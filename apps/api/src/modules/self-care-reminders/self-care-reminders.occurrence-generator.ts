import { addDateDays, getDateKeyInTimeZone } from '@planner/contracts'
import { type Kysely, sql, type Transaction } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import {
  mapCompletionRow,
  mapCourseRow,
  mapItemRow,
  mapOccurrenceRow,
  mapRuleRow,
} from '../self-care/self-care.repository.postgres.helpers.js'
import { generateSelfCareOccurrencesForRange } from '../self-care/self-care.shared.js'

// The longest supported reminder offset is 30 days. Keep an extra local day
// ahead of that boundary so early reminders also exist across DST changes.
const LOOKAHEAD_DAYS = 31
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
const DELIVERY_GRACE_MS = 5 * 60 * 1000
const DEFAULT_BATCH_SIZE = 100
const MAX_BATCHES_PER_POLL = 20
const GENERATION_BUDGET_MS = 10_000

export class PostgresSelfCareReminderOccurrenceGenerator {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async materializeUpcomingOccurrences(
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<number> {
    const limit = Math.max(1, Math.min(batchSize, DEFAULT_BATCH_SIZE))
    const startedAt = Date.now()
    let processed = 0
    for (let batch = 0; batch < MAX_BATCHES_PER_POLL; batch += 1) {
      const count = await this.materializeBatch(limit)
      processed += count
      if (count < limit || Date.now() - startedAt >= GENERATION_BUDGET_MS) break
    }
    return processed
  }

  private async materializeBatch(batchSize: number): Promise<number> {
    const now = this.now()
    const refreshBefore = new Date(now.getTime() - REFRESH_INTERVAL_MS)

    const generate = async (trx: Transaction<DatabaseSchema>) => {
      const candidates = await sql<{ id: string; rule_id: string }>`
        select item.id, rule.id as rule_id
        from app.self_care_items as item
        inner join app.self_care_schedule_rules as rule on rule.item_id = item.id
        left join app.self_care_reminder_generation as generation
          on generation.schedule_rule_id = rule.id
        where item.deleted_at is null
          and item.is_active = true
          and item.is_archived = false
          and rule.repeat_kind not in ('none', 'flexible_goal')
          and rule.preferred_time is not null
          and cardinality(rule.reminder_offsets_minutes) > 0
          and (
            rule.start_date is null
            or rule.start_date <= (${now.toISOString()}::timestamptz at time zone 'UTC')::date + 32
          )
          and (
            rule.end_date is null
            or rule.end_date >= (${now.toISOString()}::timestamptz at time zone 'UTC')::date - 2
          )
          and (
            generation.checked_at is null
            or generation.checked_at <= ${refreshBefore.toISOString()}::timestamptz
            or generation.checked_at < rule.updated_at
            or generation.checked_at < item.updated_at
            or exists (
              select 1 from app.self_care_course_details as course
              where course.item_id = item.id
                and course.updated_at > generation.checked_at
            )
            or (
              rule.repeat_kind = 'after_completion'
              and exists (
                select 1 from app.self_care_completions as completion
                where completion.item_id = item.id
                  and completion.updated_at > generation.checked_at
              )
            )
          )
        order by generation.checked_at asc nulls first, rule.id asc
        limit ${batchSize}
        for update of item skip locked
      `.execute(trx)

      // Lock the item before reading its rule, just like schedule edits and
      // interactive generation. A stale background read cannot recreate the
      // previous schedule after a concurrent edit has committed.
      for (const candidate of candidates.rows) {
        await sql`savepoint self_care_reminder_generation_item`.execute(trx)
        try {
          await this.materializeItem(trx, candidate.id, candidate.rule_id, now)
        } catch (error) {
          await sql`rollback to savepoint self_care_reminder_generation_item`.execute(
            trx,
          )
          const code = (error as { code?: unknown } | null)?.code
          // Transport, permission and transaction failures need worker recovery.
          // A malformed persisted rule must not block all other reminders.
          if (typeof code === 'string' && !/^(22|23)/.test(code)) throw error
          console.error('Self-care reminder occurrence generation failed.', {
            error,
            itemId: candidate.id,
            scheduleRuleId: candidate.rule_id,
          })
        }
        await sql`release savepoint self_care_reminder_generation_item`.execute(
          trx,
        )
        await this.markChecked(trx, candidate.rule_id, now)
      }

      return candidates.rows.length
    }

    return this.db.isTransaction
      ? generate(this.db as Transaction<DatabaseSchema>)
      : this.db.transaction().execute(generate)
  }

  private async materializeItem(
    trx: Transaction<DatabaseSchema>,
    itemId: string,
    ruleId: string,
    now: Date,
  ): Promise<void> {
    const itemRow = await trx
      .selectFrom('app.self_care_items')
      .selectAll()
      .where('id', '=', itemId)
      .executeTakeFirstOrThrow()
    const ruleRow = await trx
      .selectFrom('app.self_care_schedule_rules')
      .selectAll()
      .where('item_id', '=', itemId)
      .where('id', '=', ruleId)
      .executeTakeFirst()

    if (!ruleRow) return

    const item = mapItemRow(itemRow)
    const rule = mapRuleRow(ruleRow)
    const timeZone = rule.timezone ?? 'UTC'
    const from = getDateKeyInTimeZone(
      new Date(now.getTime() - DELIVERY_GRACE_MS),
      timeZone,
    )
    const to = addDateDays(getDateKeyInTimeZone(now, timeZone), LOOKAHEAD_DAYS)
    const [occurrences, course, completions] = await Promise.all([
      trx
        .selectFrom('app.self_care_occurrences')
        .selectAll()
        .where('item_id', '=', itemId)
        .where('scheduled_for', '>=', from)
        .where('scheduled_for', '<=', to)
        .execute(),
      trx
        .selectFrom('app.self_care_course_details')
        .selectAll()
        .where('item_id', '=', itemId)
        .executeTakeFirst(),
      rule.repeatKind === 'after_completion'
        ? trx
            .selectFrom('app.self_care_completions')
            .selectAll()
            .where('item_id', '=', itemId)
            .where('status', 'in', ['done', 'partial', 'alternative_done'])
            .orderBy('completed_at', 'desc')
            .limit(1)
            .execute()
        : Promise.resolve([]),
    ])
    const generated = generateSelfCareOccurrencesForRange({
      completions: completions.map(mapCompletionRow),
      courseDetails: course ? mapCourseRow(course) : null,
      existingOccurrences: occurrences.map(mapOccurrenceRow),
      from,
      item,
      scheduleRule: rule,
      to,
    })

    if (generated.length > 0) {
      await trx
        .insertInto('app.self_care_occurrences')
        .values(
          generated.map((occurrence) => ({
            completed_at: occurrence.completedAt,
            created_by: item.userId,
            due_at: occurrence.dueAt,
            generated_at: occurrence.generatedAt,
            id: occurrence.id,
            item_id: itemId,
            moved_to: occurrence.movedTo,
            reminder_offsets_minutes: occurrence.reminderOffsetsMinutes,
            reminder_time_zone: occurrence.reminderTimeZone,
            scheduled_for: occurrence.scheduledFor,
            schedule_rule_id: occurrence.scheduleRuleId,
            status: occurrence.status,
            updated_by: item.userId,
            user_id: item.userId,
          })),
        )
        .onConflict((conflict) => conflict.doNothing())
        .execute()
    }
  }

  private async markChecked(
    trx: Transaction<DatabaseSchema>,
    ruleId: string,
    now: Date,
  ): Promise<void> {
    // Commit progress with the generated records. Failed rules are logged and
    // retried after the refresh interval (or immediately after a user edit).
    await sql`
      insert into app.self_care_reminder_generation (schedule_rule_id, checked_at)
      values (${ruleId}::uuid, ${now.toISOString()}::timestamptz)
      on conflict (schedule_rule_id) do update
      set checked_at = excluded.checked_at
    `.execute(trx)
  }
}
