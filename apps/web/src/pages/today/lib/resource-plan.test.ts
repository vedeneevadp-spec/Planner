import { describe, expect, it } from 'vitest'

import type { Task } from '@/entities/task'

import {
  analyzeDailyLoad,
  getLoadStateLabel,
  getUnloadCandidates,
  groupDailyTasks,
} from './resource-plan'

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-04-22T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: overrides.id ?? crypto.randomUUID(),
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: '2026-04-22',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    resource: -2,
    requiresConfirmation: false,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    urgency: 'not_urgent',
    ...overrides,
  }
}

describe('resource plan', () => {
  it('keeps twelve unrated tasks unknown instead of reporting a calm day', () => {
    const analysis = analyzeDailyLoad(
      Array.from({ length: 12 }, () => createTask({ resource: null })),
      'normal',
    )

    expect(analysis).toMatchObject({
      assessedState: 'calm',
      assessedTaskCount: 0,
      isComplete: false,
      overloadScore: 0,
      state: 'unknown',
      totalResource: 0,
      totalTaskCount: 12,
      unassessedTaskCount: 12,
    })
  })

  it('counts an explicit zero as assessed while leaving missing resource unknown', () => {
    const analysis = analyzeDailyLoad(
      [0, -2, null].map((resource) => createTask({ resource })),
      'normal',
    )

    expect(analysis).toMatchObject({
      assessedState: 'calm',
      assessedTaskCount: 2,
      isComplete: false,
      overloadScore: 25,
      state: 'unknown',
      totalResource: 2,
      totalTaskCount: 3,
      unassessedTaskCount: 1,
    })
  })

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])(
    'treats invalid resource %s as unassessed without estimating it',
    (resource) => {
      const task = Object.assign(
        createTask({
          importance: 'important',
          plannedStartTime: '09:00',
          plannedEndTime: '18:00',
        }),
        { resource },
      )
      expect(analyzeDailyLoad([task], 'normal')).toMatchObject({
        assessedTaskCount: 0,
        isComplete: false,
        state: 'unknown',
        totalResource: 0,
        unassessedTaskCount: 1,
      })
    },
  )

  it('preserves known overload while the overall assessment remains unknown', () => {
    const analysis = analyzeDailyLoad(
      [-4, -4, -4, null].map((resource) => createTask({ resource })),
      'normal',
    )

    expect(analysis).toMatchObject({
      assessedState: 'overload',
      assessedTaskCount: 3,
      isComplete: false,
      overloadScore: 150,
      state: 'unknown',
      totalResource: 12,
      totalTaskCount: 4,
      unassessedTaskCount: 1,
    })
  })

  it('completes the assessment for explicit zero and restoring resource', () => {
    expect(
      analyzeDailyLoad(
        [0, 2].map((resource) => createTask({ resource })),
        'normal',
      ),
    ).toMatchObject({
      assessedState: 'calm',
      assessedTaskCount: 2,
      isComplete: true,
      state: 'calm',
      totalResource: 0,
      totalTaskCount: 2,
      unassessedTaskCount: 0,
    })
  })

  it('keeps fully rated tasks unknown when task data itself is incomplete', () => {
    expect(analyzeDailyLoad([createTask()], 'normal', false)).toMatchObject({
      assessedState: 'calm',
      assessedTaskCount: 1,
      isComplete: false,
      state: 'unknown',
      totalResource: 2,
      totalTaskCount: 1,
      unassessedTaskCount: 0,
    })
  })

  it.each([
    { dataComplete: true, expectedState: 'calm' },
    { dataComplete: false, expectedState: 'unknown' },
  ] as const)(
    'distinguishes an empty list with completeness $dataComplete',
    ({ dataComplete, expectedState }) => {
      expect(analyzeDailyLoad([], 'normal', dataComplete)).toMatchObject({
        assessedState: 'calm',
        assessedTaskCount: 0,
        isComplete: dataComplete,
        state: expectedState,
        totalResource: 0,
        totalTaskCount: 0,
        unassessedTaskCount: 0,
      })
    },
  )

  it('marks minimum mode as overloaded when resource exceeds the limit', () => {
    const analysis = analyzeDailyLoad(
      [createTask(), createTask(), createTask()],
      'minimum',
    )

    expect(analysis.totalResource).toBe(6)
    expect(analysis.state).toBe('overload')
  })

  it('separates focus, support and routine tasks', () => {
    const groups = groupDailyTasks([
      createTask({ importance: 'important', title: 'Ответить клиенту' }),
      createTask({ title: 'купить продукты' }),
      createTask({ project: 'Быт', title: 'счетчики' }),
      createTask({ title: 'Разобрать почту', urgency: 'urgent' }),
    ])

    expect(groups.focusTasks).toHaveLength(1)
    expect(groups.supportTasks).toHaveLength(1)
    expect(groups.routineTasks).toHaveLength(2)
  })

  it('suggests non-important heavy tasks for unloading first', () => {
    const support = createTask({
      id: 'support',
      plannedEndTime: '15:00',
      plannedStartTime: '09:00',
      resource: -5,
    })
    const focus = createTask({ id: 'focus', importance: 'important' })

    expect(getUnloadCandidates([focus, support], 1)[0]?.id).toBe('support')
  })

  it.each([
    { expectedLimit: 4, mode: 'minimum' },
    { expectedLimit: 8, mode: 'normal' },
    { expectedLimit: 12, mode: 'maximum' },
  ] as const)('uses the $mode resource limit', ({ expectedLimit, mode }) => {
    expect(analyzeDailyLoad([], mode).resourceLimit).toBe(expectedLimit)
  })

  it.each([
    { expected: 'calm', resources: [-3, -3] },
    { expected: 'edge', resources: [-4, -3] },
    { expected: 'edge', resources: [-4, -4] },
    { expected: 'overload', resources: [-4, -4, -1] },
  ] as const)(
    'classifies normal mode total as $expected',
    ({ expected, resources }) => {
      expect(
        analyzeDailyLoad(
          resources.map((resource) => createTask({ resource })),
          'normal',
        ).state,
      ).toBe(expected)
    },
  )

  it('subtracts restoring resource and never returns a negative total', () => {
    const analysis = analyzeDailyLoad(
      [createTask({ resource: -3 }), createTask({ resource: 5 })],
      'normal',
    )

    expect(analysis.totalResource).toBe(0)
    expect(analysis.overloadScore).toBe(0)
  })

  it('filters inactive and non-draining unload candidates', () => {
    expect(
      getUnloadCandidates([
        createTask({ id: 'active', resource: -2 }),
        createTask({ id: 'zero', resource: 0 }),
        createTask({ id: 'restoring', resource: 2 }),
        createTask({ id: 'done', resource: -5, status: 'done' }),
        createTask({ id: 'archive', resource: -5, status: 'archived' }),
      ]).map((task) => task.id),
    ).toEqual(['active'])
  })

  it('sorts candidates by importance, resource and creation time', () => {
    const tasks = [
      createTask({
        createdAt: '2026-04-22T07:00:00.000Z',
        id: 'important-heavy',
        importance: 'important',
        resource: -5,
      }),
      createTask({
        createdAt: '2026-04-22T09:00:00.000Z',
        id: 'support-light',
        resource: -2,
      }),
      createTask({
        createdAt: '2026-04-22T10:00:00.000Z',
        id: 'support-heavy-new',
        resource: -5,
      }),
      createTask({
        createdAt: '2026-04-22T08:00:00.000Z',
        id: 'support-heavy-old',
        resource: -5,
      }),
    ]
    const originalOrder = tasks.map((task) => task.id)

    expect(getUnloadCandidates(tasks).map((task) => task.id)).toEqual([
      'support-heavy-old',
      'support-heavy-new',
      'support-light',
    ])
    expect(tasks.map((task) => task.id)).toEqual(originalOrder)
    expect(getUnloadCandidates(tasks, 1).map((task) => task.id)).toEqual([
      'support-heavy-old',
    ])
    expect(getUnloadCandidates(tasks, 0)).toEqual([])
  })

  it.each([
    ['calm', 'спокойно'],
    ['edge', 'на грани'],
    ['overload', 'перегруз'],
    ['unknown', 'неполная оценка'],
  ] as const)('formats the %s state', (state, expected) => {
    expect(getLoadStateLabel(state)).toBe(expected)
  })
})
