import assert from 'node:assert/strict'
import { it } from 'node:test'

import type {
  ChaosInboxItemRecord,
  CleaningTodayResponse,
  SelfCareHistoryResponse,
  SelfCarePlanResponse,
  SelfCareTodayItem,
  Task,
} from '@planner/contracts'

import { matchesTaskContextFilter } from '../tasks/task.context-filter.js'
import {
  AiContextService,
  type AiContextServiceDependencies,
} from './ai-context.service.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

void it('includes general cleaning due today in context, workload and search', async () => {
  const service = createService({
    cleaningService: {
      getToday: () =>
        Promise.resolve(
          cleaningResponse('2026-06-21', {
            generalItems: [cleaningItem('Общая уборка', '2026-06-21')],
          }),
        ),
    },
  })

  const today = await service.getTodayContext({
    date: '2026-06-21',
    include: ['cleaning', 'stats'],
    userId: USER_ID,
  })
  assert.deepEqual(
    today.cleaning?.tasks.map((item) => item.title),
    ['Общая уборка'],
  )
  assert.equal(today.stats?.activeCounts.cleaning, 1)
  assert.deepEqual(today.cleaning?.overdue, [])

  const result = await service.searchPlanner({
    query: 'Общая уборка',
    types: ['cleaning'],
    from: '2026-06-21',
    to: '2026-06-21',
    userId: USER_ID,
  })
  assert.equal(result.totalCount, 1)
  assert.equal(result.items[0]?.title, 'Общая уборка')
})

void it('includes cleaning after the first fourteen days of an allowed month range', async () => {
  const dates: string[] = []
  const service = createService({
    cleaningService: {
      getToday: (_context, date) => {
        dates.push(date)
        return Promise.resolve(
          cleaningResponse(date, {
            items:
              date === '2026-06-20'
                ? [cleaningItem('Поздняя уборка', date)]
                : [],
          }),
        )
      },
    },
  })
  const week = await service.getWeekContext({
    from: '2026-06-01',
    to: '2026-06-30',
    userId: USER_ID,
  })

  assert.equal(dates.length, 30)
  assert.equal(dates.at(-1), '2026-06-30')
  assert.equal(week.summary.cleaningTasks, 1)
  assert.equal(week.summary.cleaningScheduledThisPeriod, 1)
})

void it('searches unfinished task statuses as todo without including completed tasks', async () => {
  const statuses: Task['status'][] = [
    'todo',
    'in_progress',
    'ready_for_review',
    'done',
    'archived',
  ]
  const service = createService({
    taskService: {
      searchTasksCursor: (_context, filters) => {
        const items = statuses
          .map((status) => task(status))
          .filter((item) => matchesTaskContextFilter(item, filters))
        return Promise.resolve({
          items,
          hasMore: false,
          nextCursor: null,
          returnedCount: items.length,
          totalCount: items.length,
          truncated: false,
        })
      },
      getTaskReadModel: () =>
        Promise.resolve({
          items: statuses.map((status) => task(status)),
          returnedCount: statuses.length,
          totalCount: statuses.length,
          truncated: false,
        }),
    },
  })
  const result = await service.searchPlanner({
    query: 'Task',
    types: ['tasks'],
    status: 'todo',
    userId: USER_ID,
  })
  assert.deepEqual(
    new Set(
      result.items.map((item) => ('status' in item ? item.status : null)),
    ),
    new Set(['todo', 'in_progress', 'ready_for_review']),
  )
})

void it('searches planned self-care as todo without returning overdue scheduled occurrences', async (context) => {
  context.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-06-21T12:00:00Z'),
  })
  const service = createService({
    selfCareService: {
      getDashboard: () =>
        Promise.resolve({
          todayItems: [],
          overdueItems: [],
          flexibleGoals: [],
          upcomingImportant: [],
          planningHints: [],
        }),
      getPlan: () =>
        Promise.resolve({
          occurrences: [
            selfCareItem('Care planned', '2026-06-22'),
            selfCareItem('Care overdue', '2026-06-20'),
          ],
        } as SelfCarePlanResponse),
      getHistory: () =>
        Promise.resolve({
          items: [],
          completions: [],
        } as unknown as SelfCareHistoryResponse),
    },
  })
  const result = await service.searchPlanner({
    query: 'Care',
    types: ['selfcare'],
    status: 'todo',
    from: '2026-06-20',
    to: '2026-06-22',
    userId: USER_ID,
  })
  assert.deepEqual(
    result.items.map((item) => item.title),
    ['Care planned'],
  )
})

