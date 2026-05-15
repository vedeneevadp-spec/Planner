import { z } from 'zod'

import {
  habitFrequencySchema,
  habitTargetTypeSchema,
  isoWeekdaySchema,
} from './habit.js'
import { generateUuidV7, uuidV7Schema } from './uuid.js'

const nullableStringWithDefault = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

const booleanWithDefault = z
  .boolean()
  .optional()
  .transform((value) => value ?? false)

const optionalBoolean = z.boolean().optional()

const optionalTimeZone = z.string().trim().min(1).max(100).optional()

export const taskStatusSchema = z.enum([
  'todo',
  'in_progress',
  'ready_for_review',
  'done',
])
export const taskImportanceSchema = z.enum(['important', 'not_important'])
export const taskUrgencySchema = z.enum(['urgent', 'not_urgent'])
export const taskRecurrenceFrequencySchema = z.enum([
  'daily',
  'weekly',
  'monthly',
  'custom',
])
export const taskResourceSchema = z
  .number()
  .int()
  .min(-5)
  .max(5)
  .nullable()
  .optional()
  .transform((value) => value ?? null)

export const taskIconSchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? '')

const routineDaysOfWeekSchema = z
  .array(isoWeekdaySchema)
  .min(1)
  .max(7)
  .transform((days) => [...new Set(days)].sort((left, right) => left - right))

const recurrenceDaysOfWeekSchema = z
  .array(isoWeekdaySchema)
  .min(1)
  .max(7)
  .transform((days) => [...new Set(days)].sort((left, right) => left - right))

export const routineTaskSchema = z.object({
  daysOfWeek: routineDaysOfWeekSchema,
  frequency: habitFrequencySchema,
  seriesId: z.string().min(1),
  targetType: habitTargetTypeSchema,
  targetValue: z.number().int().positive(),
  unit: z.string(),
})

export const routineTaskInputSchema = z
  .object({
    daysOfWeek: routineDaysOfWeekSchema.optional(),
    frequency: habitFrequencySchema.optional().default('daily'),
    seriesId: uuidV7Schema.optional(),
    targetType: habitTargetTypeSchema.optional().default('check'),
    targetValue: z.coerce.number().int().positive().optional().default(1),
    unit: z.string().trim().max(24).optional().default(''),
  })
  .transform((value) => ({
    ...value,
    daysOfWeek:
      value.daysOfWeek ??
      (value.frequency === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5]),
    seriesId: value.seriesId ?? generateUuidV7(),
  }))

export const taskRecurrenceSchema = z.object({
  daysOfWeek: recurrenceDaysOfWeekSchema,
  endDate: z.string().nullable(),
  frequency: taskRecurrenceFrequencySchema,
  interval: z.number().int().positive().optional().default(1),
  isActive: z.boolean(),
  seriesId: z.string().min(1),
  startDate: z.string(),
})

export const taskRecurrenceInputSchema = z
  .object({
    daysOfWeek: recurrenceDaysOfWeekSchema.optional(),
    endDate: z.string().nullable().optional().default(null),
    frequency: taskRecurrenceFrequencySchema.optional().default('daily'),
    interval: z.coerce.number().int().positive().optional().default(1),
    isActive: z.boolean().optional().default(true),
    seriesId: uuidV7Schema.optional(),
    startDate: z.string().optional(),
  })
  .transform((value) => ({
    ...value,
    daysOfWeek:
      value.daysOfWeek ??
      (value.frequency === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5]),
    seriesId: value.seriesId ?? generateUuidV7(),
    startDate: value.startDate ?? new Date().toISOString().slice(0, 10),
  }))
  .refine(
    (value) => value.endDate === null || value.endDate >= value.startDate,
    {
      message:
        'Task recurrence endDate must be greater than or equal to startDate.',
      path: ['endDate'],
    },
  )

