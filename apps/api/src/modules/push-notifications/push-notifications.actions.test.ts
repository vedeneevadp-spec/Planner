import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  PushNotificationMessage,
  PushNotificationSender,
} from './push-notifications.model.js'
import { MemoryPushNotificationsRepository } from './push-notifications.repository.memory.js'
import { PushNotificationsService } from './push-notifications.service.js'

const recipient = { actorUserId: 'user-1', workspaceId: 'workspace-1' }

void test('only compatible Android task reminders use native actions; other versions keep visible FCM notifications', async () => {
  const repository = new MemoryPushNotificationsRepository()
  const calls: Array<{
    tokens: readonly string[]
    message: PushNotificationMessage
  }> = []
  const sender: PushNotificationSender = {
    isAvailable: () => true,
    sendToTokens(tokens, message) {
      calls.push({ tokens, message })
      return Promise.resolve({
        deliveredCount: tokens.length,
        failedCount: 0,
        invalidTokens: [],
      })
    },
  }
  const versions = [
    undefined,
    '1.1.26',
    '1.1.27',
    '1.2.0',
    '2.0.0',
    '1.1.27-beta',
    'invalid',
  ]
  for (const [index, version] of versions.entries()) {
    await repository.upsertDevice(recipient, {
      installationId: `installation-${index}`,
      token: `token-${index}`,
      platform: 'android',
      ...(version ? { appVersion: version } : {}),
    })
  }
  await repository.upsertDevice(
    { ...recipient, actorUserId: 'another-user' },
    {
      installationId: 'another-installation',
      token: 'another-token',
      platform: 'android',
      appVersion: '1.1.27',
    },
  )
  const service = new PushNotificationsService(repository, sender)
  const message = {
    title: 'Скоро задача',
    body: 'Позвонить',
    data: {
      type: 'task-reminder',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    },
  }
  assert.deepEqual(await service.sendNotification(recipient, message), {
    deliveredCount: 7,
    failedCount: 0,
    invalidTokenCount: 0,
  })
  const legacy = calls.find((call) => !call.message.androidDataOnly)!
  const native = calls.find((call) => call.message.androidDataOnly)!
  assert.deepEqual([...legacy.tokens].sort(), [
    'token-0',
    'token-1',
    'token-5',
    'token-6',
  ])
  assert.deepEqual(legacy.message, message)
  assert.deepEqual([...native.tokens].sort(), ['token-2', 'token-3', 'token-4'])
  assert.equal(native.message.data?.recipientUserId, recipient.actorUserId)
  assert.equal(native.message.data?.actionsVersion, '1')

  calls.length = 0
  await service.sendNotification(recipient, {
    ...message,
    data: { type: 'self-care-reminder' },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.message.androidDataOnly, undefined)
  assert.equal(calls[0]!.tokens.length, 7)
})

void test('one delivery group failing does not prevent the other group, and revoked tokens are removed', async () => {
  const repository = new MemoryPushNotificationsRepository()
  for (const [index, appVersion] of ['1.1.26', '1.1.27'].entries()) {
    await repository.upsertDevice(recipient, {
      installationId: `device-${index}`,
      token: `token-${index}`,
      platform: 'android',
      appVersion,
    })
  }
  const service = new PushNotificationsService(repository, {
    isAvailable: () => true,
    sendToTokens(tokens, message) {
      if (!message.androidDataOnly)
        return Promise.reject(new Error('Transient FCM error'))
      return Promise.resolve({
        deliveredCount: 0,
        failedCount: 1,
        invalidTokens: [...tokens],
      })
    },
  })
  assert.deepEqual(
    await service.sendNotification(recipient, {
      title: 'Reminder',
      body: 'Task',
      data: { type: 'task-reminder' },
    }),
    {
      deliveredCount: 0,
      failedCount: 2,
      invalidTokenCount: 1,
    },
  )
  assert.deepEqual(await repository.listActiveTokens(recipient), ['token-0'])
})
