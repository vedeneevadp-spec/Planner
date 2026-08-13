import { type Kysely, sql } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  DueTaskReminder,
  TaskReminderRepository,
} from './task-reminders.model.js'

interface DueTaskReminderRow {
  id: string
  planned_date: string
  planned_start_time: string
  remind_offset_minutes: number
  task_id: string
  task_title: string
  user_id: string
  workspace_id: string
}

const CLAIM_TIMEOUT_INTERVAL = "interval '5 minutes'"
const STALE_GRACE_INTERVAL = "interval '5 minutes'"
const MAX_DELIVERY_ATTEMPTS = 8

export class PostgresTaskReminderRepository implements TaskReminderRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async claimDueReminders(limit: number): Promise<DueTaskReminder[]> {
    await sql`
      update app.task_reminders as reminder
      set
        claimed_at = null,
        expired_at = now(),
        last_error = 'delivery_window_expired'
      where reminder.sent_at is null
        and reminder.expired_at is null
        and reminder.failed_at is null
        and reminder.canceled_at is null
        and ${reminderStartAtSql('reminder')} <= now() - ${sql.raw(STALE_GRACE_INTERVAL)}
    `.execute(this.db)

    const result = await sql<DueTaskReminderRow>`
      with candidates as (
        select
          reminder.id,
          cast(reminder.planned_date as text) as planned_date,
          to_char(reminder.planned_start_time, 'HH24:MI') as planned_start_time,
          reminder.remind_offset_minutes,
          reminder.task_id,
          task.title as task_title,
          reminder.user_id,
          reminder.workspace_id
        from app.task_reminders as reminder
        inner join app.tasks as task
          on task.id = reminder.task_id
          and task.workspace_id = reminder.workspace_id
        where reminder.sent_at is null
          and reminder.expired_at is null
          and reminder.failed_at is null
          and reminder.canceled_at is null
          and (
            reminder.claimed_at is null
            or reminder.claimed_at <= now() - ${sql.raw(CLAIM_TIMEOUT_INTERVAL)}
          )
          and task.deleted_at is null
          and task.status not in ('done', 'archived')
          and ${reminderDueAtSql('reminder')} <= now()
          and ${reminderStartAtSql('reminder')} > now() - ${sql.raw(STALE_GRACE_INTERVAL)}
        order by ${reminderDueAtSql('reminder')} asc, reminder.created_at asc
        limit ${limit}
        for update skip locked
      ),
      claimed as (
        update app.task_reminders as reminder
        set claimed_at = now()
        from candidates
        where reminder.id = candidates.id
        returning candidates.*
      )
      select *
      from claimed
    `.execute(this.db)

    return result.rows.map(mapDueTaskReminder)
  }

  async markDelivered(reminderId: string): Promise<void> {
    await this.db
      .updateTable('app.task_reminders')
      .set({
        claimed_at: null,
        last_error: null,
        sent_at: new Date().toISOString(),
      })
      .where('id', '=', reminderId)
      .where('expired_at', 'is', null)
      .where('failed_at', 'is', null)
      .where('canceled_at', 'is', null)
      .execute()
  }

  async markUndeliverable(reminderId: string, reason: string): Promise<void> {
    await sql`
      update app.task_reminders
      set
        attempt_count = attempt_count + 1,
        claimed_at = null,
        failed_at = now(),
        last_error = left(${reason}, 1000)
      where id = cast(${reminderId} as uuid)
        and sent_at is null
        and expired_at is null
        and failed_at is null
        and canceled_at is null
    `.execute(this.db)
  }

  async releaseClaim(reminderId: string, error: string): Promise<void> {
    await sql`
      update app.task_reminders
      set
        attempt_count = attempt_count + 1,
        claimed_at = null,
        failed_at = case
          when attempt_count + 1 >= ${MAX_DELIVERY_ATTEMPTS} then now()
          else failed_at
        end,
        last_error = left(${error}, 1000)
      where id = cast(${reminderId} as uuid)
        and sent_at is null
        and expired_at is null
        and canceled_at is null
    `.execute(this.db)
  }
}

function mapDueTaskReminder(row: DueTaskReminderRow): DueTaskReminder {
  return {
    id: row.id,
    plannedDate: row.planned_date,
    plannedStartTime: row.planned_start_time,
    remindOffsetMinutes: row.remind_offset_minutes,
    taskId: row.task_id,
    taskTitle: row.task_title,
    userId: row.user_id,
    workspaceId: row.workspace_id,
  }
}

function reminderDueAtSql(alias: string) {
  return sql.raw(
    `(${reminderStartAtExpression(alias)} - make_interval(mins => ${alias}.remind_offset_minutes))`,
  )
}

function reminderStartAtSql(alias: string) {
  return sql.raw(reminderStartAtExpression(alias))
}

function reminderStartAtExpression(alias: string): string {
  return `make_timestamptz(
    extract(year from ${alias}.planned_date)::int,
    extract(month from ${alias}.planned_date)::int,
    extract(day from ${alias}.planned_date)::int,
    extract(hour from ${alias}.planned_start_time)::int,
    extract(minute from ${alias}.planned_start_time)::int,
    0,
    ${alias}.time_zone
  )`
}
