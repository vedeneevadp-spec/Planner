import assert from 'node:assert/strict'
import test from 'node:test'

import type { PushNotificationsService } from '../push-notifications/index.js'
import type {
  DueSelfCareReminder,
  SelfCareReminderRepository,
} from './self-care-reminders.model.js'
import { SelfCareRemindersService } from './self-care-reminders.service.js'

void test('processDueReminders sends self-care push and marks it delivered', async () => {
  const reminder = createReminder()
  const repository = createRepository([reminder])
  const sentMessages: Array<{
    message: Parameters<PushNotificationsService['sendNotification']>[1]
    recipient: Parameters<PushNotificationsService['sendNotification']>[0]
  }> = []
  const service = new SelfCareRemindersService(
    repository,
    createPushService(sentMessages),
  )

  const result = await service.processDueReminders(10)

  assert.deepEqual(result, {
    claimedCount: 1,
    deliveredCount: 1,
    releasedCount: 0,
  })
  assert.deepEqual(repository.deliveredIds, [reminder.id])
  assert.deepEqual(repository.releasedIds, [])
  const recipient = sentMessages[0]?.recipient
  assert.ok(recipient && 'userId' in recipient)
  assert.equal(recipient.userId, reminder.userId)
  assert.equal(sentMessages[0]?.message.title, 'Забота о себе')
  assert.equal(sentMessages[0]?.message.body, 'Через 1 день: Стоматолог')
  assert.deepEqual(sentMessages[0]?.message.data, {
    occurrenceId: reminder.occurrenceId,
    path: '/self-care',
    selfCareItemId: reminder.itemId,
    type: 'self-care-reminder',
  })
})

void test('processDueReminders releases claim when push should retry', async () => {
  const reminder = createReminder()
  const repository = createRepository([reminder])
  const service = new SelfCareRemindersService(
    repository,
    createPushService([], {
      deliveredCount: 0,
      failedCount: 1,
      invalidTokenCount: 0,
    }),
  )

  const result = await service.processDueReminders(10)

  assert.deepEqual(result, {
    claimedCount: 1,
    deliveredCount: 0,
    releasedCount: 1,
  })
  assert.deepEqual(repository.deliveredIds, [])
  assert.deepEqual(repository.releasedIds, [reminder.id])
})

function createReminder(
  overrides: Partial<DueSelfCareReminder> = {},
): DueSelfCareReminder {
  return {
    id: 'reminder-1',
    itemId: 'item-1',
    itemTitle: 'Стоматолог',
    itemType: 'appointment',
    occurrenceId: 'occurrence-1',
    remindOffsetMinutes: 1440,
    scheduledFor: '2026-06-24',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function createRepository(reminders: DueSelfCareReminder[]) {
  const claimed = [...reminders]
  const repository: SelfCareReminderRepository & {
    deliveredIds: string[]
    releasedIds: string[]
  } = {
    deliveredIds: [],
    releasedIds: [],
    claimDueReminders() {
      return Promise.resolve(claimed)
    },
    markDelivered(reminderId) {
      this.deliveredIds.push(reminderId)
      return Promise.resolve()
    },
    releaseClaim(reminderId) {
      this.releasedIds.push(reminderId)
      return Promise.resolve()
    },
  }

  return repository
}

function createPushService(
  sentMessages: Array<{
    message: Parameters<PushNotificationsService['sendNotification']>[1]
    recipient: Parameters<PushNotificationsService['sendNotification']>[0]
  }>,
  result = {
    deliveredCount: 1,
    failedCount: 0,
    invalidTokenCount: 0,
  },
): PushNotificationsService {
  return {
    sendNotification(recipient, message) {
      sentMessages.push({ message, recipient })
      return Promise.resolve(result)
    },
  } as PushNotificationsService
}
