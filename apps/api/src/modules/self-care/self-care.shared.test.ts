import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  HabitEntryRecord,
  HabitRecord,
  SelfCareAppointmentDetails,
  SelfCareCompletion,
  SelfCareCourseDetails,
  SelfCareItem,
  SelfCareMeasurementDetails,
  SelfCareOccurrence,
  SelfCareProcedureDetails,
  SelfCareScheduleRule,
} from '@planner/contracts'

import {
  buildAnalyticsResponse,
  buildDashboardResponse,
  buildDueAt,
  buildPlanResponse,
  buildTodayItem,
  createDefaultSelfCareSettings,
  generateSelfCareOccurrenceDates,
  getFlexibleGoalProgress,
  mapHabitEntryToSelfCareCompletion,
  mapHabitToSelfCareInput,
  type SelfCareStateSnapshot,
  shouldDeduplicateSelfCareItemCompletion,
} from './self-care.shared.js'

const NOW = '2026-06-01T00:00:00.000Z'

void test('buildDueAt supports form and database time formats', () => {
  assert.equal(buildDueAt('2026-06-15', '08:30'), '2026-06-15T08:30:00.000Z')
  assert.equal(buildDueAt('2026-06-15', '08:30:00'), '2026-06-15T08:30:00.000Z')
})

void test('generateSelfCareOccurrenceDates supports daily recurrences', () => {
  assert.deepEqual(
    dates(rule({ repeatKind: 'daily', startDate: '2026-06-01' }), {
      from: '2026-06-01',
      to: '2026-06-04',
    }),
    ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'],
  )
})

void test('generateSelfCareOccurrenceDates supports weekly weekdays', () => {
  assert.deepEqual(
    dates(
      rule({
        daysOfWeek: [1, 3, 5],
        repeatKind: 'weekly',
        startDate: '2026-06-01',
      }),
      { from: '2026-06-01', to: '2026-06-07' },
    ),
    ['2026-06-01', '2026-06-03', '2026-06-05'],
  )
})

void test('generateSelfCareOccurrenceDates clamps monthly day 31 to shorter months', () => {
  assert.deepEqual(
    dates(
      rule({
        dayOfMonth: 31,
        repeatKind: 'monthly',
        startDate: '2026-01-31',
      }),
      { from: '2026-01-01', to: '2026-04-30' },
    ),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
  )
})

void test('generateSelfCareOccurrenceDates supports the last weekday of a month', () => {
  assert.deepEqual(
    dates(
      rule({
        daysOfWeek: [6],
        repeatKind: 'monthly',
        startDate: '2026-06-01',
        weekOfMonth: -1,
      }),
      { from: '2026-06-01', to: '2026-08-31' },
    ),
    ['2026-06-27', '2026-07-25', '2026-08-29'],
  )
})

void test('generateSelfCareOccurrenceDates supports yearly recurrences and leap years', () => {
  assert.deepEqual(
    dates(
      rule({
        dayOfMonth: 29,
        monthOfYear: 2,
        repeatKind: 'yearly',
        startDate: '2024-02-29',
      }),
      { from: '2024-01-01', to: '2026-12-31' },
    ),
    ['2024-02-29', '2025-02-28', '2026-02-28'],
  )
})

void test('generateSelfCareOccurrenceDates supports interval recurrences', () => {
  assert.deepEqual(
    dates(
      rule({
        intervalUnit: 'day',
        intervalValue: 10,
        repeatKind: 'interval',
        startDate: '2026-06-01',
      }),
      { from: '2026-06-01', to: '2026-07-05' },
    ),
    ['2026-06-01', '2026-06-11', '2026-06-21', '2026-07-01'],
  )
})

void test('generateSelfCareOccurrenceDates schedules after_completion from actual completion date', () => {
  const completion = selfCareCompletion({
    completedAt: '2026-06-07T12:00:00.000Z',
    itemId: 'self-care-1',
  })

  assert.deepEqual(
    dates(
      rule({
        intervalUnit: 'week',
        intervalValue: 4,
        repeatKind: 'after_completion',
        startDate: '2026-06-01',
      }),
      { completions: [completion], from: '2026-07-01', to: '2026-07-31' },
    ),
    ['2026-07-05'],
  )
})

