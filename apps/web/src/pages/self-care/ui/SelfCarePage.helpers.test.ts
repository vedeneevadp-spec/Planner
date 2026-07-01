import type {
  SelfCareCompletion,
  SelfCareItem,
  SelfCareListResponse,
  SelfCareRitualStepDraftListResponse,
  SelfCareScheduleRule,
  SelfCareTemplate,
  SelfCareTodayItem,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  applyRitualStepDraftOverrides,
  buildCompletionInput,
  buildCreateScheduleRule,
  buildDateTimeInput,
  buildRestartCourseScheduleRule,
  buildRitualStepCompletionInput,
  buildRitualStepDraftInput,
  buildRitualStepDraftMap,
  buildVisibleCategoryDistribution,
  canRestartCourse,
  firstErrorMessage,
  formatCompletionMeasurementHistoryValue,
  formatCompletionState,
  formatCourseCompletionState,
  formatDate,
  formatEntryDetails,
  formatExercisePlan,
  formatExerciseSetsSummary,
  formatExerciseValue,
  formatMeasurementDelta,
  formatMeasurementSummary,
  formatMeasurementTarget,
  formatMeasurementValue,
  formatMoney,
  formatMonthKey,
  formatOptionalNumber,
  formatPlanningText,
  formatSchedule,
  formatShortDate,
  formatStateCompletionSummary,
  formatStateSummary,
  formatTime,
  formatTomorrowPlanSummary,
  getAddCareFilterCategories,
  getAddCareFilterLabel,
  getCourseProgress,
  getCourseUnitLabel,
  getCreatedTemplateIds,
  getDefaultFlexibleGoalIntervalUnit,
  getExactScheduleDateLabel,
  getExactScheduleTimeLabel,
  getInitialEditRepeatMode,
  getInitialExerciseValue,
  getInitialMeasurementValue,
  getInitialRitualStepDraft,
  getInitialScheduleDate,
  getInitialScheduleTime,
  getPrimaryActionLabel,
  getSelfCareCreateDialogMode,
  getSelfCareTab,
  getSelfCareTodayCardActionOrder,
  getTemplateTypeLabel,
  getTodayScheduleLabel,
  getTypeLabel,
  getVisibleRepeatKind,
  getVisibleSelfCareCategory,
  groupItemsByCategory,
  groupTodayItems,
  hasStateCompletionValues,
  isValidMeasurementTargetRange,
  isVisibleSelfCareTemplate,
  normalizeOptionalText,
  parseBoundedInteger,
  parseMultilineTitles,
  parseNonnegativeInteger,
  parseOptionalMeasurementNumber,
  parseOptionalPrice,
  parsePositiveInteger,
  parseRequiredMeasurementNumber,
  pluralizeRu,
  pluralRu,
  repeatKindRequiresInterval,
  shouldShowSelfCareSkipAction,
  shouldShowVisitDetails,
  shouldUseExactSchedule,
  toggleWeekday,
} from './SelfCarePage.helpers'

