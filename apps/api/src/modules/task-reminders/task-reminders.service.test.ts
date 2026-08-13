import assert from 'node:assert/strict'
import test from 'node:test'

import { TaskRemindersService } from './task-reminders.service.js'

void test('TaskRemindersService marks reminder as delivered after successful push', async () => {
  const deliveredIds: string[] = []
  const releasedIds: string[] = []
  const undeliverable: Array<{ id: string; reason: string }> = []
  const service = new TaskRemindersService(
    {
      claimDueReminders: () =>
        Promise.resolve([
          {
            id: 'reminder-1',
            plannedDate: '2026-05-05',
            plannedStartTime: '09:00',
            remindOffsetMinutes: 15,
            taskId: 'task-1',
            taskTitle: 'Prepare weekly plan',
            userId: 'user-1',
            workspaceId: 'workspace-1',
          },
        ]),
      markDelivered: (reminderId: string) => {
        deliveredIds.push(reminderId)
        return Promise.resolve()
      },
      markUndeliverable: (reminderId: string, reason: string) => {
        undeliverable.push({ id: reminderId, reason })
        return Promise.resolve()
      },
      releaseClaim: (reminderId: string) => {
        releasedIds.push(reminderId)
        return Promise.resolve()
      },
    },
    {
      sendNotification: () =>
        Promise.resolve({
          deliveredCount: 1,
          failedCount: 0,
          invalidTokenCount: 0,
        }),
    } as never,
  )

  const result = await service.processDueReminders(10)

  assert.deepEqual(deliveredIds, ['reminder-1'])
  assert.deepEqual(releasedIds, [])
  assert.deepEqual(result, {
    claimedCount: 1,
    deliveredCount: 1,
    releasedCount: 0,
    undeliverableCount: 0,
  })
  assert.deepEqual(undeliverable, [])
})

void test('TaskRemindersService releases reminder claim when push should be retried', async () => {
  const deliveredIds: string[] = []
  const releasedIds: string[] = []
  const undeliverable: Array<{ id: string; reason: string }> = []
  const service = new TaskRemindersService(
    {
      claimDueReminders: () =>
        Promise.resolve([
          {
            id: 'reminder-2',
            plannedDate: '2026-05-05',
            plannedStartTime: '09:00',
            remindOffsetMinutes: 30,
            taskId: 'task-2',
            taskTitle: 'Inbox cleanup',
            userId: 'user-2',
            workspaceId: 'workspace-2',
          },
        ]),
      markDelivered: (reminderId: string) => {
        deliveredIds.push(reminderId)
        return Promise.resolve()
      },
      markUndeliverable: (reminderId: string, reason: string) => {
        undeliverable.push({ id: reminderId, reason })
        return Promise.resolve()
      },
      releaseClaim: (reminderId: string) => {
        releasedIds.push(reminderId)
        return Promise.resolve()
      },
    },
    {
      sendNotification: () =>
        Promise.resolve({
          deliveredCount: 0,
          failedCount: 1,
          invalidTokenCount: 0,
        }),
    } as never,
  )

  const result = await service.processDueReminders(10)

  assert.deepEqual(deliveredIds, [])
  assert.deepEqual(releasedIds, ['reminder-2'])
  assert.deepEqual(result, {
    claimedCount: 1,
    deliveredCount: 0,
    releasedCount: 1,
    undeliverableCount: 0,
  })
  assert.deepEqual(undeliverable, [])
})

for (const testCase of [
  {
    expectedReason: 'no_recipient',
    name: 'no registered recipient',
    pushResult: {
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
    },
  },
  {
    expectedReason: 'invalid_recipient',
    name: 'only invalid recipients',
    pushResult: {
      deliveredCount: 0,
      failedCount: 2,
      invalidTokenCount: 2,
    },
  },
] as const) {
  void test(`TaskRemindersService marks ${testCase.name} as undeliverable`, async () => {
    const deliveredIds: string[] = []
    const releasedIds: string[] = []
    const undeliverable: Array<{ id: string; reason: string }> = []
    const service = new TaskRemindersService(
      {
        claimDueReminders: () =>
          Promise.resolve([
            {
              id: 'reminder-terminal',
              plannedDate: '2026-05-05',
              plannedStartTime: '09:00',
              remindOffsetMinutes: 15,
              taskId: 'task-terminal',
              taskTitle: 'Terminal reminder',
              userId: 'user-terminal',
              workspaceId: 'workspace-terminal',
            },
          ]),
        markDelivered: (reminderId) => {
          deliveredIds.push(reminderId)
          return Promise.resolve()
        },
        markUndeliverable: (reminderId, reason) => {
          undeliverable.push({ id: reminderId, reason })
          return Promise.resolve()
        },
        releaseClaim: (reminderId) => {
          releasedIds.push(reminderId)
          return Promise.resolve()
        },
      },
      {
        sendNotification: () => Promise.resolve(testCase.pushResult),
      } as never,
    )

    const result = await service.processDueReminders(10)

    assert.deepEqual(deliveredIds, [])
    assert.deepEqual(releasedIds, [])
    assert.deepEqual(undeliverable, [
      { id: 'reminder-terminal', reason: testCase.expectedReason },
    ])
    assert.deepEqual(result, {
      claimedCount: 1,
      deliveredCount: 0,
      releasedCount: 0,
      undeliverableCount: 1,
    })
  })
}