export const taskSchema = z.object({
  assigneeDisplayName: nullableStringWithDefault,
  assigneeUserId: nullableStringWithDefault,
  authorDisplayName: nullableStringWithDefault,
  authorUserId: nullableStringWithDefault,
  id: z.string(),
  title: z.string().min(1),
  note: z.string(),
  icon: taskIconSchema,
  importance: taskImportanceSchema.optional().default('not_important'),
  urgency: taskUrgencySchema.optional().default('not_urgent'),
  remindBeforeStart: optionalBoolean,
  projectId: nullableStringWithDefault,
  sphereId: nullableStringWithDefault,
  project: z.string(),
  recurrence: taskRecurrenceSchema.nullable().optional(),
  routine: routineTaskSchema.nullable().optional(),
  status: taskStatusSchema,
  resource: taskResourceSchema,
  requiresConfirmation: booleanWithDefault,
  plannedDate: nullableStringWithDefault,
  plannedStartTime: nullableStringWithDefault,
  plannedEndTime: nullableStringWithDefault,
  dueDate: nullableStringWithDefault,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})

export const tasksSchema = z.array(taskSchema)

export const taskScheduleInputSchema = z.object({
  plannedDate: nullableStringWithDefault,
  plannedStartTime: nullableStringWithDefault,
  plannedEndTime: nullableStringWithDefault,
})

export const newTaskInputSchema = z.object({
  assigneeUserId: nullableStringWithDefault,
  id: uuidV7Schema.optional(),
  title: z.string().min(1),
  note: z.string(),
  icon: z.string().optional(),
  importance: taskImportanceSchema.optional(),
  urgency: taskUrgencySchema.optional(),
  remindBeforeStart: optionalBoolean,
  reminderTimeZone: optionalTimeZone,
  projectId: nullableStringWithDefault,
  sphereId: nullableStringWithDefault,
  project: z.string(),
  recurrence: taskRecurrenceInputSchema.nullable().optional(),
  routine: routineTaskInputSchema.nullable().optional(),
  resource: taskResourceSchema,
  requiresConfirmation: booleanWithDefault,
  plannedDate: nullableStringWithDefault,
  plannedStartTime: nullableStringWithDefault,
  plannedEndTime: nullableStringWithDefault,
  dueDate: nullableStringWithDefault,
})

export const taskUpdateInputSchema = newTaskInputSchema
  .omit({ id: true })
  .extend({
    expectedVersion: z.number().int().positive().optional(),
  })

export const taskStatusChangeSchema = z.object({
  taskId: z.string(),
  status: taskStatusSchema,
  expectedVersion: z.number().int().positive().optional(),
})

export const taskScheduleChangeSchema = z.object({
  taskId: z.string(),
  schedule: taskScheduleInputSchema,
  expectedVersion: z.number().int().positive().optional(),
})

export const taskDeleteSchema = z.object({
  taskId: z.string(),
  expectedVersion: z.number().int().positive().optional(),
})

export type TaskStatus = z.infer<typeof taskStatusSchema>
export type TaskImportance = z.infer<typeof taskImportanceSchema>
export type RoutineTask = z.infer<typeof routineTaskSchema>
export type RoutineTaskInput = z.input<typeof routineTaskInputSchema>
export type TaskRecurrence = z.infer<typeof taskRecurrenceSchema>
export type TaskRecurrenceFrequency = z.infer<
  typeof taskRecurrenceFrequencySchema
>
export type TaskRecurrenceInput = z.input<typeof taskRecurrenceInputSchema>
export type TaskUrgency = z.infer<typeof taskUrgencySchema>
export type TaskResource = z.infer<typeof taskResourceSchema>
export type Task = z.infer<typeof taskSchema>
export type TaskScheduleInput = z.infer<typeof taskScheduleInputSchema>
export type NewTaskInput = z.infer<typeof newTaskInputSchema>
export type TaskUpdateInput = z.infer<typeof taskUpdateInputSchema>
export type TaskStatusChange = z.infer<typeof taskStatusChangeSchema>
export type TaskScheduleChange = z.infer<typeof taskScheduleChangeSchema>
export type TaskDelete = z.infer<typeof taskDeleteSchema>