void test('getFlexibleGoalProgress counts supportive completion statuses in period', () => {
  const progress = getFlexibleGoalProgress({
    completions: [
      selfCareCompletion({
        completedAt: '2026-06-02T10:00:00.000Z',
        status: 'done',
      }),
      selfCareCompletion({
        completedAt: '2026-06-03T10:00:00.000Z',
        status: 'alternative_done',
      }),
      selfCareCompletion({
        completedAt: '2026-06-04T10:00:00.000Z',
        status: 'skipped',
      }),
      selfCareCompletion({
        completedAt: '2026-06-09T10:00:00.000Z',
        status: 'done',
      }),
    ],
    itemId: 'self-care-1',
    periodEnd: '2026-06-07',
    periodStart: '2026-06-01',
    targetCount: 3,
  })

  assert.deepEqual(progress, {
    completedCount: 2,
    periodEnd: '2026-06-07',
    periodStart: '2026-06-01',
    remainingCount: 1,
    targetCount: 3,
  })
})

void test('buildDashboardResponse keeps only base flexible goals in gentle mode', () => {
  const date = '2026-06-06'
  const baseGoal = selfCareItem({
    category: 'daily_base',
    id: 'base-goal',
    title: 'Врач',
    type: 'flexible_goal',
  })
  const gentleGoal = selfCareItem({
    category: 'relax',
    id: 'gentle-goal',
    importance: 'gentle',
    title: 'Релакс',
    type: 'flexible_goal',
  })

  const response = buildDashboardResponse({
    date,
    state: {
      alternatives: [],
      appointmentDetails: [],
      completions: [],
      courseDetails: [],
      dailyStates: [],
      items: [baseGoal, gentleGoal],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [],
      procedureDetails: [],
      scheduleRules: [
        rule({
          flexiblePeriod: 'week',
          flexibleTargetCount: 1,
          id: 'base-rule',
          itemId: baseGoal.id,
          repeatKind: 'flexible_goal',
        }),
        rule({
          flexiblePeriod: 'week',
          flexibleTargetCount: 1,
          id: 'gentle-rule',
          itemId: gentleGoal.id,
          repeatKind: 'flexible_goal',
        }),
      ],
      settings: {
        ...createDefaultSelfCareSettings({ userId: 'user-1' }),
        gentleModeDate: date,
        gentleModeEnabledToday: true,
      },
      stepCompletions: [],
      steps: [],
      templates: [],
    },
  })

  assert.deepEqual(
    response.flexibleGoals.map((entry) => entry.item.id),
    ['base-goal'],
  )
})

void test('buildAnalyticsResponse keeps only visible unique flexible goals', () => {
  const activeGoal = selfCareItem({
    id: 'active-goal',
    title: 'Прогулка',
    type: 'flexible_goal',
  })
  const archivedGoal = selfCareItem({
    id: 'archived-goal',
    isActive: false,
    isArchived: true,
    title: 'Йога',
    type: 'flexible_goal',
  })
  const deletedGoal = selfCareItem({
    deletedAt: NOW,
    id: 'deleted-goal',
    isActive: false,
    isArchived: true,
    title: 'Релакс',
    type: 'flexible_goal',
  })

  const response = buildAnalyticsResponse({
    from: '2026-06-01',
    to: '2026-06-07',
    state: {
      alternatives: [],
      appointmentDetails: [],
      completions: [],
      courseDetails: [],
      dailyStates: [],
      items: [activeGoal, archivedGoal, deletedGoal],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [],
      procedureDetails: [],
      scheduleRules: [
        rule({
          flexiblePeriod: 'week',
          flexibleTargetCount: 5,
          id: 'active-rule-1',
          itemId: activeGoal.id,
          repeatKind: 'flexible_goal',
        }),
        rule({
          flexiblePeriod: 'week',
          flexibleTargetCount: 5,
          id: 'active-rule-2',
          itemId: activeGoal.id,
          repeatKind: 'flexible_goal',
        }),
        rule({
          flexiblePeriod: 'week',
          flexibleTargetCount: 3,
          id: 'archived-rule',
          itemId: archivedGoal.id,
          repeatKind: 'flexible_goal',
        }),
        rule({
          flexiblePeriod: 'week',
          flexibleTargetCount: 2,
          id: 'deleted-rule',
          itemId: deletedGoal.id,
          repeatKind: 'flexible_goal',
        }),
      ],
      settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
      stepCompletions: [],
      steps: [],
      templates: [],
    },
  })

  assert.deepEqual(
    response.flexibleGoals.map((entry) => entry.item.id),
    ['active-goal'],
  )
})

