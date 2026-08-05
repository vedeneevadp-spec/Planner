import { describe, expect, it } from 'vitest'

import type { Task } from '@/entities/task'

import {
  buildTodayTaskModel,
  getTodaySectionDefaultCollapseState,
  getTodayTaskView,
} from './today-task-model'

const TODAY_KEY = '2026-05-20'
const TOMORROW_KEY = '2026-05-21'

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-05-19T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: 'Задача',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function ids(tasks: Task[]): string[] {
  return tasks.map((task) => task.id)
}

describe('today task model', () => {
  it('projects a mixed task collection into the existing sections', () => {
    const tasks = [
      createTask({
        id: 'today-1',
        plannedDate: TODAY_KEY,
        title: 'Сегодня 1',
      }),
      createTask({
        id: 'today-2',
        plannedDate: TODAY_KEY,
        title: 'Сегодня 2',
      }),
      createTask({
        id: 'routine',
        plannedDate: TODAY_KEY,
        routine: {
          daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
          frequency: 'daily',
          seriesId: 'routine-series',
          targetType: 'check',
          targetValue: 1,
          unit: '',
        },
      }),
      createTask({ id: 'overdue', plannedDate: '2026-05-19' }),
      createTask({ id: 'tomorrow', plannedDate: TOMORROW_KEY }),
      createTask({ id: 'inbox' }),
      createTask({ id: 'future', plannedDate: '2026-05-25' }),
      createTask({
        completedAt: '2026-05-20T12:00:00.000Z',
        id: 'done-today',
        status: 'done',
      }),
      createTask({
        completedAt: '2026-05-19T12:00:00.000Z',
        id: 'done-history',
        status: 'done',
      }),
      createTask({ id: 'archive', status: 'archived' }),
    ]

    const model = buildTodayTaskModel({
      plannerTimeZone: 'UTC',
      tasks,
      todayKey: TODAY_KEY,
      tomorrowKey: TOMORROW_KEY,
    })

    expect(ids(model.mainTodayTasks)).toEqual(['today-1', 'today-2'])
    expect(ids(model.routineTasks)).toEqual(['routine'])
    expect(ids(model.overdueTasks)).toEqual(['overdue'])
    expect(ids(model.tomorrowTasks)).toEqual(['tomorrow'])
    expect(ids(model.otherTasks)).toEqual(['inbox', 'future'])
    expect(ids(model.doneTodayTasks)).toEqual(['done-today'])
    expect(ids(model.doneHistoryTasks)).toEqual(['done-history'])
    expect(ids(model.archivedTasks)).toEqual(['archive'])
    expect(ids(model.resourceTasks)).toEqual([
      'today-1',
      'today-2',
      'routine',
      'done-today',
    ])

    const visibleIds = [
      ...model.mainTodayTasks,
      ...model.routineTasks,
      ...model.overdueTasks,
      ...model.tomorrowTasks,
      ...model.otherTasks,
      ...model.doneTodayTasks,
      ...model.doneHistoryTasks,
      ...model.archivedTasks,
    ].map((task) => task.id)

    expect(new Set(visibleIds).size).toBe(visibleIds.length)
    expect(tasks.map((task) => task.id)).toEqual([
      'today-1',
      'today-2',
      'routine',
      'overdue',
      'tomorrow',
      'inbox',
      'future',
      'done-today',
      'done-history',
      'archive',
    ])
  })

  it('uses only the routine field for the Today routine section', () => {
    const model = buildTodayTaskModel({
      plannerTimeZone: 'UTC',
      tasks: [
        createTask({
          id: 'keyword-only',
          plannedDate: TODAY_KEY,
          title: 'Ежедневная уборка',
          urgency: 'urgent',
        }),
      ],
      todayKey: TODAY_KEY,
      tomorrowKey: TOMORROW_KEY,
    })

    expect(ids(model.mainTodayTasks)).toEqual(['keyword-only'])
    expect(model.routineTasks).toEqual([])
  })

  it('uses the provided timezone for completed task day boundaries', () => {
    const task = createTask({
      completedAt: '2026-05-20T22:30:00.000Z',
      id: 'late-completion',
      status: 'done',
    })

    const samaraModel = buildTodayTaskModel({
      plannerTimeZone: 'Europe/Samara',
      tasks: [task],
      todayKey: TOMORROW_KEY,
      tomorrowKey: '2026-05-22',
    })
    const utcModel = buildTodayTaskModel({
      plannerTimeZone: 'UTC',
      tasks: [task],
      todayKey: TOMORROW_KEY,
      tomorrowKey: '2026-05-22',
    })

    expect(ids(samaraModel.doneTodayTasks)).toEqual(['late-completion'])
    expect(ids(utcModel.doneHistoryTasks)).toEqual(['late-completion'])
  })

  it.each([
    {
      expected: {
        doneHistory: false,
        doneToday: false,
        other: false,
        tomorrow: false,
      },
      label: 'empty day',
      values: {},
    },
    {
      expected: {
        doneHistory: true,
        doneToday: true,
        other: true,
        tomorrow: true,
      },
      label: 'today task before all later sections',
      values: { mainTodayTasks: [createTask({ id: 'today' })] },
    },
    {
      expected: {
        doneHistory: true,
        doneToday: true,
        other: false,
        tomorrow: false,
      },
      label: 'other task as the first visible later section',
      values: { otherTasks: [createTask({ id: 'other' })] },
    },
    {
      expected: {
        doneHistory: true,
        doneToday: false,
        other: false,
        tomorrow: false,
      },
      label: 'completed today as the first visible later section',
      values: { doneTodayTasks: [createTask({ id: 'done' })] },
    },
    {
      expected: {
        doneHistory: false,
        doneToday: false,
        other: false,
        tomorrow: false,
      },
      label: 'history as the first visible later section',
      values: {},
    },
    {
      expected: {
        doneHistory: true,
        doneToday: true,
        other: true,
        tomorrow: true,
      },
      label: 'routine self-care before tomorrow',
      values: { routineExtraItemCount: 1 },
    },
    {
      expected: {
        doneHistory: true,
        doneToday: true,
        other: true,
        tomorrow: false,
      },
      label: 'tomorrow self-care before other',
      values: { tomorrowExtraItemCount: 1 },
    },
  ])('preserves collapse defaults for $label', ({ expected, values }) => {
    const empty = {
      doneTodayTasks: [],
      mainTodayTasks: [],
      otherTasks: [],
      overdueTasks: [],
      routineTasks: [],
      tomorrowTasks: [],
    }

    expect(
      getTodaySectionDefaultCollapseState({ ...empty, ...values }),
    ).toEqual(expected)
  })

  it.each([
    ['', 'cards'],
    ['taskView=cards', 'cards'],
    ['taskView=unknown', 'cards'],
    ['taskView=LIST', 'cards'],
    ['taskView=list', 'list'],
  ] as const)('resolves task view from %s', (query, expected) => {
    expect(getTodayTaskView(new URLSearchParams(query))).toBe(expected)
  })
})
