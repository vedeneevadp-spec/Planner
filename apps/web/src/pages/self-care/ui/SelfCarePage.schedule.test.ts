import type {
  SelfCareCompletion,
  SelfCareDashboardResponse,
  SelfCareHistoryResponse,
  SelfCareItem,
  SelfCareItemScheduleInput,
  SelfCareListResponse,
  SelfCarePlanResponse,
  SelfCareScheduleRule,
  SelfCareSettings,
  SelfCareTodayItem,
} from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  addIntervalDateKey,
  buildAvailableTodayEntries,
  getNextPlannedDateByItemId,
  inferNextCompletionDate,
  isScheduleRuleAvailableToday,
  scheduleSelfCareEntryOccurrence,
  shouldMoveExistingSelfCareOccurrence,
} from './SelfCarePage.schedule'

const scheduleInput: SelfCareItemScheduleInput = {
  currency: 'RUB',
  note: 'Перед визитом не есть',
  place: 'Клиника',
  price: 4600,
  scheduledFor: '2026-06-26',
  scheduledTime: '18:00',
  specialistContact: null,
  specialistName: 'Федор',
}

describe('scheduleSelfCareEntryOccurrence', () => {
  it('schedules the new date and marks the previous occurrence as moved', async () => {
    const calls: string[] = []
    const scheduleItem = vi.fn(() => {
      calls.push('schedule')
      return Promise.resolve()
    })
    const moveOccurrence = vi.fn(() => {
      calls.push('move')
      return Promise.resolve()
    })

    await scheduleSelfCareEntryOccurrence({
      entry: {
        item: { id: 'self-care-massage' },
        occurrence: {
          id: 'occurrence-old',
          scheduledFor: '2026-06-24',
        },
      },
      input: scheduleInput,
      moveNote: 'Дата записи изменена в настройках.',
      moveOccurrence,
      scheduleItem,
    })

    expect(calls).toEqual(['schedule', 'move'])
    expect(scheduleItem).toHaveBeenCalledWith({
      input: scheduleInput,
      itemId: 'self-care-massage',
      skipInvalidation: true,
    })
    expect(moveOccurrence).toHaveBeenCalledWith({
      invalidationScopes: [
        'dashboard',
        'items',
        'plan',
        'history',
        'analytics',
      ],
      input: {
        newDate: '2026-06-26',
        note: 'Дата записи изменена в настройках.',
      },
      occurrenceId: 'occurrence-old',
    })
  })

  it('updates the scheduled details without moving when the date is unchanged', async () => {
    const scheduleItem = vi.fn(() => Promise.resolve())
    const moveOccurrence = vi.fn(() => Promise.resolve())

    await scheduleSelfCareEntryOccurrence({
      entry: {
        item: { id: 'self-care-massage' },
        occurrence: {
          id: 'occurrence-current',
          scheduledFor: '2026-06-26',
        },
      },
      input: scheduleInput,
      moveNote: 'Дата записи изменена в настройках.',
      moveOccurrence,
      scheduleItem,
    })

    expect(
      shouldMoveExistingSelfCareOccurrence(
        {
          item: { id: 'self-care-massage' },
          occurrence: {
            id: 'occurrence-current',
            scheduledFor: '2026-06-26',
          },
        },
        scheduleInput,
      ),
    ).toBe(false)
    expect(scheduleItem).toHaveBeenCalledWith({
      input: scheduleInput,
      itemId: 'self-care-massage',
      skipInvalidation: false,
    })
    expect(moveOccurrence).not.toHaveBeenCalled()
  })
})

