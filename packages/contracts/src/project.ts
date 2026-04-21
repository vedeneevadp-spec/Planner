import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

export const projectStatusSchema = z.enum(['active', 'archived'])

export const projectSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  color: z.string().min(1),
  icon: z.string().min(1),
  status: projectStatusSchema,
  createdAt: z.string(),
})

export const newProjectInputSchema = z.object({
  id: uuidV7Schema.optional(),
  title: z.string().min(1),
  description: z.string(),
  color: z.string().min(1),
  icon: z.string().min(1),
})

export const projectUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().positive().optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    color: z.string().min(1).optional(),
    icon: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.color !== undefined ||
      value.icon !== undefined,
    'At least one project field must be provided.',
  )

export type ProjectStatus = z.infer<typeof projectStatusSchema>
export type Project = z.infer<typeof projectSchema>
export type NewProjectInput = z.infer<typeof newProjectInputSchema>
export type ProjectUpdateInput = z.infer<typeof projectUpdateInputSchema>
