import type {
  SelfCareDashboardResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildTodaySelfCareModel,
  formatSelfCareTaskMeta,
  getSelfCareTaskKey,
  getSelfCareTaskTime,
  isVisibleSelfCareMainTask,
} from './today-self-care'

type SelfCareTodayItemOverrides = Omit<Partial<SelfCareTodayItem>, 'item'> & {
  item?: Partial<SelfCareTodayItem['item']>
}

function createSelfCareItem(
  overrides: SelfCareTodayItemOverrides = {},
): SelfCareTodayItem {
  const { item: itemOverrides, ...entryOverrides } = overrides

  return {
    appointment: null,
    completion: null,
    courseDetails: null,
    exercise: null,
    flexibleProgress: null,
    item: {
      category: 'daily_base',
      color: null,
      createdAt: '2026-05-19T08:00:00.000Z',
      customCategoryId: null,
      defaultDurationMinutes: null,
      deletedAt: null,
      description: '',
      icon: '',
      id: 'self-care-1',
      importance: 'recommended',
      isActive: true,
      isArchived: false,
      isPrivate: true,
      migratedFromHabitId: null,
      preferredTimeOfDay: 'anytime',
      title: 'Забота',
      type: 'habit',
      updatedAt: '2026-05-19T08:00:00.000Z',
      userId: 'user-1',
      version: 1,
      workspaceId: 'personal-workspace',
      ...itemOverrides,
    } as SelfCareTodayItem['item'],
    lastExercise: null,
    lastMeasurement: null,
    measurement: null,
    occurrence: null,
    procedure: null,
    scheduleRule: null,
    steps: [],
    timeGroup: 'anytime',
    ...entryOverrides,
  }
}

function createOccurrence(
  status: NonNullable<SelfCareTodayItem['occurrence']>['status'] = 'scheduled',
  overrides: Partial<NonNullable<SelfCareTodayItem['occurrence']>> = {},
): NonNullable<SelfCareTodayItem['occurrence']> {
  return {
    completedAt: null,
    createdAt: '2026-05-19T08:00:00.000Z',
    dueAt: '2026-05-20T08:00:00.000Z',
    generatedAt: '2026-05-19T08:00:00.000Z',
    id: 'occurrence-1',
    itemId: 'self-care-1',
    movedTo: null,
    reminderOffsetsMinutes: [],
    reminderTimeZone: null,
    scheduledFor: '2026-05-20',
    scheduleRuleId: null,
    status,
    updatedAt: '2026-05-19T08:00:00.000Z',
    userId: 'user-1',
    version: 1,
    ...overrides,
  }
}