describe('self-care schedule availability helpers', () => {
  it('matches monthly rules that clamp long month days', () => {
    const rule = createScheduleRule({
      dayOfMonth: 31,
      repeatKind: 'monthly',
      startDate: '2026-01-31',
    })

    expect(isScheduleRuleAvailableToday(rule, null, '2026-02-28')).toBe(true)
    expect(isScheduleRuleAvailableToday(rule, null, '2026-03-30')).toBe(false)
  })

  it('respects weekly intervals from the schedule start date', () => {
    const rule = createScheduleRule({
      daysOfWeek: [1],
      intervalValue: 2,
      repeatKind: 'weekly',
      startDate: '2026-06-01',
    })

    expect(isScheduleRuleAvailableToday(rule, null, '2026-06-15')).toBe(true)
    expect(isScheduleRuleAvailableToday(rule, null, '2026-06-08')).toBe(false)
  })

  it('uses the latest completion date for after-completion schedules', () => {
    const rule = createScheduleRule({
      intervalUnit: 'day',
      intervalValue: 3,
      repeatKind: 'after_completion',
      startDate: '2026-06-01',
    })
    const completion = createCompletion({
      completedAt: '2026-06-10T09:00:00.000Z',
    })

    expect(isScheduleRuleAvailableToday(rule, completion, '2026-06-12')).toBe(
      false,
    )
    expect(isScheduleRuleAvailableToday(rule, completion, '2026-06-13')).toBe(
      true,
    )
    expect(
      inferNextCompletionDate({
        completion,
        scheduleRule: rule,
        todayKey: '2026-06-11',
      }),
    ).toBe('2026-06-13')
  })

  it('keeps month additions date-only and clamps to the target month', () => {
    expect(addIntervalDateKey('2026-01-31', 1, 'month')).toBe('2026-02-28')
    expect(addIntervalDateKey('2024-02-29', 1, 'year')).toBe('2025-02-28')
  })

  it('returns the earliest visible planned date per item', () => {
    const item = createItem({ id: 'course-1', title: 'Курс' })
    const plan = createPlan({
      occurrences: [
        createTodayEntry({
          item,
          occurrence: createOccurrence({
            id: 'cancelled',
            itemId: item.id,
            scheduledFor: '2026-06-22',
            status: 'cancelled',
          }),
        }),
        createTodayEntry({
          item,
          occurrence: createOccurrence({
            id: 'next',
            itemId: item.id,
            scheduledFor: '2026-06-24',
          }),
        }),
        createTodayEntry({
          item,
          occurrence: createOccurrence({
            id: 'later',
            itemId: item.id,
            scheduledFor: '2026-06-26',
          }),
        }),
      ],
    })

    expect(getNextPlannedDateByItemId(plan, '2026-06-20').get(item.id)).toBe(
      '2026-06-24',
    )
  })

  it('builds available today entries from list, dashboard occupancy, and history', () => {
    const available = createItem({
      id: 'available',
      preferredTimeOfDay: 'morning',
      title: 'Доступно',
    })
    const occupied = createItem({ id: 'occupied', title: 'Уже в dashboard' })
    const completed = createItem({ id: 'completed', title: 'Уже выполнено' })
    const list = createList({
      items: [occupied, completed, available],
      scheduleRules: [
        createScheduleRule({ itemId: occupied.id }),
        createScheduleRule({ itemId: completed.id }),
        createScheduleRule({ itemId: available.id }),
      ],
    })
    const dashboard = createDashboard({
      todayItems: [createTodayEntry({ item: occupied })],
    })
    const history = createHistory({
      completions: [
        createCompletion({
          completedAt: '2026-06-20T10:00:00.000Z',
          itemId: completed.id,
        }),
      ],
    })

    expect(
      buildAvailableTodayEntries({
        dashboard,
        history,
        list,
        plan: createPlan(),
        todayKey: '2026-06-20',
      }).map((entry) => entry.item.id),
    ).toEqual(['available'])
  })
})

