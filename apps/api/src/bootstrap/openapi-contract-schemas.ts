import {
  cleaningAssigneeSchema,
  cleaningDepthSchema,
  cleaningEnergySchema,
  cleaningFrequencyTypeSchema,
  cleaningPostponeModeSchema,
  cleaningPrioritySchema,
  cleaningTaskHistoryActionSchema,
  cleaningTaskScopeSchema,
  habitEntryStatusSchema,
  habitFrequencySchema,
  habitTargetTypeSchema,
  selfCareCategorySchema,
  selfCareCompletionStatusSchema,
  selfCareExerciseMetricTypeSchema,
  selfCareExerciseUnitSchema,
  selfCareFlexiblePeriodSchema,
  selfCareImportanceSchema,
  selfCareIntervalUnitSchema,
  selfCareItemTypeSchema,
  selfCareOccurrenceStatusSchema,
  selfCareReminderToneSchema,
  selfCareRepeatKindSchema,
  selfCareTimeOfDaySchema,
} from '@planner/contracts'
import type { OpenAPIV3 } from 'openapi-types'

import {
  nullableStringSchema,
  positiveIntegerSchema,
} from './openapi-helpers.js'

type SchemaProperties = NonNullable<OpenAPIV3.SchemaObject['properties']>

export function createCleaningContractSchemas(): Record<
  string,
  OpenAPIV3.SchemaObject
> {
  return {
    CleaningListResponse: objectSchema({
      history: arrayOfRef('CleaningTaskHistoryItemRecord'),
      states: arrayOfRef('CleaningTaskStateRecord'),
      tasks: arrayOfRef('CleaningTaskRecord'),
      zones: arrayOfRef('CleaningZoneRecord'),
    }),
    CleaningSummary: objectSchema({
      accumulatedCount: nonnegativeIntegerSchema(),
      activeZoneCount: nonnegativeIntegerSchema(),
      completedTodayCount: nonnegativeIntegerSchema(),
      dueCount: nonnegativeIntegerSchema(),
      generalCount: nonnegativeIntegerSchema(),
      quickCount: nonnegativeIntegerSchema(),
      seasonalCount: nonnegativeIntegerSchema(),
      urgentCount: nonnegativeIntegerSchema(),
    }),
    CleaningTaskActionInput: objectSchema(
      {
        date: stringSchema(),
        mode: {
          ...enumSchema(cleaningPostponeModeSchema.options),
          default: 'next_cycle',
        },
        note: {
          default: '',
          maxLength: 500,
          type: 'string',
        },
        targetDate: {
          ...nullableStringSchema(),
          default: null,
        },
      },
      [],
    ),
    CleaningTaskActionResponse: objectSchema({
      historyItem: ref('CleaningTaskHistoryItemRecord'),
      state: ref('CleaningTaskStateRecord'),
    }),
    CleaningTaskHistoryItemRecord: objectSchema({
      action: enumSchema(cleaningTaskHistoryActionSchema.options),
      createdAt: stringSchema(),
      date: stringSchema(),
      id: stringSchema(),
      note: stringSchema(),
      targetDate: nullableStringSchema(),
      taskId: stringSchema(),
      userId: stringSchema(),
      workspaceId: stringSchema(),
      zoneId: nullableStringSchema(),
    }),
    CleaningTaskRecord: objectSchema({
      assignee: enumSchema(cleaningAssigneeSchema.options),
      createdAt: stringSchema(),
      customIntervalDays: nullablePositiveIntegerSchema(),
      deletedAt: nullableStringSchema(),
      depth: enumSchema(cleaningDepthSchema.options),
      description: stringSchema(),
      energy: enumSchema(cleaningEnergySchema.options),
      estimatedMinutes: nullablePositiveIntegerSchema(),
      frequencyInterval: positiveIntegerSchema(),
      frequencyType: enumSchema(cleaningFrequencyTypeSchema.options),
      id: stringSchema(),
      impactScore: integerRangeSchema(1, 5),
      isActive: booleanSchema(),
      isSeasonal: booleanSchema(),
      priority: enumSchema(cleaningPrioritySchema.options),
      seasonMonths: monthArraySchema(),
      sortOrder: integerSchema(),
      scope: enumSchema(cleaningTaskScopeSchema.options),
      tags: stringArraySchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      updatedAt: stringSchema(),
      userId: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
      zoneId: nullableStringSchema(),
    }),
    CleaningTaskStateRecord: objectSchema({
      lastCompletedAt: nullableStringSchema(),
      lastPostponedAt: nullableStringSchema(),
      lastSkippedAt: nullableStringSchema(),
      nextDueAt: nullableStringSchema(),
      postponeCount: nonnegativeIntegerSchema(),
      taskId: stringSchema(),
      updatedAt: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
    }),
    CleaningTaskUpdateInput: objectSchema(
      {
        assignee: enumSchema(cleaningAssigneeSchema.options),
        customIntervalDays: nullablePositiveIntegerSchema(),
        depth: enumSchema(cleaningDepthSchema.options),
        description: {
          maxLength: 800,
          type: 'string',
        },
        energy: enumSchema(cleaningEnergySchema.options),
        estimatedMinutes: nullablePositiveIntegerSchema(),
        expectedVersion: positiveIntegerSchema(),
        frequencyInterval: positiveIntegerSchema(),
        frequencyType: enumSchema(cleaningFrequencyTypeSchema.options),
        impactScore: integerRangeSchema(1, 5),
        isActive: booleanSchema(),
        isSeasonal: booleanSchema(),
        priority: enumSchema(cleaningPrioritySchema.options),
        seasonMonths: monthArraySchema(),
        sortOrder: integerSchema(),
        scope: enumSchema(cleaningTaskScopeSchema.options),
        tags: stringArraySchema(),
        title: {
          maxLength: 140,
          minLength: 1,
          type: 'string',
        },
        zoneId: nullableStringSchema(),
      },
      [],
    ),
    CleaningTaskWithState: objectSchema({
      isDue: booleanSchema(),
      isOverdue: booleanSchema(),
      score: {
        type: 'number',
      },
      state: ref('CleaningTaskStateRecord'),
      task: ref('CleaningTaskRecord'),
      zone: nullableRef('CleaningZoneRecord'),
    }),
    CleaningTodayResponse: objectSchema({
      accumulatedItems: arrayOfRef('CleaningTaskWithState'),
      date: stringSchema(),
      dayOfWeek: integerRangeSchema(1, 7),
      generalItems: arrayOfRef('CleaningTaskWithState'),
      history: arrayOfRef('CleaningTaskHistoryItemRecord'),
      items: arrayOfRef('CleaningTaskWithState'),
      quickItems: arrayOfRef('CleaningTaskWithState'),
      seasonalItems: arrayOfRef('CleaningTaskWithState'),
      summary: ref('CleaningSummary'),
      urgentItems: arrayOfRef('CleaningTaskWithState'),
      zones: arrayOfRef('CleaningZoneRecord'),
    }),
    CleaningZoneRecord: objectSchema({
      createdAt: stringSchema(),
      dayOfWeek: integerRangeSchema(1, 7),
      deletedAt: nullableStringSchema(),
      description: stringSchema(),
      id: stringSchema(),
      isActive: booleanSchema(),
      sortOrder: integerSchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      updatedAt: stringSchema(),
      userId: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
    }),
    CleaningZoneUpdateInput: objectSchema(
      {
        dayOfWeek: integerRangeSchema(1, 7),
        description: {
          maxLength: 600,
          type: 'string',
        },
        expectedVersion: positiveIntegerSchema(),
        isActive: booleanSchema(),
        sortOrder: integerSchema(),
        title: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
      },
      [],
    ),
    NewCleaningTaskInput: objectSchema(
      {
        assignee: {
          ...enumSchema(cleaningAssigneeSchema.options),
          default: 'anyone',
        },
        customIntervalDays: nullablePositiveIntegerSchema(),
        depth: {
          ...enumSchema(cleaningDepthSchema.options),
          default: 'regular',
        },
        description: {
          default: '',
          maxLength: 800,
          type: 'string',
        },
        energy: {
          ...enumSchema(cleaningEnergySchema.options),
          default: 'normal',
        },
        estimatedMinutes: nullablePositiveIntegerSchema(),
        frequencyInterval: {
          ...positiveIntegerSchema(),
          default: 1,
        },
        frequencyType: {
          ...enumSchema(cleaningFrequencyTypeSchema.options),
          default: 'weekly',
        },
        id: stringSchema(),
        impactScore: {
          ...integerRangeSchema(1, 5),
          default: 3,
        },
        isActive: {
          default: true,
          type: 'boolean',
        },
        isSeasonal: {
          default: false,
          type: 'boolean',
        },
        priority: {
          ...enumSchema(cleaningPrioritySchema.options),
          default: 'normal',
        },
        seasonMonths: {
          ...monthArraySchema(),
          default: [],
        },
        sortOrder: integerSchema(),
        scope: {
          ...enumSchema(cleaningTaskScopeSchema.options),
          default: 'zone',
        },
        tags: {
          ...stringArraySchema(),
          default: [],
          maxItems: 12,
        },
        title: {
          maxLength: 140,
          minLength: 1,
          type: 'string',
        },
        zoneId: nullableStringSchema(),
      },
      ['title'],
    ),
    NewCleaningZoneInput: objectSchema(
      {
        dayOfWeek: integerRangeSchema(1, 7),
        description: {
          default: '',
          maxLength: 600,
          type: 'string',
        },
        id: stringSchema(),
        isActive: {
          default: true,
          type: 'boolean',
        },
        sortOrder: integerSchema(),
        title: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
      },
      ['dayOfWeek', 'title'],
    ),
  }
}

