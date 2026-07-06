import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

const nullableStringInput = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? null : value))
const optionalTextInput = z.string().trim().max(1200).optional().default('')
const positiveNullableIntegerInput = z
  .number()
  .int()
  .positive()
  .nullable()
  .optional()
  .transform((value) => value ?? null)
const optionalRatingSchema = z.number().int().min(1).max(5).optional()
const optionalMoneySchema = z.number().nonnegative().optional()
const nullableNumberInput = z
  .number()
  .finite()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

export const selfCareItemTypeSchema = z.enum([
  'task',
  'habit',
  'ritual',
  'procedure',
  'appointment',
  'medical',
  'flexible_goal',
  'course',
  'mood_check',
  'measurement',
  'exercise',
  'rest_action',
])
export const selfCareExerciseMetricTypeSchema = z.enum([
  'weight',
  'time',
  'count',
  'distance',
])
export const selfCareExerciseUnitSchema = z.enum([
  'kg',
  'min',
  'reps',
  'm',
  'km',
])
export const selfCareCategorySchema = z.enum([
  'health',
  'beauty',
  'body',
  'movement',
  'relax',
  'daily_base',
  'emotional',
  'sleep',
  'nutrition',
  'medical',
  'custom',
])
export const selfCareImportanceSchema = z.enum([
  'required',
  'recommended',
  'gentle',
])
export const selfCareTimeOfDaySchema = z.enum([
  'morning',
  'afternoon',
  'evening',
  'night',
  'anytime',
])
export const selfCareRepeatKindSchema = z.enum([
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'interval',
  'after_completion',
  'flexible_goal',
  'course',
])
export const selfCareIntervalUnitSchema = z.enum([
  'day',
  'week',
  'month',
  'year',
])
export const selfCareFlexiblePeriodSchema = z.enum(['day', 'week', 'month'])
export const selfCareOccurrenceStatusSchema = z.enum([
  'scheduled',
  'done',
  'partial',
  'skipped',
  'moved',
  'cancelled',
  'missed',
])
export const selfCareCompletionStatusSchema = z.enum([
  'done',
  'partial',
  'skipped',
  'moved',
  'cancelled',
  'alternative_done',
])
export const selfCareCompletedVariantSchema = z.enum([
  'full',
  'minimum',
  'alternative',
])
export const selfCareCourseTypeSchema = z.enum(['sessions', 'days'])
export const selfCareReminderToneSchema = z.enum(['soft', 'normal'])
export const selfCareReminderStrategySchema = z.enum([
  'soft',
  'normal',
  'persistent',
])

const selfCareReminderOffsetMinuteValues = [
  0, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080, 43200,
] as const
const selfCareReminderOffsetMinuteSet = new Set<number>(
  selfCareReminderOffsetMinuteValues,
)

const reminderOffsetsSchema = z
  .array(
    z
      .number()
      .int()
      .refine(
        (value) => selfCareReminderOffsetMinuteSet.has(value),
        'Unsupported self-care reminder offset.',
      ),
  )
  .max(8)
  .transform((values) =>
    [...new Set(values)].sort((left, right) => left - right),
  )
  .optional()

export const selfCareMinimumVersionInputSchema = z.object({
  description: z.string().trim().max(600).optional().default(''),
  durationMinutes: positiveNullableIntegerInput,
  title: z.string().trim().min(1).max(160),
})

export const selfCareAlternativeInputSchema = z.object({
  countsAsCompletion: z.boolean().optional().default(true),
  description: z.string().trim().max(600).optional().default(''),
  id: uuidV7Schema.optional(),
  title: z.string().trim().min(1).max(160),
})

export const selfCareItemSchema = z.object({
  color: z.string().nullable(),
  createdAt: z.string(),
  createdFromTemplateId: z.string().nullable(),
  customCategoryId: z.string().nullable(),
  defaultDurationMinutes: z.number().int().positive().nullable(),
  deletedAt: z.string().nullable(),
  description: z.string(),
  icon: z.string().nullable(),
  id: z.string(),
  importance: selfCareImportanceSchema,
  isActive: z.boolean(),
  isArchived: z.boolean(),
  isPrivate: z.boolean(),
  category: selfCareCategorySchema,
  migratedFromHabitId: z.string().nullable(),
  minimumVersionDescription: z.string().nullable(),
  minimumVersionDurationMinutes: z.number().int().positive().nullable(),
  minimumVersionTitle: z.string().nullable(),
  preferredTimeOfDay: selfCareTimeOfDaySchema.nullable(),
  title: z.string().min(1),
  type: selfCareItemTypeSchema,
  updatedAt: z.string(),
  userId: z.string(),
  version: z.number().int().positive(),
  workspaceId: z.string(),
})

