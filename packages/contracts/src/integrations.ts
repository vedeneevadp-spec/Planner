import { z } from 'zod'

import {
  chaosInboxPrioritySchema,
  chaosInboxShoppingCategorySchema,
  shoppingProductUrlSchema,
} from './chaos-inbox.js'
import {
  taskImportanceSchema,
  taskNecessitySchema,
  taskStatusSchema,
} from './task.js'
import { uuidV7Schema } from './uuid.js'

export const apiKeyScopeSchema = z.enum([
  'tasks:read',
  'tasks:write',
  'shopping:read',
  'shopping:write',
])
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>

export const createApiKeyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(apiKeyScopeSchema).min(1).max(4),
    expiresInDays: z.number().int().min(1).max(365),
  })
  .strict()
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>

export const apiKeyRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  workspaceId: z.string().uuid(),
  scopes: z.array(apiKeyScopeSchema),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
})
export type ApiKeyRecord = z.infer<typeof apiKeyRecordSchema>
export const apiKeyListResponseSchema = z.object({
  keys: z.array(apiKeyRecordSchema),
})
export type ApiKeyListResponse = z.infer<typeof apiKeyListResponseSchema>
export const createdApiKeyResponseSchema = z.object({
  key: apiKeyRecordSchema,
  secret: z.string(),
})

const taskFields = {
  title: z.string().trim().min(1).max(500),
  note: z.string().max(10000),
  project: z.string().max(200),
  plannedDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  importance: taskImportanceSchema,
  necessity: taskNecessitySchema,
  resource: z.number().int().min(-5).max(5),
}
export const publicTaskCreateSchema = z
  .object({
    ...taskFields,
    id: uuidV7Schema.optional(),
    note: taskFields.note.default(''),
    project: taskFields.project.default(''),
    plannedDate: taskFields.plannedDate.optional(),
    dueDate: taskFields.dueDate.optional(),
    importance: taskFields.importance.optional(),
    necessity: taskFields.necessity.optional(),
    resource: taskFields.resource.default(0),
  })
  .strict()
export const publicTaskUpdateSchema = z
  .object(taskFields)
  .partial()
  .extend({
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 1,
    'Provide at least one field to update.',
  )
export const publicTaskStatusSchema = z
  .object({
    status: taskStatusSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict()
export const publicTaskListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
    plannedDate: z.iso.date().optional(),
    status: taskStatusSchema.optional(),
    search: z.string().trim().min(1).max(200).optional(),
  })
  .strict()

const shoppingFields = {
  text: z.string().trim().min(1).max(5000),
  priority: chaosInboxPrioritySchema.nullable(),
  isFavorite: z.boolean(),
  shoppingCategory: chaosInboxShoppingCategorySchema.nullable(),
  productUrl: shoppingProductUrlSchema.nullable(),
}
export const publicShoppingCreateSchema = z
  .object(shoppingFields)
  .partial()
  .extend({
    id: uuidV7Schema.optional(),
    text: shoppingFields.text,
  })
  .strict()
export const publicShoppingUpdateSchema = z
  .object(shoppingFields)
  .partial()
  .extend({
    status: z.enum(['new', 'archived']).optional(),
    dueDate: z.iso.date().nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field to update.',
  )
export const publicShoppingListSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['new', 'archived']).optional(),
    search: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
