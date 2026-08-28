import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CompleteRecurringTaskCommand,
  CreateTaskCommand,
  TaskCursorPageQuery,
  TaskListFilters,
  TaskReadContext,
} from './task.model.js'
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

class ReadModelProbeRepository extends MemoryTaskRepository {
  cursorPageCalls = 0
  fullListCalls = 0
  latestEventCalls = 0

  override listByWorkspace(
    context: TaskReadContext,
    filters?: TaskListFilters,
  ) {
    this.fullListCalls += 1

    return super.listByWorkspace(context, filters)
  }

  override listCursorPageByWorkspace(
    context: TaskReadContext,
    query: TaskCursorPageQuery,
  ) {
    this.cursorPageCalls += 1

    return super.listCursorPageByWorkspace(context, query)
  }

  override getLatestEventIdByWorkspace(context: TaskReadContext) {
    this.latestEventCalls += 1

    return super.getLatestEventIdByWorkspace(context)
  }
}

void test('TaskService keeps the planner read model bounded for 10,000 tasks', async () => {
  const repository = new ReadModelProbeRepository()
  const service = new TaskService(repository)

  await Promise.all(
    Array.from({ length: 10_000 }, (_, index) =>
      service.createTask(PERSONAL_CONTEXT, {
        ...BASE_INPUT,
        plannedDate: index % 2 === 0 ? '2026-05-05' : null,
        title: `Large fixture task ${index}`,
      }),
    ),
  )

  const snapshot = await service.getTaskReadModel(PERSONAL_CONTEXT, {
    activeLimit: 500,
    dateFrom: '2026-05-05',
    dateTo: '2026-05-06',
    historyLimit: 100,
    rangeLimit: 250,
  })

  assert.equal(snapshot.items.length <= 500 + 250 + 100, true)
  assert.equal(snapshot.returnedCount, snapshot.items.length)
  assert.equal(
    new Set(snapshot.items.map((task) => task.id)).size,
    snapshot.items.length,
  )
  assert.equal(snapshot.totalCount, 10_000)
  assert.equal(snapshot.eventCursor, 10_000)
  assert.equal(snapshot.historyNextCursor, null)
  assert.deepEqual(snapshot.sources.active, {
    returnedCount: 500,
    totalCount: 10_000,
    truncated: true,
  })
  assert.deepEqual(snapshot.sources.range, {
    returnedCount: 250,
    totalCount: 5_000,
    truncated: true,
  })
  assert.equal(snapshot.truncated, true)
  assert.equal(repository.fullListCalls, 0)
  assert.equal(repository.latestEventCalls, 1)
  assert.equal(repository.cursorPageCalls, 4)
})

void test('TaskService continues closed-task history after the bounded snapshot cursor', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const closedTasks = await Promise.all(
    ['First closed', 'Second closed', 'Third closed'].map(async (title) => {
      const task = await service.createTask(PERSONAL_CONTEXT, {
        ...BASE_INPUT,
        title,
      })

      return service.setTaskStatus(
        PERSONAL_CONTEXT,
        task.id,
        'done',
        task.version,
      )
    }),
  )
  const snapshot = await service.getTaskReadModel(PERSONAL_CONTEXT, {
    activeLimit: 10,
    dateFrom: '2099-01-01',
    dateTo: '2099-01-01',
    historyLimit: 1,
    rangeLimit: 10,
  })

  assert.equal(snapshot.sources.history.returnedCount, 1)
  assert.equal(snapshot.sources.history.totalCount, 3)
  assert.ok(snapshot.historyNextCursor)

  const nextPage = await service.listTasksCursor(PERSONAL_CONTEXT, {
    cursor: snapshot.historyNextCursor,
    dateMode: 'relevant',
    direction: 'desc',
    limit: 2,
    scope: 'closed',
  })
  const snapshotTaskId = snapshot.items[0]?.id

  assert.equal(nextPage.returnedCount, 2)
  assert.equal(nextPage.totalCount, 3)
  assert.equal(
    nextPage.items.some((task) => task.id === snapshotTaskId),
    false,
  )
  assert.deepEqual(
    [snapshotTaskId, ...nextPage.items.map((task) => task.id)].sort(),
    closedTasks.map((task) => task.id).sort(),
  )
})

