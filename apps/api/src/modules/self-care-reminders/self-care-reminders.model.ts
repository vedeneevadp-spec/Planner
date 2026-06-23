export interface DueSelfCareReminder {
  id: string
  itemId: string
  itemTitle: string
  itemType: string
  occurrenceId: string
  remindOffsetMinutes: number
  scheduledFor: string
  userId: string
  workspaceId: string
}

export interface SelfCareReminderRepository {
  claimDueReminders: (limit: number) => Promise<DueSelfCareReminder[]>
  markDelivered: (reminderId: string) => Promise<void>
  releaseClaim: (reminderId: string) => Promise<void>
}

export interface SelfCareReminderProcessResult {
  claimedCount: number
  deliveredCount: number
  releasedCount: number
}
