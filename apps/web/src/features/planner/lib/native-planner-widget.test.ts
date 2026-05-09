import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
  },
  registerPlugin: vi.fn(() => ({
    consumePendingRoute: vi.fn(),
    refresh: vi.fn(),
  })),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: vi.fn(),
  },
}))

import type { Task } from '@/entities/task'

import { buildNativePlannerWidgetSnapshot } from './native-planner-widget'

const baseTask: Task = {
  assigneeDisplayName: null,
  assigneeUserId: null,
  authorDisplayName: null,
  authorUserId: null,
  completedAt: null,
  createdAt: '2026-05-08T10:00:00.000',
  dueDate: null,
  icon: '',
  id: 'task-1',
  importance: 'not_important',
  note: '',
  plannedDate: '2026-05-09',
  plannedEndTime: '10:00',
  plannedStartTime: '09:00',
  project: '',
  projectId: null,
  remindBeforeStart: undefined,
  requiresConfirmation: false,
  resource: null,
  sphereId: null,
  status: 'todo',
  title: 'Утренний фокус',
  urgency: 'not_urgent',
}

describe('native planner widget snapshot', () => {
  it('prioritizes overdue and today tasks for the Android widget', () => {
    const snapshot = buildNativePlannerWidgetSnapshot(
      [
        baseTask,
        {
          ...baseTask,
          id: 'task-2',
          plannedDate: '2026-05-08',
          title: 'Просроченная задача',
        },
        {
          ...baseTask,
          completedAt: '2026-05-09T12:00:00.000',
          id: 'task-3',
          status: 'done',
          title: 'Готовая задача',
        },
        {
          ...baseTask,
          id: 'task-4',
          plannedDate: '2026-05-10',
          title: 'Завтра',
        },
      ],
      new Date(2026, 4, 9, 12),
    )

    expect(snapshot).toMatchObject({
      dateKey: '2026-05-09',
      doneTodayCount: 1,
      moreCount: 0,
      overdueCount: 1,
      todayCount: 1,
      version: 1,
    })
    expect(snapshot.tasks).toEqual([
      {
        isOverdue: true,
        timeLabel: null,
        title: 'Просроченная задача',
      },
      {
        isOverdue: false,
        timeLabel: '09:00 - 10:00',
        title: 'Утренний фокус',
      },
    ])
  })
})