export function createHabitContractSchemas(): Record<
  string,
  OpenAPIV3.SchemaObject
> {
  return {
    HabitEntryDeleteInput: objectSchema(
      {
        expectedVersion: positiveIntegerSchema(),
      },
      [],
    ),
    HabitEntryRecord: objectSchema(
      {
        createdAt: stringSchema(),
        date: stringSchema(),
        deletedAt: nullableStringSchema(),
        habitId: stringSchema(),
        id: stringSchema(),
        note: stringSchema(),
        status: enumSchema(habitEntryStatusSchema.options),
        targetValue: positiveIntegerSchema(),
        updatedAt: stringSchema(),
        userId: stringSchema(),
        value: nonnegativeIntegerSchema(),
        version: positiveIntegerSchema(),
        workspaceId: stringSchema(),
      },
      [
        'createdAt',
        'date',
        'deletedAt',
        'habitId',
        'id',
        'note',
        'status',
        'updatedAt',
        'userId',
        'value',
        'version',
        'workspaceId',
      ],
    ),
    HabitEntryUpsertInput: objectSchema(
      {
        date: stringSchema(),
        expectedVersion: positiveIntegerSchema(),
        note: {
          default: '',
          maxLength: 500,
          type: 'string',
        },
        status: {
          ...enumSchema(habitEntryStatusSchema.options),
          default: 'done',
        },
        value: nonnegativeIntegerSchema(),
      },
      ['date'],
    ),
    HabitListResponse: arrayOfRef('HabitRecord'),
    HabitRecord: objectSchema({
      color: {
        minLength: 1,
        type: 'string',
      },
      createdAt: stringSchema(),
      daysOfWeek: weekdayArraySchema(),
      deletedAt: nullableStringSchema(),
      description: stringSchema(),
      endDate: nullableStringSchema(),
      frequency: enumSchema(habitFrequencySchema.options),
      icon: {
        minLength: 1,
        type: 'string',
      },
      id: stringSchema(),
      isActive: booleanSchema(),
      reminderTime: nullableTimeStringSchema(),
      sortOrder: integerSchema(),
      sphereId: nullableStringSchema(),
      startDate: stringSchema(),
      targetType: enumSchema(habitTargetTypeSchema.options),
      targetValue: positiveIntegerSchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      unit: stringSchema(),
      updatedAt: stringSchema(),
      userId: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
    }),
    HabitStats: objectSchema({
      bestStreak: nonnegativeIntegerSchema(),
      completionRate: integerRangeSchema(0, 100),
      completedCount: nonnegativeIntegerSchema(),
      currentStreak: nonnegativeIntegerSchema(),
      habitId: stringSchema(),
      lastCompletedDate: nullableStringSchema(),
      missedCount: nonnegativeIntegerSchema(),
      monthCompleted: nonnegativeIntegerSchema(),
      monthScheduled: nonnegativeIntegerSchema(),
      scheduledCount: nonnegativeIntegerSchema(),
      skippedCount: nonnegativeIntegerSchema(),
      weekCompleted: nonnegativeIntegerSchema(),
      weekScheduled: nonnegativeIntegerSchema(),
    }),
    HabitStatsResponse: objectSchema({
      from: stringSchema(),
      habits: arrayOfRef('HabitRecord'),
      stats: arrayOfRef('HabitStats'),
      to: stringSchema(),
    }),
    HabitTodayItem: objectSchema({
      entry: nullableRef('HabitEntryRecord'),
      habit: ref('HabitRecord'),
      isDueToday: booleanSchema(),
      progressPercent: integerRangeSchema(0, 100),
      stats: ref('HabitStats'),
    }),
    HabitTodayResponse: objectSchema({
      date: stringSchema(),
      items: arrayOfRef('HabitTodayItem'),
    }),
    HabitUpdateInput: objectSchema(
      {
        color: {
          minLength: 1,
          type: 'string',
        },
        daysOfWeek: weekdayArraySchema({ requiresSchedule: true }),
        description: {
          maxLength: 600,
          type: 'string',
        },
        endDate: nullableStringSchema(),
        expectedVersion: positiveIntegerSchema(),
        frequency: enumSchema(habitFrequencySchema.options),
        icon: {
          minLength: 1,
          type: 'string',
        },
        isActive: booleanSchema(),
        reminderTime: nullableTimeStringSchema(),
        sortOrder: integerSchema(),
        sphereId: nullableStringSchema(),
        startDate: stringSchema(),
        targetType: enumSchema(habitTargetTypeSchema.options),
        targetValue: positiveIntegerSchema(),
        title: {
          maxLength: 120,
          minLength: 1,
          type: 'string',
        },
        unit: {
          maxLength: 24,
          type: 'string',
        },
      },
      [],
    ),
    NewHabitInput: objectSchema(
      {
        color: {
          default: '#2f6f62',
          minLength: 1,
          type: 'string',
        },
        daysOfWeek: weekdayArraySchema({ requiresSchedule: true }),
        description: {
          default: '',
          maxLength: 600,
          type: 'string',
        },
        endDate: {
          ...nullableStringSchema(),
          default: null,
        },
        frequency: {
          ...enumSchema(habitFrequencySchema.options),
          default: 'daily',
        },
        icon: {
          default: 'check',
          minLength: 1,
          type: 'string',
        },
        id: stringSchema(),
        reminderTime: {
          ...nullableTimeStringSchema(),
          default: null,
        },
        sortOrder: integerSchema(),
        sphereId: {
          ...nullableStringSchema(),
          default: null,
        },
        startDate: stringSchema(),
        targetType: {
          ...enumSchema(habitTargetTypeSchema.options),
          default: 'check',
        },
        targetValue: {
          ...positiveIntegerSchema(),
          default: 1,
        },
        title: {
          maxLength: 120,
          minLength: 1,
          type: 'string',
        },
        unit: {
          default: '',
          maxLength: 24,
          type: 'string',
        },
      },
      ['title'],
    ),
  }
}

