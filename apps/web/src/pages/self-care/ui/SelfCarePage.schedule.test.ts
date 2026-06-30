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
  addRepeatInterval,
  buildAvailableTodayEntries,
  buildItemEntry,
  buildRitualDashboardItems,
  buildTodayCourseEntries,
  compareTodayEntries,
  getDatePart,
  getIsoWeekdayFromDateKey,
  getLatestProgressCompletionByItemId,
  getNextPlannedDateByItemId,
  getPlannedEntriesCountForDate,
  getPlanOccurrenceEntries,
  inferNextCompletionDate,
  isClosedTodayEntry,
  isCompletionDoneToday,
  isEntryDoneToday,
  isProgressCompletionStatus,
  isScheduleRuleAvailableToday,
  mergeLatestProgressCompletion,
  mergeRitualProgressCompletion,
  scheduleSelfCareEntryOccurrence,
  shiftDateKey,
  shouldMoveExistingSelfCareOccurrence,
  shouldShowAvailableTodayEntry,
  shouldShowOverdueEntry,
  shouldShowPlannedEntry,
  shouldShowTodayEntry,
} from './SelfCarePage.schedule'

const scheduleInput: SelfCareItemScheduleInput = {
  currency: 'RUB',
  note: 'Перед визитом не есть',
  place: 'Клиника',
  price: 4600,
  reminderOffsetsMinutes: [],
  scheduledFor: '2026-06-26',
  scheduledTime: '18:00',
  specialistContact: null,
  specialistName: 'Федор',
  timezone: null,
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

  it('keeps overdue occurrences available for the rituals tab', () => {
    const overdueItem = createItem({
      id: 'vitamin-c',
      title: 'Витамин C',
    })
    const dailyGoal = createItem({
      id: 'water',
      title: 'Вода',
      type: 'flexible_goal',
    })
    const todayEntry = createTodayEntry({
      item: overdueItem,
      occurrence: createOccurrence({
        id: 'today-occurrence',
        itemId: overdueItem.id,
        scheduledFor: '2026-06-20',
      }),
    })
    const overdueEntry = createTodayEntry({
      item: overdueItem,
      occurrence: createOccurrence({
        id: 'overdue-occurrence',
        itemId: overdueItem.id,
        scheduledFor: '2026-06-19',
      }),
    })
    const flexibleEntry = createTodayEntry({ item: dailyGoal })

    const dashboardItems = buildRitualDashboardItems(
      createDashboard({
        flexibleGoals: [flexibleEntry],
        overdueItems: [overdueEntry],
        todayItems: [todayEntry],
      }),
    )

    expect(dashboardItems.map((entry) => entry.item.id)).toEqual([
      overdueItem.id,
      dailyGoal.id,
    ])
    expect(dashboardItems[0]?.occurrence?.id).toBe('overdue-occurrence')
  })

  it('does not close open ritual occurrences with unrelated latest progress', () => {
    const overdueEntry = createTodayEntry({
      item: createItem({
        id: 'vitamin-c',
        title: 'Витамин C',
        type: 'course',
      }),
      occurrence: createOccurrence({
        id: 'overdue-occurrence',
        itemId: 'vitamin-c',
        scheduledFor: '2026-06-19',
      }),
    })
    const todayCompletion = createCompletion({
      completedAt: '2026-06-20T10:00:00.000Z',
      itemId: 'vitamin-c',
    })

    expect(
      mergeLatestProgressCompletion(overdueEntry, todayCompletion).completion
        ?.id,
    ).toBe(todayCompletion.id)
    expect(
      mergeRitualProgressCompletion(overdueEntry, todayCompletion).completion,
    ).toBeNull()
  })
})