void test('buildAnalyticsResponse groups procedure costs by completion month', () => {
  const procedure = selfCareItem({
    category: 'beauty',
    id: 'procedure-1',
    title: 'Массаж',
    type: 'procedure',
  })

  const response = buildAnalyticsResponse({
    from: '2026-05-01',
    to: '2026-06-30',
    state: selfCareState({
      completions: [
        selfCareCompletion({
          completedAt: '2026-05-20T12:00:00.000Z',
          id: 'procedure-completion-1',
          itemId: procedure.id,
        }),
        selfCareCompletion({
          completedAt: '2026-06-10T12:00:00.000Z',
          id: 'procedure-completion-2',
          itemId: procedure.id,
        }),
        selfCareCompletion({
          completedAt: '2026-06-12T12:00:00.000Z',
          id: 'procedure-skipped',
          itemId: procedure.id,
          status: 'skipped',
        }),
      ],
      items: [procedure],
      procedureDetails: [
        procedureDetails({
          defaultPrice: 2500,
          itemId: procedure.id,
        }),
      ],
    }),
  })

  assert.equal(response.procedureCosts, 5000)
  assert.deepEqual(response.procedureCostsByMonth, {
    '2026-05': 2500,
    '2026-06': 2500,
  })
})

void test('buildAnalyticsResponse returns measurement trends by item', () => {
  const measurement = selfCareItem({
    category: 'health',
    id: 'weight-1',
    title: 'Вес',
    type: 'measurement',
  })

  const response = buildAnalyticsResponse({
    from: '2026-06-01',
    to: '2026-06-30',
    state: selfCareState({
      completions: [
        selfCareCompletion({
          completedAt: '2026-06-10T08:00:00.000Z',
          id: 'weight-completion-2',
          itemId: measurement.id,
          measurementUnit: 'кг',
          measurementValue: 79.4,
        }),
        selfCareCompletion({
          completedAt: '2026-06-02T08:00:00.000Z',
          id: 'weight-completion-1',
          itemId: measurement.id,
          measurementUnit: 'кг',
          measurementValue: 80.1,
        }),
        selfCareCompletion({
          completedAt: '2026-06-12T08:00:00.000Z',
          id: 'weight-skipped',
          itemId: measurement.id,
          measurementUnit: 'кг',
          measurementValue: 79.2,
          status: 'skipped',
        }),
      ],
      items: [measurement],
      measurementDetails: [
        measurementDetails({
          itemId: measurement.id,
          unit: 'кг',
          valueLabel: 'Вес',
        }),
      ],
    }),
  })

  assert.deepEqual(response.measurementTrends, [
    {
      itemId: measurement.id,
      points: [
        {
          completedAt: '2026-06-02T08:00:00.000Z',
          date: '2026-06-02',
          value: 80.1,
        },
        {
          completedAt: '2026-06-10T08:00:00.000Z',
          date: '2026-06-10',
          value: 79.4,
        },
      ],
      title: 'Вес',
      unit: 'кг',
      valueLabel: 'Вес',
    },
  ])
})

void test('buildDashboardResponse removes planning hints after item is scheduled', () => {
  const date = '2026-06-06'
  const item = selfCareItem({
    category: 'beauty',
    id: 'procedure-1',
    title: 'Стрижка',
    type: 'procedure',
  })
  const scheduleRule = rule({
    id: 'procedure-rule',
    intervalUnit: 'week',
    intervalValue: 4,
    itemId: item.id,
    repeatKind: 'after_completion',
  })

  const response = buildDashboardResponse({
    date,
    state: {
      alternatives: [],
      appointmentDetails: [],
      completions: [],
      courseDetails: [],
      dailyStates: [],
      items: [item],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [
        selfCareOccurrence({
          itemId: item.id,
          scheduledFor: '2026-06-12',
          scheduleRuleId: scheduleRule.id,
        }),
      ],
      procedureDetails: [],
      scheduleRules: [scheduleRule],
      settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
      stepCompletions: [],
      steps: [],
      templates: [],
    },
  })

  assert.deepEqual(response.planningHints, [])
})

