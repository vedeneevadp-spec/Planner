export interface DueSelfCareReminder {
  /** Exact PostgreSQL timestamp text; retain its precision when confirming the claim. */
  claimedAt: string
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

export type SelfCareReminderClaim = Pick<
  DueSelfCareReminder,
  'id' | 'claimedAt'
>

export interface SelfCareReminderRepository {
  claimDueReminders: (limit: number) => Promise<DueSelfCareReminder[]>
  markDelivered: (claim: SelfCareReminderClaim) => Promise<boolean>
  markUndeliverable: (
    claim: SelfCareReminderClaim,
    reason: string,
  ) => Promise<boolean>
  releaseClaim: (
    claim: SelfCareReminderClaim,
    error: string,
  ) => Promise<boolean>
}

export interface SelfCareReminderProcessResult {
  claimedCount: number
  deliveredCount: number
  releasedCount: number
  undeliverableCount: number
}
