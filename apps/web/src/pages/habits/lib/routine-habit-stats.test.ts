import { describe, expect, it } from 'vitest'

import type { Task } from '@/entities/task'

import { buildRoutineHabitStats } from './routine-habit-stats'

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-05-10T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: overrides.id ?? crypto.randomUUID(),
    importance: 'not_important',
    note: '',
    plannedDate: '2026-05-10',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: 0,
    routine: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      frequency: 'daily',
      seriesId: 'routine-1',
      targetType: 'check',
      targetValue: 1,
      unit: '',
    },
    sphereId: null,
    status: 'todo',
    title: 'Умыться',
    urgency: 'urgent',
    ...overrides,
  }
}

describe('routine habit stats', () => {
  it('groups routine tasks by series and counts streaks', () => {
    const stats = buildRoutineHabitStats(
      [
        createTask({
          completedAt: '2026-05-10T09:00:00.000Z',
          id: 'done-1',
          plannedDate: '2026-05-10',
          status: 'done',
        }),
        createTask({
          completedAt: '2026-05-11T09:00:00.000Z',
          id: 'done-2',
          plannedDate: '2026-05-11',
          status: 'done',
        }),
        createTask({
          id: 'next',
          plannedDate: '2026-05-12',
        }),
      ],
      '2026-05-12',
    )

    expect(stats.activeCount).toBe(1)
    expect(stats.completedToday).toBe(0)
    expect(stats.scheduledToday).toBe(1)
    expect(stats.items[0]?.currentStreak).toBe(2)
    expect(stats.items[0]?.bestStreak).toBe(2)
  })
})
