import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, it, mock } from 'node:test'

import {
  addDateDays,
  type ChaosInboxItemRecord,
  type CleaningTodayResponse,
  getTodayDate,
  type SelfCareAnalyticsResponse,
  type SelfCareHistoryResponse,
  type SelfCarePlanResponse,
  type SelfCareTodayItem,
  type Task,
} from '@planner/contracts'

import {
  AiContextService,
  type AiContextServiceDependencies,
} from './ai-context.service.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

void describe('AiContextService', () => {
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
    assert.equal(context.stats?.activeCounts.shopping, 2)
    assert.equal(context.stats?.overdueByDomain.shopping, 1)
    assert.equal(context.overdue?.shopping, 1)
    assert.deepEqual(
      context.overdueItemsByDomain?.shopping.map((item) => item.title),
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
        priority: hardTask?.priority,
        resource: hardTask?.resource,
        resourceImpact: hardTask?.resourceImpact,
        resourceMagnitude: hardTask?.resourceMagnitude,
        urgency: hardTask?.urgency,
      },
      {
        importance: 'important',
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
      include: ['stats'],
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
      context.overdueItemsByDomain?.cleaning.map((item) => item.title),
      ['Overdue cleaning'],
    )
    assert.deepEqual(
      context.overdueItemsByDomain?.selfcare.map((item) => item.title),
      ['Overdue self care'],
    )
    assert.deepEqual(
      context.overdueItemsByDomain?.selfcare.map((item) => item.status),
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
          stepCompletions: [],
        } as SelfCareHistoryResponse,
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
        } as SelfCarePlanResponse,
        shoppingItems: [
          createShoppingItem({
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
        stepCompletions: [],
      } as SelfCareHistoryResponse,
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
      } as SelfCarePlanResponse,
    })

    const context = await service.getSelfCareContext({
      from,
      to: today,
      userId: USER_ID,
    })

    assert.equal(context.summary.scheduledCount, 4)
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
    assert.equal(context.missed[0]?.category, 'sleep')
    assert.equal(context.overdue[0]?.category, 'sleep')
    assert.equal(context.overdue[0]?.status, 'overdue')
    assert.equal(
      context.overdue.some((item) => item.title === 'Skipped routine'),
      false,
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
            occurrenceId: 'care-missed',
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
      ['Overdue care'],
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
        id: 'вода-2026-06-21',
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
        id: 'отжимания-2026-06-21',
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
})

interface CreateServiceOptions {
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
      listTasks: () => Promise.resolve(tasks),
    },
  }

  if (options.shoppingItems) {
    dependencies.chaosInboxService = {
      listItems: () =>
        Promise.resolve({
          items: options.shoppingItems ?? [],
          total: options.shoppingItems?.length ?? 0,
        }),
    }
  }

  if (options.cleaningToday) {
    dependencies.cleaningService = {
      getToday: () => Promise.resolve(options.cleaningToday!),
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
          options.selfCareHistory ??
            ({
              completions: [],
              items: [],
              stepCompletions: [],
            } as SelfCareHistoryResponse),
        ),
      getPlan: () =>
        Promise.resolve(
          options.selfCarePlan ??
            ({
              courses: [],
              from: '2026-06-15',
              medical: [],
              occurrences: [],
              planningHints: [],
              to: '2026-06-21',
            } as SelfCarePlanResponse),
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
