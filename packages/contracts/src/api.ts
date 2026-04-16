import { z } from 'zod'

import {
  taskScheduleInputSchema,
  taskSchema,
  taskStatusSchema,
} from './task.js'

export const storageDriverSchema = z.enum(['memory', 'postgres'])
export const workspaceRoleSchema = z.enum([
  'owner',
  'admin',
  'member',
  'viewer',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export const healthDatabaseStatusSchema = z.enum(['disabled', 'up', 'down'])

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  appEnv: z.string(),
  storageDriver: storageDriverSchema,
  databaseStatus: healthDatabaseStatusSchema,
  timestamp: z.string(),
})

export const taskRecordSchema = taskSchema.extend({
  workspaceId: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
})

export const sessionActorSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
})

export const sessionWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

export const sessionResponseSchema = z.object({
  actor: sessionActorSchema,
  actorUserId: z.string(),
  role: workspaceRoleSchema,
  source: z.enum(['default', 'headers']),
  workspace: sessionWorkspaceSchema,
  workspaceId: z.string(),
})

export const taskListFiltersSchema = z.object({
  plannedDate: z.string().optional(),
  project: z.string().optional(),
  status: taskStatusSchema.optional(),
})

export const taskListResponseSchema = z.array(taskRecordSchema)

export const taskStatusUpdateInputSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  status: taskStatusSchema,
})

export const taskScheduleUpdateInputSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  schedule: taskScheduleInputSchema,
})

export type ApiError = z.infer<typeof apiErrorSchema>
export type HealthDatabaseStatus = z.infer<typeof healthDatabaseStatusSchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type SessionActor = z.infer<typeof sessionActorSchema>
export type SessionResponse = z.infer<typeof sessionResponseSchema>
export type SessionWorkspace = z.infer<typeof sessionWorkspaceSchema>
export type StorageDriver = z.infer<typeof storageDriverSchema>
export type TaskListFilters = z.infer<typeof taskListFiltersSchema>
export type TaskRecord = z.infer<typeof taskRecordSchema>
export type TaskScheduleUpdateInput = z.infer<
  typeof taskScheduleUpdateInputSchema
>
export type TaskStatusUpdateInput = z.infer<typeof taskStatusUpdateInputSchema>
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>