export function createSelfCareContractSchemas(): Record<
  string,
  OpenAPIV3.SchemaObject
> {
  return {
    SelfCareAlternativeInput: objectSchema(
      {
        countsAsCompletion: {
          default: true,
          type: 'boolean',
        },
        description: {
          default: '',
          maxLength: 600,
          type: 'string',
        },
        id: stringSchema(),
        title: {
          maxLength: 160,
          minLength: 1,
          type: 'string',
        },
      },
      ['title'],
    ),
    SelfCareAnalyticsResponse: objectSchema({
      balanceByCategory: recordOf(nonnegativeIntegerSchema()),
      completionsByDay: recordOf(nonnegativeIntegerSchema()),
      courses: arrayOfRef('SelfCareTodayItem'),
      exerciseTrends: arrayOfRef('SelfCareExerciseTrend'),
      flexibleGoals: arrayOfRef('SelfCareTodayItem'),
      measurementTrends: arrayOfRef('SelfCareMeasurementTrend'),
      medicalUpcoming: arrayOfRef('SelfCareTodayItem'),
      minimumCompletionCount: nonnegativeIntegerSchema(),
      moodEnergyTrend: arrayOfRef('SelfCareDailyState'),
      procedureCosts: nonnegativeNumberSchema(),
      procedureCostsByMonth: recordOf(nonnegativeNumberSchema()),
      selectedSelfCareCount: nonnegativeIntegerSchema(),
    }),
    SelfCareAppointmentDetails: objectSchema({
      createdAt: stringSchema(),
      currency: nullableStringSchema(),
      endsAt: nullableStringSchema(),
      id: stringSchema(),
      itemId: stringSchema(),
      occurrenceId: nullableStringSchema(),
      place: nullableStringSchema(),
      preparationNote: nullableStringSchema(),
      price: nullableNonnegativeNumberSchema(),
      resultNote: nullableStringSchema(),
      specialistContact: nullableStringSchema(),
      specialistName: nullableStringSchema(),
      startsAt: stringSchema(),
      updatedAt: stringSchema(),
    }),
    SelfCareAppointmentDetailsInput: objectSchema(
      {
        currency: nullableStringSchema(),
        endsAt: nullableStringSchema(),
        place: nullableStringSchema(),
        preparationNote: nullableStringSchema(),
        price: nullableNonnegativeNumberSchema(),
        resultNote: nullableStringSchema(),
        specialistContact: nullableStringSchema(),
        specialistName: nullableStringSchema(),
        startsAt: {
          minLength: 1,
          type: 'string',
        },
      },
      ['startsAt'],
    ),
    SelfCareCompletion: objectSchema({
      alternativeTitle: nullableStringSchema(),
      completedAt: stringSchema(),
      completedVariant: nullableEnumSchema(['full', 'minimum', 'alternative']),
      createdAt: stringSchema(),
      durationMinutes: nullablePositiveIntegerSchema(),
      energyAfter: nullableIntegerRangeSchema(1, 5),
      energyBefore: nullableIntegerRangeSchema(1, 5),
      exerciseSets: arrayOfRef('SelfCareExerciseSet'),
      id: stringSchema(),
      itemId: stringSchema(),
      measurementUnit: nullableStringSchema(),
      measurementValue: nullableNumberSchema(),
      moodAfter: nullableIntegerRangeSchema(1, 5),
      moodBefore: nullableIntegerRangeSchema(1, 5),
      note: stringSchema(),
      occurrenceId: nullableStringSchema(),
      scheduledFor: nullableStringSchema(),
      status: enumSchema(selfCareCompletionStatusSchema.options),
      userId: stringSchema(),
    }),
    SelfCareCompletionInput: objectSchema(
      selfCareCompletionInputProperties(),
      [],
    ),
    SelfCareCourseDetails: objectSchema({
      breakDays: nonnegativeIntegerSchema(),
      completedCount: nonnegativeIntegerSchema(),
      courseType: enumSchema(['sessions', 'days']),
      createdAt: stringSchema(),
      endDate: nullableStringSchema(),
      id: stringSchema(),
      isCompleted: booleanSchema(),
      isPaused: booleanSchema(),
      itemId: stringSchema(),
      repeatAfterCompletion: booleanSchema(),
      startDate: nullableStringSchema(),
      totalCount: positiveIntegerSchema(),
      updatedAt: stringSchema(),
    }),
    SelfCareCourseDetailsInput: objectSchema({
      breakDays: {
        ...nonnegativeIntegerSchema(),
        default: 0,
      },
      completedCount: {
        ...nonnegativeIntegerSchema(),
        default: 0,
      },
      courseType: enumSchema(['sessions', 'days']),
      endDate: nullableStringSchema(),
      isCompleted: {
        default: false,
        type: 'boolean',
      },
      isPaused: {
        default: false,
        type: 'boolean',
      },
      repeatAfterCompletion: {
        default: false,
        type: 'boolean',
      },
      startDate: nullableStringSchema(),
      totalCount: positiveIntegerSchema(),
    }),
    SelfCareDailyState: objectSchema({
      createdAt: stringSchema(),
      date: stringSchema(),
      energy: nullableIntegerRangeSchema(1, 5),
      id: stringSchema(),
      mood: nullableIntegerRangeSchema(1, 5),
      note: stringSchema(),
      pain: nullableIntegerRangeSchema(1, 5),
      sleepQuality: nullableIntegerRangeSchema(1, 5),
      stress: nullableIntegerRangeSchema(1, 5),
      updatedAt: stringSchema(),
      userId: stringSchema(),
    }),
    SelfCareDailyStateInput: objectSchema(
      {
        energy: nullableIntegerRangeSchema(1, 5),
        mood: nullableIntegerRangeSchema(1, 5),
        note: {
          default: '',
          maxLength: 1200,
          type: 'string',
        },
        pain: nullableIntegerRangeSchema(1, 5),
        sleepQuality: nullableIntegerRangeSchema(1, 5),
        stress: nullableIntegerRangeSchema(1, 5),
      },
      [],
    ),
    SelfCareDashboardResponse: objectSchema({
      dailyState: nullableRef('SelfCareDailyState'),
      date: stringSchema(),
      flexibleGoals: arrayOfRef('SelfCareTodayItem'),
      gentleMode: booleanSchema(),
      minimumItems: arrayOfRef('SelfCareMinimumItem'),
      overdueItems: arrayOfRef('SelfCareTodayItem'),
      planningHints: arrayOfRef('SelfCareTodayItem'),
      settings: ref('SelfCareSettings'),
      todayItems: arrayOfRef('SelfCareTodayItem'),
      upcomingImportant: arrayOfRef('SelfCareTodayItem'),
    }),
    SelfCareFlexibleGoalProgress: objectSchema({
      completedCount: nonnegativeIntegerSchema(),
      periodEnd: stringSchema(),
      periodStart: stringSchema(),
      remainingCount: nonnegativeIntegerSchema(),
      targetCount: nonnegativeIntegerSchema(),
    }),
    SelfCareHistoryResponse: objectSchema({
      completions: arrayOfRef('SelfCareCompletion'),
      items: arrayOfRef('SelfCareItem'),
      stepCompletions: arrayOfRef('SelfCareRitualStepCompletion'),
    }),
    SelfCareItem: objectSchema({
      category: enumSchema(selfCareCategorySchema.options),
      color: nullableStringSchema(),
      createdAt: stringSchema(),
      createdFromTemplateId: nullableStringSchema(),
      customCategoryId: nullableStringSchema(),
      defaultDurationMinutes: nullablePositiveIntegerSchema(),
      deletedAt: nullableStringSchema(),
      description: stringSchema(),
      icon: nullableStringSchema(),
      id: stringSchema(),
      importance: enumSchema(selfCareImportanceSchema.options),
      isActive: booleanSchema(),
      isArchived: booleanSchema(),
      isPrivate: booleanSchema(),
      migratedFromHabitId: nullableStringSchema(),
      minimumVersionDescription: nullableStringSchema(),
      minimumVersionDurationMinutes: nullablePositiveIntegerSchema(),
      minimumVersionTitle: nullableStringSchema(),
      preferredTimeOfDay: nullableEnumSchema(selfCareTimeOfDaySchema.options),
      title: {
        minLength: 1,
        type: 'string',
      },
      type: enumSchema(selfCareItemTypeSchema.options),
      updatedAt: stringSchema(),
      userId: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
    }),
    SelfCareItemAlternative: objectSchema({
      countsAsCompletion: booleanSchema(),
      description: stringSchema(),
      id: stringSchema(),
      itemId: stringSchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
    }),
    SelfCareItemInput: objectSchema(
      {
        alternatives: arrayOfRef('SelfCareAlternativeInput'),
        appointmentDetails: ref('SelfCareAppointmentDetailsInput'),
        category: enumSchema(selfCareCategorySchema.options),
        color: nullableStringSchema(),
        courseDetails: ref('SelfCareCourseDetailsInput'),
        customCategoryId: nullableStringSchema(),
        defaultDurationMinutes: nullablePositiveIntegerSchema(),
        description: {
          default: '',
          maxLength: 1200,
          type: 'string',
        },
        icon: nullableStringSchema(),
        id: stringSchema(),
        importance: {
          ...enumSchema(selfCareImportanceSchema.options),
          default: 'recommended',
        },
        isActive: {
          default: true,
          type: 'boolean',
        },
        isArchived: {
          default: false,
          type: 'boolean',
        },
        isPrivate: {
          default: true,
          type: 'boolean',
        },
        medicalDetails: ref('SelfCareMedicalDetailsInput'),
        measurementDetails: ref('SelfCareMeasurementDetailsInput'),
        migratedFromHabitId: nullableStringSchema(),
        minimumVersion: ref('SelfCareMinimumVersionInput'),
        preferredTimeOfDay: nullableEnumSchema(selfCareTimeOfDaySchema.options),
        procedureDetails: ref('SelfCareProcedureDetailsInput'),
        scheduleRule: ref('SelfCareScheduleRuleInput'),
        steps: arrayOfRef('SelfCareRitualStepInput'),
        title: {
          maxLength: 160,
          minLength: 1,
          type: 'string',
        },
        type: enumSchema(selfCareItemTypeSchema.options),
      },
      ['category', 'title', 'type'],
    ),
    SelfCareItemScheduleInput: objectSchema({
      currency: nullableStringSchema(),
      note: {
        default: '',
        maxLength: 600,
        type: 'string',
      },
      place: nullableStringSchema(),
      price: nullableNonnegativeNumberSchema(),
      reminderOffsetsMinutes: {
        items: integerSchema(),
        maxItems: 8,
        type: 'array',
      },
      scheduledFor: {
        minLength: 1,
        type: 'string',
      },
      scheduledTime: nullableTimeStringSchema(),
      specialistContact: nullableStringSchema(),
      specialistName: nullableStringSchema(),
      timezone: nullableStringSchema(),
    }),
    SelfCareItemUpdateInput: objectSchema(
      {
        ...selfCareItemInputProperties(),
        expectedVersion: positiveIntegerSchema(),
      },
      [],
    ),
    SelfCareListResponse: objectSchema({
      alternatives: arrayOfRef('SelfCareItemAlternative'),
      appointmentDetails: arrayOfRef('SelfCareAppointmentDetails'),
      courseDetails: arrayOfRef('SelfCareCourseDetails'),
      exerciseDetails: arrayOfRef('SelfCareExerciseDetails'),
      items: arrayOfRef('SelfCareItem'),
      medicalDetails: arrayOfRef('SelfCareMedicalDetails'),
      measurementDetails: arrayOfRef('SelfCareMeasurementDetails'),
      procedureDetails: arrayOfRef('SelfCareProcedureDetails'),
      scheduleRules: arrayOfRef('SelfCareScheduleRule'),
      steps: arrayOfRef('SelfCareRitualStep'),
    }),
    SelfCareMeasurementDetails: objectSchema({
      createdAt: stringSchema(),
      id: stringSchema(),
      itemId: stringSchema(),
      targetMax: nullableNumberSchema(),
      targetMin: nullableNumberSchema(),
      unit: stringSchema(),
      updatedAt: stringSchema(),
      valueLabel: stringSchema(),
    }),
    SelfCareMeasurementDetailsInput: objectSchema({
      targetMax: nullableNumberSchema(),
      targetMin: nullableNumberSchema(),
      unit: {
        maxLength: 32,
        minLength: 1,
        type: 'string',
      },
      valueLabel: {
        default: 'Value',
        maxLength: 80,
        minLength: 1,
        type: 'string',
      },
    }),
    SelfCareExerciseDetails: objectSchema({
      createdAt: stringSchema(),
      id: stringSchema(),
      itemId: stringSchema(),
      metricType: enumSchema(selfCareExerciseMetricTypeSchema.options),
      plannedSets: nullablePositiveIntegerSchema(),
      plannedValue: nullableNumberSchema(),
      unit: enumSchema(selfCareExerciseUnitSchema.options),
      updatedAt: stringSchema(),
      useSets: booleanSchema(),
    }),
    SelfCareExerciseDetailsInput: objectSchema({
      metricType: enumSchema(selfCareExerciseMetricTypeSchema.options),
      plannedSets: nullablePositiveIntegerSchema(),
      plannedValue: nullableNumberSchema(),
      unit: enumSchema(selfCareExerciseUnitSchema.options),
      useSets: {
        default: false,
        type: 'boolean',
      },
    }),
    SelfCareExerciseTrend: objectSchema({
      itemId: stringSchema(),
      metricType: enumSchema(selfCareExerciseMetricTypeSchema.options),
      points: arrayOfRef('SelfCareExerciseTrendPoint'),
      title: stringSchema(),
      unit: enumSchema(selfCareExerciseUnitSchema.options),
    }),
    SelfCareExerciseTrendPoint: objectSchema({
      completedAt: stringSchema(),
      date: stringSchema(),
      sets: arrayOfRef('SelfCareExerciseSet'),
      value: numberSchema(),
    }),
    SelfCareExerciseSet: objectSchema({
      index: positiveIntegerSchema(),
      value: numberSchema(),
    }),
    SelfCareMeasurementTrend: objectSchema({
      itemId: stringSchema(),
      points: arrayOfRef('SelfCareMeasurementTrendPoint'),
      title: stringSchema(),
      unit: nullableStringSchema(),
      valueLabel: stringSchema(),
    }),
    SelfCareMeasurementTrendPoint: objectSchema({
      completedAt: stringSchema(),
      date: stringSchema(),
      value: numberSchema(),
    }),
    SelfCareMedicalDetails: objectSchema({
      analysisList: stringArraySchema(),
      clinicAddress: nullableStringSchema(),
      clinicName: nullableStringSchema(),
      createdAt: stringSchema(),
      documentUrls: stringArraySchema(),
      doctorName: nullableStringSchema(),
      id: stringSchema(),
      itemId: stringSchema(),
      nextControlDate: nullableStringSchema(),
      phone: nullableStringSchema(),
      reminderStrategy: enumSchema(['soft', 'normal', 'persistent']),
      resultNote: nullableStringSchema(),
      updatedAt: stringSchema(),
      website: nullableStringSchema(),
    }),
    SelfCareMedicalDetailsInput: objectSchema(
      {
        analysisList: stringArraySchema(),
        clinicAddress: nullableStringSchema(),
        clinicName: nullableStringSchema(),
        documentUrls: stringArraySchema(),
        doctorName: nullableStringSchema(),
        nextControlDate: nullableStringSchema(),
        phone: nullableStringSchema(),
        reminderStrategy: enumSchema(['soft', 'normal', 'persistent']),
        resultNote: nullableStringSchema(),
        website: nullableStringSchema(),
      },
      [],
    ),
    SelfCareMinimumItem: objectSchema({
      createdAt: stringSchema(),
      id: stringSchema(),
      isActive: booleanSchema(),
      linkedItemId: nullableStringSchema(),
      order: nonnegativeIntegerSchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      updatedAt: stringSchema(),
      userId: stringSchema(),
    }),
    SelfCareMinimumItemInput: objectSchema(
      {
        id: stringSchema(),
        isActive: {
          default: true,
          type: 'boolean',
        },
        linkedItemId: nullableStringSchema(),
        order: nonnegativeIntegerSchema(),
        title: {
          maxLength: 120,
          minLength: 1,
          type: 'string',
        },
      },
      ['title'],
    ),
    SelfCareMinimumItemsUpdateInput: objectSchema({
      items: {
        items: ref('SelfCareMinimumItemInput'),
        maxItems: 20,
        type: 'array',
      },
    }),
    SelfCareMinimumVersionInput: objectSchema({
      description: {
        default: '',
        maxLength: 600,
        type: 'string',
      },
      durationMinutes: nullablePositiveIntegerSchema(),
      title: {
        maxLength: 160,
        minLength: 1,
        type: 'string',
      },
    }),
    SelfCareOccurrence: objectSchema({
      completedAt: nullableStringSchema(),
      createdAt: stringSchema(),
      dueAt: nullableStringSchema(),
      generatedAt: nullableStringSchema(),
      id: stringSchema(),
      itemId: stringSchema(),
      movedTo: nullableStringSchema(),
      reminderOffsetsMinutes: {
        items: integerSchema(),
        type: 'array',
      },
      reminderTimeZone: nullableStringSchema(),
      scheduledFor: stringSchema(),
      scheduleRuleId: nullableStringSchema(),
      status: enumSchema(selfCareOccurrenceStatusSchema.options),
      updatedAt: stringSchema(),
      userId: stringSchema(),
    }),
    SelfCareOccurrenceListResponse: arrayOfRef('SelfCareOccurrence'),
    SelfCareOccurrenceMoveInput: objectSchema({
      newDate: {
        minLength: 1,
        type: 'string',
      },
      note: {
        default: '',
        maxLength: 600,
        type: 'string',
      },
    }),
    SelfCareOccurrenceSkipInput: objectSchema(
      {
        reason: {
          default: '',
          maxLength: 600,
          type: 'string',
        },
      },
      [],
    ),
    SelfCarePlanResponse: objectSchema({
      courses: arrayOfRef('SelfCareTodayItem'),
      from: stringSchema(),
      medical: arrayOfRef('SelfCareTodayItem'),
      occurrences: arrayOfRef('SelfCareTodayItem'),
      planningHints: arrayOfRef('SelfCareTodayItem'),
      to: stringSchema(),
    }),
    SelfCareProcedureDetails: objectSchema({
      contact: nullableStringSchema(),
      createdAt: stringSchema(),
      currency: nullableStringSchema(),
      defaultPrice: nullableNonnegativeNumberSchema(),
      id: stringSchema(),
      itemId: stringSchema(),
      place: nullableStringSchema(),
      specialistName: nullableStringSchema(),
      updatedAt: stringSchema(),
    }),
    SelfCareProcedureDetailsInput: objectSchema(
      {
        contact: nullableStringSchema(),
        currency: nullableStringSchema(),
        defaultPrice: nullableNonnegativeNumberSchema(),
        place: nullableStringSchema(),
        specialistName: nullableStringSchema(),
      },
      [],
    ),
    SelfCareRangeInput: objectSchema({
      from: stringSchema(),
      to: stringSchema(),
    }),
    SelfCareRitualCompletionInput: objectSchema(
      {
        ...selfCareCompletionInputProperties(),
        steps: {
          default: [],
          items: objectSchema({
            isDone: booleanSchema(),
            stepId: {
              minLength: 1,
              type: 'string',
            },
          }),
          type: 'array',
        },
      },
      [],
    ),
    SelfCareRitualStep: objectSchema({
      createdAt: stringSchema(),
      defaultChecked: booleanSchema(),
      id: stringSchema(),
      isOptional: booleanSchema(),
      itemId: stringSchema(),
      order: nonnegativeIntegerSchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      updatedAt: stringSchema(),
    }),
    SelfCareRitualStepCompletion: objectSchema({
      completionId: stringSchema(),
      id: stringSchema(),
      isDone: booleanSchema(),
      stepId: stringSchema(),
    }),
    SelfCareRitualStepDraft: objectSchema({
      date: {
        minLength: 1,
        type: 'string',
      },
      itemId: {
        minLength: 1,
        type: 'string',
      },
      occurrenceId: nullableStringSchema(),
      stepIds: stringArraySchema(),
    }),
    SelfCareRitualStepDraftInput: objectSchema({
      date: {
        minLength: 1,
        type: 'string',
      },
      itemId: {
        minLength: 1,
        type: 'string',
      },
      occurrenceId: nullableStringSchema(),
      stepIds: stringArraySchema(),
    }),
    SelfCareRitualStepDraftListResponse: objectSchema({
      date: {
        minLength: 1,
        type: 'string',
      },
      drafts: arrayOfRef('SelfCareRitualStepDraft'),
    }),
    SelfCareRitualStepInput: objectSchema(
      {
        defaultChecked: {
          default: false,
          type: 'boolean',
        },
        id: stringSchema(),
        isOptional: {
          default: false,
          type: 'boolean',
        },
        order: nonnegativeIntegerSchema(),
        title: {
          maxLength: 160,
          minLength: 1,
          type: 'string',
        },
      },
      ['title'],
    ),
    SelfCareRitualStepsUpdateInput: objectSchema({
      steps: arrayOfRef('SelfCareRitualStepInput'),
    }),
    SelfCareScheduleRule: objectSchema({
      allowMultiplePerDay: booleanSchema(),
      createdAt: stringSchema(),
      dayOfMonth: nullableIntegerRangeSchema(1, 31),
      daysOfWeek: weekdayArraySchema(),
      endDate: nullableStringSchema(),
      flexiblePeriod: nullableEnumSchema(selfCareFlexiblePeriodSchema.options),
      flexibleTargetCount: nullablePositiveIntegerSchema(),
      generateInCalendar: booleanSchema(),
      generateInTaskList: booleanSchema(),
      id: stringSchema(),
      intervalUnit: nullableEnumSchema(selfCareIntervalUnitSchema.options),
      intervalValue: nullablePositiveIntegerSchema(),
      itemId: stringSchema(),
      monthOfYear: nullableIntegerRangeSchema(1, 12),
      preferredTime: nullableTimeStringSchema(),
      reminderOffsetsMinutes: {
        items: integerSchema(),
        type: 'array',
      },
      repeatKind: enumSchema(selfCareRepeatKindSchema.options),
      startDate: nullableStringSchema(),
      timezone: nullableStringSchema(),
      updatedAt: stringSchema(),
      weekOfMonth: nullableIntegerRangeSchema(-1, 5),
    }),
    SelfCareScheduleRuleInput: objectSchema(
      {
        allowMultiplePerDay: {
          default: false,
          type: 'boolean',
        },
        dayOfMonth: nullableIntegerRangeSchema(1, 31),
        daysOfWeek: weekdayArraySchema(),
        endDate: nullableStringSchema(),
        flexiblePeriod: nullableEnumSchema(
          selfCareFlexiblePeriodSchema.options,
        ),
        flexibleTargetCount: nullablePositiveIntegerSchema(),
        generateInCalendar: {
          default: false,
          type: 'boolean',
        },
        generateInTaskList: {
          default: true,
          type: 'boolean',
        },
        id: stringSchema(),
        intervalUnit: nullableEnumSchema(selfCareIntervalUnitSchema.options),
        intervalValue: nullablePositiveIntegerSchema(),
        monthOfYear: nullableIntegerRangeSchema(1, 12),
        preferredTime: nullableTimeStringSchema(),
        reminderOffsetsMinutes: {
          items: integerSchema(),
          maxItems: 8,
          type: 'array',
        },
        repeatKind: enumSchema(selfCareRepeatKindSchema.options),
        startDate: nullableStringSchema(),
        timezone: nullableStringSchema(),
        weekOfMonth: nullableIntegerRangeSchema(-1, 5),
      },
      ['repeatKind'],
    ),
    SelfCareSettings: objectSchema({
      createdAt: stringSchema(),
      currency: nullableStringSchema(),
      defaultReminderTone: enumSchema(selfCareReminderToneSchema.options),
      gentleModeDate: nullableStringSchema(),
      gentleModeEnabledToday: booleanSchema(),
      id: stringSchema(),
      quietHoursEnd: nullableTimeStringSchema(),
      quietHoursStart: nullableTimeStringSchema(),
      showAppointmentsInCalendar: booleanSchema(),
      showSelfCareInMainTasks: booleanSchema(),
      updatedAt: stringSchema(),
      userId: stringSchema(),
    }),
    SelfCareSettingsResponse: objectSchema({
      minimumItems: arrayOfRef('SelfCareMinimumItem'),
      settings: ref('SelfCareSettings'),
    }),
    SelfCareSettingsUpdateInput: objectSchema(
      {
        currency: nullableStringSchema(),
        showAppointmentsInCalendar: booleanSchema(),
        showSelfCareInMainTasks: booleanSchema(),
      },
      [],
    ),
    SelfCareTemplate: objectSchema({
      category: enumSchema(selfCareCategorySchema.options),
      color: nullableStringSchema(),
      createdAt: stringSchema(),
      defaultSchedule: genericJsonSchema(),
      defaultSteps: stringArraySchema(),
      description: stringSchema(),
      icon: nullableStringSchema(),
      id: stringSchema(),
      importance: enumSchema(selfCareImportanceSchema.options),
      isSystem: booleanSchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      type: enumSchema(selfCareItemTypeSchema.options),
      updatedAt: stringSchema(),
    }),
    SelfCareTemplateCreateInput: objectSchema(
      {
        overrides: ref('SelfCareItemUpdateInput'),
      },
      [],
    ),
    SelfCareTemplateListResponse: arrayOfRef('SelfCareTemplate'),
    SelfCareTodayItem: objectSchema({
      appointment: nullableRef('SelfCareAppointmentDetails'),
      completion: nullableRef('SelfCareCompletion'),
      courseDetails: nullableRef('SelfCareCourseDetails'),
      exercise: nullableRef('SelfCareExerciseDetails'),
      flexibleProgress: nullableRef('SelfCareFlexibleGoalProgress'),
      item: ref('SelfCareItem'),
      lastExercise: nullableRef('SelfCareCompletion'),
      lastMeasurement: nullableRef('SelfCareCompletion'),
      measurement: nullableRef('SelfCareMeasurementDetails'),
      occurrence: nullableRef('SelfCareOccurrence'),
      procedure: nullableRef('SelfCareProcedureDetails'),
      scheduleRule: nullableRef('SelfCareScheduleRule'),
      steps: arrayOfRef('SelfCareRitualStep'),
      timeGroup: enumSchema(selfCareTimeOfDaySchema.options),
    }),
  }
}