export const selfCareScheduleRuleSchema = z.object({
  allowMultiplePerDay: z.boolean(),
  createdAt: z.string(),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  daysOfWeek: z.array(z.number().int().min(1).max(7)),
  endDate: z.string().nullable(),
  flexiblePeriod: selfCareFlexiblePeriodSchema.nullable(),
  flexibleTargetCount: z.number().int().positive().nullable(),
  generateInCalendar: z.boolean(),
  generateInTaskList: z.boolean(),
  id: z.string(),
  intervalUnit: selfCareIntervalUnitSchema.nullable(),
  intervalValue: z.number().int().positive().nullable(),
  itemId: z.string(),
  monthOfYear: z.number().int().min(1).max(12).nullable(),
  preferredTime: z.string().nullable(),
  reminderOffsetsMinutes: z.array(z.number().int()),
  repeatKind: selfCareRepeatKindSchema,
  startDate: z.string().nullable(),
  timezone: z.string().nullable(),
  updatedAt: z.string(),
  weekOfMonth: z.number().int().min(-1).max(5).nullable(),
})

export const selfCareOccurrenceSchema = z.object({
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  dueAt: z.string().nullable(),
  generatedAt: z.string().nullable(),
  id: z.string(),
  itemId: z.string(),
  movedTo: z.string().nullable(),
  reminderOffsetsMinutes: z.array(z.number().int()),
  reminderTimeZone: z.string().nullable(),
  scheduledFor: z.string(),
  scheduleRuleId: z.string().nullable(),
  status: selfCareOccurrenceStatusSchema,
  updatedAt: z.string(),
  userId: z.string(),
})

export const selfCareCompletionSchema = z.object({
  alternativeTitle: z.string().nullable(),
  completedAt: z.string(),
  completedVariant: selfCareCompletedVariantSchema.nullable(),
  createdAt: z.string(),
  currency: z.string().nullable().optional().default(null),
  durationMinutes: z.number().int().positive().nullable(),
  energyAfter: optionalRatingSchema.nullable().optional().default(null),
  energyBefore: optionalRatingSchema.nullable().optional().default(null),
  exerciseSets: z
    .array(
      z.object({
        index: z.number().int().positive(),
        value: z.number().finite(),
      }),
    )
    .optional()
    .default([]),
  id: z.string(),
  itemId: z.string(),
  measurementUnit: z.string().nullable(),
  measurementValue: z.number().nullable(),
  moodAfter: optionalRatingSchema.nullable().optional().default(null),
  moodBefore: optionalRatingSchema.nullable().optional().default(null),
  note: z.string(),
  occurrenceId: z.string().nullable(),
  price: z.number().nonnegative().nullable().optional().default(null),
  scheduledFor: z.string().nullable(),
  status: selfCareCompletionStatusSchema,
  userId: z.string(),
})

export const selfCareRitualStepSchema = z.object({
  createdAt: z.string(),
  defaultChecked: z.boolean().optional().default(false),
  id: z.string(),
  isOptional: z.boolean(),
  itemId: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  updatedAt: z.string(),
})

export const selfCareRitualStepCompletionSchema = z.object({
  completionId: z.string(),
  id: z.string(),
  isDone: z.boolean(),
  stepId: z.string(),
})

export const selfCareRitualStepDraftSchema = z.object({
  date: z.string().min(1),
  itemId: z.string().min(1),
  occurrenceId: z.string().min(1).nullable(),
  stepIds: z
    .array(z.string().min(1))
    .transform((values) => [...new Set(values)]),
})

export const selfCareRitualStepDraftInputSchema = selfCareRitualStepDraftSchema

export const selfCareRitualStepDraftListResponseSchema = z.object({
  date: z.string().min(1),
  drafts: z.array(selfCareRitualStepDraftSchema),
})

export const selfCareProcedureDetailsSchema = z.object({
  contact: z.string().nullable(),
  createdAt: z.string(),
  currency: z.string().nullable(),
  defaultPrice: z.number().nonnegative().nullable(),
  id: z.string(),
  itemId: z.string(),
  place: z.string().nullable(),
  specialistName: z.string().nullable(),
  updatedAt: z.string(),
})

export const selfCareAppointmentDetailsSchema = z.object({
  createdAt: z.string(),
  currency: z.string().nullable(),
  endsAt: z.string().nullable(),
  id: z.string(),
  itemId: z.string(),
  occurrenceId: z.string().nullable(),
  place: z.string().nullable(),
  preparationNote: z.string().nullable(),
  price: z.number().nonnegative().nullable(),
  resultNote: z.string().nullable(),
  specialistContact: z.string().nullable(),
  specialistName: z.string().nullable(),
  startsAt: z.string(),
  updatedAt: z.string(),
})

export const selfCareMedicalDetailsSchema = z.object({
  analysisList: z.array(z.string()),
  clinicAddress: z.string().nullable(),
  clinicName: z.string().nullable(),
  createdAt: z.string(),
  documentUrls: z.array(z.string()),
  doctorName: z.string().nullable(),
  id: z.string(),
  itemId: z.string(),
  nextControlDate: z.string().nullable(),
  phone: z.string().nullable(),
  reminderStrategy: selfCareReminderStrategySchema,
  resultNote: z.string().nullable(),
  updatedAt: z.string(),
  website: z.string().nullable(),
})