void it('keeps identically named cleaning in different zones without counting duplicate appearances', async () => {
  const kitchen = {
    ...cleaningItem('Пол', '2026-06-21'),
    zone: { title: 'Кухня' },
    isOverdue: true,
  }
  const bathroom = {
    ...cleaningItem('Пол', '2026-06-21'),
    zone: { title: 'Ванная' },
    isOverdue: true,
  }
  const response = cleaningResponse('2026-06-21', {
    items: [kitchen, bathroom] as CleaningTodayResponse['items'],
    accumulatedItems: [kitchen, bathroom] as CleaningTodayResponse['items'],
  })
  const service = createService({
    cleaningService: { getToday: () => Promise.resolve(response) },
  })
  const today = await service.getTodayContext({
    date: '2026-06-21',
    userId: USER_ID,
  })
  assert.equal(today.stats?.activeCounts.cleaning, 2)
  const week = await service.getWeekContext({
    from: '2026-06-21',
    to: '2026-06-21',
    userId: USER_ID,
  })
  assert.equal(week.summary.cleaningTasks, 2)
  assert.equal(week.remaining.cleaningOverdue.length, 2)
  const search = await service.searchPlanner({
    query: 'Пол',
    types: ['cleaning'],
    from: '2026-06-21',
    to: '2026-06-21',
    userId: USER_ID,
  })
  assert.equal(search.totalCount, 2)
})

void it('counts completed shopping only within the selected local period', async () => {
  const items = [
    shoppingItem({
      title: 'Shopping local today',
      status: 'archived',
      completedAt: '2026-11-04T20:30:00Z',
    }),
    shoppingItem({
      title: 'Shopping old',
      status: 'archived',
      completedAt: '2026-11-01T10:00:00Z',
    }),
    shoppingItem({
      title: 'Shopping local tomorrow',
      status: 'archived',
      completedAt: '2026-11-05T20:30:00Z',
    }),
    shoppingItem({
      title: 'Shopping without completion time',
      status: 'archived',
    }),
  ]
  const service = createService({
    chaosInboxService: {
      listItems: () => Promise.resolve({ items, total: items.length }),
    },
  })
  const week = await service.getWeekContext({
    from: '2026-11-05',
    to: '2026-11-05',
    timezone: 'Asia/Novosibirsk',
    userId: USER_ID,
  })
  assert.equal(week.progress.shoppingCompleted.count, 1)
  assert.deepEqual(
    week.progress.shoppingCompleted.items.map((item) => item.title),
    ['Shopping local today'],
  )
  assert.equal(week.summary.shoppingCompleted, 1)
})

void it('filters shopping search by completion date or active due date, not creation date', async () => {
  const items = [
    shoppingItem({
      title: 'Shopping completed',
      status: 'archived',
      completedAt: '2026-11-05T10:00:00Z',
      dueDate: '2026-11-01',
    }),
    shoppingItem({
      title: 'Shopping old',
      status: 'archived',
      completedAt: '2026-11-01T10:00:00Z',
      dueDate: '2026-11-05',
    }),
    shoppingItem({ title: 'Shopping scheduled', dueDate: '2026-11-05' }),
    shoppingItem({
      title: 'Shopping flexible',
      createdAt: '2026-11-05T10:00:00Z',
    }),
  ]
  const service = createService({
    chaosInboxService: {
      listItems: () => Promise.resolve({ items, total: items.length }),
    },
  })
  const result = await service.searchPlanner({
    query: 'Shopping',
    types: ['shopping'],
    from: '2026-11-05',
    to: '2026-11-05',
    userId: USER_ID,
  })
  assert.deepEqual(
    new Set(result.items.map((item) => item.title)),
    new Set(['Shopping completed', 'Shopping scheduled']),
  )
  const unbounded = await service.searchPlanner({
    query: 'Shopping',
    types: ['shopping'],
    userId: USER_ID,
  })
  assert.equal(unbounded.totalCount, 4)
})

