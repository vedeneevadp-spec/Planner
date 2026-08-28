import assert from 'node:assert/strict'
import test from 'node:test'

import type { PushNotificationsService } from '../push-notifications/index.js'
import type {
  ClaimedSharedTaskNotification,
  SharedTaskNotificationsRepository,
} from './shared-task-notifications.model.js'
import { SharedTaskNotificationsService } from './shared-task-notifications.service.js'

interface SentNotification {
  message: Parameters<PushNotificationsService['sendNotification']>[1]
  recipient: Parameters<PushNotificationsService['sendNotification']>[0]
}

void test('SharedTaskNotificationsService sends each notification kind with navigation and deduplication data', async () => {
  const notifications = [
    createNotification({
      id: 'notification-created',
      kind: 'shared_task_created',
    }),
    createNotification({
      id: 'notification-assigned',
      kind: 'shared_task_assigned',
    }),
    createNotification({
      id: 'notification-review',
      kind: 'shared_task_ready_for_review',
    }),
  ]
  const deliveredIds: string[] = []
  const sent: SentNotification[] = []
  const service = new SharedTaskNotificationsService(
    createRepository(notifications, { deliveredIds }),
    {
      sendNotification: (
        recipient: Parameters<PushNotificationsService['sendNotification']>[0],
        message: Parameters<PushNotificationsService['sendNotification']>[1],
      ) => {
        sent.push({ message, recipient })
        return Promise.resolve({
          deliveredCount: 1,
          failedCount: 0,
          invalidTokenCount: 0,
        })
      },
    } as unknown as PushNotificationsService,
  )

  assert.deepEqual(await service.processPendingNotifications(10), {
    claimedCount: 3,
    deliveredCount: 3,
    releasedCount: 0,
    undeliverableCount: 0,
  })
  assert.deepEqual(deliveredIds, [
    'notification-created',
    'notification-assigned',
    'notification-review',
  ])
  assert.deepEqual(
    sent.map(({ message, recipient }) => ({
      body: message.body,
      data: message.data,
      notificationTag: message.notificationTag,
      recipient,
      title: message.title,
    })),
    [
      {
        body: 'Дарья: Подготовить отчёт',
        data: {
          notificationId: 'notification-created',
          path: '/today',
          taskId: 'task-1',
          type: 'shared-task-created',
          workspaceId: 'workspace-1',
        },
        notificationTag: 'shared-task-notification:notification-created',
        recipient: {
          userId: 'recipient-1',
          workspaceId: 'workspace-1',
        },
        title: 'Новая задача в «Дом»',
      },
      {
        body: 'Подготовить отчёт · Дом',
        data: {
          notificationId: 'notification-assigned',
          path: '/today',
          taskId: 'task-1',
          type: 'shared-task-assigned',
          workspaceId: 'workspace-1',
        },
        notificationTag: 'shared-task-notification:notification-assigned',
        recipient: {
          userId: 'recipient-1',
          workspaceId: 'workspace-1',
        },
        title: 'Вам назначена задача',
      },
      {
        body: 'Подготовить отчёт · Дом',
        data: {
          notificationId: 'notification-review',
          path: '/today',
          taskId: 'task-1',
          type: 'shared-task-ready-for-review',
          workspaceId: 'workspace-1',
        },
        notificationTag: 'shared-task-notification:notification-review',
        recipient: {
          userId: 'recipient-1',
          workspaceId: 'workspace-1',
        },
        title: 'Задача готова к проверке',
      },
    ],
  )
})

void test('SharedTaskNotificationsService releases retryable deliveries and thrown errors', async () => {
  const released: Array<{ error: string; id: string }> = []
  let sendCount = 0
  const service = new SharedTaskNotificationsService(
    createRepository(
      [
        createNotification({ id: 'notification-retryable' }),
        createNotification({ id: 'notification-error' }),
      ],
      { released },
    ),
    {
      sendNotification: () => {
        sendCount += 1

        if (sendCount === 1) {
          return Promise.resolve({
            deliveredCount: 0,
            failedCount: 1,
            invalidTokenCount: 0,
          })
        }

        return Promise.reject(new Error('network unavailable'))
      },
    } as unknown as PushNotificationsService,
  )

  assert.deepEqual(await service.processPendingNotifications(10), {
    claimedCount: 2,
    deliveredCount: 0,
    releasedCount: 2,
    undeliverableCount: 0,
  })
  assert.deepEqual(released, [
    {
      error: 'push_delivery_retryable',
      id: 'notification-retryable',
    },
    {
      error: 'Error: network unavailable',
      id: 'notification-error',
    },
  ])
})

for (const testCase of [
  {
    expectedReason: 'no_recipient',
    name: 'no registered device',
    result: {
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
    },
  },
  {
    expectedReason: 'invalid_recipient',
    name: 'only invalid device tokens',
    result: {
      deliveredCount: 0,
      failedCount: 2,
      invalidTokenCount: 2,
    },
  },
] as const) {
  void test(`SharedTaskNotificationsService marks ${testCase.name} as undeliverable`, async () => {
    const undeliverable: Array<{ id: string; reason: string }> = []
    const service = new SharedTaskNotificationsService(
      createRepository([createNotification()], { undeliverable }),
      {
        sendNotification: () => Promise.resolve(testCase.result),
      } as unknown as PushNotificationsService,
    )

    assert.deepEqual(await service.processPendingNotifications(10), {
      claimedCount: 1,
      deliveredCount: 0,
      releasedCount: 0,
      undeliverableCount: 1,
    })
    assert.deepEqual(undeliverable, [
      { id: 'notification-1', reason: testCase.expectedReason },
    ])
  })
}

function createNotification(
  overrides: Partial<ClaimedSharedTaskNotification> = {},
): ClaimedSharedTaskNotification {
  return {
    actorDisplayName: 'Дарья',
    actorUserId: 'actor-1',
    id: 'notification-1',
    kind: 'shared_task_created',
    recipientUserId: 'recipient-1',
    taskId: 'task-1',
    taskTitle: 'Подготовить отчёт',
    workspaceId: 'workspace-1',
    workspaceName: 'Дом',
    ...overrides,
  }
}

function createRepository(
  notifications: ClaimedSharedTaskNotification[],
  outcomes: {
    deliveredIds?: string[]
    released?: Array<{ error: string; id: string }>
    undeliverable?: Array<{ id: string; reason: string }>
  } = {},
): SharedTaskNotificationsRepository {
  return {
    cancelNotification: () => Promise.resolve(),
    claimPendingNotifications: () => Promise.resolve(notifications),
    markDelivered: (notificationId) => {
      outcomes.deliveredIds?.push(notificationId)
      return Promise.resolve()
    },
    markUndeliverable: (notificationId, reason) => {
      outcomes.undeliverable?.push({ id: notificationId, reason })
      return Promise.resolve()
    },
    releaseClaim: (notificationId, error) => {
      outcomes.released?.push({ error, id: notificationId })
      return Promise.resolve()
    },
  }
}