export const selfCareCourseDetailsSchema = z.object({
  breakDays: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  courseType: selfCareCourseTypeSchema,
  createdAt: z.string(),
  endDate: z.string().nullable(),
  id: z.string(),
  isCompleted: z.boolean(),
  isPaused: z.boolean(),
  itemId: z.string(),
  repeatAfterCompletion: z.boolean(),
  startDate: z.string().nullable(),
  totalCount: z.number().int().positive(),
  updatedAt: z.string(),
})

export const selfCareMeasurementDetailsSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  itemId: z.string(),
  targetMax: z.number().nullable(),
  targetMin: z.number().nullable(),
  unit: z.string(),
  updatedAt: z.string(),
  valueLabel: z.string(),
})

export const selfCareExerciseDetailsSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  itemId: z.string(),
  metricType: selfCareExerciseMetricTypeSchema,
  plannedSets: z.number().int().positive().nullable(),
  plannedValue: z.number().nullable(),
  unit: selfCareExerciseUnitSchema,
  updatedAt: z.string(),
  useSets: z.boolean(),
})

export const selfCareDailyStateSchema = z.object({
  createdAt: z.string(),
  date: z.string(),
  energy: optionalRatingSchema.nullable().optional().default(null),
  id: z.string(),
  mood: optionalRatingSchema.nullable().optional().default(null),
  note: z.string(),
  pain: optionalRatingSchema.nullable().optional().default(null),
  sleepQuality: optionalRatingSchema.nullable().optional().default(null),
  stress: optionalRatingSchema.nullable().optional().default(null),
  updatedAt: z.string(),
  userId: z.string(),
})

export const selfCareTemplateSchema = z.object({
  category: selfCareCategorySchema,
  color: z.string().nullable(),
  createdAt: z.string(),
  defaultSchedule: z.unknown().nullable(),
  defaultSteps: z.array(z.string()),
  description: z.string(),
  icon: z.string().nullable(),
  id: z.string(),
  importance: selfCareImportanceSchema,
  isSystem: z.boolean(),
  title: z.string().min(1),
  type: selfCareItemTypeSchema,
  updatedAt: z.string(),
})

export const selfCareSettingsSchema = z.object({
  createdAt: z.string(),
  currency: z.string().nullable(),
  defaultReminderTone: selfCareReminderToneSchema,
  gentleModeDate: z.string().nullable(),
  gentleModeEnabledToday: z.boolean(),
  id: z.string(),
  quietHoursEnd: z.string().nullable(),
  quietHoursStart: z.string().nullable(),
  showAppointmentsInCalendar: z.boolean(),
  showSelfCareInMainTasks: z.boolean(),
  updatedAt: z.string(),
  userId: z.string(),
})

export const selfCareMinimumItemSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  isActive: z.boolean(),
  linkedItemId: z.string().nullable(),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  updatedAt: z.string(),
  userId: z.string(),
})

export const selfCareItemAlternativeSchema = z.object({
  countsAsCompletion: z.boolean(),
  description: z.string(),
  id: z.string(),
  itemId: z.string(),
  title: z.string().min(1),
})

export const selfCareListResponseSchema = z.object({
  alternatives: z.array(selfCareItemAlternativeSchema),
  appointmentDetails: z.array(selfCareAppointmentDetailsSchema),
  courseDetails: z.array(selfCareCourseDetailsSchema),
  exerciseDetails: z.array(selfCareExerciseDetailsSchema),
  items: z.array(selfCareItemSchema),
  medicalDetails: z.array(selfCareMedicalDetailsSchema),
  measurementDetails: z.array(selfCareMeasurementDetailsSchema),
  procedureDetails: z.array(selfCareProcedureDetailsSchema),
  scheduleRules: z.array(selfCareScheduleRuleSchema),
  steps: z.array(selfCareRitualStepSchema),
})

export const selfCareFlexibleGoalProgressSchema = z.object({
  completedCount: z.number().int().nonnegative(),
  periodEnd: z.string(),
  periodStart: z.string(),
  remainingCount: z.number().int().nonnegative(),
  targetCount: z.number().int().nonnegative(),
})

export const selfCareTodayItemSchema = z.object({
  appointment: selfCareAppointmentDetailsSchema.nullable(),
  completion: selfCareCompletionSchema.nullable(),
  courseDetails: selfCareCourseDetailsSchema.nullable(),
  exercise: selfCareExerciseDetailsSchema.nullable(),
  flexibleProgress: selfCareFlexibleGoalProgressSchema.nullable(),
  item: selfCareItemSchema,
  lastExercise: selfCareCompletionSchema.nullable(),
  lastMeasurement: selfCareCompletionSchema.nullable(),
  measurement: selfCareMeasurementDetailsSchema.nullable(),
  occurrence: selfCareOccurrenceSchema.nullable(),
  procedure: selfCareProcedureDetailsSchema.nullable(),
  scheduleRule: selfCareScheduleRuleSchema.nullable(),
  steps: z.array(selfCareRitualStepSchema),
  timeGroup: selfCareTimeOfDaySchema,
})