void test('buildDashboardResponse carries overdue planned care without planning duplicate', () => {
  const date = '2026-06-09'
  const item = selfCareItem({
    category: 'beauty',
    id: 'procedure-1',
    title: 'Стрижка',
    type: 'procedure',
  })
  const scheduleRule = rule({
    id: 'procedure-rule',
    intervalUnit: 'week',
    intervalValue: 4,
    itemId: item.id,
    repeatKind: 'after_completion',
  })

  const response = buildDashboardResponse({
    date,
    state: {
      alternatives: [],
      appointmentDetails: [],
      completions: [],
      courseDetails: [],
      dailyStates: [],
      items: [item],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [
        selfCareOccurrence({
          id: 'overdue-visit',
          itemId: item.id,
          scheduledFor: '2026-06-08',
          scheduleRuleId: scheduleRule.id,
        }),
      ],
      procedureDetails: [],
      scheduleRules: [scheduleRule],
      settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
      stepCompletions: [],
      steps: [],
      templates: [],
    },
  })

  assert.deepEqual(
    response.overdueItems.map((entry) => entry.occurrence?.id),
    ['overdue-visit'],
  )
  assert.deepEqual(response.planningHints, [])
})

void test('buildDashboardResponse does not carry daily routine leftovers as overdue plan', () => {
  const date = '2026-06-09'
  const item = selfCareItem({
    id: 'daily-care',
    title: 'Вода',
    type: 'habit',
  })
  const scheduleRule = rule({
    id: 'daily-rule',
    itemId: item.id,
    repeatKind: 'daily',
  })

  const response = buildDashboardResponse({
    date,
    state: {
      alternatives: [],
      appointmentDetails: [],
      completions: [],
      courseDetails: [],
      dailyStates: [],
      items: [item],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [
        selfCareOccurrence({
          id: 'yesterday-water',
          itemId: item.id,
          scheduledFor: '2026-06-08',
          scheduleRuleId: scheduleRule.id,
        }),
      ],
      procedureDetails: [],
      scheduleRules: [scheduleRule],
      settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
      stepCompletions: [],
      steps: [],
      templates: [],
    },
  })

  assert.deepEqual(response.overdueItems, [])
})

void test('buildTodayItem prefers details of the scheduled occurrence', () => {
  const item = selfCareItem({
    category: 'beauty',
    id: 'procedure-1',
    title: 'Стрижка',
    type: 'procedure',
  })
  const occurrence = selfCareOccurrence({
    dueAt: '2026-06-12T11:30:00.000Z',
    id: 'occurrence-visit',
    itemId: item.id,
    scheduledFor: '2026-06-12',
  })

  const entry = buildTodayItem({
    date: '2026-06-12',
    item,
    occurrence,
    state: {
      alternatives: [],
      appointmentDetails: [
        appointmentDetails({
          id: 'base-details',
          itemId: item.id,
          occurrenceId: null,
          place: 'Старое место',
          price: 1000,
          specialistName: 'Старый мастер',
          startsAt: '2026-05-01T10:00:00.000Z',
        }),
        appointmentDetails({
          id: 'scheduled-details',
          itemId: item.id,
          occurrenceId: occurrence.id,
          place: 'Салон Лето',
          price: 2500,
          specialistName: 'Анна',
          startsAt: '2026-06-12T11:30:00.000Z',
        }),
      ],
      completions: [],
      courseDetails: [],
      dailyStates: [],
      items: [item],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [occurrence],
      procedureDetails: [],
      scheduleRules: [],
      settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
      stepCompletions: [],
      steps: [],
      templates: [],
    },
  })

  assert.equal(entry.appointment?.occurrenceId, occurrence.id)
  assert.equal(entry.appointment?.place, 'Салон Лето')
  assert.equal(entry.appointment?.specialistName, 'Анна')
  assert.equal(entry.appointment?.price, 2500)
})

void test('buildTodayItem ignores stale completion after occurrence is scheduled again', () => {
  const occurrence = selfCareOccurrence({
    id: 'rescheduled-occurrence',
    status: 'scheduled',
  })

  const entry = buildTodayItem({
    date: occurrence.scheduledFor,
    item: selfCareItem(),
    occurrence,
    state: {
      alternatives: [],
      appointmentDetails: [],
      completions: [
        selfCareCompletion({
          occurrenceId: occurrence.id,
          status: 'skipped',
        }),
      ],
      courseDetails: [],
      dailyStates: [],
      items: [selfCareItem()],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [occurrence],
      procedureDetails: [],
      scheduleRules: [],
      settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
      stepCompletions: [],
      steps: [],
      templates: [],
    },
  })

  assert.equal(entry.occurrence?.status, 'scheduled')
  assert.equal(entry.completion, null)
})

