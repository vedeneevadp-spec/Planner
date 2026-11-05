import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, it, mock } from 'node:test'

import {
  addDateDays,
  type ChaosInboxItemRecord,
  type CleaningListResponse,
  type CleaningTodayResponse,
  getTodayDate,
  type SelfCareAnalyticsResponse,
  type SelfCareHistoryResponse,
  type SelfCarePlanResponse,
  type SelfCareTodayItem,
  type Task,
} from '@planner/contracts'

import { matchesTaskContextFilter } from '../tasks/task.context-filter.js'
import {
  AiContextService,
  type AiContextServiceDependencies,
} from './ai-context.service.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

void describe('AiContextService', () => {
  void it('reports exact calendar coverage without reading unrelated task snapshots', async () => {
    const taskReadModelCalls: unknown[] = []
    const service = createService(
      [
        ...Array.from({ length: 55 }, (_, index) =>
          createTask({
            title: `Calendar ${index}`,
            plannedDate: '2026-06-21',
            plannedStartTime: '10:00',
          }),
        ),
        createTask({ title: 'Unrelated private task' }),
      ],
      [],
      { taskReadModelCalls },
    )
    const today = await service.getTodayContext({
      date: '2026-06-21',
      timezone: 'UTC',
      userId: USER_ID,
      include: ['calendar'],
    })
    const week = await service.getWeekContext({
      from: '2026-06-21',
      to: '2026-06-21',
      timezone: 'UTC',
      userId: USER_ID,
      include: ['calendar'],
    })
    for (const result of [today, week]) {
      assert.equal(result.calendar?.totalCount, 55)
      assert.equal(result.calendar?.events.length, 50)
      assert.deepEqual(result.sourceCoverage.calendar, {
        returnedCount: 50,
        totalCount: 55,
        truncated: true,
      })
      assert.equal(result.sourceCoverage.tasks, undefined)
      assert.equal(
        JSON.stringify(result).includes('Unrelated private task'),
        false,
      )
    }
    assert.equal(taskReadModelCalls.length, 0)
  })
  void it('keeps task plan, deadline and completion distinct and counts timed tasks once', async () => {
    mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-06-21T09:00:00Z'),
    })
    const service = createService([
      createTask({
        title: 'Timed task',
        plannedDate: '2026-06-21',
        plannedStartTime: '10:00',
      }),
      createTask({
        title: 'Deadline task',
        plannedDate: '2026-06-21',
        dueDate: '2026-06-23',
      }),
      createTask({
        title: 'Finished task',
        status: 'done',
        plannedDate: '2026-06-20',
        completedAt: '2026-06-21T08:00:00.000Z',
      }),
    ])
    const context = await service.getTodayContext({
      date: '2026-06-21',
      timezone: 'UTC',
      userId: USER_ID,
    })
    const timed = context.tasks?.activeToday.find(
      (task) => task.title === 'Timed task',
    )
    assert.equal(timed?.plannedDate, '2026-06-21')
    assert.equal(timed?.dueDate, null)
    assert.equal(
      context.tasks?.completedToday[0]?.completedAt,
      '2026-06-21T08:00:00.000Z',
    )
    assert.equal(context.tasks?.completedToday[0]?.plannedDate, '2026-06-20')
    assert.equal(context.stats?.activeCounts.calendar, 1)
    assert.equal(context.stats?.activeCounts.tasks, 2)
    assert.equal(context.stats?.activeCounts.total, 2)
    assert.equal(context.stats?.totalPlannedItems, 2)
    const overload = await service.getOverloadContext({
      from: '2026-06-21',
      to: '2026-06-21',
      timezone: 'UTC',
      userId: USER_ID,
    })
    assert.equal(overload.counts.activeItemsTotal, 2)
    assert.equal(overload.load.activeScore, 6)
    assert.equal(overload.load.score, 6)
  })

  afterEach(() => {
    mock.timers.reset()
  })

  void it('resolves the read context through synthetic auth for MCP users', async () => {
    const resolveSessionCalls: unknown[] = []
    const service = createService([], resolveSessionCalls)

    await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks'],
      userId: USER_ID,
    })

    const firstCall = resolveSessionCalls[0] as {
      actorUserId?: string
      auth?: { claims?: { sub?: string } } | null
    }

    assert.equal(firstCall.actorUserId, undefined)
    assert.equal(firstCall.auth?.claims?.sub, USER_ID)
  })

  void it('getTodayContext returns only records for the authenticated user', async () => {
    const service = createService([
      createTask({
        authorUserId: USER_ID,
        dueDate: '2026-06-20',
        importance: 'important',
        title: 'Pay invoice',
      }),
      createTask({
        authorUserId: USER_ID,
        plannedDate: '2026-06-21',
        title: 'Write plan',
      }),
      createTask({
        authorUserId: OTHER_USER_ID,
        plannedDate: '2026-06-21',
        title: 'Other user task',
      }),
    ])

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks', 'stats'],
      userId: USER_ID,
    })

    assert.equal(context.tasks?.totalCount, 2)
    assert.equal(context.tasks?.overdueCount, 1)
    assert.deepEqual(
      context.tasks?.today.map((task) => task.title),
      ['Write plan'],
    )
    assert.equal(
      context.tasks?.today.some((task) => task.title === 'Other user task'),
      false,
    )
    assert.equal(context.stats?.overdueItems, 1)
  })

  void it('getTodayContext works with empty data', async () => {
    const service = createService([])

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks', 'calendar', 'shopping', 'stats'],
      userId: USER_ID,
    })

    assert.equal(context.tasks?.totalCount, 0)
    assert.equal(context.calendar?.totalCount, 0)
    assert.equal(context.shopping?.totalCount, 0)
    assert.equal(context.stats?.loadLevel, 'low')
  })

  void it('returns active flexible tasks separately without increasing day, week or overload metrics', async () => {
    const datedTasks = [
      createTask({ plannedDate: '2026-06-21', title: 'Scheduled task' }),
      createTask({ dueDate: '2026-06-21', title: 'Deadline only' }),
    ]
    const service = createService([
      ...datedTasks,
      createTask({
        title: 'Flexible important task',
        importance: 'important',
        necessity: 'required',
        resource: -3,
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
      createTask({ title: 'Flexible in progress', status: 'in_progress' }),
      createTask({ title: 'Flexible done', status: 'done' }),
      createTask({ title: 'Flexible archived', status: 'archived' }),
      createTask({ title: 'Private task', authorUserId: OTHER_USER_ID }),
    ])
    const baseline = createService(datedTasks)
    const dayParams = {
      date: '2026-06-21',
      timezone: 'UTC',
      userId: USER_ID,
    }
    const rangeParams = {
      from: '2026-06-15',
      to: '2026-06-21',
      timezone: 'UTC',
      userId: USER_ID,
    }
    const today = await service.getTodayContext(dayParams)
    const week = await service.getWeekContext(rangeParams)
    const overload = await service.getOverloadContext(rangeParams)
    const baselineToday = await baseline.getTodayContext(dayParams)
    const baselineWeek = await baseline.getWeekContext(rangeParams)
    const baselineOverload = await baseline.getOverloadContext(rangeParams)

    assert.equal(today.tasks?.flexibleCount, 2)
    assert.equal(today.tasks?.totalCount, 4)
    assert.deepEqual(
      today.tasks?.flexible.map((task) => task.title),
      ['Flexible important task', 'Flexible in progress'],
    )
    for (const task of today.tasks.flexible) {
      assert.equal(task.isFlexible, true)
      assert.equal(task.dueDate, null)
      assert.notEqual(task.status, 'overdue')
    }
    assert.equal(today.tasks?.flexible[0]?.obligation, 'required')
    assert.equal(today.tasks?.flexible[0]?.resource, -3)
    assert.deepEqual(today.tasks?.activeToday, baselineToday.tasks?.activeToday)
    assert.deepEqual(today.stats, baselineToday.stats)
    assert.deepEqual(today.calendar, baselineToday.calendar)
    assert.deepEqual(today.overdue, baselineToday.overdue)

    assert.deepEqual(week.remaining.tasksFlexible, today.tasks?.flexible)
    assert.equal(week.summary.tasksFlexible, 2)
    assert.deepEqual(week.summary, {
      ...baselineWeek.summary,
      tasksFlexible: 2,
    })
    assert.deepEqual(
      week.remaining.tasksActive,
      baselineWeek.remaining.tasksActive,
    )
    assert.deepEqual(week.highlights, baselineWeek.highlights)

    assert.deepEqual(overload.flexibleTasks, {
      count: 2,
      items: today.tasks?.flexible,
    })
    assert.deepEqual(overload.counts, baselineOverload.counts)
    assert.deepEqual(overload.load, {
      ...baselineOverload.load,
      ignoredCounts: {
        ...baselineOverload.load.ignoredCounts,
        flexibleTasks: 2,
      },
    })
    assert.deepEqual(overload.bottlenecks, baselineOverload.bottlenecks)
    assert.deepEqual(overload.suggestedFocus, baselineOverload.suggestedFocus)

    const calendarOnly = await service.getTodayContext({
      ...dayParams,
      include: ['calendar'],
    })
    assert.equal(calendarOnly.tasks, undefined)
    assert.equal(
      JSON.stringify(calendarOnly).includes('Flexible important task'),
      false,
    )
  })

  void it('reports flexible counts before compacting lists and retains source coverage', async () => {
    const service = createService(
      Array.from({ length: 55 }, (_, index) =>
        createTask({ title: `Flexible ${index}` }),
      ),
      [],
      { taskTotalCount: 80, taskTruncated: true },
    )
    const params = { from: '2026-06-15', to: '2026-06-21', userId: USER_ID }
    const today = await service.getTodayContext({
      date: params.to,
      userId: USER_ID,
    })
    const week = await service.getWeekContext(params)
    const overload = await service.getOverloadContext(params)

    assert.equal(today.tasks?.flexibleCount, 55)
    assert.equal(today.tasks?.flexible.length, 50)
    assert.deepEqual(today.listCoverage?.['tasks.flexible'], {
      returnedCount: 50,
      totalCount: 55,
      truncated: true,
    })
    assert.equal(today.stats?.activeCounts.tasks, 0)
    assert.equal(week.summary.tasksFlexible, 55)
    assert.equal(week.remaining.tasksFlexible.length, 50)
    assert.equal(week.summary.plannedTasks, 0)
    assert.equal(overload.flexibleTasks.count, 55)
    assert.equal(overload.flexibleTasks.items.length, 50)
    assert.equal(overload.counts.tasksActive, 0)
    for (const context of [today, week, overload]) {
      assert.deepEqual(context.sourceCoverage.tasks, {
        returnedCount: 55,
        totalCount: 80,
        truncated: true,
      })
    }
  })

  void it('finds flexible tasks without a date filter and never matches them as overdue', async () => {
    const service = createService([createTask({ title: 'Flexible documents' })])
    const params = {
      query: 'documents',
      types: ['tasks'] as const,
      userId: USER_ID,
    }
    const search = (filters = {}) =>
      service.searchPlanner({ ...params, types: [...params.types], ...filters })
    const result = await search()

    assert.equal(result.items.length, 1)
    assert.equal((result.items[0] as { isFlexible: boolean }).isFlexible, true)
    assert.equal((await search({ status: 'overdue' })).items.length, 0)
    assert.equal(
      (await search({ from: '2026-06-21', to: '2026-06-21' })).items.length,
      0,
    )
  })

  void it('reports bounded task and shopping source coverage to AI clients', async () => {
    const taskReadModelCalls: unknown[] = []
    const service = createService(
      [
        createTask({
          plannedDate: '2026-06-21',
          title: 'Visible bounded task',
        }),
      ],
      [],
      {
        shoppingItems: [createShoppingItem({ text: 'Visible shopping item' })],
        shoppingTotalCount: 1_000,
        taskReadModelCalls,
        taskTotalCount: 10_000,
        taskTruncated: true,
      },
    )

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks', 'shopping'],
      userId: USER_ID,
    })

    assert.deepEqual(context.sourceCoverage.tasks, {
      returnedCount: 1,
      totalCount: 10_000,
      truncated: true,
    })
    assert.deepEqual(context.sourceCoverage.shopping, {
      returnedCount: 1,
      totalCount: 1_000,
      truncated: true,
    })
    assert.deepEqual(taskReadModelCalls, [
      {
        activeLimit: 500,
        dateFrom: '2026-06-21',
        dateTo: '2026-06-21',
        historyLimit: 250,
        rangeLimit: 500,
      },
    ])
  })

  void it('uses planner timezone for default today context near a UTC boundary', async () => {
    mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-06-24T20:30:00.000Z'),
    })
    const service = createService([
      createTask({
        plannedDate: '2026-06-24',
        title: 'Amsterdam planner day',
      }),
      createTask({
        plannedDate: '2026-06-25',
        title: 'Astrakhan planner day',
      }),
    ])

    const astrakhan = await service.getTodayContext({
      include: ['tasks'],
      timezone: 'Europe/Astrakhan',
      userId: USER_ID,
    })
    const amsterdam = await service.getTodayContext({
      include: ['tasks'],
      timezone: 'Europe/Amsterdam',
      userId: USER_ID,
    })

    assert.equal(astrakhan.date, '2026-06-25')
    assert.deepEqual(
      astrakhan.tasks?.today.map((task) => task.title),
      ['Astrakhan planner day'],
    )
    assert.equal(amsterdam.date, '2026-06-24')
    assert.deepEqual(
      amsterdam.tasks?.today.map((task) => task.title),
      ['Amsterdam planner day'],
    )
  })

  void it('splits active and completed shopping without counting completed items as load', async () => {
    const service = createService([], [], {
      shoppingItems: [
        createShoppingItem({
          dueDate: '2026-06-20',
          status: 'new',
          text: 'Expired milk',
        }),
        createShoppingItem({
          status: 'in_review',
          text: 'Fresh bread',
        }),
        createShoppingItem({
          completedAt: '2026-06-20T12:00:00.000Z',
          status: 'archived',
          text: 'Already bought cheese',
        }),
      ],
    })

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['shopping', 'stats'],
      userId: USER_ID,
    })

    assert.equal(context.shopping?.activeCount, 2)
    assert.equal(context.shopping?.completedCount, 1)
    assert.equal(context.shopping?.urgentActiveCount, 0)
    assert.deepEqual(
      context.shopping?.active.map((item) => item.title),
      ['Expired milk', 'Fresh bread'],
    )
    assert.deepEqual(
      context.shopping?.completed.map((item) => item.title),
      ['Already bought cheese'],
    )
    assert.equal(
      context.shopping?.completed[0]?.addedAt,
      '2026-06-19T10:00:00.000Z',
    )
    assert.equal(
      context.shopping?.completed[0]?.activatedAt,
      '2026-06-19T10:00:00.000Z',
    )
    assert.equal(
      context.shopping?.completed[0]?.completedAt,
      '2026-06-20T12:00:00.000Z',
    )
    assert.equal(context.stats?.activeCounts.shopping, 2)
    assert.equal(context.stats?.overdueByDomain.shopping, 1)
    assert.equal(context.overdue?.shopping, 1)
    assert.deepEqual(
      context.overdueItemsByDomain?.shopping?.map((item) => item.title),
      ['Expired milk'],
    )
  })

  void it('keeps today important limited to active selected-date tasks', async () => {
    const service = createService([
      createTask({
        completedAt: '2026-06-12T08:00:00.000Z',
        importance: 'important',
        plannedDate: '2026-06-10',
        status: 'done',
        title: 'Old completed important',
      }),
      createTask({
        completedAt: '2026-06-21T08:00:00.000Z',
        importance: 'important',
        plannedDate: '2026-06-21',
        status: 'done',
        title: 'Done today important',
      }),
      createTask({
        importance: 'important',
        plannedDate: '2026-06-21',
        title: 'Today important',
      }),
      createTask({
        importance: 'important',
        plannedDate: '2026-06-22',
        title: 'Future important',
      }),
    ])

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks', 'stats'],
      userId: USER_ID,
    })

    assert.deepEqual(
      context.tasks?.important.map((task) => task.title),
      ['Today important'],
    )
    assert.deepEqual(
      context.tasks?.importantActiveToday.map((task) => task.title),
      ['Today important'],
    )
    assert.deepEqual(context.tasks?.importantOverdue, [])
    assert.deepEqual(
      context.tasks?.today.map((task) => task.title),
      ['Today important'],
    )
    assert.deepEqual(
      context.tasks?.activeToday.map((task) => task.title),
      ['Today important'],
    )
    assert.deepEqual(
      context.tasks?.completedToday.map((task) => task.title),
      ['Done today important'],
    )
    assert.equal(context.tasks?.activeTodayCount, 1)
    assert.equal(context.tasks?.completedTodayCount, 1)
    assert.equal(context.stats?.activeCounts.tasks, 1)
  })

  void it('exposes task decision fields for GPT prioritization', async () => {
    const service = createService([
      createTask({
        importance: 'important',
        necessity: 'required',
        plannedDate: '2026-06-21',
        resource: -3,
        title: 'Hard urgent task',
        urgency: 'urgent',
      }),
      createTask({
        plannedDate: '2026-06-21',
        resource: 2,
        title: 'Restorative task',
      }),
      createTask({
        plannedDate: '2026-06-21',
        resource: null,
        title: 'Unspecified resource task',
      }),
    ])

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks'],
      userId: USER_ID,
    })
    const hardTask = context.tasks?.today.find(
      (task) => task.title === 'Hard urgent task',
    )
    const restorativeTask = context.tasks?.today.find(
      (task) => task.title === 'Restorative task',
    )
    const unspecifiedTask = context.tasks?.today.find(
      (task) => task.title === 'Unspecified resource task',
    )

    assert.deepEqual(
      {
        importance: hardTask?.importance,
        obligation: hardTask?.obligation,
        priority: hardTask?.priority,
        resource: hardTask?.resource,
        resourceImpact: hardTask?.resourceImpact,
        resourceMagnitude: hardTask?.resourceMagnitude,
        urgency: hardTask?.urgency,
      },
      {
        importance: 'important',
        obligation: 'required',
        priority: 'high',
        resource: -3,
        resourceImpact: 'drain',
        resourceMagnitude: 3,
        urgency: 'urgent',
      },
    )
    assert.equal(restorativeTask?.resourceImpact, 'restore')
    assert.equal(restorativeTask?.resourceMagnitude, 2)
    assert.equal(unspecifiedTask?.resourceImpact, 'unknown')
    assert.equal(unspecifiedTask?.resourceMagnitude, null)
  })

  void it('separates overdue counts by planner domain', async () => {
    const service = createService(
      [
        createTask({
          dueDate: '2026-06-20',
          title: 'Overdue task',
        }),
      ],
      [],
      {
        cleaningToday: createCleaningTodayResponse(),
        selfCareDashboard: {
          flexibleGoals: [],
          overdueItems: [
            createSelfCareTodayItem({
              date: '2026-06-20',
              occurrenceId: 'selfcare-overdue',
              title: 'Overdue self care',
              type: 'ritual',
            }),
          ],
          planningHints: [],
          todayItems: [],
          upcomingImportant: [],
        },
        shoppingItems: [
          createShoppingItem({
            dueDate: '2026-06-20',
            status: 'new',
            text: 'Overdue shopping',
          }),
        ],
      },
    )

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['stats', 'cleaning', 'selfcare'],
      userId: USER_ID,
    })

    assert.deepEqual(context.stats?.overdueByDomain, {
      cleaning: 1,
      habits: 0,
      selfCare: 1,
      shopping: 1,
      tasks: 1,
      total: 4,
    })
    assert.deepEqual(context.overdue, {
      cleaning: 1,
      habits: 0,
      selfcare: 1,
      shopping: 1,
      tasks: 1,
      total: 4,
    })
    assert.deepEqual(
      context.overdueItemsByDomain?.cleaning?.map((item) => item.title),
      ['Overdue cleaning'],
    )
    assert.deepEqual(
      context.overdueItemsByDomain?.selfcare?.map((item) => item.title),
      ['Overdue self care'],
    )
    assert.deepEqual(
      context.overdueItemsByDomain?.selfcare?.map((item) => item.status),
      ['overdue'],
    )
  })

  void it('groups overdue cleaning backlog by zone', async () => {
    const service = createService([], [], {
      cleaningToday: createCleaningTodayResponse([
        { title: 'Change bedding', zone: 'Спальня' },
        { title: 'Vacuum bedroom', zone: 'Спальня' },
        { title: 'Dust bedroom', zone: 'Спальня' },
        { title: 'Wipe table', zone: 'Гостиная' },
        { title: 'Vacuum living room', zone: 'Гостиная' },
        { title: 'Check boiler', zone: 'Котельная' },
        { title: 'No zone task', zone: null },
      ]),
    })

    const todayContext = await service.getTodayContext({
      date: '2026-06-21',
      include: ['cleaning'],
      userId: USER_ID,
    })
    const weekContext = await service.getWeekContext({
      from: '2026-06-15',
      to: '2026-06-21',
      userId: USER_ID,
    })
    const overloadContext = await service.getOverloadContext({
      from: '2026-06-15',
      to: '2026-06-21',
      userId: USER_ID,
    })
    const expectedGroups = [
      { count: 3, zone: 'Спальня' },
      { count: 2, zone: 'Гостиная' },
      { count: 1, zone: 'Без зоны' },
      { count: 1, zone: 'Котельная' },
    ]

    assert.deepEqual(
      todayContext.cleaningOverdueByZone?.map(({ count, zone }) => ({
        count,
        zone,
      })),
      expectedGroups,
    )
    assert.deepEqual(
      todayContext.cleaningOverdueByZone?.[0]?.items.map((item) => item.title),
      ['Change bedding', 'Vacuum bedroom', 'Dust bedroom'],
    )
    assert.deepEqual(
      weekContext.remaining.cleaningOverdueByZone.map(({ count, zone }) => ({
        count,
        zone,
      })),
      expectedGroups,
    )
    assert.deepEqual(
      overloadContext.cleaningOverdueByZone?.map(({ count, zone }) => ({
        count,
        zone,
      })),
      expectedGroups,
    )
  })

  void it('exposes completed cleaning history in day, week, and search contexts', async () => {
    const service = createService([], [], {
      cleaningList: createCleaningListResponse([
        {
          completedAt: '2026-09-09T05:54:59.493Z',
          date: '2026-09-09',
          taskId: 'cleaning-table',
          title: 'Протереть стол',
          zoneId: 'zone-kirill',
          zoneTitle: 'Комната Кирилла',
        },
        {
          completedAt: '2026-09-09T13:23:56.580Z',
          date: '2026-09-09',
          taskId: 'cleaning-hall-floor',
          title: 'Помыть полы в прихожей',
          zoneId: 'zone-living-room',
          zoneTitle: 'Гостиная',
        },
      ]),
      cleaningToday: createCleaningTodayResponse([]),
    })

    const todayContext = await service.getTodayContext({
      date: '2026-09-09',
      include: ['cleaning'],
      userId: USER_ID,
    })
    const weekContext = await service.getWeekContext({
      from: '2026-09-08',
      to: '2026-09-10',
      userId: USER_ID,
    })
    const searchResult = await service.searchPlanner({
      from: '2026-09-08',
      query: 'Протереть стол',
      status: 'done',
      to: '2026-09-10',
      types: ['cleaning'],
      userId: USER_ID,
    })

    assert.equal(todayContext.cleaning?.completedCount, 2)
    assert.deepEqual(
      todayContext.cleaning?.completed.map((item) => ({
        completedAt: item.completedAt,
        date: item.date,
        status: item.status,
        title: item.title,
        zone: item.zone,
      })),
      [
        {
          completedAt: '2026-09-09T05:54:59.493Z',
          date: '2026-09-09',
          status: 'done',
          title: 'Протереть стол',
          zone: 'Комната Кирилла',
        },
        {
          completedAt: '2026-09-09T13:23:56.580Z',
          date: '2026-09-09',
          status: 'done',
          title: 'Помыть полы в прихожей',
          zone: 'Гостиная',
        },
      ],
    )
    assert.equal(weekContext.progress.cleaningCompleted.count, 2)
    assert.deepEqual(
      weekContext.progress.cleaningCompleted.items.map((item) => item.title),
      ['Протереть стол', 'Помыть полы в прихожей'],
    )
    assert.deepEqual(
      searchResult.items.map((item) => ({
        status: 'status' in item ? item.status : null,
        title: item.title,
      })),
      [{ status: 'done', title: 'Протереть стол' }],
    )
  })

  void it('computes overload from active and overdue items, not completed history', async () => {
    const doneTasks = Array.from({ length: 12 }, (_, index) =>
      createTask({
        completedAt: `2026-06-${String(16 + index).padStart(2, '0')}T08:00:00.000Z`,
        plannedDate: `2026-06-${String(16 + index).padStart(2, '0')}`,
        status: 'done',
        title: `Done task ${index}`,
      }),
    )
    const service = createService(
      [
        ...doneTasks,
        createTask({
          plannedDate: '2026-06-18',
          title: 'Active routine',
        }),
      ],
      [],
      {
        shoppingItems: Array.from({ length: 5 }, (_, index) =>
          createShoppingItem({
            status: 'archived',
            text: `Bought item ${index}`,
          }),
        ),
      },
    )

    const context = await service.getOverloadContext({
      from: '2026-06-15',
      to: '2026-06-21',
      userId: USER_ID,
    })

    assert.equal(context.counts.tasksActive, 1)
    assert.equal(context.counts.tasksTotal, 1)
    assert.equal(context.counts.shoppingActive, 0)
    assert.equal(context.counts.shoppingCompleted, 5)
    assert.equal(context.load.activeCounts.shoppingActive, 0)
    assert.equal(context.load.ignoredCounts.completedShopping, 5)
    assert.equal(context.load.ignoredCounts.completedTasks, 6)
    assert.equal(
      context.load.structuredReasons.some(
        (reason) => reason.code === 'shopping_active',
      ),
      false,
    )
    assert.equal(context.load.level, 'low')
  })

  void it('exposes weekly progress separately from remaining work', async () => {
    const service = createService(
      [
        createTask({
          completedAt: '2026-06-16T08:00:00.000Z',
          plannedDate: '2026-06-16',
          status: 'done',
          title: 'Done task',
        }),
        createTask({
          importance: 'important',
          plannedDate: '2026-06-21',
          title: 'Active task',
        }),
      ],
      [],
      {
        selfCareHistory: {
          appointmentDetails: [],
          completions: [
            createSelfCareCompletion({
              completedAt: '2026-06-17T09:00:00.000Z',
              itemId: 'care-item',
              scheduledFor: '2026-06-17',
              status: 'done',
            }),
          ],
          items: [
            createSelfCareItem({
              id: 'care-item',
              title: 'Care done',
              type: 'ritual',
            }),
          ],
          procedureDetails: [],
          stepCompletions: [],
        },
        selfCarePlan: {
          courses: [],
          from: '2026-06-15',
          medical: [],
          occurrences: [
            createSelfCareTodayItem({
              date: '2026-06-21',
              occurrenceId: 'care-remaining',
              title: 'Care remaining',
              type: 'ritual',
            }),
          ],
          planningHints: [],
          to: '2026-06-21',
        },
        shoppingItems: [
          createShoppingItem({
            completedAt: '2026-06-17T09:00:00.000Z',
            status: 'archived',
            text: 'Bought milk',
          }),
          createShoppingItem({
            priority: 'high',
            status: 'new',
            text: 'Buy bread',
          }),
        ],
      },
    )

    const context = await service.getWeekContext({
      from: '2026-06-15',
      to: '2026-06-21',
      userId: USER_ID,
    })

    assert.equal(context.progress.tasksCompleted.count, 1)
    assert.deepEqual(
      context.progress.tasksCompleted.items.map((item) => item.title),
      ['Done task'],
    )
    assert.equal(context.progress.shoppingCompleted.count, 1)
    assert.equal(context.progress.selfCareCompleted.count, 1)
    assert.deepEqual(
      context.remaining.tasksActive.map((item) => item.title),
      ['Active task'],
    )
    assert.deepEqual(
      context.remaining.shoppingActive.map((item) => item.title),
      ['Buy bread'],
    )
    assert.equal(context.summary.shoppingActive, 1)
    assert.equal(context.summary.shoppingCompleted, 1)
    assert.equal(context.summary.shoppingTotal, 2)
    assert.equal(context.summary.shoppingUrgentActive, 1)
  })

  void it('does not mark future tasks in the current week as overdue', async () => {
    const today = getTodayDate('Europe/Astrakhan')
    const yesterday = addDateDays(today, -1)
    const tomorrow = addDateDays(today, 1)
    const weekEnd = addDateDays(today, 2)
    const service = createService(
      [
        createTask({
          plannedDate: yesterday,
          title: 'Past open task',
        }),
        createTask({
          plannedDate: tomorrow,
          title: 'Future open task',
        }),
      ],
      [],
      {
        shoppingItems: [
          createShoppingItem({
            dueDate: yesterday,
            text: 'Past shopping item',
          }),
          createShoppingItem({
            dueDate: tomorrow,
            text: 'Future shopping item',
          }),
        ],
      },
    )

    const context = await service.getWeekContext({
      from: yesterday,
      timezone: 'Europe/Astrakhan',
      to: weekEnd,
      userId: USER_ID,
    })

    assert.deepEqual(
      context.highlights.overdue.map((item) => item.title),
      ['Past open task'],
    )
    assert.equal(context.summary.overdueTasks, 1)
    assert.equal(
      context.highlights.overdue.some(
        (item) => item.title === 'Future open task',
      ),
      false,
    )
    assert.deepEqual(
      context.remaining.shoppingActive.map((item) => ({
        status: item.status,
        title: item.title,
      })),
      [
        { status: 'overdue', title: 'Past shopping item' },
        { status: 'todo', title: 'Future shopping item' },
      ],
    )
  })

  void it('groups repeated weekly routines for analytics counts', async () => {
    const service = createService(
      Array.from({ length: 7 }, (_, index) =>
        createTask({
          plannedDate: `2026-06-${String(15 + index).padStart(2, '0')}`,
          routine: {
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            frequency: 'daily',
            seriesId: 'medicine-series',
            targetType: 'check',
            targetValue: 1,
            unit: '',
          },
          title: 'Take medicine',
        }),
      ),
    )

    const context = await service.getWeekContext({
      from: '2026-06-15',
      to: '2026-06-21',
      userId: USER_ID,
    })

    assert.equal(context.summary.taskOccurrencesActive, 7)
    assert.equal(context.summary.taskGroupsActive, 1)
    assert.equal(context.summary.plannedTasks, 1)
    assert.deepEqual(context.highlights.repeatedRoutineGroups, [
      {
        count: 7,
        dates: [
          '2026-06-15',
          '2026-06-16',
          '2026-06-17',
          '2026-06-18',
          '2026-06-19',
          '2026-06-20',
          '2026-06-21',
        ],
        source: 'tasks',
        title: 'Take medicine',
      },
    ])
  })

  void it('returns self-care scheduled, remaining, completed, overdue and duplicate signals', async () => {
    const today = getTodayDate('Europe/Astrakhan')
    const yesterday = addDateDays(today, -1)
    const from = addDateDays(today, -6)
    const service = createService([], [], {
      selfCareHistory: {
        appointmentDetails: [],
        completions: [
          createSelfCareCompletion({
            completedAt: `${yesterday}T09:00:00.000Z`,
            itemId: 'walk-item',
            scheduledFor: yesterday,
            status: 'done',
          }),
        ],
        items: [
          createSelfCareItem({
            category: 'movement',
            id: 'walk-item',
            title: 'Walk',
            type: 'ritual',
          }),
        ],
        procedureDetails: [],
        stepCompletions: [],
      },
      selfCarePlan: {
        courses: [],
        from,
        medical: [],
        occurrences: [
          createSelfCareTodayItem({
            category: 'nutrition',
            date: today,
            occurrenceId: 'water-1',
            title: 'Drink water',
            type: 'ritual',
          }),
          createSelfCareTodayItem({
            category: 'nutrition',
            date: today,
            occurrenceId: 'water-2',
            title: 'Drink water',
            type: 'ritual',
          }),
          createSelfCareTodayItem({
            category: 'sleep',
            date: yesterday,
            occurrenceId: 'sleep-1',
            title: 'Sleep routine',
            type: 'ritual',
          }),
          createSelfCareTodayItem({
            category: 'beauty',
            date: yesterday,
            occurrenceId: 'skipped-1',
            occurrenceStatus: 'skipped',
            title: 'Skipped routine',
            type: 'ritual',
          }),
        ],
        planningHints: [],
        to: today,
      },
    })

    const context = await service.getSelfCareContext({
      from,
      to: today,
      userId: USER_ID,
    })

    assert.equal(context.summary.scheduledCount, 3)
    assert.equal(context.summary.remainingCount, 2)
    assert.equal(context.summary.completedCount, 1)
    assert.equal(context.summary.missedCount, 1)
    assert.equal(context.summary.overdueCount, 1)
    assert.equal(context.summary.potentialDuplicateCount, 1)
    assert.equal(context.potentialDuplicates[0]?.title, 'Drink water')
    assert.equal(context.potentialDuplicates[0]?.count, 2)
    assert.equal(context.completed[0]?.category, 'movement')
    assert.equal(context.remaining[0]?.category, 'nutrition')
    assert.equal(
      context.remaining.some((item) => item.title === 'Skipped routine'),
      false,
    )
    assert.equal(
      context.scheduled.some((item) => item.title === 'Skipped routine'),
      false,
    )
    assert.equal(context.missed[0]?.category, 'beauty')
    assert.equal(context.missed[0]?.status, 'missed')
    assert.equal(context.overdue[0]?.category, 'sleep')
    assert.equal(context.overdue[0]?.status, 'overdue')
    assert.equal(
      context.overdue.some((item) => item.title === 'Skipped routine'),
      false,
    )
  })

  void it('excludes moved and completed self-care occurrences from planned contexts', async () => {
    mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-08-26T05:00:00.000Z'),
    })
    const movedManicure = createSelfCareTodayItem({
      category: 'body',
      date: '2026-08-24',
      occurrenceId: 'manicure-moved',
      occurrenceStatus: 'moved',
      title: 'Маникюр',
      type: 'appointment',
    })
    const completedCare = createSelfCareTodayItem({
      category: 'beauty',
      date: '2026-08-24',
      occurrenceId: 'morning-care-done',
      occurrenceStatus: 'done',
      title: 'Утренний уход',
      type: 'ritual',
    })
    const activeYoga = createSelfCareTodayItem({
      category: 'movement',
      date: '2026-08-24',
      occurrenceId: 'yoga-active',
      title: 'Йога',
      type: 'task',
    })
    const replacementManicure = createSelfCareTodayItem({
      category: 'body',
      date: '2026-08-25',
      occurrenceId: 'manicure-replacement',
      title: 'Маникюр',
      type: 'appointment',
    })
    const service = createService([], [], {
      selfCareDashboard: {
        flexibleGoals: [],
        overdueItems: [],
        planningHints: [],
        todayItems: [movedManicure, completedCare, activeYoga],
        upcomingImportant: [],
      },
      selfCareHistory: {
        appointmentDetails: [],
        completions: [
          createSelfCareCompletion({
            completedAt: '2026-08-24T09:00:00.000Z',
            itemId: completedCare.item.id,
            scheduledFor: '2026-08-24',
            status: 'done',
          }),
        ],
        items: [completedCare.item],
        procedureDetails: [],
        stepCompletions: [],
      },
      selfCarePlan: {
        courses: [],
        from: '2026-08-24',
        medical: [],
        occurrences: [movedManicure, completedCare, replacementManicure],
        planningHints: [],
        to: '2026-08-25',
      },
    })

    const todayContext = await service.getTodayContext({
      date: '2026-08-24',
      include: ['selfcare'],
      userId: USER_ID,
    })
    const rangeContext = await service.getSelfCareContext({
      from: '2026-08-24',
      to: '2026-08-25',
      userId: USER_ID,
    })
    const searchResult = await service.searchPlanner({
      from: '2026-08-24',
      query: 'Маникюр',
      to: '2026-08-25',
      types: ['selfcare'],
      userId: USER_ID,
    })

    assert.deepEqual(
      todayContext.selfCare?.planned.map((item) => item.title),
      ['Йога'],
    )
    assert.deepEqual(
      todayContext.selfCare?.scheduled.map((item) => item.title),
      ['Йога'],
    )
    assert.deepEqual(
      todayContext.selfCare?.completed.map((item) => item.title),
      ['Утренний уход'],
    )
    assert.deepEqual(
      rangeContext.planned.map((item) => ({
        date: item.date,
        title: item.title,
      })),
      [{ date: '2026-08-25', title: 'Маникюр' }],
    )
    assert.deepEqual(rangeContext.scheduled, rangeContext.planned)
    assert.deepEqual(
      searchResult.items.map((item) => ({
        date: 'date' in item ? item.date : null,
        title: item.title,
      })),
      [{ date: '2026-08-25', title: 'Маникюр' }],
    )
  })

  void it('filters legacy habit artifacts from today self-care context', async () => {
    const service = createService([], [], {
      selfCareDashboard: {
        flexibleGoals: [],
        overdueItems: [
          createSelfCareTodayItem({
            date: '2026-06-20',
            occurrenceId: 'legacy-habit-missed',
            title: 'Legacy missed habit',
            type: 'habit',
          }),
          createSelfCareTodayItem({
            date: '2026-06-20',
            occurrenceId: 'care-skipped',
            occurrenceStatus: 'skipped',
            title: 'Skipped care',
            type: 'ritual',
          }),
          createSelfCareTodayItem({
            date: '2026-06-20',
            occurrenceId: 'care-overdue',
            title: 'Overdue care',
            type: 'ritual',
          }),
        ],
        planningHints: [
          createSelfCareTodayItem({
            date: '2026-06-21',
            occurrenceId: 'legacy-habit-hint',
            title: 'Legacy hint',
            type: 'habit',
          }),
          createSelfCareTodayItem({
            date: '2026-06-21',
            occurrenceId: 'morning-care-hint',
            title: 'Утренний уход',
            type: 'ritual',
          }),
        ],
        todayItems: [
          createSelfCareTodayItem({
            date: '2026-06-21',
            occurrenceId: 'yoga-task',
            title: 'Йога',
            type: 'task',
          }),
          createSelfCareTodayItem({
            date: '2026-06-21',
            occurrenceId: 'yoga-habit',
            title: 'Йога',
            type: 'habit',
          }),
          createSelfCareTodayItem({
            date: '2026-06-21',
            occurrenceId: 'coffee-habit',
            title: 'Утренний кофе',
            type: 'habit',
          }),
          createSelfCareTodayItem({
            date: '2026-06-21',
            occurrenceId: 'coffee-task',
            title: 'Утренний кофе',
            type: 'task',
          }),
          createSelfCareTodayItem({
            date: '2026-06-21',
            isActive: false,
            isArchived: true,
            occurrenceId: 'archived-tail',
            title: 'Медиана',
            type: 'task',
          }),
          createSelfCareTodayItem({
            date: '2026-06-21',
            occurrenceId: 'morning-care',
            title: 'Утренний уход',
            type: 'ritual',
          }),
        ],
        upcomingImportant: [],
      },
    })

    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['selfcare', 'habits', 'stats'],
      userId: USER_ID,
    })

    assert.deepEqual(
      context.selfCare?.remaining.map((item) => ({
        title: item.title,
        type: item.type,
      })),
      [
        { title: 'Йога', type: 'task' },
        { title: 'Утренний кофе', type: 'task' },
        { title: 'Утренний уход', type: 'ritual' },
      ],
    )
    assert.deepEqual(
      context.selfCare?.missed.map((item) => item.title),
      ['Skipped care'],
    )
    assert.deepEqual(
      context.selfCare?.overdue.map((item) => item.title),
      ['Overdue care'],
    )
    assert.deepEqual(
      context.selfCare?.overdue.map((item) => item.status),
      ['overdue'],
    )
    assert.equal(context.selfCare?.suggestedFocus, 'Утренний уход')
    assert.equal(context.habits, undefined)
    assert.equal(context.stats?.activeCounts.habits, 0)
    assert.equal(context.stats?.overdueByDomain.habits, 0)
    assert.equal(context.stats?.overdueByDomain.selfCare, 1)
  })

  void it('keeps same-title flexible goals separate and preserves identity after a rename', async () => {
    const first = createSelfCareTodayItem({
      date: '2026-06-21',
      occurrenceId: 'first-goal',
      title: 'Вода',
      type: 'flexible_goal',
    })
    const second = createSelfCareTodayItem({
      date: '2026-06-21',
      occurrenceId: 'second-goal',
      title: 'Вода',
      type: 'flexible_goal',
    })
    const dashboard = {
      flexibleGoals: [first, second, first],
      overdueItems: [],
      planningHints: [],
      todayItems: [],
      upcomingImportant: [],
    }
    const service = createService([], [], { selfCareDashboard: dashboard })
    const params = {
      date: '2026-06-21',
      include: ['selfcare'] as const,
      userId: USER_ID,
    }
    const before = await service.getTodayContext({
      ...params,
      include: [...params.include],
    })
    assert.equal(before.selfCareFlexibleGoals?.totalGoals, 2)
    const originalId = before.selfCare?.flexibleGoals.find((goal) =>
      goal.id.includes('first-goal-item'),
    )?.id
    assert.ok(originalId)

    first.item.title = 'Вода после тренировки'
    const after = await service.getTodayContext({
      ...params,
      include: [...params.include],
    })
    assert.equal(after.selfCareFlexibleGoals?.totalGoals, 2)
    assert.equal(
      after.selfCare?.flexibleGoals.find(
        (goal) => goal.title === 'Вода после тренировки',
      )?.id,
      originalId,
    )
    const tomorrow = await service.getTodayContext({
      ...params,
      date: '2026-06-22',
      include: [...params.include],
    })
    assert.equal(
      tomorrow.selfCare?.flexibleGoals.find(
        (goal) => goal.title === 'Вода после тренировки',
      )?.id,
      originalId,
    )
  })

  void it('returns flexible self-care goals as one progress object per goal', async () => {
    const waterGoal = createSelfCareTodayItem({
      category: 'nutrition',
      completedCount: 1,
      date: '2026-06-21',
      occurrenceId: 'water-goal',
      remainingCount: 2,
      targetCount: 3,
      title: 'Вода',
      type: 'flexible_goal',
    })
    const pushupsGoal = createSelfCareTodayItem({
      category: 'movement',
      completedCount: 0,
      date: '2026-06-21',
      occurrenceId: 'pushups-goal',
      remainingCount: 3,
      targetCount: 3,
      title: 'Отжимания',
      type: 'flexible_goal',
    })
    const service = createService([], [], {
      selfCareAnalytics: createSelfCareAnalyticsResponse({
        completionsByDay: {},
        courses: [],
        flexibleGoals: [waterGoal, pushupsGoal, waterGoal],
        measurementTrends: [],
        medicalUpcoming: [],
        minimumCompletionCount: 0,
        moodEnergyTrend: [],
        procedureCosts: 0,
        procedureCostsByMonth: {},
        selectedSelfCareCount: 0,
      }),
      selfCareDashboard: {
        flexibleGoals: [waterGoal, pushupsGoal, waterGoal],
        overdueItems: [],
        planningHints: [],
        todayItems: [waterGoal, pushupsGoal, waterGoal],
        upcomingImportant: [],
      },
    })

    const todayContext = await service.getTodayContext({
      date: '2026-06-21',
      include: ['selfcare', 'stats'],
      userId: USER_ID,
    })
    const selfCareContext = await service.getSelfCareContext({
      from: '2026-06-21',
      to: '2026-06-21',
      userId: USER_ID,
    })

    assert.deepEqual(todayContext.selfCare?.remaining, [])
    assert.deepEqual(todayContext.selfCare?.flexibleGoals, [
      {
        category: 'nutrition',
        date: '2026-06-21',
        doneCount: 1,
        expectedRepeats: true,
        id: 'flexible-goal:water-goal-item:2026-06-21:2026-06-21',
        remainingCount: 2,
        source: 'selfcare',
        status: 'in_progress',
        targetCount: 3,
        title: 'Вода',
        type: 'flexible_goal',
        unit: null,
      },
      {
        category: 'movement',
        date: '2026-06-21',
        doneCount: 0,
        expectedRepeats: true,
        id: 'flexible-goal:pushups-goal-item:2026-06-21:2026-06-21',
        remainingCount: 3,
        source: 'selfcare',
        status: 'planned',
        targetCount: 3,
        title: 'Отжимания',
        type: 'flexible_goal',
        unit: null,
      },
    ])
    assert.equal(todayContext.selfCareFlexibleGoals?.totalGoals, 2)
    assert.equal(todayContext.selfCareFlexibleGoals?.inProgressGoals, 1)
    assert.equal(todayContext.selfCareFlexibleGoals?.completedGoals, 0)
    assert.equal(todayContext.stats?.activeCounts.selfCare, 0)
    assert.deepEqual(
      selfCareContext.summary.flexibleGoals.items.map((goal) => goal.title),
      ['Вода', 'Отжимания'],
    )
    assert.deepEqual(
      selfCareContext.summary.selfCareFlexibleGoals.items.map(
        (goal) => goal.title,
      ),
      ['Вода', 'Отжимания'],
    )
  })

  void it('does not return legacy habits through planner search', async () => {
    const service = createService([])

    const result = await service.searchPlanner({
      query: 'Daily habit',
      types: ['habits'],
      userId: USER_ID,
    })

    assert.equal(result.totalCount, 0)
    assert.deepEqual(result.items, [])
  })

  void it('counts actual task completions in the planner timezone instead of planned dates or archives', async () => {
    const service = createService([
      createTask({
        title: 'Finished after an old plan',
        plannedDate: '2026-06-10',
        completedAt: '2026-06-20T18:00:00.000Z',
        status: 'done',
      }),
      createTask({
        title: 'Finished before a future plan',
        plannedDate: '2026-06-30',
        completedAt: '2026-06-21T08:00:00.000Z',
        status: 'done',
      }),
      createTask({
        title: 'Finished on a different day',
        plannedDate: '2026-06-21',
        completedAt: '2026-06-22T08:00:00.000Z',
        status: 'done',
      }),
      createTask({
        title: 'Archived instead of completed',
        plannedDate: '2026-06-21',
        completedAt: '2026-06-21T08:00:00.000Z',
        status: 'archived',
      }),
      createTask({
        title: 'Missing completion time',
        plannedDate: '2026-06-21',
        status: 'done',
      }),
    ])
    const period = {
      from: '2026-06-21',
      to: '2026-06-21',
      timezone: 'Asia/Novosibirsk',
      userId: USER_ID,
    }
    const today = await service.getTodayContext({
      date: period.from,
      timezone: period.timezone,
      userId: USER_ID,
    })
    const week = await service.getWeekContext(period)
    const overload = await service.getOverloadContext(period)
    const expected = [
      'Finished after an old plan',
      'Finished before a future plan',
    ]

    assert.deepEqual(
      today.tasks?.completedToday.map((item) => item.title),
      expected,
    )
    assert.equal(today.tasks?.completedTodayCount, 2)
    assert.deepEqual(
      week.progress.tasksCompleted.items.map((item) => item.title),
      expected,
    )
    assert.equal(week.summary.completedTasks, 2)
    assert.equal(overload.load.ignoredCounts.completedTasks, 2)
    assert.equal(today.tasks?.activeTodayCount, 0)
    assert.equal(overload.counts.tasksActive, 0)
  })

  void it('selects gentle and restoring tasks using signed resource values', async () => {
    const service = createService(
      [-4, -2, -1, 0, 1, 4, null].map((resource) =>
        createTask({
          title: `Resource ${resource}`,
          plannedDate: '2026-06-21',
          resource,
        }),
      ),
    )
    const context = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks'],
      userId: USER_ID,
    })

    assert.deepEqual(
      context.tasks?.lowEnergy.map((item) => item.resource),
      [-1, 0, 1, 4],
    )
    assert.equal(
      context.tasks?.today.find((item) => item.resource === -4)?.priority,
      'normal',
    )
    assert.equal(
      context.tasks?.today.find((item) => item.resource === 4)?.priority,
      'low',
    )
  })

  void it('keeps independent same-title tasks separate in weekly and overload counts', async () => {
    const service = createService([
      createTask({ title: 'Read report', plannedDate: '2026-06-21' }),
      createTask({ title: 'Read report', plannedDate: '2026-06-21' }),
    ])
    const period = { from: '2026-06-21', to: '2026-06-21', userId: USER_ID }
    const week = await service.getWeekContext(period)
    const overload = await service.getOverloadContext(period)

    assert.equal(week.summary.taskGroupsActive, 2)
    assert.equal(week.summary.tasksActive, 2)
    assert.equal(week.remaining.tasksActive.length, 2)
    assert.equal(overload.counts.tasksActive, 2)
  })

  void it('counts a task planned today with an overdue deadline only once in active load', async () => {
    const service = createService([
      createTask({ plannedDate: '2026-06-21', dueDate: '2026-06-20' }),
    ])
    const today = await service.getTodayContext({
      date: '2026-06-21',
      include: ['tasks', 'stats'],
      userId: USER_ID,
    })

    assert.equal(today.tasks?.activeTodayCount, 1)
    assert.equal(today.tasks?.overdueCount, 1)
    assert.equal(today.tasks?.totalCount, 1)
    assert.equal(today.stats?.activeCounts.tasks, 1)
  })

  void it('includes deadlines inside a period even when the task is planned outside it', async () => {
    const service = createService([
      createTask({
        title: 'Deadline in range',
        plannedDate: '2026-06-30',
        plannedStartTime: '10:00',
        dueDate: '2026-06-21',
      }),
      createTask({
        title: 'Plan in range',
        plannedDate: '2026-06-21',
        dueDate: '2026-06-30',
      }),
    ])
    const period = { from: '2026-06-21', to: '2026-06-21', userId: USER_ID }
    const week = await service.getWeekContext(period)
    const overload = await service.getOverloadContext(period)

    assert.equal(week.remaining.tasksActive.length, 2)
    assert.equal(week.summary.tasksActive, 2)
    assert.equal(overload.counts.tasksActive, 2)
    assert.equal(overload.counts.calendarEvents, 0)
  })

  void it('compacts historical task lists using the requested date instead of the current date', async () => {
    const service = createService([
      ...Array.from({ length: 50 }, (_, index) =>
        createTask({
          title: `Completed task ${index}`,
          plannedDate: '2026-06-20',
          completedAt: '2026-06-21T08:00:00.000Z',
          status: 'done',
        }),
      ),
      createTask({
        title: 'Important with future plan',
        plannedDate: '2026-06-30',
        completedAt: '2026-06-21T08:00:00.000Z',
        status: 'done',
        importance: 'important',
      }),
    ])
    const period = { from: '2026-06-21', to: '2026-06-21', userId: USER_ID }
    const day = { date: period.from, userId: USER_ID }
    mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-06-21T12:00:00Z'),
    })
    const currentDay = await service.getTodayContext(day)
    const currentWeek = await service.getWeekContext(period)
    mock.timers.setTime(new Date('2026-11-05T12:00:00Z').getTime())
    const historicalDay = await service.getTodayContext(day)
    const historicalWeek = await service.getWeekContext(period)

    assert.equal(currentDay.tasks?.completedToday.length, 50)
    assert.equal(currentDay.tasks?.completedTodayCount, 51)
    assert.deepEqual(
      historicalDay.tasks?.completedToday,
      currentDay.tasks?.completedToday,
    )
    assert.deepEqual(
      historicalWeek.progress.tasksCompleted,
      currentWeek.progress.tasksCompleted,
    )
  })
})

