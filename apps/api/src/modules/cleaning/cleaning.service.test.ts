import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleaningTaskActionInputSchema,
  cleaningZoneUpdateInputSchema,
  generateUuidV7,
  newCleaningTaskInputSchema,
  newCleaningZoneInputSchema,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import { MemoryCleaningRepository } from './cleaning.repository.memory.js'
import { CleaningService } from './cleaning.service.js'
import { getIsoWeekday } from './cleaning.shared.js'

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

  const completedAction = await service.completeTask(
    OWNER_CONTEXT,
    task.id,
    cleaningTaskActionInputSchema.parse({
      date: '2026-05-25',
    }),
  )

  assert.equal(completedAction.state.postponeCount, 0)

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

void test('CleaningService accumulates untouched zone tasks after their assigned day passes', async () => {
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
      estimatedMinutes: 20,
      priority: 'normal',
      title: 'Помыть плиту',
      zoneId: zone.id,
    }),
  )
  const taskCreatedDate = task.createdAt.slice(0, 10)

  await service.updateZone(
    OWNER_CONTEXT,
    zone.id,
    cleaningZoneUpdateInputSchema.parse({
      dayOfWeek: getIsoWeekday(taskCreatedDate),
    }),
  )

  const assignedDay = await service.getToday(OWNER_CONTEXT, taskCreatedDate)

  assert.equal(
    assignedDay.items.some((item) => item.task.id === task.id),
    true,
  )
  assert.equal(
    assignedDay.accumulatedItems.some((item) => item.task.id === task.id),
    false,
  )

  const nextDay = await service.getToday(
    OWNER_CONTEXT,
    addDaysToDateKey(taskCreatedDate, 1),
  )

  assert.equal(
    nextDay.items.some((item) => item.task.id === task.id),
    false,
  )
  assert.equal(
    nextDay.accumulatedItems.some((item) => item.task.id === task.id),
    true,
  )
  assert.equal(nextDay.summary.accumulatedCount, 1)
})

void test('CleaningService includes seasonal tasks in the general flow only during configured months', async () => {
  const service = new CleaningService(new MemoryCleaningRepository())
  const task = await service.createTask(
    OWNER_CONTEXT,
    newCleaningTaskInputSchema.parse({
      isSeasonal: true,
      scope: 'general',
      seasonMonths: [12],
      title: 'Полить растения',
    }),
  )

  const activeMonth = await service.getToday(OWNER_CONTEXT, '2099-12-01')
  const inactiveMonth = await service.getToday(OWNER_CONTEXT, '2099-11-01')

  assert.equal(
    activeMonth.generalItems.some((item) => item.task.id === task.id),
    true,
  )
  assert.equal(
    inactiveMonth.generalItems.some((item) => item.task.id === task.id),
    false,
  )
})

void test('CleaningService never overwrites stable ids owned by another scope or a deleted row', async () => {
  const repository = new MemoryCleaningRepository()
  const service = new CleaningService(repository)
  const otherContext = {
    ...OWNER_CONTEXT,
    actorUserId: 'user-2',
    workspaceId: 'workspace-2',
  }
  const zoneId = generateUuidV7()
  const firstZone = await service.createZone(
    OWNER_CONTEXT,
    newCleaningZoneInputSchema.parse({
      dayOfWeek: 1,
      id: zoneId,
      title: 'First zone',
    }),
  )

  await assert.rejects(
    service.createZone(
      otherContext,
      newCleaningZoneInputSchema.parse({
        dayOfWeek: 2,
        id: zoneId,
        title: 'Other scope zone',
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'cleaning_zone_create_conflict',
  )
  assert.equal(
    (await service.listCleaning(OWNER_CONTEXT)).zones[0]?.id,
    firstZone.id,
  )
  assert.equal((await service.listCleaning(otherContext)).zones.length, 0)

  const otherZone = await service.createZone(
    otherContext,
    newCleaningZoneInputSchema.parse({
      dayOfWeek: 2,
      title: 'Other zone',
    }),
  )
  const taskId = generateUuidV7()
  await service.createTask(
    OWNER_CONTEXT,
    newCleaningTaskInputSchema.parse({
      id: taskId,
      title: 'First task',
      zoneId: firstZone.id,
    }),
  )
  await assert.rejects(
    service.createTask(
      otherContext,
      newCleaningTaskInputSchema.parse({
        id: taskId,
        title: 'Other scope task',
        zoneId: otherZone.id,
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'cleaning_task_create_conflict',
  )

  await service.removeZone(OWNER_CONTEXT, firstZone.id)
  await assert.rejects(
    service.createZone(
      OWNER_CONTEXT,
      newCleaningZoneInputSchema.parse({
        dayOfWeek: 3,
        id: zoneId,
        title: 'Reused deleted id',
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'cleaning_zone_create_conflict',
  )
})

void test('CleaningService replays operation receipts only within the same actor and workspace', async () => {
  const service = new CleaningService(new MemoryCleaningRepository())
  const operationId = generateUuidV7()
  const input = newCleaningZoneInputSchema.parse({
    dayOfWeek: 1,
    id: generateUuidV7(),
    title: 'Idempotent zone',
  })
  const first = await service.createZone(OWNER_CONTEXT, input, operationId)
  const replay = await service.createZone(OWNER_CONTEXT, input, operationId)

  assert.deepEqual(replay, first)
  await assert.rejects(
    service.createZone(
      OWNER_CONTEXT,
      newCleaningZoneInputSchema.parse({
        ...input,
        title: 'Different payload',
      }),
      operationId,
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'cleaning_operation_conflict',
  )

  const otherContext = {
    ...OWNER_CONTEXT,
    actorUserId: 'user-2',
    workspaceId: 'workspace-2',
  }
  const other = await service.createZone(
    otherContext,
    newCleaningZoneInputSchema.parse({
      dayOfWeek: 2,
      id: generateUuidV7(),
      title: 'Scoped operation',
    }),
    operationId,
  )

  assert.equal(other.workspaceId, otherContext.workspaceId)
})

function addDaysToDateKey(dateKey: string, amount: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`)

  date.setUTCDate(date.getUTCDate() + amount)

  return date.toISOString().slice(0, 10)
}
