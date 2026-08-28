import { type Kysely, sql } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  ClaimedSharedTaskNotification,
  SharedTaskNotificationKind,
  SharedTaskNotificationsRepository,
} from './shared-task-notifications.model.js'

interface ClaimedSharedTaskNotificationRow {
  actor_display_name: string | null
  actor_user_id: string | null
  id: string
  kind: string
  recipient_user_id: string
  task_id: string
  task_title: string
  workspace_id: string
  workspace_name: string
}

const CLAIM_TIMEOUT_INTERVAL = "interval '5 minutes'"
const MAX_DELIVERY_ATTEMPTS = 8
const MAX_RETRY_DELAY_SECONDS = 300
const RETRY_DELAY_SECONDS = 5

export class PostgresSharedTaskNotificationsRepository implements SharedTaskNotificationsRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async claimPendingNotifications(
    limit: number,
  ): Promise<ClaimedSharedTaskNotification[]> {
    await this.cancelInvalidPendingNotifications()

    const result = await sql<ClaimedSharedTaskNotificationRow>`
      with candidates as (
        select
          notification.id,
          notification.kind::text as kind,
          notification.task_id,
          task.title as task_title,
          notification.workspace_id,
          workspace.name as workspace_name,
          notification.recipient_user_id,
          notification.actor_user_id,
          actor.display_name as actor_display_name
        from app.shared_task_notifications as notification
        inner join app.tasks as task
          on task.id = notification.task_id
          and task.workspace_id = notification.workspace_id
        inner join app.workspaces as workspace
          on workspace.id = notification.workspace_id
        inner join app.users as recipient
          on recipient.id = notification.recipient_user_id
        inner join app.workspace_members as membership
          on membership.workspace_id = notification.workspace_id
          and membership.user_id = notification.recipient_user_id
        left join app.users as actor
          on actor.id = notification.actor_user_id
          and actor.deleted_at is null
        where notification.sent_at is null
          and notification.canceled_at is null
          and notification.failed_at is null
          and notification.available_at <= now()
          and (
            notification.claimed_at is null
            or notification.claimed_at <= now() - ${sql.raw(CLAIM_TIMEOUT_INTERVAL)}
          )
          and task.deleted_at is null
          and workspace.deleted_at is null
          and workspace.kind = 'shared'
          and recipient.deleted_at is null
          and membership.deleted_at is null
        order by notification.available_at asc, notification.id asc
        limit ${limit}
        for update of notification skip locked
      ),
      claimed as (
        update app.shared_task_notifications as notification
        set claimed_at = now()
        from candidates
        where notification.id = candidates.id
        returning candidates.*
      )
      select *
      from claimed
    `.execute(this.db)

    return result.rows.map(mapClaimedSharedTaskNotification)
  }

  async markDelivered(notificationId: string): Promise<void> {
    await sql`
      update app.shared_task_notifications
      set
        claimed_at = null,
        last_error = null,
        sent_at = now()
      where id = cast(${notificationId} as uuid)
        and sent_at is null
        and canceled_at is null
        and failed_at is null
    `.execute(this.db)
  }

  async markUndeliverable(
    notificationId: string,
    reason: string,
  ): Promise<void> {
    await sql`
      update app.shared_task_notifications
      set
        attempt_count = attempt_count + 1,
        claimed_at = null,
        failed_at = now(),
        last_error = left(${reason}, 1000)
      where id = cast(${notificationId} as uuid)
        and sent_at is null
        and canceled_at is null
        and failed_at is null
    `.execute(this.db)
  }

  async cancelNotification(
    notificationId: string,
    reason: string,
  ): Promise<void> {
    await sql`
      update app.shared_task_notifications
      set
        canceled_at = now(),
        claimed_at = null,
        last_error = left(${reason}, 1000)
      where id = cast(${notificationId} as uuid)
        and sent_at is null
        and canceled_at is null
        and failed_at is null
    `.execute(this.db)
  }

  async releaseClaim(notificationId: string, error: string): Promise<void> {
    await sql`
      update app.shared_task_notifications
      set
        attempt_count = attempt_count + 1,
        available_at = case
          when attempt_count + 1 >= ${MAX_DELIVERY_ATTEMPTS} then available_at
          else now() + make_interval(
            secs => least(
              ${MAX_RETRY_DELAY_SECONDS},
              ${RETRY_DELAY_SECONDS} * power(2, attempt_count)
            )
          )
        end,
        claimed_at = null,
        failed_at = case
          when attempt_count + 1 >= ${MAX_DELIVERY_ATTEMPTS} then now()
          else failed_at
        end,
        last_error = left(${error}, 1000)
      where id = cast(${notificationId} as uuid)
        and sent_at is null
        and canceled_at is null
        and failed_at is null
    `.execute(this.db)
  }

  private async cancelInvalidPendingNotifications(): Promise<void> {
    await sql`
      update app.shared_task_notifications as notification
      set
        canceled_at = now(),
        claimed_at = null,
        last_error = 'notification_no_longer_applicable'
      where notification.sent_at is null
        and notification.canceled_at is null
        and notification.failed_at is null
        and (
          notification.recipient_user_id = notification.actor_user_id
          or not exists (
            select 1
            from app.tasks as task
            inner join app.workspaces as workspace
              on workspace.id = notification.workspace_id
            inner join app.users as recipient
              on recipient.id = notification.recipient_user_id
            inner join app.workspace_members as membership
              on membership.workspace_id = notification.workspace_id
              and membership.user_id = notification.recipient_user_id
            where task.id = notification.task_id
              and task.workspace_id = notification.workspace_id
              and task.deleted_at is null
              and workspace.deleted_at is null
              and workspace.kind = 'shared'
              and recipient.deleted_at is null
              and membership.deleted_at is null
              and case notification.kind::text
                when 'shared_task_created'
                  then recipient.shared_task_created_notifications_enabled
                when 'shared_task_assigned'
                  then recipient.shared_task_assigned_notifications_enabled
                    and task.assignee_user_id = notification.recipient_user_id
                when 'shared_task_ready_for_review'
                  then recipient.shared_task_ready_for_review_notifications_enabled
                    and task.status = 'ready_for_review'
                    and task.created_by = notification.recipient_user_id
                else false
              end
          )
        )
    `.execute(this.db)
  }
}

function mapClaimedSharedTaskNotification(
  row: ClaimedSharedTaskNotificationRow,
): ClaimedSharedTaskNotification {
  return {
    actorDisplayName: row.actor_display_name,
    actorUserId: row.actor_user_id,
    id: row.id,
    kind: parseSharedTaskNotificationKind(row.kind),
    recipientUserId: row.recipient_user_id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
  }
}

function parseSharedTaskNotificationKind(
  value: string,
): SharedTaskNotificationKind {
  if (
    value === 'shared_task_created' ||
    value === 'shared_task_assigned' ||
    value === 'shared_task_ready_for_review'
  ) {
    return value
  }

  throw new Error(`Unsupported shared task notification kind: ${value}`)
}
