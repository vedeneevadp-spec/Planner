import type { PushTestNotificationResponse } from './push-notifications.model.js'

export type ReminderPushDeliveryOutcome =
  'delivered' | 'invalid_recipient' | 'no_recipient' | 'retryable'

export function classifyReminderPushDelivery(
  result: PushTestNotificationResponse,
): ReminderPushDeliveryOutcome {
  if (result.deliveredCount > 0) {
    return 'delivered'
  }

  if (
    result.invalidTokenCount > 0 &&
    result.failedCount <= result.invalidTokenCount
  ) {
    return 'invalid_recipient'
  }

  if (result.failedCount === 0) {
    return 'no_recipient'
  }

  return 'retryable'
}