void test('buildTodayItem includes course details for course progress', () => {
  const item = selfCareItem({
    id: 'course-1',
    title: 'Витамины',
    type: 'course',
  })
  const details = courseDetails({
    completedCount: 7,
    itemId: item.id,
    totalCount: 30,
  })

  const entry = buildTodayItem({
    date: '2026-06-10',
    item,
    occurrence: null,
    state: {
      alternatives: [],
      appointmentDetails: [],
      completions: [],
      courseDetails: [details],
      dailyStates: [],
      items: [item],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [],
      procedureDetails: [],
      scheduleRules: [],
      settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
      stepCompletions: [],
      steps: [],
      templates: [],
    },
  })

  assert.equal(entry.courseDetails?.completedCount, 7)
  assert.equal(entry.courseDetails?.totalCount, 30)
})

void test('buildPlanResponse omits archived courses', () => {
  const activeCourse = selfCareItem({
    category: 'health',
    id: 'active-course',
    title: 'Витамины',
    type: 'course',
  })
  const archivedCourse = selfCareItem({
    category: 'health',
    id: 'archived-course',
    isActive: false,
    isArchived: true,
    title: 'Старые витамины',
    type: 'course',
  })

  const response = buildPlanResponse({
    from: '2026-06-01',
    state: {
      alternatives: [],
      appointmentDetails: [],
      completions: [],
      courseDetails: [
        courseDetails({
          id: 'active-course-details',
          itemId: activeCourse.id,
        }),
        courseDetails({
          id: 'archived-course-details',
          itemId: archivedCourse.id,
        }),
      ],
      dailyStates: [],
      items: [activeCourse, archivedCourse],
      medicalDetails: [],
      minimumItems: [],
      occurrences: [],
      procedureDetails: [],
      scheduleRules: [],
      settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
      stepCompletions: [],
      steps: [],
      templates: [],
    },
    to: '2026-06-30',
  })

  assert.deepEqual(
    response.courses.map((entry) => entry.item.id),
    ['active-course'],
  )
})

void test('generateSelfCareOccurrenceDates supports course schedules', () => {
  assert.deepEqual(
    dates(
      rule({
        daysOfWeek: [1, 3],
        repeatKind: 'course',
        startDate: '2026-06-01',
      }),
      { from: '2026-06-01', to: '2026-06-10' },
    ),
    ['2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10'],
  )
})

void test('generateSelfCareOccurrenceDates keeps date-only recurrence stable across DST', () => {
  assert.deepEqual(
    dates(
      rule({
        daysOfWeek: [7],
        repeatKind: 'weekly',
        startDate: '2026-03-01',
        timezone: 'America/New_York',
      }),
      { from: '2026-03-01', to: '2026-03-22' },
    ),
    ['2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22'],
  )
})

void test('mapHabitToSelfCareInput keeps old habits as regular self-care', () => {
  const input = mapHabitToSelfCareInput({
    ...BASE_HABIT,
    daysOfWeek: [1, 3, 5],
    frequency: 'weekly',
    reminderTime: '08:30',
    targetType: 'duration',
    targetValue: 20,
  })

  assert.equal(input.type, 'habit')
  assert.equal(input.category, 'daily_base')
  assert.equal(input.importance, 'recommended')
  assert.equal(input.isPrivate, true)
  assert.equal(input.migratedFromHabitId, BASE_HABIT.id)
  assert.equal(input.defaultDurationMinutes, 20)
  assert.equal(input.preferredTimeOfDay, 'morning')
  assert.deepEqual(input.scheduleRule, {
    allowMultiplePerDay: false,
    dayOfMonth: null,
    daysOfWeek: [1, 3, 5],
    endDate: null,
    flexiblePeriod: null,
    flexibleTargetCount: null,
    generateInCalendar: false,
    generateInTaskList: true,
    intervalUnit: null,
    intervalValue: null,
    monthOfYear: null,
    preferredTime: '08:30',
    reminderOffsetsMinutes: [],
    repeatKind: 'weekly',
    startDate: BASE_HABIT.startDate,
    timezone: null,
    weekOfMonth: null,
  })
})

