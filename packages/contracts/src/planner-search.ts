import { z } from 'zod'

export const plannerSearchSourceSchema = z.enum([
  'tasks',
  'shopping',
  'cleaning',
  'care',
])
export const plannerSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(200),
  source: z
    .enum(['all', 'tasks', 'shopping', 'cleaning', 'care'])
    .default('all'),
  includeCompleted: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(true),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const plannerSearchItemSchema = z.object({
  id: z.string(),
  source: plannerSearchSourceSchema,
  title: z.string(),
  description: z.string(),
  context: z.string(),
  date: z.string().nullable(),
  status: z.enum(['active', 'done', 'archived']),
})

export const plannerSearchResponseSchema = z.object({
  items: z.array(plannerSearchItemSchema),
  hasMore: z.boolean(),
  page: z.number().int().positive(),
  unavailableSources: z.array(plannerSearchSourceSchema),
})

export type PlannerSearchSource = z.infer<typeof plannerSearchSourceSchema>
export type PlannerSearchQuery = z.infer<typeof plannerSearchQuerySchema>
export type PlannerSearchItem = z.infer<typeof plannerSearchItemSchema>
export type PlannerSearchResponse = z.infer<typeof plannerSearchResponseSchema>