export const selfCareDashboardResponseSchema = z.object({
  date: z.string(),
  dailyState: selfCareDailyStateSchema.nullable(),
  flexibleGoals: z.array(selfCareTodayItemSchema),
  gentleMode: z.boolean(),
  minimumItems: z.array(selfCareMinimumItemSchema),
  overdueItems: z.array(selfCareTodayItemSchema),
  planningHints: z.array(selfCareTodayItemSchema),
  settings: selfCareSettingsSchema,
  todayItems: z.array(selfCareTodayItemSchema),
  upcomingImportant: z.array(selfCareTodayItemSchema),
})

export const selfCarePlanResponseSchema = z.object({
  courses: z.array(selfCareTodayItemSchema),
  from: z.string(),
  medical: z.array(selfCareTodayItemSchema),
  occurrences: z.array(selfCareTodayItemSchema),
  planningHints: z.array(selfCareTodayItemSchema),
  to: z.string(),
})

export const selfCareHistoryResponseSchema = z.object({
  appointmentDetails: z.array(selfCareAppointmentDetailsSchema),
  completions: z.array(selfCareCompletionSchema),
  items: z.array(selfCareItemSchema),
  procedureDetails: z.array(selfCareProcedureDetailsSchema),
  stepCompletions: z.array(selfCareRitualStepCompletionSchema),
})

const selfCareAnalyticsTrendPointBaseSchema = z.object({
  alternativeTitle: z.string().nullable(),
  completedAt: z.string(),
  completedVariant: selfCareCompletedVariantSchema.nullable(),
  completionId: z.string(),
  date: z.string(),
  durationMinutes: z.number().int().positive().nullable(),
  energyAfter: optionalRatingSchema.nullable().optional().default(null),
  energyBefore: optionalRatingSchema.nullable().optional().default(null),
  moodAfter: optionalRatingSchema.nullable().optional().default(null),
  moodBefore: optionalRatingSchema.nullable().optional().default(null),
  note: z.string(),
  scheduledFor: z.string().nullable(),
  status: selfCareCompletionStatusSchema,
})

export const selfCareMeasurementTrendPointSchema =
  selfCareAnalyticsTrendPointBaseSchema.extend({
    value: z.number(),
  })

export const selfCareMeasurementTrendSchema = z.object({
  itemId: z.string(),
  points: z.array(selfCareMeasurementTrendPointSchema),
  title: z.string(),
  unit: z.string().nullable(),
  valueLabel: z.string(),
})

export const selfCareExerciseTrendPointSchema =
  selfCareAnalyticsTrendPointBaseSchema.extend({
    sets: z.array(
      z.object({
        index: z.number().int().positive(),
        value: z.number().finite(),
      }),
    ),
    value: z.number(),
  })

export const selfCareExerciseTrendSchema = z.object({
  itemId: z.string(),
  metricType: selfCareExerciseMetricTypeSchema,
  points: z.array(selfCareExerciseTrendPointSchema),
  title: z.string(),
  unit: selfCareExerciseUnitSchema,
})

export const selfCareAnalyticsResponseSchema = z.object({
  balanceByCategory: z.record(
    selfCareCategorySchema,
    z.number().int().nonnegative(),
  ),
  completionsByDay: z.record(z.string(), z.number().int().nonnegative()),
  courses: z.array(selfCareTodayItemSchema),
  exerciseTrends: z.array(selfCareExerciseTrendSchema),
  flexibleGoals: z.array(selfCareTodayItemSchema),
  measurementTrends: z.array(selfCareMeasurementTrendSchema),
  medicalUpcoming: z.array(selfCareTodayItemSchema),
  minimumCompletionCount: z.number().int().nonnegative(),
  moodEnergyTrend: z.array(selfCareDailyStateSchema),
  procedureCosts: z.number().nonnegative(),
  procedureCostsByMonth: z.record(z.string(), z.number().nonnegative()),
  selectedSelfCareCount: z.number().int().nonnegative(),
})

export const selfCareSettingsResponseSchema = z.object({
  minimumItems: z.array(selfCareMinimumItemSchema),
  settings: selfCareSettingsSchema,
})