void test('TaskService loads the archive before trimming completed history', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const archiveCandidate = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    title: 'Archive priority',
  })
  const archivedTask = await service.setTaskStatus(
    PERSONAL_CONTEXT,
    archiveCandidate.id,
    'archived',
    archiveCandidate.version,
  )

  await new Promise((resolve) => setTimeout(resolve, 2))

  const historyCandidate = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    title: 'Newer completed history',
  })
  const completedTask = await service.setTaskStatus(
    PERSONAL_CONTEXT,
    historyCandidate.id,
    'done',
    historyCandidate.version,
  )
  const snapshot = await service.getTaskReadModel(PERSONAL_CONTEXT, {
    activeLimit: 10,
    dateFrom: '2099-01-01',
    dateTo: '2099-01-01',
    historyLimit: 1,
    rangeLimit: 10,
  })

  assert.deepEqual(snapshot.sources.history, {
    returnedCount: 1,
    totalCount: 2,
    truncated: true,
  })
  assert.deepEqual(
    snapshot.items.map((task) => task.id),
    [archivedTask.id],
  )
  assert.ok(snapshot.historyNextCursor)

  const nextPage = await service.listTasksCursor(PERSONAL_CONTEXT, {
    cursor: snapshot.historyNextCursor,
    dateMode: 'relevant',
    direction: 'desc',
    limit: 1,
    scope: 'closed',
  })

  assert.deepEqual(
    nextPage.items.map((task) => task.id),
    [completedTask.id],
  )
  assert.equal(nextPage.nextCursor, null)

  const legacyCursor = Buffer.from(
    JSON.stringify({
      createdAt: completedTask.createdAt,
      dateFrom: null,
      dateMode: 'relevant',
      dateTo: null,
      direction: 'desc',
      id: completedTask.id,
      scope: 'closed',
      version: 1,
    }),
    'utf8',
  ).toString('base64url')
  const restartedPage = await service.listTasksCursor(PERSONAL_CONTEXT, {
    cursor: legacyCursor,
    dateMode: 'relevant',
    direction: 'desc',
    limit: 1,
    scope: 'closed',
  })

  assert.deepEqual(
    restartedPage.items.map((task) => task.id),
    [archivedTask.id],
  )
})

void test('TaskService cursor does not duplicate or skip baseline tasks after a concurrent insert', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const baselineTasks = await Promise.all(
    ['First', 'Second', 'Third'].map((title) =>
      service.createTask(PERSONAL_CONTEXT, {
        ...BASE_INPUT,
        title,
      }),
    ),
  )

  await new Promise((resolve) => setTimeout(resolve, 2))

  const filters = {
    dateMode: 'relevant' as const,
    direction: 'desc' as const,
    limit: 1,
    scope: 'all' as const,
  }
  const firstPage = await service.listTasksCursor(PERSONAL_CONTEXT, filters)
  const insertedTask = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    title: 'Inserted after first page',
  })
  const collectedIds = firstPage.items.map((task) => task.id)
  let cursor = firstPage.nextCursor

  while (cursor) {
    const page = await service.listTasksCursor(PERSONAL_CONTEXT, {
      ...filters,
      cursor,
    })

    collectedIds.push(...page.items.map((task) => task.id))
    cursor = page.nextCursor
  }

  assert.deepEqual(
    [...collectedIds].sort(),
    baselineTasks.map((task) => task.id).sort(),
  )
  assert.equal(new Set(collectedIds).size, collectedIds.length)
  assert.equal(collectedIds.includes(insertedTask.id), false)
})

void test('TaskService rejects a cursor with a non-UUID anchor before querying the repository', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const cursor = Buffer.from(
    JSON.stringify({
      createdAt: '2026-08-25T00:00:00.000Z',
      dateFrom: null,
      dateMode: 'relevant',
      dateTo: null,
      direction: 'asc',
      id: 'not-a-uuid',
      scope: 'all',
      version: 1,
    }),
    'utf8',
  ).toString('base64url')

  await assert.rejects(
    service.listTasksCursor(PERSONAL_CONTEXT, {
      cursor,
      dateMode: 'relevant',
      direction: 'asc',
      limit: 100,
      scope: 'all',
    }),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'invalid_task_cursor',
  )
})

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
    necessity: 'required',
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
  assert.equal(nextTask?.necessity, 'required')
})

