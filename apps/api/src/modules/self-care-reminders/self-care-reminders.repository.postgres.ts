import { type Kysely, sql } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  DueSelfCareReminder,
  SelfCareReminderRepository,
} from './self-care-reminders.model.js'

interface DueSelfCareReminderRow {
  id: string
  item_id: string
  item_title: string
  item_type: string
  occurrence_id: string
  remind_offset_minutes: number
  scheduled_for: string
  user_id: string
  workspace_id: string
}

const CLAIM_TIMEOUT_INTERVAL = "interval '5 minutes'"
const STALE_GRACE_INTERVAL = "interval '5 minutes'"

export class PostgresSelfCareReminderRepository implements SelfCareReminderRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async claimDueReminders(limit: number): Promise<DueSelfCareReminder[]> {
    await this.cancelInvalidPendingReminders()
    await this.markStalePendingRemindersDelivered()
    await this.materializeDueReminders()

    const result = await sql<DueSelfCareReminderRow>`
      with candidates as (
        select
          reminder.id,
          reminder.item_id,
          item.title as item_title,
          item.type as item_type,
          reminder.occurrence_id,
          reminder.remind_offset_minutes,
          cast(occurrence.scheduled_for as text) as scheduled_for,
          reminder.user_id,
          reminder.workspace_id
        from app.self_care_reminders as reminder
        inner join app.self_care_occurrences as occurrence
          on occurrence.id = reminder.occurrence_id
        inner join app.self_care_items as item
          on item.id = reminder.item_id
          and item.workspace_id = reminder.workspace_id
        where reminder.sent_at is null
          and reminder.canceled_at is null
          and (
            reminder.claimed_at is null
            or reminder.claimed_at <= now() - ${sql.raw(CLAIM_TIMEOUT_INTERVAL)}
          )
          and reminder.reminder_at <= now()
          and reminder.due_at > now() - ${sql.raw(STALE_GRACE_INTERVAL)}
          and occurrence.status = 'scheduled'
          and occurrence.due_at is not null
          and item.deleted_at is null
          and item.is_active = true
          and item.is_archived = false
        order by reminder.reminder_at asc, reminder.created_at asc
        limit ${limit}
        for update skip locked
      ),
      claimed as (
        update app.self_care_reminders as reminder
        set claimed_at = now()
        from candidates
        where reminder.id = candidates.id
        returning candidates.*
      )
      select *
      from claimed
    `.execute(this.db)

    return result.rows.map(mapDueSelfCareReminder)
  }

  async markDelivered(reminderId: string): Promise<void> {
    await this.db
      .updateTable('app.self_care_reminders')
      .set({
        claimed_at: null,
        sent_at: new Date().toISOString(),
      })
      .where('id', '=', reminderId)
      .execute()
  }

  async releaseClaim(reminderId: string): Promise<void> {
    await this.db
      .updateTable('app.self_care_reminders')
      .set({
        claimed_at: null,
      })
      .where('id', '=', reminderId)
      .execute()
  }

  private async cancelInvalidPendingReminders(): Promise<void> {
    await sql`
      update app.self_care_reminders as reminder
      set
        canceled_at = now(),
        claimed_at = null
      from app.self_care_occurrences as occurrence
      inner join app.self_care_items as item
        on item.id = occurrence.item_id
      left join app.self_care_schedule_rules as rule
        on rule.id = occurrence.schedule_rule_id
      where reminder.occurrence_id = occurrence.id
        and reminder.sent_at is null
        and reminder.canceled_at is null
        and (
          occurrence.status <> 'scheduled'
          or occurrence.due_at is null
          or item.deleted_at is not null
          or item.is_active = false
          or item.is_archived = true
          or not exists (
            select 1
            from unnest(
              case
                when cardinality(occurrence.reminder_offsets_minutes) > 0
                then occurrence.reminder_offsets_minutes
                else coalesce(rule.reminder_offsets_minutes, array[]::integer[])
              end
            ) as configured_offset(offset_minutes)
            where configured_offset.offset_minutes = reminder.remind_offset_minutes
          )
        )
    `.execute(this.db)
  }

  private async markStalePendingRemindersDelivered(): Promise<void> {
    await sql`
      update app.self_care_reminders as reminder
      set
        claimed_at = null,
        sent_at = now()
      where reminder.sent_at is null
        and reminder.canceled_at is null
        and reminder.due_at <= now() - ${sql.raw(STALE_GRACE_INTERVAL)}
    `.execute(this.db)
  }

  private async materializeDueReminders(): Promise<void> {
    await sql`
      with candidate_reminders as (
        select
          item.workspace_id,
          occurrence.user_id,
          occurrence.item_id,
          occurrence.id as occurrence_id,
          rule.id as schedule_rule_id,
          reminder_offset.offset_minutes as remind_offset_minutes,
          occurrence.due_at,
          (
            occurrence.due_at
            - make_interval(mins => reminder_offset.offset_minutes)
          ) as reminder_at,
          coalesce(
            nullif(btrim(occurrence.reminder_time_zone), ''),
            nullif(btrim(rule.timezone), ''),
            'UTC'
          ) as time_zone
        from app.self_care_occurrences as occurrence
        inner join app.self_care_items as item
          on item.id = occurrence.item_id
        left join app.self_care_schedule_rules as rule
          on rule.id = occurrence.schedule_rule_id
        cross join lateral (
          select distinct offset_minutes
          from unnest(
            case
              when cardinality(occurrence.reminder_offsets_minutes) > 0
              then occurrence.reminder_offsets_minutes
              else coalesce(rule.reminder_offsets_minutes, array[]::integer[])
            end
          ) as configured_offset(offset_minutes)
          where offset_minutes >= 0
            and offset_minutes <= 43200
        ) as reminder_offset
        where occurrence.status = 'scheduled'
          and occurrence.due_at is not null
          and occurrence.due_at > now() - ${sql.raw(STALE_GRACE_INTERVAL)}
          and item.deleted_at is null
          and item.is_active = true
          and item.is_archived = false
      )
      insert into app.self_care_reminders (
        workspace_id,
        user_id,
        item_id,
        occurrence_id,
        schedule_rule_id,
        remind_offset_minutes,
        due_at,
        reminder_at,
        time_zone,
        claimed_at,
        sent_at,
        canceled_at
      )
      select
        workspace_id,
        user_id,
        item_id,
        occurrence_id,
        schedule_rule_id,
        remind_offset_minutes,
        due_at,
        reminder_at,
        time_zone,
        null,
        null,
        null
      from candidate_reminders
      where reminder_at <= now()
      on conflict (occurrence_id, remind_offset_minutes) do update
      set
        workspace_id = excluded.workspace_id,
        user_id = excluded.user_id,
        item_id = excluded.item_id,
        schedule_rule_id = excluded.schedule_rule_id,
        due_at = excluded.due_at,
        reminder_at = excluded.reminder_at,
        time_zone = excluded.time_zone,
        claimed_at = null,
        canceled_at = null,
        sent_at = case
          when app.self_care_reminders.due_at = excluded.due_at
            and app.self_care_reminders.reminder_at = excluded.reminder_at
            and app.self_care_reminders.time_zone = excluded.time_zone
          then app.self_care_reminders.sent_at
          else null
        end
    `.execute(this.db)
  }
}

function mapDueSelfCareReminder(
  row: DueSelfCareReminderRow,
): DueSelfCareReminder {
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    itemType: row.item_type,
    occurrenceId: row.occurrence_id,
    remindOffsetMinutes: row.remind_offset_minutes,
    scheduledFor: row.scheduled_for,
    userId: row.user_id,
    workspaceId: row.workspace_id,
  }
}
