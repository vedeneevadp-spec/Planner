export interface DueTaskReminder {
  id: string
  plannedDate: string
  plannedStartTime: string
  remindOffsetMinutes: number
  taskId: string
  taskTitle: string
  userId: string
  workspaceId: string
}

export interface TaskReminderRepository {
  claimDueReminders: (limit: number) => Promise<DueTaskReminder[]>
  markDelivered: (reminderId: string) => Promise<void>
  markUndeliverable: (reminderId: string, reason: string) => Promise<void>
  releaseClaim: (reminderId: string, error: string) => Promise<void>
}

export interface TaskReminderProcessResult {
  claimedCount: number
  deliveredCount: number
  releasedCount: number
  undeliverableCount: number
}
