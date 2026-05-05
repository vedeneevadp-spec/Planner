import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

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
export type TaskUrgency = z.infer<typeof taskUrgencySchema>
export type TaskResource = z.infer<typeof taskResourceSchema>
export type Task = z.infer<typeof taskSchema>
export type TaskScheduleInput = z.infer<typeof taskScheduleInputSchema>
export type NewTaskInput = z.infer<typeof newTaskInputSchema>
export type TaskUpdateInput = z.infer<typeof taskUpdateInputSchema>
export type TaskStatusChange = z.infer<typeof taskStatusChangeSchema>
export type TaskScheduleChange = z.infer<typeof taskScheduleChangeSchema>
export type TaskDelete = z.infer<typeof taskDeleteSchema>
