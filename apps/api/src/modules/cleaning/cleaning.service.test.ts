import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleaningTaskActionInputSchema,
  newCleaningTaskInputSchema,
  newCleaningZoneInputSchema,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import { MemoryCleaningRepository } from './cleaning.repository.memory.js'
import { CleaningService } from './cleaning.service.js'

const OWNER_CONTEXT = {
  actorUserId: 'user-1',
  auth: null,
  groupRole: null,
  role: 'owner' as const,
  workspaceId: 'workspace-1',
  workspaceKind: 'personal' as const,
}

const GUEST_CONTEXT = {
  ...OWNER_CONTEXT,
  role: 'guest' as const,
}

void test('CleaningService rejects guest writes', async () => {
  const service = new CleaningService(new MemoryCleaningRepository())

  await assert.rejects(
    Promise.resolve().then(() =>
      service.createZone(
        GUEST_CONTEXT,
        newCleaningZoneInputSchema.parse({
          dayOfWeek: 1,
          title: 'Кухня',
        }),
      ),
    ),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'workspace_write_forbidden',
  )
})

void test('CleaningService promotes postponed tasks and resets counter on completion', async () => {
  const service = new CleaningService(new MemoryCleaningRepository())
  const zone = await service.createZone(
    OWNER_CONTEXT,
    newCleaningZoneInputSchema.parse({
      dayOfWeek: 1,
      title: 'Кухня',
    }),
  )
  const task = await service.createTask(
    OWNER_CONTEXT,
    newCleaningTaskInputSchema.parse({
      estimatedMinutes: 30,
      priority: 'normal',
      title: 'Помыть холодильник',
      zoneId: zone.id,
    }),
  )

  await service.postponeTask(
    OWNER_CONTEXT,
    task.id,
    cleaningTaskActionInputSchema.parse({
      date: '2026-05-11',
    }),
  )
  await service.postponeTask(
    OWNER_CONTEXT,
    task.id,
    cleaningTaskActionInputSchema.parse({
      date: '2026-05-18',
    }),
  )

  const postponedToday = await service.getToday(OWNER_CONTEXT, '2026-05-25')

  assert.equal(postponedToday.urgentItems[0]?.task.id, task.id)
  assert.equal(postponedToday.urgentItems[0]?.state.postponeCount, 2)

  await service.completeTask(
    OWNER_CONTEXT,
    task.id,
    cleaningTaskActionInputSchema.parse({
      date: '2026-05-25',
    }),
  )

  const sameDayAfterCompletion = await service.getToday(
    OWNER_CONTEXT,
    '2026-05-25',
  )

  assert.equal(
    sameDayAfterCompletion.items.some((item) => item.task.id === task.id),
    false,
  )
  assert.equal(sameDayAfterCompletion.summary.completedTodayCount, 1)

  const duplicateCompletion = await service.completeTask(
    OWNER_CONTEXT,
    task.id,
    cleaningTaskActionInputSchema.parse({
      date: '2026-05-25',
    }),
  )
  const historyAfterDuplicate = await service.listCleaning(OWNER_CONTEXT)

  assert.equal(duplicateCompletion.historyItem.action, 'completed')
  assert.equal(
    historyAfterDuplicate.history.filter(
      (item) =>
        item.taskId === task.id &&
        item.action === 'completed' &&
        item.date === '2026-05-25',
    ).length,
    1,
  )

  const completedToday = await service.getToday(OWNER_CONTEXT, '2026-06-01')
  const completedTask = completedToday.items.find(
    (item) => item.task.id === task.id,
  )

  assert.equal(completedTask?.state.postponeCount, 0)
  assert.equal(completedTask?.state.nextDueAt, '2026-06-01')
})
