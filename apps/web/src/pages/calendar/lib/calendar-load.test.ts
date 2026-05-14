import { describe, expect, it } from 'vitest'

import type { Task } from '@/entities/task'

import {
  buildCalendarMonthLoad,
  getCalendarDaySummary,
  shiftCalendarMonth,
} from './calendar-load'

const baseTask: Task = {
  assigneeDisplayName: null,
  assigneeUserId: null,
  authorDisplayName: null,
  authorUserId: null,
  completedAt: null,
  createdAt: '2026-05-01T08:00:00.000Z',
  dueDate: null,
  icon: '',
  id: 'task-1',
  importance: 'not_important',
  note: '',
  plannedDate: '2026-05-14',
  plannedEndTime: null,
  plannedStartTime: null,
  project: '',
  projectId: null,
  recurrence: null,
  requiresConfirmation: false,
  resource: null,
  routine: null,
  sphereId: null,
  status: 'todo',
  title: 'Task',
  urgency: 'not_urgent',
}

describe('calendar load', () => {
  it('builds a six-week monday-first month grid', () => {
    const month = buildCalendarMonthLoad([], '2026-05-14')

    expect(month.days).toHaveLength(42)
    expect(month.days[0]).toMatchObject({
      dateKey: '2026-04-27',
      isCurrentMonth: false,
    })
    expect(month.days[4]).toMatchObject({
      dateKey: '2026-05-01',
      isCurrentMonth: true,
    })
  })

  it('counts active planned load, timed tasks and routines', () => {
    const summary = getCalendarDaySummary(
      [
        {
          ...baseTask,
          id: 'focus',
          importance: 'important',
          plannedEndTime: '12:00',
          plannedStartTime: '09:00',
          resource: -4,
        },
        {
          ...baseTask,
          id: 'routine',
          resource: 2,
          routine: {
            daysOfWeek: [1, 2, 3, 4, 5],
            frequency: 'weekly',
            seriesId: 'routine-series',
            targetType: 'check',
            targetValue: 1,
            unit: '',
          },
        },
        {
          ...baseTask,
          id: 'done',
          status: 'done',
        },
      ],
      '2026-05-14',
    )

    expect(summary.plannedTasks.map((task) => task.id)).toEqual([
      'focus',
      'routine',
    ])
    expect(summary.loadUnits).toBe(5)
    expect(summary.restoreUnits).toBe(2)
    expect(summary.timedMinutes).toBe(180)
    expect(summary.timedTaskCount).toBe(1)
    expect(summary.importantTaskCount).toBe(1)
    expect(summary.routineTaskCount).toBe(1)
  })

  it('summarizes the visible month and keeps the busiest day', () => {
    const month = buildCalendarMonthLoad(
      [
        {
          ...baseTask,
          id: 'normal-day',
          plannedDate: '2026-05-02',
          resource: -2,
        },
        {
          ...baseTask,
          id: 'overloaded-day-a',
          plannedDate: '2026-05-03',
          resource: -4,
        },
        {
          ...baseTask,
          id: 'overloaded-day-b',
          plannedDate: '2026-05-03',
          resource: -4,
        },
        {
          ...baseTask,
          id: 'overloaded-day-c',
          plannedDate: '2026-05-03',
          resource: -4,
        },
      ],
      '2026-05-14',
    )

    expect(month.activeTaskCount).toBe(4)
    expect(month.loadUnits).toBe(14)
    expect(month.overloadedDayCount).toBe(1)
    expect(month.busiestDay?.dateKey).toBe('2026-05-03')
  })

  it('shifts month anchors without carrying an end-of-month overflow', () => {
    expect(shiftCalendarMonth('2026-05-31', 1)).toBe('2026-06-01')
    expect(shiftCalendarMonth('2026-05-31', -1)).toBe('2026-04-01')
  })
})
