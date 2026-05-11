import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

export const habitFrequencySchema = z.enum(['daily', 'weekly', 'custom'])
export const habitTargetTypeSchema = z.enum(['check', 'count', 'duration'])
export const habitEntryStatusSchema = z.enum(['done', 'skipped'])

export const isoWeekdaySchema = z.number().int().min(1).max(7)

const habitDaysOfWeekSchema = z
  .array(isoWeekdaySchema)
  .min(1)
  .max(7)
  .transform((days) => [...new Set(days)].sort((left, right) => left - right))

export const habitSchema = z.object({
  color: z.string().min(1),
  createdAt: z.string(),
  description: z.string(),
  endDate: z.string().nullable(),
  frequency: habitFrequencySchema,
  daysOfWeek: z.array(isoWeekdaySchema),
  icon: z.string().min(1),
  id: z.string(),
  isActive: z.boolean(),
  reminderTime: z.string().nullable(),
  sortOrder: z.number().int(),
  sphereId: z.string().nullable(),
  startDate: z.string(),
  targetType: habitTargetTypeSchema,
  targetValue: z.number().int().positive(),
  title: z.string().min(1),
  unit: z.string(),
  updatedAt: z.string(),
  userId: z.string(),
})

export const habitEntrySchema = z.object({
  createdAt: z.string(),
  date: z.string(),
  habitId: z.string(),
  id: z.string(),
  note: z.string(),
  status: habitEntryStatusSchema,
  updatedAt: z.string(),
  userId: z.string(),
  value: z.number().int().nonnegative(),
})

export const newHabitInputSchema = z
  .object({
    color: z.string().trim().min(1).optional().default('#2f6f62'),
    daysOfWeek: habitDaysOfWeekSchema.optional(),
    description: z.string().trim().max(600).optional().default(''),
    endDate: z.string().nullable().optional().default(null),
    frequency: habitFrequencySchema.optional().default('daily'),
    icon: z.string().trim().min(1).optional().default('check'),
    id: uuidV7Schema.optional(),
    reminderTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional()
      .default(null),
    sortOrder: z.number().int().optional(),
    sphereId: z.string().nullable().optional().default(null),
    startDate: z.string().optional(),
    targetType: habitTargetTypeSchema.optional().default('check'),
    targetValue: z.coerce.number().int().positive().optional().default(1),
    title: z.string().trim().min(1).max(120),
    unit: z.string().trim().max(24).optional().default(''),
  })
  .transform((value) => ({
    ...value,
    daysOfWeek:
      value.daysOfWeek ??
      (value.frequency === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5]),
  }))
  .refine(
    (value) =>
      value.endDate === null ||
      value.startDate === undefined ||
      value.endDate >= value.startDate,
    {
      message: 'Habit endDate must be greater than or equal to startDate.',
      path: ['endDate'],
    },
  )

export const habitUpdateInputSchema = z
  .object({
    color: z.string().trim().min(1).optional(),
    daysOfWeek: habitDaysOfWeekSchema.optional(),
    description: z.string().trim().max(600).optional(),
    endDate: z.string().nullable().optional(),
    expectedVersion: z.number().int().positive().optional(),
    frequency: habitFrequencySchema.optional(),
    icon: z.string().trim().min(1).optional(),
    isActive: z.boolean().optional(),
    reminderTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    sortOrder: z.number().int().optional(),
    sphereId: z.string().nullable().optional(),
    startDate: z.string().optional(),
    targetType: habitTargetTypeSchema.optional(),
    targetValue: z.coerce.number().int().positive().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    unit: z.string().trim().max(24).optional(),
  })
  .refine(
    (value) =>
      value.color !== undefined ||
      value.daysOfWeek !== undefined ||
      value.description !== undefined ||
      value.endDate !== undefined ||
      value.frequency !== undefined ||
      value.icon !== undefined ||
      value.isActive !== undefined ||
      value.reminderTime !== undefined ||
      value.sortOrder !== undefined ||
      value.sphereId !== undefined ||
      value.startDate !== undefined ||
      value.targetType !== undefined ||
      value.targetValue !== undefined ||
      value.title !== undefined ||
      value.unit !== undefined,
    'At least one habit field must be provided.',
  )
  .refine(
    (value) =>
      value.endDate === undefined ||
      value.endDate === null ||
      value.startDate === undefined ||
      value.endDate >= value.startDate,
    {
      message: 'Habit endDate must be greater than or equal to startDate.',
      path: ['endDate'],
    },
  )

export const habitEntryUpsertInputSchema = z.object({
  date: z.string(),
  expectedVersion: z.number().int().positive().optional(),
  note: z.string().trim().max(500).optional().default(''),
  status: habitEntryStatusSchema.optional().default('done'),
  value: z.coerce.number().int().nonnegative().optional(),
})

export const habitEntryDeleteInputSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
})

export const habitTodayQuerySchema = z.object({
  date: z.string().optional(),
})

export const habitStatsQuerySchema = z.object({
  from: z.string(),
  to: z.string(),
})

export const habitStatsSchema = z.object({
  bestStreak: z.number().int().nonnegative(),
  completionRate: z.number().int().min(0).max(100),
  completedCount: z.number().int().nonnegative(),
  currentStreak: z.number().int().nonnegative(),
  habitId: z.string(),
  lastCompletedDate: z.string().nullable(),
  missedCount: z.number().int().nonnegative(),
  monthCompleted: z.number().int().nonnegative(),
  monthScheduled: z.number().int().nonnegative(),
  scheduledCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  weekCompleted: z.number().int().nonnegative(),
  weekScheduled: z.number().int().nonnegative(),
})

export type Habit = z.infer<typeof habitSchema>
export type HabitEntry = z.infer<typeof habitEntrySchema>
export type HabitEntryDeleteInput = z.infer<typeof habitEntryDeleteInputSchema>
export type HabitEntryStatus = z.infer<typeof habitEntryStatusSchema>
export type HabitEntryUpsertInput = z.infer<typeof habitEntryUpsertInputSchema>
export type HabitFrequency = z.infer<typeof habitFrequencySchema>
export type HabitStats = z.infer<typeof habitStatsSchema>
export type HabitStatsQuery = z.infer<typeof habitStatsQuerySchema>
export type HabitTargetType = z.infer<typeof habitTargetTypeSchema>
export type HabitTodayQuery = z.infer<typeof habitTodayQuerySchema>
export type HabitUpdateInput = z.infer<typeof habitUpdateInputSchema>
export type IsoWeekday = z.infer<typeof isoWeekdaySchema>
export type NewHabitInput = z.infer<typeof newHabitInputSchema>
