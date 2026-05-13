import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

export const cleaningWeekdaySchema = z.number().int().min(1).max(7)
export const cleaningPrioritySchema = z.enum(['low', 'normal', 'high'])
export const cleaningFrequencyTypeSchema = z.enum([
  'weekly',
  'monthly',
  'custom',
])
export const cleaningDepthSchema = z.enum(['minimum', 'regular', 'deep'])
export const cleaningEnergySchema = z.enum(['low', 'normal', 'high'])
export const cleaningAssigneeSchema = z.enum([
  'self',
  'partner',
  'child',
  'anyone',
])
export const cleaningTaskHistoryActionSchema = z.enum([
  'completed',
  'postponed',
  'skipped',
])
export const cleaningPostponeModeSchema = z.enum([
  'next_cycle',
  'specific_date',
  'another_day',
])

const cleaningSeasonMonthsSchema = z
  .array(z.number().int().min(1).max(12))
  .max(12)
  .transform((months) =>
    [...new Set(months)].sort((left, right) => left - right),
  )

const cleaningTagsSchema = z
  .array(z.string().trim().min(1).max(36))
  .max(12)
  .transform((tags) => [...new Set(tags)])

export const cleaningZoneSchema = z.object({
  createdAt: z.string(),
  dayOfWeek: cleaningWeekdaySchema,
  description: z.string(),
  id: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  title: z.string().min(1),
  updatedAt: z.string(),
  userId: z.string(),
})

export const cleaningTaskSchema = z.object({
  assignee: cleaningAssigneeSchema,
  createdAt: z.string(),
  customIntervalDays: z.number().int().positive().nullable(),
  depth: cleaningDepthSchema,
  description: z.string(),
  energy: cleaningEnergySchema,
  estimatedMinutes: z.number().int().positive().nullable(),
  frequencyInterval: z.number().int().positive(),
  frequencyType: cleaningFrequencyTypeSchema,
  id: z.string(),
  impactScore: z.number().int().min(1).max(5),
  isActive: z.boolean(),
  isSeasonal: z.boolean(),
  priority: cleaningPrioritySchema,
  seasonMonths: z.array(z.number().int().min(1).max(12)),
  sortOrder: z.number().int(),
  tags: z.array(z.string()),
  title: z.string().min(1),
  updatedAt: z.string(),
  userId: z.string(),
  zoneId: z.string(),
})

export const cleaningTaskStateSchema = z.object({
  lastCompletedAt: z.string().nullable(),
  lastPostponedAt: z.string().nullable(),
  lastSkippedAt: z.string().nullable(),
  nextDueAt: z.string().nullable(),
  postponeCount: z.number().int().nonnegative(),
  taskId: z.string(),
  updatedAt: z.string(),
})

export const cleaningTaskHistoryItemSchema = z.object({
  action: cleaningTaskHistoryActionSchema,
  createdAt: z.string(),
  date: z.string(),
  id: z.string(),
  note: z.string(),
  targetDate: z.string().nullable(),
  taskId: z.string(),
  userId: z.string(),
  zoneId: z.string(),
})

export const newCleaningZoneInputSchema = z.object({
  dayOfWeek: cleaningWeekdaySchema,
  description: z.string().trim().max(600).optional().default(''),
  id: uuidV7Schema.optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional(),
  title: z.string().trim().min(1).max(80),
})

export const cleaningZoneUpdateInputSchema = z
  .object({
    dayOfWeek: cleaningWeekdaySchema.optional(),
    description: z.string().trim().max(600).optional(),
    expectedVersion: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    title: z.string().trim().min(1).max(80).optional(),
  })
  .refine(
    (value) =>
      value.dayOfWeek !== undefined ||
      value.description !== undefined ||
      value.isActive !== undefined ||
      value.sortOrder !== undefined ||
      value.title !== undefined,
    'At least one cleaning zone field must be provided.',
  )

