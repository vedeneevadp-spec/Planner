import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'

import type {
  ChaosInboxItemRecord,
  CleaningTodayResponse,
  HabitTodayResponse,
  SelfCareHistoryResponse,
  SelfCarePlanResponse,
  SelfCareTodayItem,
  Task,
} from '@planner/contracts'

import {
  AiContextService,
  type AiContextServiceDependencies,
} from './ai-context.service.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

void describe('AiContextService', () => {
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
      context.tasks?.today.map((task) => task.title),
      ['Today important'],
    )
    assert.equal(context.tasks?.activeTodayCount, 1)
    assert.equal(context.tasks?.completedTodayCount, 0)
    assert.equal(context.stats?.activeCounts.tasks, 1)
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
        habitToday: createHabitTodayResponse(),
        selfCareDashboard: {
          overdueItems: [
            createSelfCareTodayItem({
              date: '2026-06-20',
              occurrenceId: 'selfcare-overdue',
              occurrenceStatus: 'missed',
              title: 'Missed self care',
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
      habits: 1,
      selfCare: 1,
      shopping: 1,
      tasks: 1,
      total: 5,
    })
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
    assert.equal(context.load.level, 'low')
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

  void it('returns self-care scheduled, remaining, completed, missed and duplicate signals', async () => {
    const service = createService([], [], {
      selfCareHistory: {
        completions: [
          createSelfCareCompletion({
            completedAt: '2026-06-20T09:00:00.000Z',
            itemId: 'walk-item',
            scheduledFor: '2026-06-20',
            status: 'done',
          }),
        ],
        items: [
          createSelfCareItem({
            id: 'walk-item',
            title: 'Walk',
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
            occurrenceId: 'water-1',
            title: 'Drink water',
            type: 'ritual',
          }),
          createSelfCareTodayItem({
            date: '2026-06-21',
            occurrenceId: 'water-2',
            title: 'Drink water',
            type: 'ritual',
          }),
          createSelfCareTodayItem({
            date: '2026-06-19',
            occurrenceId: 'sleep-1',
            occurrenceStatus: 'missed',
            title: 'Sleep routine',
            type: 'ritual',
          }),
        ],
        planningHints: [],
        to: '2026-06-21',
      } as SelfCarePlanResponse,
    })

    const context = await service.getSelfCareContext({
      from: '2026-06-15',
      to: '2026-06-21',
      userId: USER_ID,
    })

    assert.equal(context.summary.scheduledCount, 3)
    assert.equal(context.summary.remainingCount, 2)
    assert.equal(context.summary.completedCount, 1)
    assert.equal(context.summary.missedCount, 1)
    assert.equal(context.summary.potentialDuplicateCount, 1)
    assert.equal(context.potentialDuplicates[0]?.title, 'Drink water')
    assert.equal(context.potentialDuplicates[0]?.count, 2)
  })
})

interface CreateServiceOptions {
  cleaningToday?: CleaningTodayResponse | undefined
  habitToday?: HabitTodayResponse | undefined
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

  if (options.habitToday) {
    dependencies.habitService = {
      getStats: () =>
        Promise.resolve({
          stats: options.habitToday!.items.map((item) => ({
            currentStreak: 0,
            habitId: item.habit.id,
          })),
        }),
      getToday: () => Promise.resolve(options.habitToday!),
    }
  }

  if (
    options.selfCareDashboard ||
    options.selfCarePlan ||
    options.selfCareHistory
  ) {
    dependencies.selfCareService = {
      getDashboard: () =>
        Promise.resolve(
          options.selfCareDashboard ?? {
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

function createCleaningTodayResponse(): CleaningTodayResponse {
  return {
    accumulatedItems: [
      {
        isDue: true,
        isOverdue: true,
        state: {
          nextDueAt: '2026-06-20',
        },
        task: {
          title: 'Overdue cleaning',
        },
        zone: {
          title: 'Kitchen',
        },
      },
    ],
    dayOfWeek: 7,
    history: [],
    items: [],
    summary: {
      accumulatedCount: 1,
      activeZoneCount: 1,
      completedTodayCount: 0,
      dueCount: 0,
      generalCount: 0,
      quickCount: 0,
      seasonalCount: 0,
      urgentCount: 1,
    },
    zones: [
      {
        dayOfWeek: 7,
        title: 'Kitchen',
      },
    ],
  } as unknown as CleaningTodayResponse
}

function createHabitTodayResponse(): HabitTodayResponse {
  return {
    date: '2026-06-21',
    items: [
      {
        entry: {
          status: 'skipped',
        },
        habit: {
          id: 'habit-1',
          title: 'Daily habit',
        },
        isDueToday: true,
      },
    ],
  } as unknown as HabitTodayResponse
}

function createSelfCareTodayItem(input: {
  date: string
  occurrenceId: string
  occurrenceStatus?: 'done' | 'missed' | 'moved' | 'scheduled' | 'skipped'
  title: string
  type: string
}): SelfCareTodayItem {
  return {
    completion: null,
    item: createSelfCareItem({
      id: `${input.occurrenceId}-item`,
      title: input.title,
      type: input.type,
    }),
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

function createSelfCareItem(overrides: {
  id: string
  title: string
  type: string
}): SelfCareHistoryResponse['items'][number] {
  return {
    id: overrides.id,
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
