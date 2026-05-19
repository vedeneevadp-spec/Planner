import { beforeEach, describe, expect, it, vi } from 'vitest'

const capacitorMocks = vi.hoisted(() => ({
  ackPendingCompletedTasks: vi.fn(),
  consumePendingCompletedTasks: vi.fn(),
  consumePendingRoute: vi.fn(),
  getPlatform: vi.fn(),
  isNativePlatform: vi.fn(),
  readPendingCompletedTasks: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: capacitorMocks.getPlatform,
    isNativePlatform: capacitorMocks.isNativePlatform,
  },
  registerPlugin: vi.fn(() => ({
    ackPendingCompletedTasks: capacitorMocks.ackPendingCompletedTasks,
    consumePendingCompletedTasks: capacitorMocks.consumePendingCompletedTasks,
    consumePendingRoute: capacitorMocks.consumePendingRoute,
    readPendingCompletedTasks: capacitorMocks.readPendingCompletedTasks,
    refresh: capacitorMocks.refresh,
  })),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: vi.fn(),
  },
}))

import type { Sphere } from '@/entities/sphere'
import type { Task } from '@/entities/task'

import {
  ackPendingNativePlannerWidgetCompletedTasks,
  buildNativePlannerWidgetSnapshot,
  readPendingNativePlannerWidgetCompletedTasks,
} from './native-planner-widget'

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

const baseProject: Sphere = {
  color: '#2f6f62',
  createdAt: '2026-05-01T10:00:00.000Z',
  deletedAt: null,
  description: '',
  icon: 'svg:folder',
  id: 'project-1',
  isActive: true,
  isDefault: false,
  name: 'Фокус',
  sortOrder: 0,
  updatedAt: '2026-05-01T10:00:00.000Z',
  userId: 'user-1',
  version: 1,
  workspaceId: 'workspace-1',
}

describe('native planner widget snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capacitorMocks.getPlatform.mockReturnValue('android')
    capacitorMocks.isNativePlatform.mockReturnValue(true)
  })

  it('prioritizes overdue, today, tomorrow and unscheduled tasks for the Android widget', () => {
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
          title: 'Позвонить',
        },
        {
          ...baseTask,
          id: 'task-5',
          plannedDate: null,
          title: 'Когда-нибудь',
        },
        {
          ...baseTask,
          id: 'task-6',
          plannedDate: '2026-05-15',
          title: 'Позже',
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
        dateBucket: 'overdue',
        icon: '',
        id: 'task-2',
        isOverdue: true,
        timeLabel: null,
        title: 'Просроченная задача',
        visualTone: 'overdue',
      },
      {
        color: '#8EE7C8',
        dateBucket: 'today',
        icon: '',
        id: 'task-1',
        isOverdue: false,
        timeLabel: '09:00 - 10:00',
        title: 'Утренний фокус',
        visualTone: 'default',
      },
      {
        color: '#8EE7C8',
        dateBucket: 'tomorrow',
        icon: '',
        id: 'task-4',
        isOverdue: false,
        timeLabel: null,
        title: 'Завтра: Позвонить',
        visualTone: 'default',
      },
      {
        color: '#8EE7C8',
        dateBucket: 'future',
        icon: '',
        id: 'task-6',
        isOverdue: false,
        timeLabel: null,
        title: '15 мая: Позже',
        visualTone: 'default',
      },
      {
        color: '#8EE7C8',
        dateBucket: 'unscheduled',
        icon: '',
        id: 'task-5',
        isOverdue: false,
        timeLabel: null,
        title: 'Без даты: Когда-нибудь',
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
      Array.from({ length: 25 }, (_, index) => ({
        ...baseTask,
        id: `task-${index + 1}`,
        plannedEndTime: null,
        plannedStartTime: `${String(8 + index).padStart(2, '0')}:00`,
        title: `Задача ${index + 1}`,
      })),
      new Date(2026, 4, 9, 12),
    )

    expect(snapshot.tasks).toHaveLength(24)
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

  it('reads and filters pending Android widget completions', async () => {
    capacitorMocks.readPendingCompletedTasks.mockResolvedValue({
      taskIds: ['task-1', '', 'task-2', 3],
    })

    await expect(
      readPendingNativePlannerWidgetCompletedTasks(),
    ).resolves.toEqual(['task-1', 'task-2'])
  })

  it('acknowledges filtered Android widget completions', async () => {
    capacitorMocks.ackPendingCompletedTasks.mockResolvedValue(undefined)

    await ackPendingNativePlannerWidgetCompletedTasks(['task-1', '', 'task-2'])

    expect(capacitorMocks.ackPendingCompletedTasks).toHaveBeenCalledWith({
      taskIds: ['task-1', 'task-2'],
    })
  })
})