describe('SelfCarePage helpers', () => {
  it('shows skip only for overdue planned occurrences', () => {
    const plannedEntry = createTodayEntry({ occurrence: createOccurrence() })
    const adHocEntry = createTodayEntry({ occurrence: null })

    expect(shouldShowSelfCareSkipAction(plannedEntry, 'overdue')).toBe(true)
    expect(shouldShowSelfCareSkipAction(plannedEntry, 'today')).toBe(false)
    expect(shouldShowSelfCareSkipAction(adHocEntry, 'overdue')).toBe(false)
  })

  it('keeps icon actions before text actions on today cards', () => {
    expect(
      getSelfCareTodayCardActionOrder({
        hasRestartAction: false,
        hasScheduleAction: true,
        hasSkipAction: true,
      }),
    ).toEqual(['complete', 'edit', 'archive', 'skip', 'schedule'])

    expect(
      getSelfCareTodayCardActionOrder({
        hasRestartAction: true,
        hasScheduleAction: false,
        hasSkipAction: false,
      }),
    ).toEqual(['edit', 'archive', 'restart'])
  })

  it('builds create schedule rules only with fields used by the selected cadence', () => {
    expect(
      buildCreateScheduleRule({
        dayOfMonth: 31,
        daysOfWeek: [1, 3],
        flexiblePeriod: 'week',
        flexibleTargetCount: 3,
        intervalUnit: 'week',
        intervalValue: 2,
        monthOfYear: 6,
        repeatKind: 'weekly',
        startDate: '2026-06-22',
      }),
    ).toMatchObject({
      dayOfMonth: null,
      daysOfWeek: [1, 3],
      intervalUnit: null,
      intervalValue: null,
      repeatKind: 'weekly',
      startDate: '2026-06-22',
    })

    expect(
      buildCreateScheduleRule({
        courseScheduleMode: 'interval',
        dayOfMonth: 22,
        daysOfWeek: [2],
        flexiblePeriod: 'month',
        flexibleTargetCount: 5,
        intervalUnit: 'day',
        intervalValue: 3,
        monthOfYear: 6,
        repeatKind: 'course',
        startDate: '2026-06-22',
      }),
    ).toMatchObject({
      daysOfWeek: [],
      intervalUnit: 'day',
      intervalValue: 3,
      repeatKind: 'course',
    })

    expect(
      buildCreateScheduleRule({
        dayOfMonth: 1,
        daysOfWeek: [],
        flexiblePeriod: 'month',
        flexibleTargetCount: 8,
        intervalUnit: 'week',
        intervalValue: 1,
        monthOfYear: 1,
        repeatKind: 'flexible_goal',
        startDate: '2026-06-22',
      }),
    ).toMatchObject({
      flexiblePeriod: 'month',
      flexibleTargetCount: 8,
      intervalUnit: null,
      intervalValue: null,
      repeatKind: 'flexible_goal',
    })

    expect(
      buildCreateScheduleRule({
        dayOfMonth: 1,
        daysOfWeek: [1],
        flexiblePeriod: 'day',
        flexibleTargetCount: 1,
        hasFlexibleGoal: true,
        intervalUnit: 'day',
        intervalValue: 3,
        monthOfYear: 1,
        repeatKind: 'interval',
        startDate: '2026-06-22',
      }),
    ).toMatchObject({
      daysOfWeek: [],
      flexiblePeriod: 'day',
      flexibleTargetCount: 1,
      intervalUnit: 'day',
      intervalValue: 3,
      repeatKind: 'interval',
    })
  })

  it('keeps numeric parsing and weekday toggles deterministic', () => {
    expect(normalizeOptionalText('  hello  ')).toBe('hello')
    expect(normalizeOptionalText('   ')).toBeNull()
    expect(parseOptionalPrice('12,5')).toBe(12.5)
    expect(parseOptionalPrice('-1')).toBeNull()
    expect(parseOptionalMeasurementNumber('-2,25')).toBe(-2.25)
    expect(parseRequiredMeasurementNumber('')).toBeNull()
    expect(parseRequiredMeasurementNumber('36,6')).toBe(36.6)
    expect(parsePositiveInteger('3')).toBe(3)
    expect(parsePositiveInteger('3.5')).toBeNull()
    expect(parseNonnegativeInteger('0')).toBe(0)
    expect(parseNonnegativeInteger('-1')).toBeNull()
    expect(parseBoundedInteger('13', 1, 12)).toBeNull()
    expect(isValidMeasurementTargetRange(10, 9)).toBe(false)
    expect(parseMultilineTitles(' Умыться \n\n Крем ')).toEqual([
      'Умыться',
      'Крем',
    ])
    expect(toggleWeekday([1, 3], 2)).toEqual([1, 2, 3])
    expect(toggleWeekday([1, 2, 3], 2)).toEqual([1, 3])
    expect(formatOptionalNumber(null)).toBe('')
    expect(formatOptionalNumber(12)).toBe('12')
  })

  it('groups categories through the visible self-care taxonomy', () => {
    const archived = createItem({
      category: 'movement',
      id: 'archived',
      isArchived: true,
    })
    const list = createList({
      items: [
        createItem({ category: 'medical', id: 'medical' }),
        createItem({ category: 'nutrition', id: 'nutrition' }),
        createItem({ category: 'sleep', id: 'sleep' }),
        archived,
      ],
    })

    expect(groupItemsByCategory(list).health.map((item) => item.id)).toEqual([
      'medical',
      'nutrition',
    ])
    expect(groupItemsByCategory(list).relax.map((item) => item.id)).toEqual([
      'sleep',
    ])
    expect(buildVisibleCategoryDistribution({ medical: 2, sleep: 1 })).toEqual([
      ['health', 2],
      ['relax', 1],
    ])
    expect(getAddCareFilterCategories('health')).toEqual([
      'health',
      'medical',
      'nutrition',
    ])
    expect(getAddCareFilterLabel('movement')).toBe('Движение')
    expect(getVisibleSelfCareCategory('body')).toBe('body')
    expect(getVisibleSelfCareCategory('emotional')).toBe('custom')
  })

  it('builds ritual draft keys, optimistic overrides, and completion inputs', () => {
    const entry = createTodayEntry({
      item: createItem({ defaultDurationMinutes: 20, id: 'ritual-1' }),
      occurrence: createOccurrence({ id: 'occurrence-1', itemId: 'ritual-1' }),
      steps: [
        createStep({ id: 'step-1', itemId: 'ritual-1' }),
        createStep({ id: 'step-2', itemId: 'ritual-1' }),
      ],
    })
    const response: SelfCareRitualStepDraftListResponse = {
      date: '2026-06-22',
      drafts: [
        {
          date: '2026-06-22',
          itemId: 'ritual-1',
          occurrenceId: 'occurrence-1',
          stepIds: ['step-1'],
        },
      ],
    }
    const drafts = buildRitualStepDraftMap(response)
    const nextDrafts = applyRitualStepDraftOverrides(drafts, {
      '2026-06-22:ritual-1:occurrence-1': ['step-2'],
    })

    expect(buildCompletionInput(entry)).toMatchObject({
      durationMinutes: 20,
      status: 'done',
    })
    expect(buildRitualStepCompletionInput(entry, ['step-2'])).toEqual([
      { isDone: false, stepId: 'step-1' },
      { isDone: true, stepId: 'step-2' },
    ])
    expect(buildRitualStepCompletionInput(entry, undefined)).toEqual([
      { isDone: true, stepId: 'step-1' },
      { isDone: true, stepId: 'step-2' },
    ])
    expect(getInitialRitualStepDraft(entry)).toEqual([])
    expect(buildRitualStepDraftInput(entry, '2026-06-22', ['step-2'])).toEqual({
      date: '2026-06-22',
      itemId: 'ritual-1',
      occurrenceId: 'occurrence-1',
      stepIds: ['step-2'],
    })
    expect(nextDrafts['2026-06-22:ritual-1:occurrence-1']).toEqual(['step-2'])
    expect(
      applyRitualStepDraftOverrides(nextDrafts, {
        '2026-06-22:ritual-1:occurrence-1': null,
      })['2026-06-22:ritual-1:occurrence-1'],
    ).toBeUndefined()
  })

  it('formats schedule, measurements, courses, and tomorrow summary labels', () => {
    const measurementEntry = createTodayEntry({
      completion: createCompletion({
        completedAt: '2026-06-22T08:00:00.000Z',
        measurementUnit: 'кг',
        measurementValue: 62.5,
      }),
      item: createItem({ type: 'measurement' }),
      measurement: createMeasurementDetails({
        targetMax: 65,
        targetMin: 60,
        unit: 'кг',
        valueLabel: 'Вес',
      }),
    })
    const courseEntry = createTodayEntry({
      completion: createCompletion({ completedAt: '2026-06-22T08:00:00.000Z' }),
      courseDetails: createCourseDetails({
        completedCount: 2,
        courseType: 'sessions',
        totalCount: 5,
      }),
      item: createItem({ type: 'course' }),
    })

    expect(
      formatSchedule(
        createScheduleRule({
          daysOfWeek: [1, 2, 3, 4, 5],
          repeatKind: 'weekly',
        }),
      ),
    ).toBe('по будням')
    expect(formatSchedule(null)).toBe('по необходимости')
    expect(
      formatSchedule(
        createScheduleRule({
          daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
          repeatKind: 'weekly',
        }),
      ),
    ).toBe('каждый день')
    expect(
      formatSchedule(
        createScheduleRule({
          intervalUnit: 'month',
          intervalValue: 2,
          repeatKind: 'after_completion',
        }),
      ),
    ).toBe('каждые 2 мес.')
    expect(
      formatSchedule(
        createScheduleRule({
          flexiblePeriod: 'day',
          flexibleTargetCount: 2,
          repeatKind: 'flexible_goal',
        }),
      ),
    ).toBe('2 раза за день · каждый день')
    expect(formatMeasurementSummary(measurementEntry)).toContain('Вес: 62,5 кг')
    expect(formatMeasurementTarget(measurementEntry)).toBe(
      'Норма: 60 кг – 65 кг',
    )
    expect(formatMeasurementDelta(1.5, 'кг')).toBe('+1,5 кг')
    expect(formatMeasurementDelta(0, 'кг')).toBe('без изменений')
    expect(formatMeasurementValue(1000.5, null)).toBe('1 000,5')
    expect(formatExerciseValue(28, 'reps')).toBe('28 раз')
    expect(formatExerciseValue(5, 'min')).toBe('5 мин')
    expect(
      formatExerciseSetsSummary(
        createCompletion({ exerciseSets: [{ index: 1, value: 10 }] }),
      ),
    ).toBe('1 подход')
    expect(
      formatExerciseSetsSummary(
        createCompletion({
          exerciseSets: [
            { index: 1, value: 10 },
            { index: 2, value: 10 },
            { index: 3, value: 8 },
            { index: 4, value: 8 },
            { index: 5, value: 6 },
          ],
        }),
      ),
    ).toBe('5 подходов')
    expect(
      formatExercisePlan(
        createTodayEntry({
          exercise: createExerciseDetails({
            plannedSets: 3,
            plannedValue: 20,
            unit: 'reps',
            useSets: true,
          }),
          item: createItem({ type: 'exercise' }),
        }),
      ),
    ).toBe('План: 20 раз · 3 подхода')
    expect(
      formatCompletionMeasurementHistoryValue(
        createCompletion({
          exerciseSets: [
            { index: 1, value: 7 },
            { index: 2, value: 6 },
            { index: 3, value: 6 },
          ],
          measurementUnit: 'reps',
          measurementValue: 19,
        }),
        createItem({ type: 'exercise' }),
      ),
    ).toBe('19 раз, 3 подхода')
    expect(
      formatCompletionMeasurementHistoryValue(
        createCompletion({
          measurementUnit: 'кг',
          measurementValue: 64.4,
        }),
        createItem({ type: 'measurement' }),
      ),
    ).toBe('64,4 кг')
    expect(formatMoney(1200, 'RUB')).toContain('1 200')
    expect(formatCourseCompletionState(courseEntry, '2026-06-22')).toBe(
      'Сессия засчитана сегодня',
    )
    expect(getCourseProgress(courseEntry.courseDetails)).toMatchObject({
      label: 'Курс: 2 из 5 сессий',
      percent: 40,
    })
    expect(formatTomorrowPlanSummary(null)).toBe('План загружается')
    expect(formatTomorrowPlanSummary(0)).toBe('Пока ничего не запланировано')
    expect(formatTomorrowPlanSummary(1)).toBe('1 ритуал запланировано')
    expect(formatTomorrowPlanSummary(2)).toBe('2 ритуала запланировано')
    expect(formatTomorrowPlanSummary(5)).toBe('5 ритуалов запланировано')
    expect(pluralizeRu(21, 'ритуал', 'ритуала', 'ритуалов')).toBe('ритуал')
    expect(pluralRu(22, 'день', 'дня', 'дней')).toBe('дня')
  })

  it('derives dashboard state from entries, templates, and schedules', () => {
    const courseEntry = createTodayEntry({
      courseDetails: createCourseDetails({ isCompleted: true }),
      item: createItem({ id: 'course-1', type: 'course' }),
      scheduleRule: createScheduleRule({
        daysOfWeek: [2, 4],
        intervalUnit: 'week',
        intervalValue: 1,
        repeatKind: 'course',
      }),
    })
    const appointmentEntry = createTodayEntry({
      appointment: createAppointmentDetails({
        startsAt: '2026-06-22T14:00:00.000Z',
      }),
      item: createItem({ id: 'appointment-1', type: 'appointment' }),
      occurrence: createOccurrence({
        dueAt: '2026-06-22T14:00:00.000Z',
        reminderTimeZone: 'Europe/Astrakhan',
        scheduledFor: '2026-06-22',
      }),
    })

    expect(groupTodayItems([appointmentEntry]).morning).toEqual([
      appointmentEntry,
    ])
    expect(
      getInitialScheduleDate(
        appointmentEntry,
        '2026-06-24',
        'Europe/Astrakhan',
      ),
    ).toBe('2026-06-22')
    expect(getInitialScheduleTime(appointmentEntry, 'Europe/Astrakhan')).toBe(
      '18:00',
    )
    expect(formatTime('2026-06-22T14:00:00.000Z', 'Europe/Astrakhan')).toBe(
      '18:00',
    )
    expect(formatDate('2026-06-22')).toContain('22')
    expect(formatShortDate('2026-06-22')).toContain('22')
    expect(formatMonthKey('2026-06')).toContain('2026')
    expect(formatTime('2026-06-22T09:15:00.000Z', 'UTC')).toBe('09:15')
    expect(buildDateTimeInput('2026-06-25', '18:00', 'Europe/Astrakhan')).toBe(
      '2026-06-25T14:00:00.000Z',
    )
    expect(buildDateTimeInput('2026-06-22', '09:15')).toBe(
      '2026-06-22T09:15:00.000Z',
    )
    expect(canRestartCourse(courseEntry)).toBe(true)
    expect(
      buildRestartCourseScheduleRule(courseEntry, '2026-06-22'),
    ).toMatchObject({
      daysOfWeek: [2, 4],
      intervalUnit: 'week',
      intervalValue: 1,
      repeatKind: 'course',
      startDate: '2026-06-22',
    })
    expect(
      getVisibleRepeatKind('course', 'daily', { courseScheduleMode: 'weekly' }),
    ).toBe('weekly')
    expect(
      getVisibleRepeatKind('task', 'monthly', { courseScheduleMode: 'daily' }),
    ).toBe('monthly')
    expect(repeatKindRequiresInterval('after_completion')).toBe(true)
    expect(
      getCreatedTemplateIds(
        createList({
          items: [
            createItem({ createdFromTemplateId: 'template-1' }),
            createItem({
              createdFromTemplateId: 'template-archived',
              isArchived: true,
            }),
          ],
        }),
      ),
    ).toEqual(new Set(['template-1']))
    expect(getTemplateTypeLabel(createTemplate({ type: 'procedure' }))).toBe(
      'запись',
    )
    expect(
      isVisibleSelfCareTemplate(createTemplate({ type: 'mood_check' })),
    ).toBe(false)
    expect(
      isVisibleSelfCareTemplate(createTemplate({ category: 'emotional' })),
    ).toBe(false)
  })

  it('parses tab and create dialog URL state', () => {
    expect(getSelfCareTab(new URLSearchParams('tab=history'))).toBe('history')
    expect(getSelfCareTab(new URLSearchParams('tab=unknown'))).toBe('today')
    expect(
      getSelfCareCreateDialogMode(
        new URLSearchParams('selfCareAction=care&selfCareActionRequest=custom'),
      ),
    ).toBe('custom')
    expect(
      getSelfCareCreateDialogMode(new URLSearchParams('selfCareAction=care')),
    ).toBe('choice')
    expect(getSelfCareCreateDialogMode(new URLSearchParams())).toBeNull()
    expect(firstErrorMessage([])).toBeNull()
    expect(firstErrorMessage([new Error('Boom')])).toContain('Boom')
    expect(
      firstErrorMessage([new Error('Skip me'), new Error('Keep me')], {
        shouldIgnore: (error) =>
          error instanceof Error && error.message === 'Skip me',
      }),
    ).toContain('Keep me')
  })

  it('formats state, completion, entry details, action labels, and planning text', () => {
    const stateEntry = createTodayEntry({
      completion: createCompletion({
        energyAfter: 4,
        moodAfter: 5,
      }),
      item: createItem({ type: 'mood_check' }),
    })
    const appointmentEntry = createTodayEntry({
      appointment: createAppointmentDetails({
        place: 'Клиника',
        price: 3200,
        specialistName: 'Врач',
      }),
      item: createItem({ type: 'appointment' }),
    })
    const procedureEntry = createTodayEntry({
      item: createItem({ type: 'procedure' }),
      procedure: createProcedureDetails({
        defaultPrice: 1500,
        place: 'Салон',
        specialistName: 'Мастер',
      }),
    })
    const flexibleEntry = createTodayEntry({
      flexibleProgress: {
        completedCount: 1,
        periodEnd: '2026-06-28',
        periodStart: '2026-06-22',
        remainingCount: 2,
        targetCount: 3,
      },
      item: createItem({ type: 'flexible_goal' }),
    })
    const plannedEntry = createTodayEntry({
      item: createItem(),
      occurrence: createOccurrence({
        dueAt: '2026-06-22T12:30:00.000Z',
        scheduledFor: '2026-06-22',
      }),
    })

    expect(formatStateCompletionSummary(stateEntry.completion)).toBe(
      'настроение 5/5 · энергия 4/5',
    )
    expect(formatStateSummary(stateEntry)).toContain('настроение 5/5')
    expect(hasStateCompletionValues(stateEntry.completion)).toBe(true)
    expect(formatCompletionState(stateEntry.completion, '2026-06-22')).toBe(
      'Выполнено сегодня',
    )
    expect(
      formatCompletionState(
        createCompletion({
          completedAt: '2026-06-20T08:00:00.000Z',
          status: 'partial',
        }),
        '2026-06-22',
      ),
    ).toContain('Частично выполнено')
    expect(formatEntryDetails(appointmentEntry)).toContain('Клиника')
    expect(formatEntryDetails(procedureEntry)).toContain('Салон')
    expect(
      getPrimaryActionLabel(createTodayEntry({ item: createItem() }), false),
    ).toBe('Выполнить')
    expect(
      getPrimaryActionLabel(
        createTodayEntry({ item: createItem({ type: 'measurement' }) }),
        false,
      ),
    ).toBe('Записать')
    expect(
      getPrimaryActionLabel(
        createTodayEntry({
          courseDetails: createCourseDetails({ isCompleted: true }),
          item: createItem({ type: 'course' }),
        }),
        false,
      ),
    ).toBe('Курс завершён')
    expect(formatPlanningText(flexibleEntry)).toContain('Осталось 2')
    expect(formatPlanningText(plannedEntry)).toContain(
      formatExpectedLocalTime('2026-06-22T12:30:00.000Z'),
    )
    expect(
      formatPlanningText(
        createTodayEntry({
          scheduleRule: createScheduleRule({ repeatKind: 'after_completion' }),
        }),
      ),
    ).toContain('Давно не обновлялось')
    expect(getCourseUnitLabel('days', 5)).toBe('дней')
  })

  it('derives labels and exact schedule affordances by item type', () => {
    expect(shouldUseExactSchedule('appointment')).toBe(true)
    expect(shouldUseExactSchedule('habit')).toBe(false)
    expect(shouldShowVisitDetails('medical')).toBe(true)
    expect(shouldShowVisitDetails('task')).toBe(false)
    expect(getExactScheduleDateLabel('measurement')).toBe('Дата измерения')
    expect(getExactScheduleTimeLabel('mood_check')).toBe('Время отметки')
    expect(
      getInitialEditRepeatMode(createScheduleRule({ repeatKind: 'daily' })),
    ).toBe('daily')
    expect(
      getInitialEditRepeatMode(createScheduleRule({ repeatKind: 'course' })),
    ).toBe('keep')
    expect(
      getInitialMeasurementValue(
        createTodayEntry({
          completion: createCompletion({ measurementValue: 36.6 }),
          item: createItem({ type: 'measurement' }),
        }),
      ),
    ).toBe('36.6')
    expect(
      getInitialExerciseValue(
        createTodayEntry({
          completion: createCompletion({
            completedAt: '2026-06-20T09:00:00.000Z',
            measurementValue: 12,
          }),
          item: createItem({ type: 'exercise' }),
          lastExercise: createCompletion({ measurementValue: 12 }),
        }),
        '2026-06-21',
      ),
    ).toBe('')
    expect(
      getInitialExerciseValue(
        createTodayEntry({
          completion: createCompletion({
            completedAt: '2026-06-21T09:00:00.000Z',
            measurementValue: 8,
          }),
          item: createItem({ type: 'exercise' }),
          lastExercise: createCompletion({ measurementValue: 12 }),
        }),
        '2026-06-21',
      ),
    ).toBe('8')
    expect(
      getInitialExerciseValue(
        createTodayEntry({
          completion: null,
          item: createItem({ type: 'exercise' }),
          lastExercise: createCompletion({
            completedAt: '2026-06-20T21:30:00.000Z',
            measurementValue: 12,
          }),
        }),
        '2026-06-21',
        'Europe/Samara',
      ),
    ).toBe('12')
    expect(
      getTodayScheduleLabel(
        createTodayEntry({
          item: createItem({ type: 'habit' }),
          scheduleRule: createScheduleRule({ repeatKind: 'daily' }),
        }),
      ),
    ).toBe('каждый день')
    expect(getTypeLabel(createItem({ type: 'ritual' }))).toBe('ритуал')
    expect(getCourseProgress(null)).toBeNull()
    expect(getDefaultFlexibleGoalIntervalUnit('day')).toBe('day')
    expect(getDefaultFlexibleGoalIntervalUnit('week')).toBe('week')
    expect(getDefaultFlexibleGoalIntervalUnit('month')).toBe('month')
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
    preferredTimeOfDay: 'morning',
    title: 'Забота',
    type: 'habit',
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function formatExpectedLocalTime(value: string): string {
  const date = new Date(value)

  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`
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
    startDate: '2026-06-22',
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
    completedAt: '2026-06-22T08:00:00.000Z',
    completedVariant: 'full',
    createdAt: '2026-06-22T08:00:00.000Z',
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
    scheduledFor: '2026-06-22',
    scheduleRuleId: 'rule-1',
    status: 'scheduled',
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
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

function createCourseDetails(
  overrides: Partial<NonNullable<SelfCareTodayItem['courseDetails']>> = {},
): NonNullable<SelfCareTodayItem['courseDetails']> {
  return {
    breakDays: 0,
    completedCount: 0,
    courseType: 'days',
    createdAt: '2026-06-01T00:00:00.000Z',
    endDate: null,
    id: 'course-details-1',
    isCompleted: false,
    isPaused: false,
    itemId: 'item-1',
    repeatAfterCompletion: false,
    startDate: '2026-06-01',
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

function createExerciseDetails(
  overrides: Partial<NonNullable<SelfCareTodayItem['exercise']>> = {},
): NonNullable<SelfCareTodayItem['exercise']> {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    id: 'exercise-1',
    itemId: 'item-1',
    metricType: 'count',
    plannedSets: null,
    plannedValue: null,
    unit: 'reps',
    updatedAt: '2026-06-01T00:00:00.000Z',
    useSets: false,
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
    place: null,
    preparationNote: null,
    price: null,
    resultNote: null,
    specialistContact: null,
    specialistName: null,
    startsAt: '2026-06-22T09:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
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
    place: null,
    specialistName: null,
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

function createTemplate(
  overrides: Partial<SelfCareTemplate> = {},
): SelfCareTemplate {
  return {
    category: 'health',
    color: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    defaultSchedule: null,
    defaultSteps: [],
    description: '',
    icon: null,
    id: 'template-1',
    importance: 'recommended',
    isSystem: true,
    title: 'Шаблон',
    type: 'habit',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}