describe('self-care schedule projection helpers', () => {
  it('builds item entries with linked details and ordered ritual steps', () => {
    const item = createItem({ id: 'ritual-1', title: 'Уход', type: 'ritual' })
    const list = createList({
      appointmentDetails: [createAppointmentDetails({ itemId: item.id })],
      courseDetails: [createCourseDetails({ itemId: item.id })],
      items: [item],
      measurementDetails: [createMeasurementDetails({ itemId: item.id })],
      procedureDetails: [createProcedureDetails({ itemId: item.id })],
      scheduleRules: [createScheduleRule({ itemId: item.id })],
      steps: [
        createStep({ id: 'second', itemId: item.id, order: 2 }),
        createStep({ id: 'first', itemId: item.id, order: 1 }),
      ],
    })

    const entry = buildItemEntry(item, list)

    expect(entry.appointment?.itemId).toBe(item.id)
    expect(entry.courseDetails?.itemId).toBe(item.id)
    expect(entry.measurement?.itemId).toBe(item.id)
    expect(entry.procedure?.itemId).toBe(item.id)
    expect(entry.scheduleRule?.itemId).toBe(item.id)
    expect(entry.steps.map((step) => step.id)).toEqual(['first', 'second'])
  })

  it('derives latest progress completions and preserves measurement readings', () => {
    const skipped = createCompletion({
      completedAt: '2026-06-24T09:00:00.000Z',
      id: 'skipped',
      status: 'skipped',
    })
    const older = createCompletion({
      completedAt: '2026-06-20T09:00:00.000Z',
      id: 'older',
      measurementValue: 60,
    })
    const latest = createCompletion({
      completedAt: '2026-06-22T09:00:00.000Z',
      id: 'latest',
      measurementValue: 62,
      status: 'partial',
    })
    const latestByItemId = getLatestProgressCompletionByItemId(
      createHistory({ completions: [skipped, older, latest] }),
    )
    const measurementItem = createItem({ type: 'measurement' })
    const merged = mergeLatestProgressCompletion(
      createTodayEntry({ item: measurementItem }),
      latestByItemId.get('item-1') ?? null,
    )

    expect(latestByItemId.get('item-1')?.id).toBe('latest')
    expect(merged.completion?.id).toBe('latest')
    expect(merged.lastMeasurement?.measurementValue).toBe(62)
    expect(
      mergeLatestProgressCompletion(
        createTodayEntry({
          item: measurementItem,
          lastMeasurement: older,
        }),
        createCompletion({ measurementValue: null }),
      ).lastMeasurement?.id,
    ).toBe('older')
  })

  it('builds today course entries from dashboard and plan without stale courses', () => {
    const activeCourse = createItem({
      id: 'active-course',
      title: 'Активный курс',
      type: 'course',
    })
    const staleCourse = createItem({
      id: 'stale-course',
      title: 'Старый курс',
      type: 'course',
    })
    const activeEntry = createTodayEntry({
      courseDetails: createCourseDetails({ itemId: activeCourse.id }),
      item: activeCourse,
      scheduleRule: createScheduleRule({
        itemId: activeCourse.id,
        repeatKind: 'course',
        startDate: '2026-06-20',
      }),
    })
    const staleEntry = createTodayEntry({
      courseDetails: createCourseDetails({ itemId: staleCourse.id }),
      item: staleCourse,
      occurrence: createOccurrence({
        itemId: staleCourse.id,
        scheduledFor: '2026-06-10',
      }),
      scheduleRule: createScheduleRule({
        itemId: staleCourse.id,
        repeatKind: 'course',
        startDate: '2026-06-20',
      }),
    })

    expect(
      buildTodayCourseEntries({
        dashboardTodayItems: [],
        latestCompletionByItemId: new Map([
          [
            activeCourse.id,
            createCompletion({
              completedAt: '2026-06-18T10:00:00.000Z',
              itemId: activeCourse.id,
            }),
          ],
        ]),
        nextPlannedDateByItemId: new Map([[activeCourse.id, '2026-06-20']]),
        planCourses: [staleEntry, activeEntry],
        todayKey: '2026-06-20',
      }).map((entry) => entry.item.id),
    ).toEqual(['active-course'])
  })

  it('filters and deduplicates planned occurrence entries by item', () => {
    const task = createItem({ id: 'task-1', title: 'Задача' })
    const course = createItem({ id: 'course-1', title: 'Курс', type: 'course' })
    const medical = createItem({
      id: 'medical-1',
      title: 'Врач',
      type: 'medical',
    })
    const plan = createPlan({
      occurrences: [
        createTodayEntry({
          item: task,
          occurrence: createOccurrence({
            itemId: task.id,
            scheduledFor: '2026-06-24',
          }),
        }),
        createTodayEntry({
          item: task,
          occurrence: createOccurrence({
            id: 'later',
            itemId: task.id,
            scheduledFor: '2026-06-25',
          }),
        }),
        createTodayEntry({
          item: course,
          occurrence: createOccurrence({ itemId: course.id }),
        }),
        createTodayEntry({
          item: medical,
          occurrence: createOccurrence({ itemId: medical.id }),
        }),
        createTodayEntry({
          item: createItem({ id: 'cancelled' }),
          occurrence: createOccurrence({ status: 'cancelled' }),
        }),
      ],
    })

    expect(getPlanOccurrenceEntries(plan, '2026-06-20')).toHaveLength(1)
    expect(getPlanOccurrenceEntries(plan, '2026-06-20')[0]?.item.id).toBe(
      'task-1',
    )
    expect(getPlannedEntriesCountForDate(plan, '2026-06-24')).toBe(1)
    expect(getPlannedEntriesCountForDate(undefined, '2026-06-24')).toBeNull()
  })

  it('evaluates today, planned, closed, and completion states', () => {
    const doneCompletion = createCompletion({
      completedAt: '2026-06-20T10:00:00.000Z',
      status: 'alternative_done',
    })
    const skippedCompletion = createCompletion({
      completedAt: '2026-06-20T10:00:00.000Z',
      status: 'skipped',
    })
    const flexibleDone = createTodayEntry({
      flexibleProgress: {
        completedCount: 3,
        periodEnd: '2026-06-20',
        periodStart: '2026-06-20',
        remainingCount: 0,
        targetCount: 3,
      },
    })
    const cancelled = createTodayEntry({
      occurrence: createOccurrence({ status: 'cancelled' }),
    })
    const active = createTodayEntry()

    expect(isProgressCompletionStatus('partial')).toBe(true)
    expect(isProgressCompletionStatus('skipped')).toBe(false)
    expect(isCompletionDoneToday(doneCompletion, '2026-06-20')).toBe(true)
    expect(isCompletionDoneToday(skippedCompletion, '2026-06-20')).toBe(false)
    expect(
      isEntryDoneToday(
        createTodayEntry({ completion: doneCompletion }),
        '2026-06-20',
      ),
    ).toBe(true)
    expect(
      isEntryDoneToday(
        createTodayEntry({
          completion: createCompletion({
            measurementValue: 10,
            status: 'partial',
          }),
          item: createItem({ type: 'exercise' }),
        }),
        '2026-06-20',
      ),
    ).toBe(false)
    expect(
      shouldShowTodayEntry(
        createTodayEntry({
          completion: createCompletion({
            measurementValue: 10,
            status: 'partial',
          }),
          item: createItem({ type: 'exercise' }),
        }),
      ),
    ).toBe(true)
    expect(
      shouldShowAvailableTodayEntry(
        createTodayEntry({
          completion: createCompletion({
            measurementValue: 10,
            status: 'partial',
          }),
          item: createItem({ type: 'exercise' }),
          scheduleRule: null,
        }),
        '2026-06-20',
      ),
    ).toBe(true)
    expect(shouldShowTodayEntry(active)).toBe(true)
    expect(shouldShowTodayEntry(flexibleDone)).toBe(false)
    expect(shouldShowTodayEntry(cancelled)).toBe(false)
    expect(shouldShowPlannedEntry(active)).toBe(true)
    expect(shouldShowPlannedEntry(cancelled)).toBe(false)
    expect(isClosedTodayEntry(flexibleDone)).toBe(true)
    expect(isClosedTodayEntry(cancelled)).toBe(true)
  })

  it('shows open overdue courses without returning them to regular today items', () => {
    const overdueCourse = createTodayEntry({
      courseDetails: createCourseDetails({ itemId: 'course-1' }),
      item: createItem({
        id: 'course-1',
        title: 'Витамин C',
        type: 'course',
      }),
      occurrence: createOccurrence({
        id: 'overdue-course',
        itemId: 'course-1',
        scheduledFor: '2026-06-19',
      }),
      scheduleRule: createScheduleRule({
        itemId: 'course-1',
        repeatKind: 'course',
        startDate: '2026-06-01',
      }),
    })
    const completedCourse = createTodayEntry({
      ...overdueCourse,
      courseDetails: createCourseDetails({
        isCompleted: true,
        itemId: 'course-1',
      }),
    })

    expect(shouldShowTodayEntry(overdueCourse)).toBe(false)
    expect(shouldShowOverdueEntry(overdueCourse)).toBe(true)
    expect(shouldShowOverdueEntry(completedCourse)).toBe(false)
  })

  it('covers available-today branches for appointment, course, no-rule and hidden items', () => {
    const appointment = createTodayEntry({
      appointment: createAppointmentDetails({
        itemId: 'appointment-1',
        startsAt: '2026-06-20T12:00:00.000Z',
      }),
      item: createItem({
        id: 'appointment-1',
        title: 'Запись',
        type: 'appointment',
      }),
    })
    const course = createTodayEntry({
      courseDetails: createCourseDetails({ itemId: 'course-1' }),
      item: createItem({ id: 'course-1', title: 'Курс', type: 'course' }),
      scheduleRule: createScheduleRule({
        itemId: 'course-1',
        repeatKind: 'course',
      }),
    })
    const hidden = createTodayEntry({
      item: createItem({ isArchived: true }),
    })
    const noRule = createTodayEntry({ scheduleRule: null })
    const flexible = createTodayEntry({
      item: createItem({ type: 'flexible_goal' }),
    })

    expect(shouldShowAvailableTodayEntry(appointment, '2026-06-20')).toBe(true)
    expect(shouldShowAvailableTodayEntry(appointment, '2026-06-21')).toBe(false)
    expect(shouldShowAvailableTodayEntry(course, '2026-06-20')).toBe(true)
    expect(shouldShowAvailableTodayEntry(hidden, '2026-06-20')).toBe(false)
    expect(shouldShowAvailableTodayEntry(noRule, '2026-06-20')).toBe(true)
    expect(
      shouldShowAvailableTodayEntry(
        createTodayEntry({
          completion: createCompletion({
            completedAt: '2026-06-20T10:00:00.000Z',
          }),
          scheduleRule: null,
        }),
        '2026-06-20',
      ),
    ).toBe(false)
    expect(shouldShowAvailableTodayEntry(flexible, '2026-06-20')).toBe(false)
  })

  it('covers repeat interval, date, and sorting helpers', () => {
    expect(addRepeatInterval('2026-06-01', createScheduleRule())).toBe(
      '2026-06-02',
    )
    expect(
      addRepeatInterval(
        '2026-06-01',
        createScheduleRule({ repeatKind: 'weekly' }),
      ),
    ).toBe('2026-06-08')
    expect(
      addRepeatInterval(
        '2026-01-31',
        createScheduleRule({ repeatKind: 'monthly' }),
      ),
    ).toBe('2026-02-28')
    expect(
      addRepeatInterval(
        '2024-02-29',
        createScheduleRule({ repeatKind: 'yearly' }),
      ),
    ).toBe('2025-02-28')
    expect(
      addRepeatInterval(
        '2026-06-01',
        createScheduleRule({ intervalUnit: null, repeatKind: 'course' }),
      ),
    ).toBe('2026-06-02')
    expect(
      addRepeatInterval(
        '2026-06-01',
        createScheduleRule({ repeatKind: 'flexible_goal' }),
      ),
    ).toBeNull()
    expect(shiftDateKey('2026-06-20', 2)).toBe('2026-06-22')
    expect(getIsoWeekdayFromDateKey('2026-06-21')).toBe(7)
    expect(getDatePart('2026-06-21', 'day')).toBe(21)
    expect(getDatePart('2026-06-21', 'month')).toBe(6)
    expect(
      compareTodayEntries(
        createTodayEntry({
          item: createItem({ title: 'Б' }),
          timeGroup: 'morning',
        }),
        createTodayEntry({
          item: createItem({ title: 'А' }),
          timeGroup: 'evening',
        }),
      ),
    ).toBeLessThan(0)
  })

  it('covers yearly, interval, course weekday, and bounded availability rules', () => {
    expect(
      isScheduleRuleAvailableToday(
        createScheduleRule({
          dayOfMonth: 29,
          monthOfYear: 2,
          repeatKind: 'yearly',
          startDate: '2024-02-29',
        }),
        null,
        '2025-02-28',
      ),
    ).toBe(true)
    expect(
      isScheduleRuleAvailableToday(
        createScheduleRule({
          intervalUnit: 'week',
          intervalValue: 2,
          repeatKind: 'interval',
          startDate: '2026-06-01',
        }),
        null,
        '2026-06-29',
      ),
    ).toBe(true)
    expect(
      isScheduleRuleAvailableToday(
        createScheduleRule({
          daysOfWeek: [3],
          repeatKind: 'course',
          startDate: '2026-06-01',
        }),
        null,
        '2026-06-24',
      ),
    ).toBe(true)
    expect(
      isScheduleRuleAvailableToday(
        createScheduleRule({ endDate: '2026-06-19' }),
        null,
        '2026-06-20',
      ),
    ).toBe(false)
    expect(
      isScheduleRuleAvailableToday(null, createCompletion(), '2026-06-20'),
    ).toBe(false)
    expect(
      isScheduleRuleAvailableToday(
        createScheduleRule({ repeatKind: 'flexible_goal' }),
        null,
        '2026-06-20',
      ),
    ).toBe(false)
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
    exerciseSets: [],
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
    reminderOffsetsMinutes: [],
    reminderTimeZone: null,
    scheduledFor: '2026-06-20',
    scheduleRuleId: 'rule-1',
    status: 'scheduled',
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
    ...overrides,
  }
}

function createAppointmentDetails(
  overrides: Partial<NonNullable<SelfCareTodayItem['appointment']>> = {},
): NonNullable<SelfCareTodayItem['appointment']> {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    currency: 'RUB',
    endsAt: null,
    id: 'appointment-1',
    itemId: 'item-1',
    occurrenceId: null,
    place: 'Клиника',
    preparationNote: '',
    price: null,
    resultNote: '',
    specialistContact: null,
    specialistName: 'Специалист',
    startsAt: '2026-06-20T10:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function createCourseDetails(
  overrides: Partial<NonNullable<SelfCareTodayItem['courseDetails']>> = {},
): NonNullable<SelfCareTodayItem['courseDetails']> {
  return {
    breakDays: 0,
    completedCount: 0,
    courseType: 'days',
    createdAt: '2026-06-01T00:00:00.000Z',
    endDate: null,
    id: 'course-1',
    isCompleted: false,
    isPaused: false,
    itemId: 'item-1',
    repeatAfterCompletion: false,
    startDate: '2026-06-20',
    totalCount: 10,
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function createMeasurementDetails(
  overrides: Partial<NonNullable<SelfCareTodayItem['measurement']>> = {},
): NonNullable<SelfCareTodayItem['measurement']> {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    id: 'measurement-1',
    itemId: 'item-1',
    targetMax: null,
    targetMin: null,
    unit: 'кг',
    updatedAt: '2026-06-01T00:00:00.000Z',
    valueLabel: 'Вес',
    ...overrides,
  }
}

function createProcedureDetails(
  overrides: Partial<NonNullable<SelfCareTodayItem['procedure']>> = {},
): NonNullable<SelfCareTodayItem['procedure']> {
  return {
    contact: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    currency: 'RUB',
    defaultPrice: null,
    id: 'procedure-1',
    itemId: 'item-1',
    place: 'Салон',
    specialistName: 'Мастер',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function createStep(
  overrides: Partial<SelfCareTodayItem['steps'][number]> = {},
): SelfCareTodayItem['steps'][number] {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    defaultChecked: false,
    id: 'step-1',
    isOptional: false,
    itemId: 'item-1',
    order: 0,
    title: 'Шаг',
    updatedAt: '2026-06-01T00:00:00.000Z',
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
    exercise: null,
    flexibleProgress: null,
    item,
    lastExercise: null,
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
    exerciseDetails: [],
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