function objectSchema(
  properties: SchemaProperties,
  required = Object.keys(properties),
): OpenAPIV3.SchemaObject {
  const schema: OpenAPIV3.SchemaObject = {
    additionalProperties: false,
    properties,
    type: 'object',
  }

  if (required.length > 0) {
    schema.required = required
  }

  return schema
}

function genericJsonSchema(): OpenAPIV3.SchemaObject {
  return {
    nullable: true,
  }
}

function recordOf(valueSchema: OpenAPIV3.SchemaObject): OpenAPIV3.SchemaObject {
  return {
    additionalProperties: valueSchema,
    type: 'object',
  }
}

function arrayOfRef(schemaName: string): OpenAPIV3.SchemaObject {
  return {
    items: ref(schemaName),
    type: 'array',
  }
}

function booleanSchema(): OpenAPIV3.SchemaObject {
  return {
    type: 'boolean',
  }
}

function enumSchema(values: readonly string[]): OpenAPIV3.SchemaObject {
  return {
    enum: [...values],
    type: 'string',
  }
}

function integerRangeSchema(
  minimum: number,
  maximum: number,
): OpenAPIV3.SchemaObject {
  return {
    maximum,
    minimum,
    type: 'integer',
  }
}

function integerSchema(): OpenAPIV3.SchemaObject {
  return {
    type: 'integer',
  }
}

