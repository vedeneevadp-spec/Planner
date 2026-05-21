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
  personalWorkspace: {
    id: 'personal-workspace',
    name: 'Personal workspace',
  },
  workspaceName: 'Family workspace',
  workspaceKind: 'shared' as const,
  workspaceId: 'shared-workspace',
}

const TRANSFER_PERSONAL_CONTEXT = {
  ...PERSONAL_CONTEXT,
  workspaceId: 'personal-workspace',
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

void test('TaskService treats stale same-status completion as idempotent', async () => {
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
      seriesId: '019db853-b277-7000-8000-000000000003',
      startDate: '2099-01-01',
    },
    title: 'Повторный replay',
  })

  const completedTask = await service.setTaskStatus(
    PERSONAL_CONTEXT,
    task.id,
    'done',
    task.version,
  )
  const replayedTask = await service.setTaskStatus(
    PERSONAL_CONTEXT,
    task.id,
    'done',
    task.version,
  )

  const tasks = await service.listTasks(PERSONAL_CONTEXT)

  assert.equal(replayedTask.status, 'done')
  assert.equal(replayedTask.version, completedTask.version)
  assert.equal(tasks.length, 2)
})

void test('TaskService keeps stale conflicting status updates strict', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const task = await service.createTask(PERSONAL_CONTEXT, BASE_INPUT)

  await service.setTaskStatus(PERSONAL_CONTEXT, task.id, 'done', task.version)

  await assert.rejects(
    Promise.resolve().then(() =>
      service.setTaskStatus(PERSONAL_CONTEXT, task.id, 'todo', task.version),
    ),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'task_version_conflict',
  )
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

void test('TaskService creates the next routine occurrence without recurrence', async () => {
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
  const nextTask = tasks.find(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.routine?.seriesId === task.routine?.seriesId,
  )

  assert.equal(nextTask?.status, 'todo')
  assert.equal(nextTask?.plannedDate, '2099-01-02')
  assert.equal(nextTask?.title, 'Рутинная задача')
  assert.equal(nextTask?.recurrence, null)
  assert.equal(nextTask?.routine?.frequency, 'daily')
})

void test('TaskService creates a linked personal copy and syncs status', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const sharedTask = await service.createTask(SHARED_CONTEXT, {
    ...BASE_INPUT,
    title: 'Купить молоко',
  })

  const personalTask = await service.copyTaskToPersonal(
    SHARED_CONTEXT,
    sharedTask.id,
    sharedTask.version,
  )

  assert.equal(personalTask.workspaceId, 'personal-workspace')
  assert.deepEqual(personalTask.linkedTask, {
    id: sharedTask.id,
    workspaceId: 'shared-workspace',
  })
  assert.deepEqual(personalTask.sourceWorkspace, {
    id: 'shared-workspace',
    name: 'Family workspace',
  })

  const sharedTasksBeforeStatus = await service.listTasks(SHARED_CONTEXT)
  assert.equal(
    sharedTasksBeforeStatus.some((task) => task.id === sharedTask.id),
    true,
  )

  await service.setTaskStatus(
    TRANSFER_PERSONAL_CONTEXT,
    personalTask.id,
    'done',
    personalTask.version,
  )

  const sharedTasksAfterStatus = await service.listTasks(SHARED_CONTEXT)
  const updatedSharedTask = sharedTasksAfterStatus.find(
    (task) => task.id === sharedTask.id,
  )

  assert.equal(updatedSharedTask?.status, 'done')
})

void test('TaskService moves only authored shared tasks to personal workspace', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const sharedTask = await service.createTask(SHARED_CONTEXT, {
    ...BASE_INPUT,
    title: 'Убрать стол',
  })

  const personalTask = await service.moveTaskToPersonal(
    SHARED_CONTEXT,
    sharedTask.id,
    sharedTask.version,
  )

  assert.equal(personalTask.workspaceId, 'personal-workspace')
  assert.equal(personalTask.linkedTask, null)
  assert.equal(personalTask.sourceWorkspace, null)
  assert.equal((await service.listTasks(SHARED_CONTEXT)).length, 0)
  assert.equal((await service.listTasks(TRANSFER_PERSONAL_CONTEXT)).length, 1)
})

void test('TaskService rejects moving another author task to personal workspace', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const otherAuthorContext = {
    ...SHARED_CONTEXT,
    actorDisplayName: 'Other',
    actorUserId: 'user-2',
  }
  const sharedTask = await service.createTask(otherAuthorContext, {
    ...BASE_INPUT,
    title: 'Чужая задача',
  })

  await assert.rejects(
    Promise.resolve().then(() =>
      service.moveTaskToPersonal(
        SHARED_CONTEXT,
        sharedTask.id,
        sharedTask.version,
      ),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'task_move_to_personal_forbidden',
  )
})
