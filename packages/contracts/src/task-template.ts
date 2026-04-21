import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

const nullableStringWithDefault = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

export const taskTemplateSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  note: z.string(),
  projectId: nullableStringWithDefault,
  project: z.string(),
  plannedDate: nullableStringWithDefault,
  plannedStartTime: nullableStringWithDefault,
  plannedEndTime: nullableStringWithDefault,
  dueDate: nullableStringWithDefault,
  createdAt: z.string(),
})

export const taskTemplatesSchema = z.array(taskTemplateSchema)

export const newTaskTemplateInputSchema = z.object({
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

export type TaskTemplate = z.infer<typeof taskTemplateSchema>
export type NewTaskTemplateInput = z.infer<typeof newTaskTemplateInputSchema>