interface CreateServiceOptions {
  cleaningList?: CleaningListResponse | undefined
  cleaningToday?: CleaningTodayResponse | undefined
  selfCareAnalytics?: SelfCareAnalyticsResponse | undefined
  selfCareDashboard?:
    | Awaited<
        ReturnType<
          NonNullable<
            AiContextServiceDependencies['selfCareService']
          >['getDashboard']
        >
      >
    | undefined
  selfCareHistory?: SelfCareHistoryResponse | undefined
  selfCarePlan?: SelfCarePlanResponse | undefined
  shoppingItems?: ChaosInboxItemRecord[] | undefined
  shoppingTotalCount?: number | undefined
  taskReadModelCalls?: unknown[] | undefined
  taskTotalCount?: number | undefined
  taskTruncated?: boolean | undefined
}

function createService(
  tasks: Task[],
  resolveSessionCalls: unknown[] = [],
  options: CreateServiceOptions = {},
): AiContextService {
  const dependencies: AiContextServiceDependencies = {
    sessionService: {
      resolveSession: (input) => {
        resolveSessionCalls.push(input)

        return Promise.resolve({
          actor: {
            email: 'owner@example.test',
          },
          actorUserId: USER_ID,
          groupRole: null,
          role: 'owner',
          workspace: {
            kind: 'personal',
            name: 'Personal',
          },
          workspaceId: WORKSPACE_ID,
          workspaces: [
            {
              id: WORKSPACE_ID,
              kind: 'personal',
              name: 'Personal',
            },
          ],
        })
      },
    },
    taskService: {
      searchTasksCursor: (_context, filters) => {
        const matching = tasks.filter((task) =>
          matchesTaskContextFilter(task, filters),
        )
        const items = matching.slice(0, filters.limit)
        const hasMore = items.length < matching.length
        return Promise.resolve({
          items,
          hasMore,
          nextCursor: hasMore ? 'fixture-next-page' : null,
          returnedCount: items.length,
          totalCount: matching.length,
          truncated: hasMore,
        })
      },
      getTaskReadModel: (_context, filters) => {
        options.taskReadModelCalls?.push(filters)

        return Promise.resolve({
          items: tasks,
          returnedCount: tasks.length,
          totalCount: options.taskTotalCount ?? tasks.length,
          truncated: options.taskTruncated ?? false,
        })
      },
    },
  }

  if (options.shoppingItems) {
    dependencies.chaosInboxService = {
      listItems: () =>
        Promise.resolve({
          items: options.shoppingItems ?? [],
          total:
            options.shoppingTotalCount ?? options.shoppingItems?.length ?? 0,
        }),
    }
  }

  if (options.cleaningToday) {
    dependencies.cleaningService = {
      getToday: () => Promise.resolve(options.cleaningToday!),
      ...(options.cleaningList
        ? {
            listCleaning: () => Promise.resolve(options.cleaningList!),
          }
        : {}),
    }
  }

  if (
    options.selfCareDashboard ||
    options.selfCarePlan ||
    options.selfCareHistory ||
    options.selfCareAnalytics
  ) {
    dependencies.selfCareService = {
      getAnalytics: () =>
        Promise.resolve(
          options.selfCareAnalytics ?? createSelfCareAnalyticsResponse(),
        ),
      getDashboard: () =>
        Promise.resolve(
          options.selfCareDashboard ?? {
            flexibleGoals: [],
            overdueItems: [],
            planningHints: [],
            todayItems: [],
            upcomingImportant: [],
          },
        ),
      getHistory: () =>
        Promise.resolve(
          options.selfCareHistory ?? {
            appointmentDetails: [],
            completions: [],
            items: [],
            procedureDetails: [],
            stepCompletions: [],
          },
        ),
      getPlan: () =>
        Promise.resolve(
          options.selfCarePlan ?? {
            courses: [],
            from: '2026-06-15',
            medical: [],
            occurrences: [],
            planningHints: [],
            to: '2026-06-21',
          },
        ),
    }
  }

  return new AiContextService(dependencies)
}

