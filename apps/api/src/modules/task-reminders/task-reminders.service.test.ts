import assert from 'node:assert/strict'
import test from 'node:test'

import { TaskRemindersService } from './task-reminders.service.js'

void test('TaskRemindersService marks reminder as delivered after successful push', async () => {
  const deliveredIds: string[] = []
  const releasedIds: string[] = []
  const service = new TaskRemindersService(
    {
      claimDueReminders: () =>
        Promise.resolve([
          {
            id: 'reminder-1',
            plannedDate: '2026-05-05',
            plannedStartTime: '09:00',
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
  })
})

void test('TaskRemindersService releases reminder claim when push should be retried', async () => {
  const deliveredIds: string[] = []
  const releasedIds: string[] = []
  const service = new TaskRemindersService(
    {
      claimDueReminders: () =>
        Promise.resolve([
          {
            id: 'reminder-2',
            plannedDate: '2026-05-05',
            plannedStartTime: '09:00',
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
  })
})
