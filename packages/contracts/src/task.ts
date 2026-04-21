import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

const nullableStringWithDefault = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

export const taskStatusSchema = z.enum(['todo', 'done'])

export const taskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  note: z.string(),
  projectId: nullableStringWithDefault,
  project: z.string(),
  status: taskStatusSchema,
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
  id: uuidV7Schema.optional(),
  title: z.string().min(1),
  note: z.string(),
  projectId: nullableStringWithDefault,
  project: z.string(),
  plannedDate: nullableStringWithDefault,
  plannedStartTime: nullableStringWithDefault,
  plannedEndTime: nullableStringWithDefault,
  dueDate: nullableStringWithDefault,
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
export type Task = z.infer<typeof taskSchema>
export type TaskScheduleInput = z.infer<typeof taskScheduleInputSchema>
export type NewTaskInput = z.infer<typeof newTaskInputSchema>
export type TaskStatusChange = z.infer<typeof taskStatusChangeSchema>
export type TaskScheduleChange = z.infer<typeof taskScheduleChangeSchema>
export type TaskDelete = z.infer<typeof taskDeleteSchema>