export const newCleaningTaskInputSchema = z
  .object({
    assignee: cleaningAssigneeSchema.optional().default('anyone'),
    customIntervalDays: z.number().int().positive().nullable().optional(),
    depth: cleaningDepthSchema.optional().default('regular'),
    description: z.string().trim().max(800).optional().default(''),
    energy: cleaningEnergySchema.optional().default('normal'),
    estimatedMinutes: z.number().int().positive().nullable().optional(),
    frequencyInterval: z.number().int().positive().optional().default(1),
    frequencyType: cleaningFrequencyTypeSchema.optional().default('weekly'),
    id: uuidV7Schema.optional(),
    impactScore: z.number().int().min(1).max(5).optional().default(3),
    isActive: z.boolean().optional().default(true),
    isSeasonal: z.boolean().optional().default(false),
    priority: cleaningPrioritySchema.optional().default('normal'),
    seasonMonths: cleaningSeasonMonthsSchema.optional().default([]),
    sortOrder: z.number().int().optional(),
    tags: cleaningTagsSchema.optional().default([]),
    title: z.string().trim().min(1).max(140),
    zoneId: z.string().min(1),
  })
  .transform((value) => ({
    ...value,
    customIntervalDays:
      value.frequencyType === 'custom'
        ? (value.customIntervalDays ?? value.frequencyInterval)
        : null,
    estimatedMinutes: value.estimatedMinutes ?? null,
  }))

export const cleaningTaskUpdateInputSchema = z
  .object({
    assignee: cleaningAssigneeSchema.optional(),
    customIntervalDays: z.number().int().positive().nullable().optional(),
    depth: cleaningDepthSchema.optional(),
    description: z.string().trim().max(800).optional(),
    energy: cleaningEnergySchema.optional(),
    estimatedMinutes: z.number().int().positive().nullable().optional(),
    expectedVersion: z.number().int().positive().optional(),
    frequencyInterval: z.number().int().positive().optional(),
    frequencyType: cleaningFrequencyTypeSchema.optional(),
    impactScore: z.number().int().min(1).max(5).optional(),
    isActive: z.boolean().optional(),
    isSeasonal: z.boolean().optional(),
    priority: cleaningPrioritySchema.optional(),
    seasonMonths: cleaningSeasonMonthsSchema.optional(),
    sortOrder: z.number().int().optional(),
    tags: cleaningTagsSchema.optional(),
    title: z.string().trim().min(1).max(140).optional(),
    zoneId: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.assignee !== undefined ||
      value.customIntervalDays !== undefined ||
      value.depth !== undefined ||
      value.description !== undefined ||
      value.energy !== undefined ||
      value.estimatedMinutes !== undefined ||
      value.frequencyInterval !== undefined ||
      value.frequencyType !== undefined ||
      value.impactScore !== undefined ||
      value.isActive !== undefined ||
      value.isSeasonal !== undefined ||
      value.priority !== undefined ||
      value.seasonMonths !== undefined ||
      value.sortOrder !== undefined ||
      value.tags !== undefined ||
      value.title !== undefined ||
      value.zoneId !== undefined,
    'At least one cleaning task field must be provided.',
  )

export const cleaningTaskActionInputSchema = z.object({
  date: z.string().optional(),
  mode: cleaningPostponeModeSchema.optional().default('next_cycle'),
  note: z.string().trim().max(500).optional().default(''),
  targetDate: z.string().nullable().optional().default(null),
})

export const cleaningTodayQuerySchema = z.object({
  date: z.string().optional(),
})

export type CleaningAssignee = z.infer<typeof cleaningAssigneeSchema>
export type CleaningDepth = z.infer<typeof cleaningDepthSchema>
export type CleaningEnergy = z.infer<typeof cleaningEnergySchema>
export type CleaningFrequencyType = z.infer<typeof cleaningFrequencyTypeSchema>
export type CleaningPostponeMode = z.infer<typeof cleaningPostponeModeSchema>
export type CleaningPriority = z.infer<typeof cleaningPrioritySchema>
export type CleaningTask = z.infer<typeof cleaningTaskSchema>
export type CleaningTaskActionInput = z.infer<
  typeof cleaningTaskActionInputSchema
>
export type CleaningTaskHistoryAction = z.infer<
  typeof cleaningTaskHistoryActionSchema
>
export type CleaningTaskHistoryItem = z.infer<
  typeof cleaningTaskHistoryItemSchema
>
export type CleaningTaskState = z.infer<typeof cleaningTaskStateSchema>
export type CleaningTaskUpdateInput = z.infer<
  typeof cleaningTaskUpdateInputSchema
>
export type CleaningTodayQuery = z.infer<typeof cleaningTodayQuerySchema>
export type CleaningWeekday = z.infer<typeof cleaningWeekdaySchema>
export type CleaningZone = z.infer<typeof cleaningZoneSchema>
export type CleaningZoneUpdateInput = z.infer<
  typeof cleaningZoneUpdateInputSchema
>
export type NewCleaningTaskInput = z.infer<typeof newCleaningTaskInputSchema>
export type NewCleaningZoneInput = z.infer<typeof newCleaningZoneInputSchema>
