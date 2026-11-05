import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
  ChaosInboxItemRecord,
  CleaningTodayResponse,
  Task,
} from '@planner/contracts'

import {
  AiContextService,
  type AiContextServiceDependencies,
} from './ai-context.service.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const DAY = '2026-06-21'

void describe('AI context section permissions', () => {
  void it('loads and projects requested weekly domains without leaking other sections', async () => {
    for (const include of [
      'tasks',
      'calendar',
      'shopping',
      'cleaning',
      'selfcare',
    ] as const) {
      const { service, calls, completionQueries } = createService()
      const result = await service.getWeekContext({
        userId: USER_ID,
        from: DAY,
        to: DAY,
        include: [include],
      })

      assert.deepEqual(calls, {
        tasks: include === 'tasks' ? 1 : 0,
        shopping: include === 'shopping' ? 1 : 0,
        cleaning: include === 'cleaning' ? 1 : 0,
        selfcare: include === 'selfcare' ? 1 : 0,
      })
      assert.equal(completionQueries.length, include === 'tasks' ? 1 : 0)
      assert.equal(result.bottlenecks, undefined)
      assert.equal(result.possibleSimplifications, undefined)
      assert.equal(result.summary.loadLevel, undefined)
      assert.equal(
        result.progress.tasksCompleted !== undefined,
        include === 'tasks',
      )
      assert.equal(
        result.progress.shoppingCompleted !== undefined,
        include === 'shopping',
      )
      assert.equal(
        result.progress.cleaningCompleted !== undefined,
        include === 'cleaning',
      )
      assert.equal(
        result.progress.selfCareCompleted !== undefined,
        include === 'selfcare',
      )
      assert.equal(
        result.summary.selfCareFlexibleGoals !== undefined,
        include === 'selfcare',
      )
      assert.equal(
        result.sourceCoverage.tasks !== undefined,
        include === 'tasks',
      )
      assert.equal(
        result.sourceCoverage.shopping !== undefined,
        include === 'shopping',
      )
      assert.equal(result.calendar !== undefined, include === 'calendar')
      if (include === 'calendar') {
        assert.equal(
          result.calendar?.events[0]?.title,
          'Scheduled calendar event',
        )
        assert.deepEqual(result.summary, {})
        assert.deepEqual(result.highlights, {})
      }
      assert.equal(
        JSON.stringify(result).includes('Private overdue task'),
        include === 'tasks',
      )
      assert.equal(
        JSON.stringify(result).includes('Private shopping item'),
        include === 'shopping',
      )
    }
  })

  void it('returns weekly stats without task titles or flexible goal details', async () => {
    const { service, calls } = createService()
    const result = await service.getWeekContext({
      userId: USER_ID,
      from: DAY,
      to: DAY,
      include: ['stats'],
    })
    assert.deepEqual(calls, { tasks: 1, shopping: 1, cleaning: 1, selfcare: 1 })
    assert.deepEqual(result.progress, {})
    assert.deepEqual(result.remaining, {})
    assert.deepEqual(result.highlights, {})
    assert.equal(result.summary.selfCareFlexibleGoals, undefined)
    assert.equal(result.summary.tasksActive, 1)
    assert.equal(result.summary.shoppingActive, 1)
    assert.ok(result.summary.loadLevel)
    assert.equal(JSON.stringify(result).includes('Private'), false)
    assert.equal(
      JSON.stringify(result).includes('Scheduled calendar event'),
      false,
    )
  })

  void it('keeps omitted and empty weekly include equivalent to the complete response', async () => {
    const { service } = createService()
    const omitted = await service.getWeekContext({
      userId: USER_ID,
      from: DAY,
      to: DAY,
    })
    const empty = await service.getWeekContext({
      userId: USER_ID,
      from: DAY,
      to: DAY,
      include: [],
    })
    assert.deepEqual(
      { ...empty, generatedAt: null },
      { ...omitted, generatedAt: null },
    )
    assert.equal(omitted.calendar.totalCount, 1)
    assert.equal(omitted.highlights.overdue[0]?.title, 'Private overdue task')
    assert.ok(omitted.summary.loadLevel)
  })

  void it('loads and returns only task details for tasks-only requests', async () => {
    const { service, calls } = createService()
    const result = await service.getTodayContext({
      userId: USER_ID,
      date: DAY,
      include: ['tasks'],
    })

    assert.deepEqual(calls, { tasks: 1, shopping: 0, cleaning: 0, selfcare: 0 })
    assert.equal(result.tasks?.overdue[0]?.title, 'Private overdue task')
    assert.deepEqual(Object.keys(result.sourceCoverage), [
      'tasks',
      'taskCompletions',
    ])
    assert.deepEqual(Object.keys(result.overdueItemsByDomain ?? {}), ['tasks'])
    assert.deepEqual(result.overdue, { tasks: 1, total: 1 })
    assert.equal(result.cleaningOverdueByZone, undefined)
    assert.equal(result.selfCareFlexibleGoals, undefined)
    assert.equal(result.stats, undefined)
    assert.equal(result.shopping, undefined)
  })

  void it('does not disclose unrelated task details or counts through calendar-only requests', async () => {
    const { service, calls } = createService()
    const result = await service.getTodayContext({
      userId: USER_ID,
      date: DAY,
      include: ['calendar'],
    })

    assert.deepEqual(calls, { tasks: 0, shopping: 0, cleaning: 0, selfcare: 0 })
    assert.equal(result.calendar?.events[0]?.title, 'Scheduled calendar event')
    assert.equal(result.tasks, undefined)
    assert.deepEqual(result.sourceCoverage, {
      calendar: { returnedCount: 1, totalCount: 1, truncated: false },
    })
    assert.deepEqual(result.overdueItemsByDomain, {})
    assert.deepEqual(result.overdue, { total: 0 })
    assert.equal(JSON.stringify(result).includes('Private overdue task'), false)
  })

  void it('loads shopping without reading task, cleaning or self-care services', async () => {
    const { service, calls } = createService()
    const result = await service.getTodayContext({
      userId: USER_ID,
      date: DAY,
      include: ['shopping'],
    })

    assert.deepEqual(calls, { tasks: 0, shopping: 1, cleaning: 0, selfcare: 0 })
    assert.equal(result.shopping?.active[0]?.title, 'Private shopping item')
    assert.deepEqual(Object.keys(result.sourceCoverage), ['shopping'])
    assert.deepEqual(Object.keys(result.overdueItemsByDomain ?? {}), [
      'shopping',
    ])
    assert.deepEqual(result.overdue, { shopping: 1, total: 1 })
    assert.equal(result.cleaningOverdueByZone, undefined)
    assert.equal(result.selfCareFlexibleGoals, undefined)
  })

  void it('does not disclose general task counts through calendar-only search', async () => {
    const { service } = createService()
    const result = await service.searchPlanner({
      userId: USER_ID,
      query: 'Scheduled',
      types: ['calendar'],
      from: DAY,
      to: DAY,
    })

    assert.equal(result.items[0]?.title, 'Scheduled calendar event')
    assert.deepEqual(result.sourceCoverage, {
      calendar: { returnedCount: 1, totalCount: 1, truncated: false },
    })
    assert.equal(JSON.stringify(result).includes('Private overdue task'), false)
  })

  void it('allows aggregate stats while withholding unrequested titles and detail groups', async () => {
    const { service, calls } = createService()
    const result = await service.getTodayContext({
      userId: USER_ID,
      date: DAY,
      include: ['stats'],
    })

    assert.deepEqual(calls, { tasks: 1, shopping: 1, cleaning: 1, selfcare: 1 })
    assert.equal(result.stats?.activeCounts.tasks, 2)
    assert.equal(result.stats?.activeCounts.shopping, 1)
    assert.equal(result.overdue?.total, 2)
    assert.deepEqual(result.overdueItemsByDomain, {})
    assert.equal(result.cleaningOverdueByZone, undefined)
    assert.equal(result.selfCareFlexibleGoals, undefined)
    assert.equal(JSON.stringify(result).includes('Private'), false)
    assert.equal(
      JSON.stringify(result).includes('Scheduled calendar event'),
      false,
    )
  })

  void it('treats empty and omitted include consistently as all sections', async () => {
    const { service } = createService()
    const omitted = await service.getTodayContext({
      userId: USER_ID,
      date: DAY,
    })
    const empty = await service.getTodayContext({
      userId: USER_ID,
      date: DAY,
      include: [],
    })

    assert.deepEqual(
      { ...empty, generatedAt: null },
      { ...omitted, generatedAt: null },
    )
    assert.equal(empty.tasks?.overdue[0]?.title, 'Private overdue task')
    assert.equal(empty.shopping?.active[0]?.title, 'Private shopping item')
    assert.ok(empty.stats)
    assert.ok(empty.selfCareFlexibleGoals)
  })
})