void test('mapHabitToSelfCareInput preserves old habit daily target as flexible progress', () => {
  const input = mapHabitToSelfCareInput({
    ...BASE_HABIT,
    daysOfWeek: [1, 3, 5],
    frequency: 'weekly',
    reminderTime: '08:30',
    targetType: 'count',
    targetValue: 3,
    unit: 'раза',
  })

  assert.equal(input.type, 'habit')
  assert.equal(input.migratedFromHabitId, BASE_HABIT.id)
  assert.equal(input.preferredTimeOfDay, 'morning')
  assert.deepEqual(input.scheduleRule, {
    allowMultiplePerDay: false,
    dayOfMonth: null,
    daysOfWeek: [1, 3, 5],
    endDate: null,
    flexiblePeriod: 'day',
    flexibleTargetCount: 3,
    generateInCalendar: false,
    generateInTaskList: true,
    intervalUnit: null,
    intervalValue: null,
    monthOfYear: null,
    preferredTime: '08:30',
    reminderOffsetsMinutes: [],
    repeatKind: 'flexible_goal',
    startDate: BASE_HABIT.startDate,
    timezone: null,
    weekOfMonth: null,
  })
})

void test('mapHabitEntryToSelfCareCompletion preserves old habit history', () => {
  const completion = mapHabitEntryToSelfCareCompletion({
    entry: habitEntry({ status: 'skipped' }),
    item: {
      id: 'self-care-1',
      userId: BASE_HABIT.userId,
    } as never,
  })

  assert.equal(completion.itemId, 'self-care-1')
  assert.equal(completion.userId, BASE_HABIT.userId)
  assert.equal(completion.status, 'skipped')
  assert.equal(completion.completedAt, '2026-06-03T12:00:00.000Z')
  assert.equal(completion.scheduledFor, '2026-06-03')
  assert.equal(completion.note, 'без сил')
})

void test('shouldDeduplicateSelfCareItemCompletion allows repeated flexible-goal clicks for migrated habits', () => {
  assert.equal(
    shouldDeduplicateSelfCareItemCompletion({
      item: selfCareItem({ type: 'habit' }),
      scheduleRule: rule({
        flexiblePeriod: 'day',
        flexibleTargetCount: 3,
        repeatKind: 'flexible_goal',
      }),
    }),
    false,
  )
  assert.equal(
    shouldDeduplicateSelfCareItemCompletion({
      item: selfCareItem({ type: 'habit' }),
      scheduleRule: rule({ repeatKind: 'daily' }),
    }),
    true,
  )
})

function dates(
  recurrenceRule: SelfCareScheduleRule,
  input: {
    completions?: SelfCareCompletion[]
    from: string
    to: string
  },
): string[] {
  return generateSelfCareOccurrenceDates({
    completions: input.completions ?? [],
    from: input.from,
    item: {
      createdAt: `${recurrenceRule.startDate ?? '2026-06-01'}T00:00:00.000Z`,
      type: 'ritual',
    },
    rule: recurrenceRule,
    to: input.to,
  })
}

function selfCareState(
  overrides: Partial<SelfCareStateSnapshot> = {},
): SelfCareStateSnapshot {
  return {
    alternatives: [],
    appointmentDetails: [],
    completions: [],
    courseDetails: [],
    dailyStates: [],
    items: [],
    medicalDetails: [],
    measurementDetails: [],
    minimumItems: [],
    occurrences: [],
    procedureDetails: [],
    scheduleRules: [],
    settings: createDefaultSelfCareSettings({ userId: 'user-1' }),
    stepCompletions: [],
    steps: [],
    templates: [],
    ...overrides,
  }
}

function rule(overrides: Partial<SelfCareScheduleRule>): SelfCareScheduleRule {
  return {
    allowMultiplePerDay: false,
    createdAt: NOW,
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
    itemId: 'self-care-1',
    monthOfYear: null,
    preferredTime: null,
    reminderOffsetsMinutes: [],
    repeatKind: 'daily',
    startDate: '2026-06-01',
    timezone: null,
    updatedAt: NOW,
    weekOfMonth: null,
    ...overrides,
  }
}

