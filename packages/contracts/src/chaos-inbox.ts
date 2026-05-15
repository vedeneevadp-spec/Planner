import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

const nullableStringWithDefault = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

export const chaosInboxSourceSchema = z.enum([
  'manual',
  'quick_add',
  'widget',
  'voice',
])
export const chaosInboxStatusSchema = z.enum([
  'new',
  'in_review',
  'converted',
  'archived',
])
export const chaosInboxKindSchema = z.enum([
  'unknown',
  'task',
  'note',
  'shopping',
  'event',
  'idea',
])
export const chaosInboxPrioritySchema = z.enum(['low', 'medium', 'high'])
export const chaosInboxShoppingCategorySchema = z.enum([
  'groceries',
  'household',
  'other',
])

export const chaosInboxItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  text: z.string().min(1).max(5000),
  source: chaosInboxSourceSchema,
  status: chaosInboxStatusSchema,
  kind: chaosInboxKindSchema,
  sphereId: nullableStringWithDefault,
  priority: chaosInboxPrioritySchema.nullable().optional().default(null),
  isFavorite: z.boolean().optional().default(false),
  shoppingCategory: chaosInboxShoppingCategorySchema
    .nullable()
    .optional()
    .default(null),
  dueDate: nullableStringWithDefault,
  convertedTaskId: nullableStringWithDefault,
  convertedNoteId: nullableStringWithDefault,
  linkedTaskDeleted: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const newChaosInboxItemInputSchema = z.object({
  id: uuidV7Schema.optional(),
  kind: chaosInboxKindSchema.optional().default('unknown'),
  text: z.string().trim().min(1).max(5000),
  source: chaosInboxSourceSchema.optional().default('manual'),
  priority: chaosInboxPrioritySchema.nullable().optional().default(null),
  isFavorite: z.boolean().optional().default(false),
  shoppingCategory: chaosInboxShoppingCategorySchema
    .nullable()
    .optional()
    .default(null),
})

export const createChaosInboxItemsInputSchema = z.object({
  items: z.array(newChaosInboxItemInputSchema).min(1).max(100),
})

export const chaosInboxItemUpdateInputSchema = z
  .object({
    kind: chaosInboxKindSchema.optional(),
    sphereId: z.string().nullable().optional(),
    priority: chaosInboxPrioritySchema.nullable().optional(),
    isFavorite: z.boolean().optional(),
    shoppingCategory: chaosInboxShoppingCategorySchema.nullable().optional(),
    dueDate: z.string().nullable().optional(),
    status: chaosInboxStatusSchema.optional(),
  })
  .refine(
    (value) =>
      value.kind !== undefined ||
      value.sphereId !== undefined ||
      value.priority !== undefined ||
      value.isFavorite !== undefined ||
      value.shoppingCategory !== undefined ||
      value.dueDate !== undefined ||
      value.status !== undefined,
    'At least one chaos inbox field must be provided.',
  )

export const chaosInboxBulkUpdateInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  patch: chaosInboxItemUpdateInputSchema,
})

export const chaosInboxListFiltersSchema = z.object({
  status: chaosInboxStatusSchema.optional(),
  kind: chaosInboxKindSchema.optional(),
  sphereId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const chaosInboxListResponseSchema = z.object({
  items: z.array(chaosInboxItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
})

export const chaosInboxCreatedResponseSchema = z.object({
  items: z.array(chaosInboxItemSchema),
})

export const chaosInboxConvertToTaskResponseSchema = z.object({
  inboxItem: chaosInboxItemSchema,
  taskId: z.string(),
})

export type ChaosInboxSource = z.infer<typeof chaosInboxSourceSchema>
export type ChaosInboxStatus = z.infer<typeof chaosInboxStatusSchema>
export type ChaosInboxKind = z.infer<typeof chaosInboxKindSchema>
export type ChaosInboxPriority = z.infer<typeof chaosInboxPrioritySchema>
export type ChaosInboxShoppingCategory = z.infer<
  typeof chaosInboxShoppingCategorySchema
>
export type ChaosInboxItem = z.infer<typeof chaosInboxItemSchema>
export type NewChaosInboxItemInput = z.infer<
  typeof newChaosInboxItemInputSchema
>
export type CreateChaosInboxItemsInput = z.infer<
  typeof createChaosInboxItemsInputSchema
>
export type ChaosInboxItemUpdateInput = z.infer<
  typeof chaosInboxItemUpdateInputSchema
>
export type ChaosInboxBulkUpdateInput = z.infer<
  typeof chaosInboxBulkUpdateInputSchema
>
export type ChaosInboxListFilters = z.infer<typeof chaosInboxListFiltersSchema>
export type ChaosInboxListResponse = z.infer<
  typeof chaosInboxListResponseSchema
>
export type ChaosInboxCreatedResponse = z.infer<
  typeof chaosInboxCreatedResponseSchema
>
export type ChaosInboxConvertToTaskResponse = z.infer<
  typeof chaosInboxConvertToTaskResponseSchema
>