function createService() {
  const calls = { tasks: 0, shopping: 0, cleaning: 0, selfcare: 0 }
  const completionQueries: unknown[] = []
  const dependencies: AiContextServiceDependencies = {
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
      searchTasksCursor: (_context, filters) => {
        if (filters.status === 'done') completionQueries.push(filters)
        const items =
          filters.status === 'done'
            ? []
            : [
                createTask({
                  title: 'Private overdue task',
                  dueDate: '2026-06-20',
                }),
                createTask({
                  id: 'calendar',
                  title: 'Scheduled calendar event',
                  plannedDate: DAY,
                  plannedStartTime: '10:00',
                }),
              ]
                .filter(
                  (task) =>
                    !filters.calendarOnly ||
                    (task.plannedDate && task.plannedStartTime),
                )
                .filter(
                  (task) =>
                    !filters.search ||
                    task.title
                      .toLowerCase()
                      .includes(filters.search.toLowerCase()),
                )
        return Promise.resolve({
          items,
          returnedCount: items.length,
          totalCount: items.length,
          truncated: false,
          hasMore: false,
          nextCursor: null,
        })
      },
      getTaskReadModel: () => {
        calls.tasks += 1
        return Promise.resolve({
          items: [
            createTask({
              title: 'Private overdue task',
              dueDate: '2026-06-20',
            }),
            createTask({
              id: 'calendar',
              title: 'Scheduled calendar event',
              plannedDate: DAY,
              plannedStartTime: '10:00',
            }),
          ],
          returnedCount: 2,
          totalCount: 2,
          truncated: false,
        })
      },
    },
    chaosInboxService: {
      listItems: () => {
        calls.shopping += 1
        return Promise.resolve({
          items: [
            {
              id: 'shopping',
              userId: USER_ID,
              kind: 'shopping',
              status: 'new',
              text: 'Private shopping item',
              dueDate: '2026-06-20',
              priority: 'medium',
              isFavorite: false,
            } as ChaosInboxItemRecord,
          ],
          total: 1,
        })
      },
    },
    cleaningService: {
      getToday: () => {
        calls.cleaning += 1
        return Promise.resolve({
          items: [],
          accumulatedItems: [],
          generalItems: [],
          history: [],
          zones: [],
        } as unknown as CleaningTodayResponse)
      },
    },
    selfCareService: {
      getDashboard: () => {
        calls.selfcare += 1
        return Promise.resolve({
          flexibleGoals: [],
          overdueItems: [],
          planningHints: [],
          todayItems: [],
          upcomingImportant: [],
        })
      },
      getHistory: () =>
        Promise.resolve({
          appointmentDetails: [],
          completions: [],
          items: [],
          procedureDetails: [],
          stepCompletions: [],
        }),
      getPlan: () => {
        calls.selfcare += 1
        return Promise.resolve({
          courses: [],
          from: DAY,
          to: DAY,
          medical: [],
          occurrences: [],
          planningHints: [],
        })
      },
    },
  }
  return {
    calls,
    completionQueries,
    service: new AiContextService(dependencies),
  }
}

function createTask(overrides: Partial<Task>): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: USER_ID,
    completedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task',
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: null,
    plannedStartTime: null,
    plannedEndTime: null,
    project: '',
    projectId: null,
    resource: 0,
    requiresConfirmation: false,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}