function createTask(overrides: Partial<Task>): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: 'Owner',
    authorUserId: USER_ID,
    completedAt: null,
    createdAt: '2026-06-19T10:00:00.000Z',
    dueDate: null,
    icon: '',
    id: randomUUID(),
    importance: 'not_important',
    linkedTask: null,
    necessity: 'desired',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    recurrence: null,
    remindBeforeStart: false,
    reminderOffsets: [],
    requiresConfirmation: false,
    resource: 2,
    routine: null,
    sourceWorkspace: null,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function createShoppingItem(
  overrides: Partial<ChaosInboxItemRecord>,
): ChaosInboxItemRecord {
  return {
    activatedAt: '2026-06-19T10:00:00.000Z',
    completedAt: null,
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: '2026-06-19T10:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id: randomUUID(),
    isFavorite: false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: 'medium',
    shoppingCategory: 'groceries',
    source: 'manual',
    sphereId: null,
    status: 'new',
    text: 'Shopping item',
    updatedAt: '2026-06-19T10:00:00.000Z',
    userId: USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  }
}

function createCleaningTodayResponse(
  overdueItems: Array<{ title: string; zone?: string | null }> = [
    { title: 'Overdue cleaning', zone: 'Kitchen' },
  ],
): CleaningTodayResponse {
  return {
    accumulatedItems: overdueItems.map((item) => ({
      isDue: true,
      isOverdue: true,
      state: {
        nextDueAt: '2026-06-20',
      },
      task: {
        title: item.title,
      },
      zone: item.zone ? { title: item.zone } : null,
    })),
    dayOfWeek: 7,
    history: [],
    items: [],
    summary: {
      accumulatedCount: overdueItems.length,
      activeZoneCount: 1,
      completedTodayCount: 0,
      dueCount: 0,
      generalCount: 0,
      quickCount: 0,
      seasonalCount: 0,
      urgentCount: overdueItems.length,
    },
    zones: [
      {
        dayOfWeek: 7,
        title: 'Kitchen',
      },
    ],
  } as unknown as CleaningTodayResponse
}