export const selfCareScheduleRuleInputSchema = z
  .object({
    allowMultiplePerDay: z.boolean().optional().default(false),
    dayOfMonth: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .optional()
      .default(null),
    daysOfWeek: z.array(z.number().int().min(1).max(7)).optional().default([]),
    endDate: nullableStringInput,
    flexiblePeriod: selfCareFlexiblePeriodSchema
      .nullable()
      .optional()
      .default(null),
    flexibleTargetCount: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .default(null),
    generateInCalendar: z.boolean().optional().default(false),
    generateInTaskList: z.boolean().optional().default(true),
    id: uuidV7Schema.optional(),
    intervalUnit: selfCareIntervalUnitSchema
      .nullable()
      .optional()
      .default(null),
    intervalValue: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .default(null),
    monthOfYear: z
      .number()
      .int()
      .min(1)
      .max(12)
      .nullable()
      .optional()
      .default(null),
    preferredTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional()
      .default(null),
    reminderOffsetsMinutes: reminderOffsetsSchema.default([]),
    repeatKind: selfCareRepeatKindSchema,
    startDate: nullableStringInput,
    timezone: nullableStringInput,
    weekOfMonth: z
      .number()
      .int()
      .min(-1)
      .max(5)
      .nullable()
      .optional()
      .default(null),
  })
  .superRefine((value, ctx) => {
    if (
      (value.repeatKind === 'interval' ||
        value.repeatKind === 'after_completion') &&
      (!value.intervalValue || !value.intervalUnit)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'intervalValue and intervalUnit are required.',
        path: ['intervalValue'],
      })
    }

    if (
      value.repeatKind === 'flexible_goal' &&
      (!value.flexibleTargetCount || !value.flexiblePeriod)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'flexibleTargetCount and flexiblePeriod are required.',
        path: ['flexibleTargetCount'],
      })
    }
  })

export const selfCareRitualStepInputSchema = z.object({
  defaultChecked: z.boolean().optional().default(false),
  id: uuidV7Schema.optional(),
  isOptional: z.boolean().optional().default(false),
  order: z.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).max(160),
})

export const selfCareProcedureDetailsInputSchema = z.object({
  contact: nullableStringInput,
  currency: nullableStringInput,
  defaultPrice: optionalMoneySchema.nullable().optional().default(null),
  place: nullableStringInput,
  specialistName: nullableStringInput,
})

export const selfCareAppointmentDetailsInputSchema = z.object({
  currency: nullableStringInput,
  endsAt: nullableStringInput,
  place: nullableStringInput,
  preparationNote: nullableStringInput,
  price: optionalMoneySchema.nullable().optional().default(null),
  resultNote: nullableStringInput,
  specialistContact: nullableStringInput,
  specialistName: nullableStringInput,
  startsAt: z.string().min(1),
})

export const selfCareMedicalDetailsInputSchema = z.object({
  analysisList: z
    .array(z.string().trim().min(1).max(160))
    .optional()
    .default([]),
  clinicAddress: nullableStringInput,
  clinicName: nullableStringInput,
  documentUrls: z
    .array(z.string().trim().min(1).max(800))
    .optional()
    .default([]),
  doctorName: nullableStringInput,
  nextControlDate: nullableStringInput,
  phone: nullableStringInput,
  reminderStrategy: selfCareReminderStrategySchema.optional().default('soft'),
  resultNote: nullableStringInput,
  website: nullableStringInput,
})

export const selfCareCourseDetailsInputSchema = z.object({
  breakDays: z.number().int().nonnegative().optional().default(0),
  completedCount: z.number().int().nonnegative().optional().default(0),
  courseType: selfCareCourseTypeSchema,
  endDate: nullableStringInput,
  isCompleted: z.boolean().optional().default(false),
  isPaused: z.boolean().optional().default(false),
  repeatAfterCompletion: z.boolean().optional().default(false),
  startDate: nullableStringInput,
  totalCount: z.number().int().positive(),
})

export const selfCareMeasurementDetailsInputSchema = z
  .object({
    targetMax: nullableNumberInput,
    targetMin: nullableNumberInput,
    unit: z.string().trim().min(1).max(32),
    valueLabel: z.string().trim().min(1).max(80).optional().default('Значение'),
  })
  .superRefine((value, ctx) => {
    if (
      value.targetMin !== null &&
      value.targetMax !== null &&
      value.targetMin > value.targetMax
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'targetMin must be less than or equal to targetMax.',
        path: ['targetMin'],
      })
    }
  })

export const selfCareExerciseDetailsInputSchema = z.object({
  metricType: selfCareExerciseMetricTypeSchema,
  plannedSets: positiveNullableIntegerInput,
  plannedValue: nullableNumberInput,
  unit: selfCareExerciseUnitSchema,
  useSets: z.boolean().optional().default(false),
})