void it('uses actual local self-care completion dates consistently across day, week and history', async () => {
  const historyQueries: Array<{
    from: string
    to: string
    timezone: string | undefined
  }> = []
  const service = createService({
    selfCareService: {
      getDashboard: () =>
        Promise.resolve({
          todayItems: [],
          overdueItems: [],
          flexibleGoals: [],
          upcomingImportant: [],
          planningHints: [],
        }),
      getPlan: () =>
        Promise.resolve({ occurrences: [] } as unknown as SelfCarePlanResponse),
      getHistory: (context, from, to) => {
        historyQueries.push({ from, to, timezone: context.clientTimeZone })
        return Promise.resolve({
          items: [
            {
              id: 'care',
              title: 'Completed old plan',
              category: 'relax',
              type: 'procedure',
            },
          ],
          completions: [
            {
              itemId: 'care',
              status: 'done',
              scheduledFor: '2026-11-01',
              completedAt: '2026-11-04T20:30:00Z',
            },
          ],
        } as unknown as SelfCareHistoryResponse)
      },
    },
  })
  const params = { userId: USER_ID, timezone: 'Asia/Novosibirsk' }
  const today = await service.getTodayContext({
    ...params,
    date: '2026-11-05',
    include: ['selfcare'],
  })
  const week = await service.getWeekContext({
    ...params,
    from: '2026-11-05',
    to: '2026-11-05',
  })
  const history = await service.getSelfCareContext({
    ...params,
    from: '2026-11-05',
    to: '2026-11-05',
  })
  const expected = [
    {
      category: 'relax',
      date: '2026-11-05',
      plannedDate: '2026-11-01',
      source: 'selfcare',
      status: 'done',
      title: 'Completed old plan',
      type: 'procedure',
    },
  ]
  assert.deepEqual(today.selfCare?.completed, expected)
  assert.deepEqual(week.progress.selfCareCompleted.items, expected)
  assert.deepEqual(history.completed, expected)
  assert.equal(week.progress.selfCareCompleted.count, 1)
  assert.deepEqual(
    historyQueries,
    Array.from({ length: 3 }, () => ({
      from: '2026-11-05',
      to: '2026-11-05',
      timezone: 'Asia/Novosibirsk',
    })),
  )
})

function createService(
  overrides: Partial<AiContextServiceDependencies>,
): AiContextService {
  return new AiContextService({
    sessionService: {
      resolveSession: () =>
        Promise.resolve({
          actor: { email: 'owner@example.test' },
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
    taskService: {
      getTaskReadModel: () =>
        Promise.resolve({
          items: [],
          returnedCount: 0,
          totalCount: 0,
          truncated: false,
        }),
      searchTasksCursor: () =>
        Promise.resolve({
          items: [],
          returnedCount: 0,
          totalCount: 0,
          hasMore: false,
          truncated: false,
          nextCursor: null,
        }),
    },
    ...overrides,
  })
}

function cleaningResponse(
  date: string,
  overrides: Partial<CleaningTodayResponse> = {},
): CleaningTodayResponse {
  return {
    date,
    dayOfWeek: 7,
    items: [],
    generalItems: [],
    accumulatedItems: [],
    zones: [],
    ...overrides,
  } as unknown as CleaningTodayResponse
}

function cleaningItem(
  title: string,
  date: string,
): CleaningTodayResponse['items'][number] {
  return {
    task: { title },
    state: { nextDueAt: date },
    isDue: true,
    isOverdue: false,
    zone: null,
  } as unknown as CleaningTodayResponse['items'][number]
}

function selfCareItem(title: string, date: string): SelfCareTodayItem {
  return {
    item: { title, type: 'appointment', category: 'health' },
    occurrence: { status: 'scheduled', scheduledFor: date, completedAt: null },
    completion: null,
  } as unknown as SelfCareTodayItem
}

function task(status: Task['status']): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: 'Owner',
    authorUserId: USER_ID,
    completedAt: null,
    createdAt: '2026-06-19T10:00:00.000Z',
    dueDate: null,
    icon: '',
    id: status,
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
    status,
    title: `Task ${status}`,
    urgency: 'not_urgent',
  }
}

function shoppingItem(
  input: Partial<ChaosInboxItemRecord> & { title: string },
): ChaosInboxItemRecord {
  return {
    activatedAt: null,
    completedAt: null,
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: '2026-01-01T10:00:00Z',
    deletedAt: null,
    dueDate: null,
    id: input.title,
    isFavorite: false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: 'medium',
    shoppingCategory: null,
    source: 'manual',
    sphereId: null,
    status: 'new',
    text: input.title,
    updatedAt: '2026-01-01T10:00:00Z',
    userId: USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
    ...input,
  }
}