function createCleaningListResponse(
  completions: Array<{
    completedAt: string
    date: string
    taskId: string
    title: string
    zoneId: string
    zoneTitle: string
  }>,
): CleaningListResponse {
  return {
    history: completions.map((completion, index) => ({
      action: 'completed',
      createdAt: completion.completedAt,
      date: completion.date,
      id: `history-${index}`,
      note: '',
      targetDate: null,
      taskId: completion.taskId,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      zoneId: completion.zoneId,
    })),
    states: completions.map((completion) => ({
      lastCompletedAt: completion.completedAt,
      lastPostponedAt: null,
      lastSkippedAt: null,
      nextDueAt: '2026-09-16',
      postponeCount: 0,
      taskId: completion.taskId,
      updatedAt: completion.completedAt,
      version: 1,
      workspaceId: WORKSPACE_ID,
    })),
    tasks: completions.map((completion) => ({
      assignee: 'anyone',
      createdAt: completion.completedAt,
      customIntervalDays: null,
      deletedAt: null,
      depth: 'regular',
      description: '',
      energy: 'normal',
      estimatedMinutes: 10,
      frequencyInterval: 1,
      frequencyType: 'weekly',
      id: completion.taskId,
      impactScore: 3,
      isActive: true,
      isSeasonal: false,
      priority: 'normal',
      scope: 'zone',
      seasonMonths: [],
      sortOrder: 0,
      tags: [],
      title: completion.title,
      updatedAt: completion.completedAt,
      userId: USER_ID,
      version: 1,
      workspaceId: WORKSPACE_ID,
      zoneId: completion.zoneId,
    })),
    zones: completions.map((completion, index) => ({
      createdAt: completion.completedAt,
      dayOfWeek: index + 1,
      deletedAt: null,
      description: '',
      id: completion.zoneId,
      isActive: true,
      sortOrder: index,
      title: completion.zoneTitle,
      updatedAt: completion.completedAt,
      userId: USER_ID,
      version: 1,
      workspaceId: WORKSPACE_ID,
    })),
  }
}