export const selfCareItemInputObjectSchema = z.object({
  alternatives: z.array(selfCareAlternativeInputSchema).optional().default([]),
  appointmentDetails: selfCareAppointmentDetailsInputSchema.optional(),
  category: selfCareCategorySchema,
  color: nullableStringInput,
  courseDetails: selfCareCourseDetailsInputSchema.optional(),
  customCategoryId: nullableStringInput,
  defaultDurationMinutes: positiveNullableIntegerInput,
  description: optionalTextInput,
  icon: nullableStringInput,
  id: uuidV7Schema.optional(),
  importance: selfCareImportanceSchema.optional().default('recommended'),
  isActive: z.boolean().optional().default(true),
  isArchived: z.boolean().optional().default(false),
  isPrivate: z.boolean().optional().default(true),
  exerciseDetails: selfCareExerciseDetailsInputSchema.optional(),
  medicalDetails: selfCareMedicalDetailsInputSchema.optional(),
  measurementDetails: selfCareMeasurementDetailsInputSchema.optional(),
  migratedFromHabitId: z.string().nullable().optional().default(null),
  minimumVersion: selfCareMinimumVersionInputSchema.optional(),
  preferredTimeOfDay: selfCareTimeOfDaySchema
    .nullable()
    .optional()
    .default('anytime'),
  procedureDetails: selfCareProcedureDetailsInputSchema.optional(),
  scheduleRule: selfCareScheduleRuleInputSchema.optional(),
  steps: z.array(selfCareRitualStepInputSchema).optional().default([]),
  title: z.string().trim().min(1).max(160),
  type: selfCareItemTypeSchema,
})

export const selfCareItemInputSchema =
  selfCareItemInputObjectSchema.superRefine((value, ctx) => {
    if (value.type === 'flexible_goal') {
      if (!value.scheduleRule) {
        ctx.addIssue({
          code: 'custom',
          message: 'Flexible goals require a schedule rule.',
          path: ['scheduleRule'],
        })
      } else {
        if (
          value.scheduleRule.repeatKind === 'course' ||
          value.scheduleRule.repeatKind === 'after_completion'
        ) {
          ctx.addIssue({
            code: 'custom',
            message:
              'Flexible goals cannot use course or after-completion schedules.',
            path: ['scheduleRule', 'repeatKind'],
          })
        }

        if (
          !value.scheduleRule.flexibleTargetCount ||
          !value.scheduleRule.flexiblePeriod
        ) {
          ctx.addIssue({
            code: 'custom',
            message:
              'Flexible goals require flexibleTargetCount and flexiblePeriod.',
            path: ['scheduleRule', 'flexibleTargetCount'],
          })
        }
      }
    }

    if (value.type === 'course' && !value.courseDetails) {
      ctx.addIssue({
        code: 'custom',
        message: 'Course details are required for courses.',
        path: ['courseDetails'],
      })
    }

    if (value.type === 'appointment' && !value.appointmentDetails?.startsAt) {
      ctx.addIssue({
        code: 'custom',
        message: 'startsAt is required for appointments.',
        path: ['appointmentDetails', 'startsAt'],
      })
    }

    if (value.type === 'measurement' && !value.measurementDetails) {
      ctx.addIssue({
        code: 'custom',
        message: 'Measurement details are required for measurement items.',
        path: ['measurementDetails'],
      })
    }

    if (value.type === 'exercise' && !value.exerciseDetails) {
      ctx.addIssue({
        code: 'custom',
        message: 'Exercise details are required for exercise items.',
        path: ['exerciseDetails'],
      })
    }
  })

export const selfCareItemUpdateInputSchema = selfCareItemInputObjectSchema
  .partial()
  .extend({
    expectedVersion: z.number().int().positive().optional(),
    minimumVersion: selfCareMinimumVersionInputSchema.nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'expectedVersion'),
    'At least one self-care item field must be provided.',
  )

export const selfCareCompletionInputSchema = z.object({
  alternativeTitle: nullableStringInput,
  completedAt: z.string().optional(),
  completedVariant: selfCareCompletedVariantSchema
    .nullable()
    .optional()
    .default(null),
  currency: nullableStringInput,
  durationMinutes: positiveNullableIntegerInput,
  energyAfter: optionalRatingSchema.nullable().optional().default(null),
  energyBefore: optionalRatingSchema.nullable().optional().default(null),
  exerciseSets: z
    .array(
      z.object({
        index: z.number().int().positive(),
        value: z.number().finite(),
      }),
    )
    .optional()
    .default([]),
  measurementUnit: nullableStringInput,
  measurementValue: nullableNumberInput,
  moodAfter: optionalRatingSchema.nullable().optional().default(null),
  moodBefore: optionalRatingSchema.nullable().optional().default(null),
  note: z.string().trim().max(1200).optional().default(''),
  price: optionalMoneySchema.nullable().optional().default(null),
  status: selfCareCompletionStatusSchema.optional().default('done'),
})

const optionalNullableStringPatch = z.string().trim().nullable().optional()
const optionalNullableNumberPatch = z.number().finite().nullable().optional()
const optionalNullableMoneyPatch = z
  .number()
  .nonnegative()
  .nullable()
  .optional()