function nullableEnumSchema(values: readonly string[]): OpenAPIV3.SchemaObject {
  return {
    ...enumSchema(values),
    nullable: true,
  }
}

function nullableIntegerRangeSchema(
  minimum: number,
  maximum: number,
): OpenAPIV3.SchemaObject {
  return {
    ...integerRangeSchema(minimum, maximum),
    nullable: true,
  }
}

function monthArraySchema(): OpenAPIV3.SchemaObject {
  return {
    items: integerRangeSchema(1, 12),
    maxItems: 12,
    type: 'array',
  }
}

function nonnegativeIntegerSchema(): OpenAPIV3.SchemaObject {
  return {
    minimum: 0,
    type: 'integer',
  }
}

function nonnegativeNumberSchema(): OpenAPIV3.SchemaObject {
  return {
    minimum: 0,
    type: 'number',
  }
}

function nullableNonnegativeNumberSchema(): OpenAPIV3.SchemaObject {
  return {
    ...nonnegativeNumberSchema(),
    nullable: true,
  }
}

function nullableNumberSchema(): OpenAPIV3.SchemaObject {
  return {
    nullable: true,
    type: 'number',
  }
}

function nullablePositiveIntegerSchema(): OpenAPIV3.SchemaObject {
  return {
    ...positiveIntegerSchema(),
    nullable: true,
  }
}

