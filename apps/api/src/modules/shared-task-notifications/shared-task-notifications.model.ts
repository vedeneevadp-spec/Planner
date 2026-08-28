export const SHARED_TASK_NOTIFICATION_KINDS = [
  'shared_task_created',
  'shared_task_assigned',
  'shared_task_ready_for_review',
] as const

export type SharedTaskNotificationKind =
  (typeof SHARED_TASK_NOTIFICATION_KINDS)[number]

export interface ClaimedSharedTaskNotification {
  actorDisplayName: string | null
  actorUserId: string | null
  id: string
  kind: SharedTaskNotificationKind
  recipientUserId: string
  taskId: string
  taskTitle: string
  workspaceId: string
  workspaceName: string
}

export interface SharedTaskNotificationsRepository {
  cancelNotification: (notificationId: string, reason: string) => Promise<void>
  claimPendingNotifications: (
    limit: number,
  ) => Promise<ClaimedSharedTaskNotification[]>
  markDelivered: (notificationId: string) => Promise<void>
  markUndeliverable: (notificationId: string, reason: string) => Promise<void>
  releaseClaim: (notificationId: string, error: string) => Promise<void>
}

export interface SharedTaskNotificationsProcessResult {
  claimedCount: number
  deliveredCount: number
  releasedCount: number
  undeliverableCount: number
}
