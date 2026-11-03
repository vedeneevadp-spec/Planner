import { describe, expect, it } from 'vitest'

import type { Task } from '@/entities/task'

import { buildRescheduleOptions } from './reschedule-plan'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'moving',
    title: 'Разобрать документы',
    note: '',
    project: '',
    projectId: null,
    status: 'todo',
    importance: 'not_important',
    urgency: 'not_urgent',
    necessity: 'desired',
    resource: -3,
    plannedDate: '2026-11-03',
    plannedStartTime: null,
    plannedEndTime: null,
    dueDate: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    completedAt: null,
    icon: '',
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    requiresConfirmation: false,
    sphereId: null,
    ...overrides,
  }
}

describe('load-aware rescheduling', () => {
  it('skips an overloaded tomorrow and previews both days without modifying tasks', () => {
    const moving = task()
    const tasks = [
      moving,
      task({ id: 'busy', resource: -4, plannedDate: '2026-11-04' }),
      task({ id: 'busy-2', resource: -3, plannedDate: '2026-11-04' }),
      task({
        id: 'done',
        resource: -4,
        plannedDate: '2026-11-05',
        status: 'done',
      }),
    ]
    const { options, recommendedDate } = buildRescheduleOptions(
      tasks,
      moving,
      'normal',
      '2026-11-03',
      true,
    )
    expect(options).toHaveLength(7)
    expect(options[0]?.before.totalResource).toBe(7)
    expect(options[0]?.after.totalResource).toBe(10)
    expect(recommendedDate).toBe('2026-11-05')
    expect(moving.plannedDate).toBe('2026-11-03')
  })
  it('honours deadlines and the selected energy mode', () => {
    const moving = task({ resource: -3, dueDate: '2026-11-04' })
    const result = buildRescheduleOptions(
      [moving, task({ id: 'busy', resource: -2, plannedDate: '2026-11-04' })],
      moving,
      'minimum',
      '2026-11-03',
      true,
    )
    expect(result.recommendedDate).toBeNull()
    expect(result.options.filter((day) => day.allowed)).toHaveLength(1)
    expect(result.options[0]?.after.assessedState).toBe('overload')
  })
  it('does not recommend a day with unknown resource or incomplete data', () => {
    const moving = task()
    const unknown = task({
      id: 'unknown',
      resource: null,
      plannedDate: '2026-11-04',
    })
    expect(
      buildRescheduleOptions(
        [moving, unknown],
        moving,
        'normal',
        '2026-11-03',
        true,
      ).recommendedDate,
    ).toBe('2026-11-05')
    const incomplete = buildRescheduleOptions(
      [moving],
      moving,
      'normal',
      '2026-11-03',
      false,
    )
    expect(incomplete.recommendedDate).toBeNull()
    expect(incomplete.options.every((day) => !day.after.isComplete)).toBe(true)
  })
  it('counts projected repeats and does not duplicate a moved occurrence', () => {
    const moving = task({
      resource: -4,
      recurrence: {
        seriesId: 'series',
        isActive: true,
        frequency: 'daily',
        interval: 1,
        daysOfWeek: [],
        startDate: '2026-11-03',
        endDate: null,
      },
    })
    const result = buildRescheduleOptions(
      [moving],
      moving,
      'normal',
      '2026-11-03',
      true,
    )
    expect(result.options[0]?.before.totalResource).toBe(4)
    expect(result.options[0]?.after.totalResource).toBe(4)
    expect(result.options[0]?.after.totalTaskCount).toBe(1)
  })
  it('includes restoring resource and existing completed repeats without a phantom duplicate', () => {
    const moving = task()
    const recurrence = {
      seriesId: 'series',
      isActive: true,
      frequency: 'daily' as const,
      interval: 1,
      daysOfWeek: [],
      startDate: '2026-11-03',
      endDate: null,
    }
    const result = buildRescheduleOptions(
      [
        moving,
        task({ id: 'restore', resource: 2, plannedDate: '2026-11-04' }),
        task({ id: 'series-active', resource: -5, recurrence }),
        task({
          id: 'series-done',
          resource: -5,
          recurrence,
          plannedDate: '2026-11-04',
          status: 'done',
        }),
      ],
      moving,
      'normal',
      '2026-11-03',
      true,
    )
    expect(result.options[0]?.after.totalResource).toBe(1)
  })
})
