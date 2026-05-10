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
    consumePendingCompletedTasks: vi.fn(),
    consumePendingRoute: vi.fn(),
    refresh: vi.fn(),
  })),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: vi.fn(),
  },
}))

import type { Project } from '@/entities/project'
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

const baseProject: Project = {
  color: '#2f6f62',
  createdAt: '2026-05-01T10:00:00.000Z',
  deletedAt: null,
  description: '',
  icon: 'svg:folder',
  id: 'project-1',
  status: 'active',
  title: 'Фокус',
  updatedAt: '2026-05-01T10:00:00.000Z',
  version: 1,
  workspaceId: 'workspace-1',
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
      hiddenTaskCount: 0,
      overdueCount: 1,
      todayCount: 1,
      version: 4,
    })
    expect(snapshot.tasks).toEqual([
      {
        color: '#8EE7C8',
        icon: '',
        id: 'task-2',
        isOverdue: true,
        timeLabel: null,
        title: 'Просроченная задача',
        visualTone: 'overdue',
      },
      {
        color: '#8EE7C8',
        icon: '',
        id: 'task-1',
        isOverdue: false,
        timeLabel: '09:00 - 10:00',
        title: 'Утренний фокус',
        visualTone: 'default',
      },
    ])
  })

  it('sorts and tones widget tasks by status, overdue age, time and priority', () => {
    const snapshot = buildNativePlannerWidgetSnapshot(
      [
        {
          ...baseTask,
          createdAt: '2026-05-08T10:00:00.000',
          id: 'task-recent-overdue',
          plannedDate: '2026-05-08',
          plannedStartTime: '11:00',
          title: 'Свежая просрочка',
        },
        {
          ...baseTask,
          createdAt: '2026-05-08T09:00:00.000',
          id: 'task-old-overdue',
          plannedDate: '2026-05-07',
          plannedStartTime: '12:00',
          title: 'Самая старая просрочка',
        },
        {
          ...baseTask,
          id: 'task-active-overdue',
          plannedDate: '2026-05-08',
          plannedStartTime: null,
          status: 'in_progress',
          title: 'Активная просроченная',
        },
        {
          ...baseTask,
          id: 'task-normal-today',
          plannedStartTime: '08:00',
          title: 'Обычная сегодня',
        },
        {
          ...baseTask,
          id: 'task-priority-today',
          importance: 'important',
          plannedStartTime: '08:00',
          title: 'Важная срочная сегодня',
          urgency: 'urgent',
        },
        {
          ...baseTask,
          id: 'task-late-today',
          plannedStartTime: '11:00',
          title: 'Поздняя сегодня',
        },
      ],
      new Date(2026, 4, 9, 12),
    )

    expect(snapshot.tasks.map((task) => task.title)).toEqual([
      'Активная просроченная',
      'Самая старая просрочка',
      'Свежая просрочка',
      'Важная срочная сегодня',
      'Обычная сегодня',
      'Поздняя сегодня',
    ])
    expect(snapshot.tasks.map((task) => task.visualTone)).toEqual([
      'in_progress',
      'overdue',
      'overdue',
      'urgent',
      'default',
      'default',
    ])
  })

  it('limits the native payload and reports hidden tasks', () => {
    const snapshot = buildNativePlannerWidgetSnapshot(
      Array.from({ length: 13 }, (_, index) => ({
        ...baseTask,
        id: `task-${index + 1}`,
        plannedEndTime: null,
        plannedStartTime: `${String(8 + index).padStart(2, '0')}:00`,
        title: `Задача ${index + 1}`,
      })),
      new Date(2026, 4, 9, 12),
    )

    expect(snapshot.tasks).toHaveLength(12)
    expect(snapshot.hiddenTaskCount).toBe(1)
  })

  it('adds task icons and project colors to the native payload', () => {
    const snapshot = buildNativePlannerWidgetSnapshot(
      [
        {
          ...baseTask,
          icon: '🎯',
          project: 'Фокус',
          projectId: baseProject.id,
        },
      ],
      [baseProject],
      new Date(2026, 4, 9, 12),
    )

    expect(snapshot.tasks[0]).toMatchObject({
      color: '#2F6F62',
      icon: '🎯',
      id: 'task-1',
    })
  })
})
