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
  task_id: string
  task_title: string
  user_id: string
  workspace_id: string
}

const CLAIM_TIMEOUT_INTERVAL = "interval '5 minutes'"
const STALE_GRACE_INTERVAL = "interval '5 minutes'"

export class PostgresTaskReminderRepository implements TaskReminderRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async claimDueReminders(limit: number): Promise<DueTaskReminder[]> {
    await sql`
      update app.task_reminders as reminder
      set
        claimed_at = null,
        sent_at = now()
      where reminder.sent_at is null
        and reminder.canceled_at is null
        and ${reminderStartAtSql('reminder')} <= now() - ${sql.raw(STALE_GRACE_INTERVAL)}
    `.execute(this.db)

    const result = await sql<DueTaskReminderRow>`
      with candidates as (
        select
          reminder.id,
          cast(reminder.planned_date as text) as planned_date,
          to_char(reminder.planned_start_time, 'HH24:MI') as planned_start_time,
          reminder.task_id,
          task.title as task_title,
          reminder.user_id,
          reminder.workspace_id
        from app.task_reminders as reminder
        inner join app.tasks as task
          on task.id = reminder.task_id
          and task.workspace_id = reminder.workspace_id
        where reminder.sent_at is null
          and reminder.canceled_at is null
          and (
            reminder.claimed_at is null
            or reminder.claimed_at <= now() - ${sql.raw(CLAIM_TIMEOUT_INTERVAL)}
          )
          and task.deleted_at is null
          and task.status <> 'done'
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
        sent_at: new Date().toISOString(),
      })
      .where('id', '=', reminderId)
      .execute()
  }

  async releaseClaim(reminderId: string): Promise<void> {
    await this.db
      .updateTable('app.task_reminders')
      .set({
        claimed_at: null,
      })
      .where('id', '=', reminderId)
      .execute()
  }
}

function mapDueTaskReminder(row: DueTaskReminderRow): DueTaskReminder {
  return {
    id: row.id,
    plannedDate: row.planned_date,
    plannedStartTime: row.planned_start_time,
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