function createDashboard(
  todayItems: SelfCareTodayItem[],
  options: {
    flexibleGoals?: SelfCareTodayItem[]
    overdueItems?: SelfCareTodayItem[]
    showSelfCareInMainTasks?: boolean
  } = {},
): SelfCareDashboardResponse {
  return {
    date: '2026-05-20',
    dailyState: null,
    flexibleGoals: options.flexibleGoals ?? [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: options.overdueItems ?? [],
    planningHints: [],
    settings: {
      showSelfCareInMainTasks: options.showSelfCareInMainTasks ?? true,
    } as SelfCareDashboardResponse['settings'],
    todayItems,
    upcomingImportant: [],
  }
}

function createDailyFlexibleGoal(id: string): SelfCareTodayItem {
  return createSelfCareItem({
    flexibleProgress: {
      completedCount: 0,
      periodEnd: '2026-05-20',
      periodStart: '2026-05-20',
      remainingCount: 3,
      targetCount: 3,
    },
    item: { id, title: id, type: 'flexible_goal' },
    scheduleRule: {
      allowMultiplePerDay: false,
      createdAt: '2026-05-19T08:00:00.000Z',
      dayOfMonth: null,
      daysOfWeek: [],
      endDate: null,
      flexiblePeriod: 'day',
      flexibleTargetCount: 3,
      generateInCalendar: false,
      generateInTaskList: true,
      id: `${id}-rule`,
      intervalUnit: null,
      intervalValue: null,
      itemId: id,
      monthOfYear: null,
      preferredTime: null,
      reminderOffsetsMinutes: [],
      repeatKind: 'daily',
      startDate: '2026-05-19',
      timezone: null,
      updatedAt: '2026-05-19T08:00:00.000Z',
      weekOfMonth: null,
    },
  })
}

describe('today self-care model', () => {
  it('keeps today, overdue and tomorrow entries in their existing groups', () => {
    const todayItem = createSelfCareItem({ item: { id: 'today' } })
    const flexibleGoal = createDailyFlexibleGoal('flexible')
    const overdueItem = createSelfCareItem({ item: { id: 'overdue' } })
    const tomorrowItem = createSelfCareItem({ item: { id: 'tomorrow' } })

    const model = buildTodaySelfCareModel({
      todayDashboard: createDashboard([todayItem], {
        flexibleGoals: [flexibleGoal],
        overdueItems: [overdueItem],
      }),
      tomorrowDashboard: createDashboard([tomorrowItem]),
    })

    expect(model.routineEntries.map((entry) => entry.item.id)).toEqual([
      'today',
      'flexible',
    ])
    expect(model.overdueEntries.map((entry) => entry.item.id)).toEqual([
      'overdue',
    ])
    expect(model.tomorrowEntries.map((entry) => entry.item.id)).toEqual([
      'tomorrow',
    ])
  })

  it('uses the tomorrow setting only while the today dashboard is absent', () => {
    const tomorrowDashboard = createDashboard([
      createSelfCareItem({ item: { id: 'tomorrow' } }),
    ])

    expect(
      buildTodaySelfCareModel({
        todayDashboard: undefined,
        tomorrowDashboard,
      }).tomorrowEntries,
    ).toHaveLength(1)

    const disabledModel = buildTodaySelfCareModel({
      todayDashboard: createDashboard([], {
        showSelfCareInMainTasks: false,
      }),
      tomorrowDashboard,
    })

    expect(disabledModel.showSelfCareMainTasks).toBe(false)
    expect(disabledModel.routineEntries).toEqual([])
    expect(disabledModel.overdueEntries).toEqual([])
    expect(disabledModel.tomorrowEntries).toEqual([])
  })

  it.each([
    'cancelled',
    'done',
    'missed',
    'moved',
    'partial',
    'skipped',
  ] as const)('hides %s occurrences', (status) => {
    expect(
      isVisibleSelfCareMainTask(
        createSelfCareItem({ occurrence: createOccurrence(status) }),
      ),
    ).toBe(false)
  })

  it('preserves the existing item, course and flexible progress filters', () => {
    const hiddenEntries = [
      createSelfCareItem({ item: { isActive: false } }),
      createSelfCareItem({ item: { isArchived: true } }),
      createSelfCareItem({
        completion: {} as NonNullable<SelfCareTodayItem['completion']>,
      }),
      createSelfCareItem({
        courseDetails: {
          isCompleted: true,
          isPaused: false,
        } as NonNullable<SelfCareTodayItem['courseDetails']>,
        item: { type: 'course' },
      }),
      createSelfCareItem({
        courseDetails: {
          isCompleted: false,
          isPaused: true,
        } as NonNullable<SelfCareTodayItem['courseDetails']>,
        item: { type: 'course' },
      }),
      createSelfCareItem({
        flexibleProgress: {
          completedCount: 3,
          periodEnd: '2026-05-20',
          periodStart: '2026-05-20',
          remainingCount: 0,
          targetCount: 3,
        },
      }),
    ]

    expect(hiddenEntries.map(isVisibleSelfCareMainTask)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('preserves key and time formatting fallbacks', () => {
    const occurrenceEntry = createSelfCareItem({
      occurrence: createOccurrence('scheduled', {
        dueAt: '2026-05-20T11:30:00.000Z',
        id: 'occurrence-time',
        reminderTimeZone: 'UTC',
      }),
    })
    const preferredTimeEntry = createSelfCareItem({
      scheduleRule: {
        preferredTime: '07:45',
      } as NonNullable<SelfCareTodayItem['scheduleRule']>,
    })

    expect(getSelfCareTaskKey(occurrenceEntry)).toBe(
      'self-care-occurrence-time',
    )
    expect(getSelfCareTaskTime(occurrenceEntry, 'Europe/Samara')).toBe('11:30')
    expect(formatSelfCareTaskMeta(occurrenceEntry, 'Europe/Samara')).toBe(
      'Забота · 11:30',
    )
    expect(getSelfCareTaskTime(preferredTimeEntry, 'Europe/Samara')).toBe(
      '07:45',
    )
    expect(formatSelfCareTaskMeta(createSelfCareItem(), 'Europe/Samara')).toBe(
      'Забота',
    )
  })
})