function createItem(overrides: Partial<SelfCareItem> = {}): SelfCareItem {
  return {
    category: 'health',
    color: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    createdFromTemplateId: null,
    customCategoryId: null,
    defaultDurationMinutes: null,
    deletedAt: null,
    description: '',
    icon: null,
    id: 'item-1',
    importance: 'recommended',
    isActive: true,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: null,
    minimumVersionDescription: null,
    minimumVersionDurationMinutes: null,
    minimumVersionTitle: null,
    preferredTimeOfDay: 'anytime',
    title: 'Забота',
    type: 'habit',
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function createScheduleRule(
  overrides: Partial<SelfCareScheduleRule> = {},
): SelfCareScheduleRule {
  return {
    allowMultiplePerDay: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    dayOfMonth: null,
    daysOfWeek: [],
    endDate: null,
    flexiblePeriod: null,
    flexibleTargetCount: null,
    generateInCalendar: false,
    generateInTaskList: true,
    id: 'rule-1',
    intervalUnit: null,
    intervalValue: null,
    itemId: 'item-1',
    monthOfYear: null,
    preferredTime: null,
    reminderOffsetsMinutes: [],
    repeatKind: 'daily',
    startDate: '2026-06-20',
    timezone: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    weekOfMonth: null,
    ...overrides,
  }
}

function createCompletion(
  overrides: Partial<SelfCareCompletion> = {},
): SelfCareCompletion {
  return {
    alternativeTitle: null,
    completedAt: '2026-06-20T10:00:00.000Z',
    completedVariant: 'full',
    createdAt: '2026-06-20T10:00:00.000Z',
    durationMinutes: null,
    energyAfter: null,
    energyBefore: null,
    id: 'completion-1',
    itemId: 'item-1',
    measurementUnit: null,
    measurementValue: null,
    moodAfter: null,
    moodBefore: null,
    note: '',
    occurrenceId: null,
    scheduledFor: null,
    status: 'done',
    userId: 'user-1',
    ...overrides,
  }
}

function createOccurrence(
  overrides: Partial<NonNullable<SelfCareTodayItem['occurrence']>> = {},
): NonNullable<SelfCareTodayItem['occurrence']> {
  return {
    completedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    dueAt: null,
    generatedAt: null,
    id: 'occurrence-1',
    itemId: 'item-1',
    movedTo: null,
    scheduledFor: '2026-06-20',
    scheduleRuleId: 'rule-1',
    status: 'scheduled',
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
    ...overrides,
  }
}

function createTodayEntry(
  overrides: Partial<SelfCareTodayItem> = {},
): SelfCareTodayItem {
  const item = overrides.item ?? createItem()

  return {
    appointment: null,
    completion: null,
    courseDetails: null,
    flexibleProgress: null,
    item,
    lastMeasurement: null,
    measurement: null,
    occurrence: null,
    procedure: null,
    scheduleRule: null,
    steps: [],
    timeGroup: item.preferredTimeOfDay ?? 'anytime',
    ...overrides,
  }
}

function createList(
  overrides: Partial<SelfCareListResponse> = {},
): SelfCareListResponse {
  return {
    alternatives: [],
    appointmentDetails: [],
    courseDetails: [],
    items: [],
    medicalDetails: [],
    measurementDetails: [],
    procedureDetails: [],
    scheduleRules: [],
    steps: [],
    ...overrides,
  }
}

function createHistory(
  overrides: Partial<SelfCareHistoryResponse> = {},
): SelfCareHistoryResponse {
  return {
    completions: [],
    items: [],
    stepCompletions: [],
    ...overrides,
  }
}

function createPlan(
  overrides: Partial<SelfCarePlanResponse> = {},
): SelfCarePlanResponse {
  return {
    courses: [],
    from: '2026-06-20',
    medical: [],
    occurrences: [],
    planningHints: [],
    to: '2026-07-20',
    ...overrides,
  }
}

function createDashboard(
  overrides: Partial<SelfCareDashboardResponse> = {},
): SelfCareDashboardResponse {
  return {
    dailyState: null,
    date: '2026-06-20',
    flexibleGoals: [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: [],
    planningHints: [],
    settings: createSettings(),
    todayItems: [],
    upcomingImportant: [],
    ...overrides,
  }
}

function createSettings(
  overrides: Partial<SelfCareSettings> = {},
): SelfCareSettings {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    currency: 'RUB',
    defaultReminderTone: 'soft',
    gentleModeDate: null,
    gentleModeEnabledToday: false,
    id: 'settings-1',
    quietHoursEnd: null,
    quietHoursStart: null,
    showAppointmentsInCalendar: true,
    showSelfCareInMainTasks: true,
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
    ...overrides,
  }
}
