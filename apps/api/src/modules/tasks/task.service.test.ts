import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../../bootstrap/http-error.js'
import { MemoryTaskRepository } from './task.repository.memory.js'
import { TaskService } from './task.service.js'

const PERSONAL_CONTEXT = {
  actorDisplayName: 'Darya',
  actorUserId: 'user-1',
  auth: null,
  groupRole: null,
  role: 'owner' as const,
  workspaceId: 'workspace-1',
  workspaceKind: 'personal' as const,
}

const SHARED_CONTEXT = {
  ...PERSONAL_CONTEXT,
  workspaceKind: 'shared' as const,
}

const BASE_INPUT = {
  assigneeUserId: null,
  dueDate: null,
  icon: '',
  note: '',
  plannedDate: '2026-05-05',
  plannedEndTime: null,
  plannedStartTime: '09:00',
  project: '',
  projectId: null,
  resource: 0,
  requiresConfirmation: false,
  sphereId: null,
  title: 'Task reminder test',
}

void test('TaskService allows a personal task reminder when start time is set', async () => {
  const service = new TaskService(new MemoryTaskRepository())

  const task = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    remindBeforeStart: true,
    reminderTimeZone: 'Asia/Novosibirsk',
  })

  assert.equal(task.remindBeforeStart, true)
})

void test('TaskService rejects task reminders in shared workspaces', async () => {
  const service = new TaskService(new MemoryTaskRepository())

  await assert.rejects(
    Promise.resolve().then(() =>
      service.createTask(SHARED_CONTEXT, {
        ...BASE_INPUT,
        remindBeforeStart: true,
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'task_reminder_personal_workspace_required',
  )
})

void test('TaskService requires a start time for task reminders', async () => {
  const service = new TaskService(new MemoryTaskRepository())

  await assert.rejects(
    Promise.resolve().then(() =>
      service.createTask(PERSONAL_CONTEXT, {
        ...BASE_INPUT,
        plannedStartTime: null,
        remindBeforeStart: true,
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'task_reminder_start_time_required',
  )
})

void test('TaskService creates the next recurring occurrence after completion', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const task = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    plannedDate: '2099-01-01',
    recurrence: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      endDate: null,
      frequency: 'daily',
      interval: 1,
      isActive: true,
      seriesId: '019db853-b277-7000-8000-000000000001',
      startDate: '2099-01-01',
    },
    title: 'Умыться',
    urgency: 'urgent',
  })

  await service.setTaskStatus(PERSONAL_CONTEXT, task.id, 'done', task.version)

  const tasks = await service.listTasks(PERSONAL_CONTEXT)
  const nextTask = tasks.find(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.recurrence?.seriesId === task.recurrence?.seriesId,
  )

  assert.equal(nextTask?.status, 'todo')
  assert.equal(nextTask?.plannedDate, '2099-01-02')
  assert.equal(nextTask?.title, 'Умыться')
})

void test('TaskService respects recurring task intervals', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const task = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    plannedDate: '2099-01-01',
    recurrence: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      endDate: null,
      frequency: 'daily',
      interval: 3,
      isActive: true,
      seriesId: '019db853-b277-7000-8000-000000000004',
      startDate: '2099-01-01',
    },
    title: 'Каждые три дня',
    urgency: 'urgent',
  })

  await service.setTaskStatus(PERSONAL_CONTEXT, task.id, 'done', task.version)

  const tasks = await service.listTasks(PERSONAL_CONTEXT)
  const nextTask = tasks.find(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.recurrence?.seriesId === task.recurrence?.seriesId,
  )

  assert.equal(nextTask?.plannedDate, '2099-01-04')
})

void test('TaskService creates monthly recurring occurrences', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const task = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    plannedDate: '2099-01-31',
    recurrence: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      endDate: null,
      frequency: 'monthly',
      interval: 1,
      isActive: true,
      seriesId: '019db853-b277-7000-8000-000000000005',
      startDate: '2099-01-31',
    },
    title: 'Раз в месяц',
    urgency: 'urgent',
  })

  await service.setTaskStatus(PERSONAL_CONTEXT, task.id, 'done', task.version)

  const tasks = await service.listTasks(PERSONAL_CONTEXT)
  const nextTask = tasks.find(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.recurrence?.seriesId === task.recurrence?.seriesId,
  )

  assert.equal(nextTask?.plannedDate, '2099-02-28')
})

void test('TaskService does not repeat routine tasks without recurrence', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const task = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    plannedDate: '2099-01-01',
    routine: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      frequency: 'daily',
      seriesId: '019db853-b277-7000-8000-000000000002',
      targetType: 'check',
      targetValue: 1,
      unit: '',
    },
    title: 'Рутинная задача',
    urgency: 'urgent',
  })

  await service.setTaskStatus(PERSONAL_CONTEXT, task.id, 'done', task.version)

  const tasks = await service.listTasks(PERSONAL_CONTEXT)

  assert.equal(tasks.length, 1)
})