function nullableRef(schemaName: string): OpenAPIV3.SchemaObject {
  return {
    allOf: [ref(schemaName)],
    nullable: true,
  }
}

function nullableTimeStringSchema(): OpenAPIV3.SchemaObject {
  return {
    nullable: true,
    pattern: '^\\d{2}:\\d{2}$',
    type: 'string',
  }
}

function numberSchema(): OpenAPIV3.SchemaObject {
  return {
    type: 'number',
  }
}

function ref(schemaName: string): OpenAPIV3.ReferenceObject {
  return {
    $ref: `#/components/schemas/${schemaName}`,
  }
}

function stringArraySchema(): OpenAPIV3.SchemaObject {
  return {
    items: stringSchema(),
    type: 'array',
  }
}

function stringSchema(): OpenAPIV3.SchemaObject {
  return {
    type: 'string',
  }
}

function weekdayArraySchema(
  options: { requiresSchedule?: boolean } = {},
): OpenAPIV3.SchemaObject {
  return {
    items: integerRangeSchema(1, 7),
    ...(options.requiresSchedule
      ? {
          maxItems: 7,
          minItems: 1,
        }
      : {}),
    type: 'array',
  }
}

function selfCareCompletionInputProperties(): SchemaProperties {
  return {
    alternativeTitle: nullableStringSchema(),
    completedAt: stringSchema(),
    completedVariant: nullableEnumSchema(['full', 'minimum', 'alternative']),
    durationMinutes: nullablePositiveIntegerSchema(),
    energyAfter: nullableIntegerRangeSchema(1, 5),
    energyBefore: nullableIntegerRangeSchema(1, 5),
    exerciseSets: arrayOfRef('SelfCareExerciseSet'),
    measurementUnit: nullableStringSchema(),
    measurementValue: nullableNumberSchema(),
    moodAfter: nullableIntegerRangeSchema(1, 5),
    moodBefore: nullableIntegerRangeSchema(1, 5),
    note: {
      default: '',
      maxLength: 1200,
      type: 'string',
    },
    status: {
      ...enumSchema(selfCareCompletionStatusSchema.options),
      default: 'done',
    },
  }
}