void test('TaskService uses client timezone for next recurring reminder occurrence', async () => {
  const repository = new RecordingMemoryTaskRepository()
  const service = new TaskService(repository)
  const context = {
    ...PERSONAL_CONTEXT,
    clientTimeZone: 'America/New_York',
  }
  const task = await service.createTask(context, {
    ...BASE_INPUT,
    plannedDate: '2099-01-01',
    recurrence: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      endDate: null,
      frequency: 'daily',
      interval: 1,
      isActive: true,
      seriesId: '019db853-b277-7000-8000-000000000006',
      startDate: '2099-01-01',
    },
    remindBeforeStart: true,
    reminderOffsets: [15],
    reminderTimeZone: 'Asia/Novosibirsk',
    title: 'Повтор со сменой timezone',
  })

  await service.setTaskStatus(context, task.id, 'done', task.version)

  assert.deepEqual(repository.createdReminderTimeZones, [
    'Asia/Novosibirsk',
    'America/New_York',
  ])
})

void test('TaskService uses client timezone for recurring completion reference date', async () => {
  const service = new TaskService(
    new MemoryTaskRepository(),
    () => new Date('2026-06-14T21:30:00.000Z'),
  )
  const context = {
    ...PERSONAL_CONTEXT,
    clientTimeZone: 'Europe/Samara',
  }
  const task = await service.createTask(context, {
    ...BASE_INPUT,
    plannedDate: '2026-06-14',
    recurrence: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      endDate: null,
      frequency: 'daily',
      interval: 1,
      isActive: true,
      seriesId: '019db853-b277-7000-8000-000000000007',
      startDate: '2026-06-14',
    },
    title: 'Повтор у границы дня',
  })

  await service.setTaskStatus(context, task.id, 'done', task.version)

  const tasks = await service.listTasks(context)
  const nextTask = tasks.find(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.recurrence?.seriesId === task.recurrence?.seriesId,
  )

  assert.equal(nextTask?.plannedDate, '2026-06-16')
})

void test('TaskService archives recurring tasks without creating the next occurrence', async () => {
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
      seriesId: '019db853-b277-7000-8000-000000000004',
      startDate: '2099-01-01',
    },
    title: 'Отложенная повторяющаяся задача',
  })

  const archivedTask = await service.setTaskStatus(
    PERSONAL_CONTEXT,
    task.id,
    'archived',
    task.version,
  )
  const tasks = await service.listTasks(PERSONAL_CONTEXT)

  assert.equal(archivedTask.status, 'archived')
  assert.equal(archivedTask.completedAt, null)
  assert.equal(tasks.length, 1)
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

void test('TaskService does not recreate an occurrence that was already completed', async () => {
  const service = new TaskService(new MemoryTaskRepository())
  const firstTask = await service.createTask(PERSONAL_CONTEXT, {
    ...BASE_INPUT,
    plannedDate: '2099-01-01',
    recurrence: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      endDate: null,
      frequency: 'daily',
      interval: 1,
      isActive: true,
      seriesId: '019db853-b277-7000-8000-000000000008',
      startDate: '2099-01-01',
    },
    title: 'Повтор после следующего выполнения',
  })

  await service.setTaskStatus(
    PERSONAL_CONTEXT,
    firstTask.id,
    'done',
    firstTask.version,
  )
  const secondTask = (await service.listTasks(PERSONAL_CONTEXT)).find(
    (task) => task.plannedDate === '2099-01-02',
  )!

  await service.setTaskStatus(
    PERSONAL_CONTEXT,
    secondTask.id,
    'done',
    secondTask.version,
  )
  await service.setTaskStatus(
    PERSONAL_CONTEXT,
    firstTask.id,
    'done',
    firstTask.version,
  )

  const tasks = await service.listTasks(PERSONAL_CONTEXT)

  assert.equal(tasks.length, 3)
  assert.equal(
    tasks.filter((task) => task.plannedDate === '2099-01-02').length,
    1,
  )
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
    necessity: 'optional',
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
  assert.equal(nextTask?.necessity, 'optional')
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

class RecordingMemoryTaskRepository extends MemoryTaskRepository {
  readonly createdReminderTimeZones: Array<string | undefined> = []

  override create(command: CreateTaskCommand) {
    this.createdReminderTimeZones.push(command.input.reminderTimeZone)

    return super.create(command)
  }

  override completeRecurring(command: CompleteRecurringTaskCommand) {
    this.createdReminderTimeZones.push(command.nextTaskInput.reminderTimeZone)

    return super.completeRecurring(command)
  }
}

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