function createSelfCareTodayItem(input: {
  category?: SelfCareHistoryResponse['items'][number]['category'] | undefined
  completedCount?: number
  date: string
  deletedAt?: string | null | undefined
  isActive?: boolean | undefined
  isArchived?: boolean | undefined
  occurrenceId: string
  occurrenceStatus?: 'done' | 'missed' | 'moved' | 'scheduled' | 'skipped'
  remainingCount?: number
  targetCount?: number
  title: string
  type: string
  unit?: string | null
}): SelfCareTodayItem {
  return {
    completion: null,
    flexibleProgress:
      input.type === 'flexible_goal'
        ? {
            completedCount: input.completedCount ?? 0,
            periodEnd: input.date,
            periodStart: input.date,
            remainingCount:
              input.remainingCount ??
              Math.max(
                0,
                (input.targetCount ?? 1) - (input.completedCount ?? 0),
              ),
            targetCount: input.targetCount ?? 1,
          }
        : null,
    item: createSelfCareItem({
      category: input.category,
      deletedAt: input.deletedAt,
      id: `${input.occurrenceId}-item`,
      isActive: input.isActive,
      isArchived: input.isArchived,
      title: input.title,
      type: input.type,
    }),
    lastMeasurement: input.unit
      ? ({
          measurementUnit: input.unit,
        } as SelfCareTodayItem['lastMeasurement'])
      : null,
    measurement: null,
    occurrence: {
      completedAt:
        input.occurrenceStatus === 'done'
          ? `${input.date}T09:00:00.000Z`
          : null,
      id: input.occurrenceId,
      itemId: `${input.occurrenceId}-item`,
      scheduledFor: input.date,
      status: input.occurrenceStatus ?? 'scheduled',
    },
  } as SelfCareTodayItem
}

