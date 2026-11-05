import assert from 'node:assert/strict'
import { afterEach, it, mock } from 'node:test'

import type { NewTaskInput } from '@planner/contracts'

import type {
  TaskCursorPageQuery,
  TaskReadContext,
} from '../tasks/task.model.js'
import { MemoryTaskRepository } from '../tasks/task.repository.memory.js'
import { TaskService } from '../tasks/task.service.js'
import { AiContextService } from './ai-context.service.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const CONTEXT = {
  actorDisplayName: 'Test owner',
  actorUserId: USER_ID,
  auth: null,
  clientTimeZone: 'UTC',
  role: 'owner' as const,
  workspaceKind: 'personal' as const,
  workspaceId: WORKSPACE_ID,
}

class BoundedRepository extends MemoryTaskRepository {
  queries: TaskCursorPageQuery[] = []
  override listByWorkspace(): never {
    throw new Error('AI must not load the complete task collection')
  }
  override listCursorPageByWorkspace(
    context: TaskReadContext,
    query: TaskCursorPageQuery,
  ) {
    this.queries.push(query)
    assert.ok(query.limit <= 500)
    return super.listCursorPageByWorkspace(context, query)
  }
}

afterEach(() => mock.timers.reset())

void it('searches before limiting and traverses matching tasks outside the 500-task snapshot without gaps', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T03:00:00Z') })
  const { repository, taskService, service } = createService()
  const matching = []
  for (let index = 0; index < 1100; index++) {
    const isMatch = index >= 530 && index < 570
    const created = await taskService.createTask(
      CONTEXT,
      input({
        title: `${isMatch ? 'Needle' : 'Ordinary'} ${index}`,
        note: isMatch ? 'Literal 100%_match' : '',
      }),
    )
    if (isMatch) matching.push(created)
    mock.timers.tick(1)
  }
  const snapshot = await taskService.getTaskReadModel(CONTEXT, {
    activeLimit: 500,
    historyLimit: 250,
    rangeLimit: 500,
    dateFrom: '2026-11-05',
    dateTo: '2026-11-05',
  })
  assert.ok(
    matching.every(
      (task) => !snapshot.items.some((item) => item.id === task.id),
    ),
  )

  const params = {
    query: '100%_match',
    types: ['tasks' as const],
    timezone: 'UTC',
    userId: USER_ID,
    limit: 7,
  }
  const first = await service.searchPlanner(params)
  assert.equal(first.totalCount, 40)
  assert.equal(first.returnedCount, 7)
  assert.equal(first.sourceCoverage.tasks?.truncated, true)
  assert.ok(first.taskPagination?.nextCursor)
  const titles = first.items.map((item) => item.title)
  let cursor: string | null = first.taskPagination.nextCursor
  while (cursor) {
    const page = await service.searchPlanner({ ...params, taskCursor: cursor })
    titles.push(...page.items.map((item) => item.title))
    assert.equal(page.totalCount, 40)
    cursor = page.taskPagination?.nextCursor ?? null
  }
  assert.equal(titles.length, 40)
  assert.deepEqual(new Set(titles), new Set(matching.map((task) => task.title)))
  await assert.rejects(
    service.searchPlanner({
      ...params,
      query: 'Different',
      taskCursor: first.taskPagination.nextCursor,
    }),
    /cursor/i,
  )
  await assert.rejects(
    service.searchPlanner({
      ...params,
      types: ['tasks', 'calendar'],
      taskCursor: first.taskPagination.nextCursor,
    }),
    /taskCursor/,
  )
  assert.ok(
    repository.queries.some(
      (query) => query.contextFilter?.search === '100%_match',
    ),
  )
})

void it('counts actual completions beyond the 250-history snapshot and continues from the visible 50-item overview page', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T03:00:00Z') })
  const { taskService, service } = createService()
  const completedTitles = []
  for (let index = 0; index < 310; index++) {
    const task = await taskService.createTask(
      CONTEXT,
      input({
        title: `Completed ${index}`,
        plannedDate: '2020-01-01',
        importance: index < 70 ? 'important' : 'not_important',
      }),
    )
    await taskService.setTaskStatus(CONTEXT, task.id, 'done')
    completedTitles.push(task.title)
    mock.timers.tick(1)
  }
  const period = {
    from: '2026-11-04',
    to: '2026-11-05',
    timezone: 'UTC',
    userId: USER_ID,
  }
  const snapshot = await taskService.getTaskReadModel(CONTEXT, {
    activeLimit: 500,
    historyLimit: 250,
    rangeLimit: 500,
    dateFrom: period.from,
    dateTo: period.to,
  })
  assert.equal(snapshot.items.length, 250)
  const week = await service.getWeekContext(period)
  const today = await service.getTodayContext({
    date: period.to,
    timezone: 'UTC',
    userId: USER_ID,
  })
  const overload = await service.getOverloadContext(period)
  assert.equal(week.progress.tasksCompleted.count, 310)
  assert.equal(week.summary.completedTasks, 310)
  assert.equal(today.tasks?.completedTodayCount, 310)
  assert.equal(overload.load.ignoredCounts.completedTasks, 310)
  assert.equal(overload.load.ignoredCounts.completedHighPriorityTasks, 70)
  assert.equal(week.progress.tasksCompleted.items.length, 50)
  assert.equal(week.sourceCoverage.taskCompletions?.totalCount, 310)
  assert.equal(week.sourceCoverage.taskCompletions?.returnedCount, 50)
  assert.equal(week.sourceCoverage.taskCompletions?.truncated, true)
  let cursor: string | null | undefined =
    week.sourceCoverage.taskCompletions?.nextCursor
  assert.ok(cursor)
  const statsOnlyWeek = await service.getWeekContext({
    ...period,
    include: ['stats'],
  })
  const statsOnlyDay = await service.getTodayContext({
    date: period.to,
    timezone: 'UTC',
    userId: USER_ID,
    include: ['stats'],
  })
  assert.equal(statsOnlyWeek.sourceCoverage.taskCompletions?.totalCount, 310)
  assert.equal(statsOnlyWeek.sourceCoverage.taskCompletions?.nextCursor, null)
  assert.equal(statsOnlyDay.sourceCoverage.taskCompletions?.nextCursor, null)
  const titles = week.progress.tasksCompleted.items.map((item) => item.title)
  while (cursor) {
    const page = await service.searchPlanner({
      ...period,
      query: '',
      status: 'done',
      types: ['tasks'],
      limit: 30,
      taskCursor: cursor,
    })
    assert.equal(page.totalCount, 310)
    titles.push(...page.items.map((item) => item.title))
    cursor = page.taskPagination?.nextCursor
  }
  assert.equal(titles.length, 310)
  assert.deepEqual(new Set(titles), new Set(completedTitles))
})

function createService() {
  const repository = new BoundedRepository()
  const taskService = new TaskService(repository)
  const service = new AiContextService({
    taskService,
    sessionService: {
      resolveSession: () =>
        Promise.resolve({
          actor: { email: 'test@example.test' },
          actorUserId: USER_ID,
          groupRole: null,
          role: 'owner',
          workspace: { kind: 'personal', name: 'Personal' },
          workspaceId: WORKSPACE_ID,
          workspaces: [
            { id: WORKSPACE_ID, kind: 'personal', name: 'Personal' },
          ],
        }),
    },
  })
  return { repository, taskService, service }
}

function input(overrides: Partial<NewTaskInput>): NewTaskInput {
  return {
    assigneeUserId: null,
    dueDate: null,
    icon: '',
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    resource: 0,
    requiresConfirmation: false,
    sphereId: null,
    title: 'Task',
    ...overrides,
  }
}