export const selfCareCompletionUpdateInputSchema = z
  .object({
    alternativeTitle: optionalNullableStringPatch,
    completedVariant: selfCareCompletedVariantSchema.nullable().optional(),
    currency: optionalNullableStringPatch,
    durationMinutes: z.number().int().positive().nullable().optional(),
    energyAfter: optionalRatingSchema.nullable().optional(),
    energyBefore: optionalRatingSchema.nullable().optional(),
    exerciseSets: z
      .array(
        z.object({
          index: z.number().int().positive(),
          value: z.number().finite(),
        }),
      )
      .optional(),
    measurementUnit: optionalNullableStringPatch,
    measurementValue: optionalNullableNumberPatch,
    moodAfter: optionalRatingSchema.nullable().optional(),
    moodBefore: optionalRatingSchema.nullable().optional(),
    note: z.string().trim().max(1200).optional(),
    price: optionalNullableMoneyPatch,
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one self-care completion field must be provided.',
  )

export const selfCareRitualCompletionInputSchema =
  selfCareCompletionInputSchema.extend({
    steps: z
      .array(z.object({ isDone: z.boolean(), stepId: z.string().min(1) }))
      .optional()
      .default([]),
  })

export const selfCareOccurrenceMoveInputSchema = z.object({
  newDate: z.string().min(1),
  note: z.string().trim().max(600).optional().default(''),
})

export const selfCareItemScheduleInputSchema = z.object({
  currency: nullableStringInput,
  note: z.string().trim().max(600).optional().default(''),
  place: nullableStringInput,
  price: optionalMoneySchema.nullable().optional().default(null),
  reminderOffsetsMinutes: reminderOffsetsSchema.default([]),
  scheduledFor: z.string().min(1),
  scheduledTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  specialistContact: nullableStringInput,
  specialistName: nullableStringInput,
  timezone: nullableStringInput,
})

export const selfCareOccurrenceSkipInputSchema = z.object({
  reason: z.string().trim().max(600).optional().default(''),
})

export const selfCareDailyStateInputSchema = z.object({
  energy: optionalRatingSchema.nullable().optional().default(null),
  mood: optionalRatingSchema.nullable().optional().default(null),
  note: z.string().trim().max(1200).optional().default(''),
  pain: optionalRatingSchema.nullable().optional().default(null),
  sleepQuality: optionalRatingSchema.nullable().optional().default(null),
  stress: optionalRatingSchema.nullable().optional().default(null),
})

export const selfCareSettingsUpdateInputSchema = z.object({
  currency: nullableStringInput,
  showAppointmentsInCalendar: z.boolean().optional(),
  showSelfCareInMainTasks: z.boolean().optional(),
})

export const selfCareMinimumItemInputSchema = z.object({
  id: uuidV7Schema.optional(),
  isActive: z.boolean().optional().default(true),
  linkedItemId: z.string().nullable().optional().default(null),
  order: z.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).max(120),
})

export const selfCareMinimumItemsUpdateInputSchema = z.object({
  items: z.array(selfCareMinimumItemInputSchema).max(20),
})

export const selfCareListQuerySchema = z.object({
  category: selfCareCategorySchema.optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
  type: selfCareItemTypeSchema.optional(),
})

export const selfCareDateQuerySchema = z.object({
  date: z.string().optional(),
})

export const selfCareRangeQuerySchema = z.object({
  from: z.string(),
  to: z.string(),
})

export const selfCareTemplateCreateInputSchema = z.object({
  overrides: selfCareItemInputObjectSchema.partial().optional().default({}),
})

export type SelfCareAlternativeInput = z.infer<
  typeof selfCareAlternativeInputSchema
>
export type SelfCareAnalyticsResponse = z.infer<
  typeof selfCareAnalyticsResponseSchema
>
export type SelfCareAppointmentDetails = z.infer<
  typeof selfCareAppointmentDetailsSchema
>
export type SelfCareAppointmentDetailsInput = z.infer<
  typeof selfCareAppointmentDetailsInputSchema
>
export type SelfCareCategory = z.infer<typeof selfCareCategorySchema>
export type SelfCareCompletion = z.infer<typeof selfCareCompletionSchema>
export type SelfCareCompletionInput = z.infer<
  typeof selfCareCompletionInputSchema
>
export type SelfCareCompletionUpdateInput = z.infer<
  typeof selfCareCompletionUpdateInputSchema
>
export type SelfCareCompletionStatus = z.infer<
  typeof selfCareCompletionStatusSchema
>
export type SelfCareCourseDetails = z.infer<typeof selfCareCourseDetailsSchema>
export type SelfCareCourseDetailsInput = z.infer<
  typeof selfCareCourseDetailsInputSchema
>
export type SelfCareDashboardResponse = z.infer<
  typeof selfCareDashboardResponseSchema
>
export type SelfCareDailyState = z.infer<typeof selfCareDailyStateSchema>
export type SelfCareDailyStateInput = z.infer<
  typeof selfCareDailyStateInputSchema
>
export type SelfCareExerciseDetails = z.infer<
  typeof selfCareExerciseDetailsSchema
>
export type SelfCareExerciseDetailsInput = z.infer<
  typeof selfCareExerciseDetailsInputSchema
>
export type SelfCareExerciseMetricType = z.infer<
  typeof selfCareExerciseMetricTypeSchema
>
export type SelfCareExerciseTrend = z.infer<typeof selfCareExerciseTrendSchema>
export type SelfCareExerciseTrendPoint = z.infer<
  typeof selfCareExerciseTrendPointSchema