function selfCareItemInputProperties(): SchemaProperties {
  return {
    alternatives: arrayOfRef('SelfCareAlternativeInput'),
    appointmentDetails: ref('SelfCareAppointmentDetailsInput'),
    category: enumSchema(selfCareCategorySchema.options),
    color: nullableStringSchema(),
    courseDetails: ref('SelfCareCourseDetailsInput'),
    customCategoryId: nullableStringSchema(),
    defaultDurationMinutes: nullablePositiveIntegerSchema(),
    description: {
      maxLength: 1200,
      type: 'string',
    },
    icon: nullableStringSchema(),
    id: stringSchema(),
    importance: enumSchema(selfCareImportanceSchema.options),
    isActive: booleanSchema(),
    isArchived: booleanSchema(),
    isPrivate: booleanSchema(),
    exerciseDetails: ref('SelfCareExerciseDetailsInput'),
    medicalDetails: ref('SelfCareMedicalDetailsInput'),
    measurementDetails: ref('SelfCareMeasurementDetailsInput'),
    migratedFromHabitId: nullableStringSchema(),
    minimumVersion: nullableRef('SelfCareMinimumVersionInput'),
    preferredTimeOfDay: nullableEnumSchema(selfCareTimeOfDaySchema.options),
    procedureDetails: ref('SelfCareProcedureDetailsInput'),
    scheduleRule: ref('SelfCareScheduleRuleInput'),
    steps: arrayOfRef('SelfCareRitualStepInput'),
    title: {
      maxLength: 160,
      minLength: 1,
      type: 'string',
    },
    type: enumSchema(selfCareItemTypeSchema.options),
  }
}
