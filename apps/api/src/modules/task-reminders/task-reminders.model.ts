export interface DueTaskReminder {
  id: string
  plannedDate: string
  plannedStartTime: string
  taskId: string
  taskTitle: string
  userId: string
  workspaceId: string
}

export interface TaskReminderRepository {
  claimDueReminders: (limit: number) => Promise<DueTaskReminder[]>
  markDelivered: (reminderId: string) => Promise<void>
  releaseClaim: (reminderId: string) => Promise<void>
}

export interface TaskReminderProcessResult {
  claimedCount: number
  deliveredCount: number
  releasedCount: number
}