>
export type SelfCareExerciseUnit = z.infer<typeof selfCareExerciseUnitSchema>
export type SelfCareFlexibleGoalProgress = z.infer<
  typeof selfCareFlexibleGoalProgressSchema
>
export type SelfCareFlexiblePeriod = z.infer<
  typeof selfCareFlexiblePeriodSchema
>
export type SelfCareHistoryResponse = z.infer<
  typeof selfCareHistoryResponseSchema
>
export type SelfCareImportance = z.infer<typeof selfCareImportanceSchema>
export type SelfCareIntervalUnit = z.infer<typeof selfCareIntervalUnitSchema>
export type SelfCareItem = z.infer<typeof selfCareItemSchema>
export type SelfCareItemAlternative = z.infer<
  typeof selfCareItemAlternativeSchema
>
export type SelfCareItemInput = z.infer<typeof selfCareItemInputSchema>
export type SelfCareItemScheduleInput = z.infer<
  typeof selfCareItemScheduleInputSchema
>
export type SelfCareItemType = z.infer<typeof selfCareItemTypeSchema>
export type SelfCareItemUpdateInput = z.infer<
  typeof selfCareItemUpdateInputSchema
>
export type SelfCareListResponse = z.infer<typeof selfCareListResponseSchema>
export type SelfCareMedicalDetails = z.infer<
  typeof selfCareMedicalDetailsSchema
>
export type SelfCareMedicalDetailsInput = z.infer<
  typeof selfCareMedicalDetailsInputSchema
>
export type SelfCareMeasurementDetails = z.infer<
  typeof selfCareMeasurementDetailsSchema
>
export type SelfCareMeasurementDetailsInput = z.infer<
  typeof selfCareMeasurementDetailsInputSchema
>
export type SelfCareMeasurementTrend = z.infer<
  typeof selfCareMeasurementTrendSchema
>
export type SelfCareMeasurementTrendPoint = z.infer<
  typeof selfCareMeasurementTrendPointSchema
>
export type SelfCareMinimumItem = z.infer<typeof selfCareMinimumItemSchema>
export type SelfCareMinimumItemInput = z.infer<
  typeof selfCareMinimumItemInputSchema
>
export type SelfCareMinimumItemsUpdateInput = z.infer<
  typeof selfCareMinimumItemsUpdateInputSchema
>
export type SelfCareOccurrence = z.infer<typeof selfCareOccurrenceSchema>
export type SelfCareOccurrenceMoveInput = z.infer<
  typeof selfCareOccurrenceMoveInputSchema
>
export type SelfCareOccurrenceSkipInput = z.infer<
  typeof selfCareOccurrenceSkipInputSchema
>
export type SelfCareOccurrenceStatus = z.infer<
  typeof selfCareOccurrenceStatusSchema
>
export type SelfCarePlanResponse = z.infer<typeof selfCarePlanResponseSchema>
export type SelfCareProcedureDetails = z.infer<
  typeof selfCareProcedureDetailsSchema
>
export type SelfCareProcedureDetailsInput = z.infer<
  typeof selfCareProcedureDetailsInputSchema
>
export type SelfCareReminderTone = z.infer<typeof selfCareReminderToneSchema>
export type SelfCareRepeatKind = z.infer<typeof selfCareRepeatKindSchema>
export type SelfCareRitualCompletionInput = z.infer<
  typeof selfCareRitualCompletionInputSchema
>
export type SelfCareRitualStep = z.infer<typeof selfCareRitualStepSchema>
export type SelfCareRitualStepCompletion = z.infer<
  typeof selfCareRitualStepCompletionSchema
>
export type SelfCareRitualStepDraft = z.infer<
  typeof selfCareRitualStepDraftSchema
>
export type SelfCareRitualStepDraftInput = z.infer<
  typeof selfCareRitualStepDraftInputSchema
>
export type SelfCareRitualStepDraftListResponse = z.infer<
  typeof selfCareRitualStepDraftListResponseSchema
>
export type SelfCareRitualStepInput = z.infer<
  typeof selfCareRitualStepInputSchema
>
export type SelfCareScheduleRule = z.infer<typeof selfCareScheduleRuleSchema>
export type SelfCareScheduleRuleInput = z.infer<
  typeof selfCareScheduleRuleInputSchema
>
export type SelfCareSettings = z.infer<typeof selfCareSettingsSchema>
export type SelfCareSettingsResponse = z.infer<
  typeof selfCareSettingsResponseSchema
>
export type SelfCareSettingsUpdateInput = z.infer<
  typeof selfCareSettingsUpdateInputSchema
>
export type SelfCareTemplate = z.infer<typeof selfCareTemplateSchema>
export type SelfCareTemplateCreateInput = z.infer<
  typeof selfCareTemplateCreateInputSchema
>
export type SelfCareTimeOfDay = z.infer<typeof selfCareTimeOfDaySchema>
export type SelfCareTodayItem = z.infer<typeof selfCareTodayItemSchema>