function selfCareCompletion(
  overrides: Partial<SelfCareCompletion> = {},
): SelfCareCompletion {
  return {
    alternativeTitle: null,
    completedAt: '2026-06-02T12:00:00.000Z',
    completedVariant: 'full',
    createdAt: NOW,
    durationMinutes: null,
    energyAfter: null,
    energyBefore: null,
    id: 'completion-1',
    itemId: 'self-care-1',
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

function selfCareOccurrence(
  overrides: Partial<SelfCareOccurrence> = {},
): SelfCareOccurrence {
  return {
    completedAt: null,
    createdAt: NOW,
    dueAt: null,
    generatedAt: NOW,
    id: 'occurrence-1',
    itemId: 'self-care-1',
    movedTo: null,
    scheduledFor: '2026-06-02',
    scheduleRuleId: 'rule-1',
    status: 'scheduled',
    updatedAt: NOW,
    userId: 'user-1',
    ...overrides,
  }
}

function appointmentDetails(
  overrides: Partial<SelfCareAppointmentDetails> = {},
): SelfCareAppointmentDetails {
  return {
    createdAt: NOW,
    currency: 'RUB',
    endsAt: null,
    id: 'appointment-details-1',
    itemId: 'self-care-1',
    occurrenceId: null,
    place: null,
    preparationNote: null,
    price: null,
    resultNote: null,
    specialistContact: null,
    specialistName: null,
    startsAt: '2026-06-02T10:00:00.000Z',
    updatedAt: NOW,
    ...overrides,
  }
}

function courseDetails(
  overrides: Partial<SelfCareCourseDetails> = {},
): SelfCareCourseDetails {
  return {
    completedCount: 0,
    courseType: 'days',
    createdAt: NOW,
    endDate: null,
    id: 'course-details-1',
    isCompleted: false,
    isPaused: false,
    itemId: 'self-care-1',
    startDate: '2026-06-01',
    totalCount: 30,
    updatedAt: NOW,
    ...overrides,
  }
}

function procedureDetails(
  overrides: Partial<SelfCareProcedureDetails> = {},
): SelfCareProcedureDetails {
  return {
    contact: null,
    createdAt: NOW,
    currency: 'RUB',
    defaultPrice: null,
    id: 'procedure-details-1',
    itemId: 'self-care-1',
    place: null,
    specialistName: null,
    updatedAt: NOW,
    ...overrides,
  }
}

function measurementDetails(
  overrides: Partial<SelfCareMeasurementDetails> = {},
): SelfCareMeasurementDetails {
  return {
    createdAt: NOW,
    id: 'measurement-details-1',
    itemId: 'self-care-1',
    targetMax: null,
    targetMin: null,
    unit: '',
    updatedAt: NOW,
    valueLabel: 'Значение',
    ...overrides,
  }
}

function selfCareItem(overrides: Partial<SelfCareItem> = {}): SelfCareItem {
  return {
    category: 'daily_base',
    color: null,
    createdAt: NOW,
    createdFromTemplateId: null,
    customCategoryId: null,
    defaultDurationMinutes: null,
    deletedAt: null,
    description: '',
    icon: null,
    id: 'self-care-1',
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
    type: 'task',
    updatedAt: NOW,
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

const BASE_HABIT: HabitRecord = {
  color: '#214e42',
  createdAt: '2026-05-01T00:00:00.000Z',
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  deletedAt: null,
  description: 'мягкое движение',
  endDate: null,
  frequency: 'daily',
  icon: 'sparkle',
  id: 'habit-1',
  isActive: true,
  reminderTime: null,
  sortOrder: 0,
  sphereId: null,
  startDate: '2026-05-05',
  targetType: 'check',
  targetValue: 1,
  title: 'Йога',
  unit: '',
  updatedAt: '2026-05-01T00:00:00.000Z',
  userId: 'user-1',
  version: 1,
  workspaceId: 'workspace-1',
}

function habitEntry(
  overrides: Partial<HabitEntryRecord> = {},
): HabitEntryRecord {
  return {
    createdAt: '2026-06-03T11:00:00.000Z',
    date: '2026-06-03',
    deletedAt: null,
    habitId: BASE_HABIT.id,
    id: 'entry-1',
    note: 'без сил',
    status: 'done',
    updatedAt: '2026-06-03T11:00:00.000Z',
    userId: BASE_HABIT.userId,
    value: 1,
    version: 1,
    workspaceId: BASE_HABIT.workspaceId,
    ...overrides,
  }
}