function createSelfCareAnalyticsResponse(
  overrides: Partial<SelfCareAnalyticsResponse> = {},
): SelfCareAnalyticsResponse {
  return {
    balanceByCategory: {
      beauty: 0,
      body: 0,
      custom: 0,
      daily_base: 0,
      emotional: 0,
      health: 0,
      medical: 0,
      movement: 0,
      nutrition: 0,
      relax: 0,
      sleep: 0,
    },
    completionsByDay: {},
    courses: [],
    exerciseTrends: [],
    flexibleGoals: [],
    measurementTrends: [],
    medicalUpcoming: [],
    minimumCompletionCount: 0,
    moodEnergyTrend: [],
    procedureCosts: 0,
    procedureCostsByMonth: {},
    selectedSelfCareCount: 0,
    ...overrides,
  }
}

function createSelfCareItem(overrides: {
  category?: SelfCareHistoryResponse['items'][number]['category'] | undefined
  deletedAt?: string | null | undefined
  id: string
  isActive?: boolean | undefined
  isArchived?: boolean | undefined
  title: string
  type: string
}): SelfCareHistoryResponse['items'][number] {
  return {
    category: overrides.category ?? 'health',
    deletedAt: overrides.deletedAt ?? null,
    id: overrides.id,
    isActive: overrides.isActive ?? true,
    isArchived: overrides.isArchived ?? false,
    title: overrides.title,
    type: overrides.type,
  } as SelfCareHistoryResponse['items'][number]
}

function createSelfCareCompletion(overrides: {
  completedAt: string
  itemId: string
  scheduledFor: string
  status: 'done' | 'partial' | 'skipped' | 'supportive'
}): SelfCareHistoryResponse['completions'][number] {
  return {
    completedAt: overrides.completedAt,
    itemId: overrides.itemId,
    scheduledFor: overrides.scheduledFor,
    status: overrides.status,
  } as SelfCareHistoryResponse['completions'][number]
}
