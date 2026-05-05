import { z } from 'zod'

import {
  chaosInboxConvertToTaskResponseSchema,
  chaosInboxCreatedResponseSchema,
  chaosInboxItemSchema,
  chaosInboxListResponseSchema,
} from './chaos-inbox.js'
import { dailyPlanSchema } from './daily-plan.js'
import { emojiAssetSchema, emojiSetSchema } from './emoji-set.js'
import {
  lifeSphereSchema,
  weeklySphereStatsResponseSchema,
} from './life-sphere.js'
import { projectSchema } from './project.js'
import {
  taskScheduleInputSchema,
  taskSchema,
  taskStatusSchema,
  taskUpdateInputSchema,
} from './task.js'
import { taskTemplateSchema } from './task-template.js'

export const storageDriverSchema = z.enum(['memory', 'postgres'])
export const appRoleSchema = z.enum(['owner', 'admin', 'user', 'guest'])
export const assignableAppRoleSchema = z.enum(['admin', 'user', 'guest'])
export const workspaceRoleSchema = z.enum(['owner', 'admin', 'user', 'guest'])
export const workspaceKindSchema = z.enum(['personal', 'shared'])
export const workspaceGroupRoleSchema = z.enum([
  'group_admin',
  'senior_member',
  'member',
])
export const assignableWorkspaceGroupRoleSchema = workspaceGroupRoleSchema

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

export const taskTemplateRecordSchema = taskTemplateSchema.extend({
  workspaceId: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
})

export const projectRecordSchema = projectSchema.extend({
  workspaceId: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
})

export const emojiAssetRecordSchema = emojiAssetSchema.extend({
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
  updatedAt: z.string(),
  version: z.number().int().positive(),
  workspaceId: z.string(),
})

export const emojiSetRecordSchema = emojiSetSchema.extend({
  deletedAt: z.string().nullable(),
  items: z.array(emojiAssetRecordSchema),
  updatedAt: z.string(),
  version: z.number().int().positive(),
  workspaceId: z.string(),
})

export const sessionActorSchema = z.object({
  avatarUrl: z.string().nullable(),
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
})

export const userProfileSchema = sessionActorSchema.extend({
  updatedAt: z.string(),
})

export const sessionWorkspaceSchema = z.object({
  id: z.string(),
  kind: workspaceKindSchema,
  name: z.string(),
  slug: z.string(),
})

export const sessionWorkspaceMembershipSchema = sessionWorkspaceSchema.extend({
  groupRole: workspaceGroupRoleSchema.nullable(),
  role: workspaceRoleSchema,
})

export const workspaceSettingsSchema = z.object({
  taskCompletionConfettiEnabled: z.boolean(),
})

export const sessionResponseSchema = z.object({
  actor: sessionActorSchema,
  actorUserId: z.string(),
  appRole: appRoleSchema,
  groupRole: workspaceGroupRoleSchema.nullable(),
  role: workspaceRoleSchema,
  source: z.enum(['access_token', 'default', 'headers']),
  workspace: sessionWorkspaceSchema,
  workspaceId: z.string(),
  workspaceSettings: workspaceSettingsSchema,
  workspaces: z.array(sessionWorkspaceMembershipSchema),
})

export const adminUserRecordSchema = z.object({
  displayName: z.string(),
  email: z.string(),
  id: z.string(),
  appRole: appRoleSchema,
  updatedAt: z.string(),
})

export const adminUserListResponseSchema = z.object({
  users: z.array(adminUserRecordSchema),
})

export const adminUserRoleUpdateInputSchema = z.object({
  role: assignableAppRoleSchema,
})

export const workspaceUserRecordSchema = z.object({
  displayName: z.string(),
  email: z.string(),
  groupRole: workspaceGroupRoleSchema.nullable(),
  id: z.string(),
  isOwner: z.boolean(),
  joinedAt: z.string(),
  membershipId: z.string(),
  updatedAt: z.string(),
})

export const workspaceUserListResponseSchema = z.object({
  users: z.array(workspaceUserRecordSchema),
})

export const workspaceUserGroupRoleUpdateInputSchema = z.object({
  groupRole: assignableWorkspaceGroupRoleSchema,
})

export const workspaceInvitationRecordSchema = z.object({
  email: z.string(),
  groupRole: assignableWorkspaceGroupRoleSchema,
  id: z.string(),
  invitedAt: z.string(),
  updatedAt: z.string(),
})

export const workspaceInvitationListResponseSchema = z.object({
  invitations: z.array(workspaceInvitationRecordSchema),
})

export const workspaceInvitationCreateInputSchema = z.object({
  email: z.string().trim().email().max(320),
  groupRole: assignableWorkspaceGroupRoleSchema.default('member'),
})

export const createSharedWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
})

export const updateSharedWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export const workspaceSettingsUpdateInputSchema = z.object({
  taskCompletionConfettiEnabled: z.boolean(),
})

export const updateUserProfileInputSchema = z
  .object({
    avatarDataUrl: z.string().trim().min(1).optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    removeAvatar: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.removeAvatar || Boolean(value.avatarDataUrl || value.displayName),
    {
      message: 'At least one profile field must be updated.',
      path: ['displayName'],
    },
  )
  .refine(
    (value) => !(value.removeAvatar && value.avatarDataUrl),
    {
      message: 'Avatar upload and avatar removal are mutually exclusive.',
      path: ['avatarDataUrl'],
    },
  )

export const taskListFiltersSchema = z.object({
  plannedDate: z.string().optional(),
  projectId: z.string().optional(),
  sphereId: z.string().optional(),
  project: z.string().optional(),
  status: taskStatusSchema.optional(),
})

export const taskListResponseSchema = z.array(taskRecordSchema)
export const chaosInboxItemRecordSchema = chaosInboxItemSchema.extend({
  workspaceId: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
})
export const chaosInboxListRecordResponseSchema =
  chaosInboxListResponseSchema.extend({
    items: z.array(chaosInboxItemRecordSchema),
  })
export const chaosInboxCreatedRecordResponseSchema =
  chaosInboxCreatedResponseSchema.extend({
    items: z.array(chaosInboxItemRecordSchema),
  })
export const chaosInboxConvertToTaskRecordResponseSchema =
  chaosInboxConvertToTaskResponseSchema.extend({
    inboxItem: chaosInboxItemRecordSchema,
  })
export const dailyPlanRecordSchema = dailyPlanSchema.extend({
  workspaceId: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
})
export const lifeSphereRecordSchema = lifeSphereSchema.extend({
  workspaceId: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
})
export const lifeSphereListRecordResponseSchema = z.array(
  lifeSphereRecordSchema,
)
export const weeklySphereStatsRecordResponseSchema =
  weeklySphereStatsResponseSchema.extend({
    spheres: z.array(lifeSphereRecordSchema),
  })
export const taskTemplateListResponseSchema = z.array(taskTemplateRecordSchema)
export const projectListResponseSchema = z.array(projectRecordSchema)
export const emojiSetListResponseSchema = z.array(emojiSetRecordSchema)

export const taskEventRecordSchema = z.object({
  actorUserId: z.string().nullable(),
  eventId: z.string(),
  eventType: z.string(),
  id: z.number().int().nonnegative(),
  occurredAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
  taskId: z.string().nullable(),
  workspaceId: z.string(),
})

export const taskEventListFiltersSchema = z.object({
  afterEventId: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export const taskEventListResponseSchema = z.object({
  events: z.array(taskEventRecordSchema),
  nextEventId: z.number().int().nonnegative(),
})

export const taskStatusUpdateInputSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  status: taskStatusSchema,
})

export const taskScheduleUpdateInputSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  schedule: taskScheduleInputSchema,
})

export const taskDetailsUpdateInputSchema = taskUpdateInputSchema

export type ApiError = z.infer<typeof apiErrorSchema>
export type AdminUserRecord = z.infer<typeof adminUserRecordSchema>
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>
export type AdminUserRoleUpdateInput = z.infer<
  typeof adminUserRoleUpdateInputSchema
>
export type AppRole = z.infer<typeof appRoleSchema>
export type AssignableAppRole = z.infer<typeof assignableAppRoleSchema>
export type AssignableWorkspaceGroupRole = z.infer<
  typeof assignableWorkspaceGroupRoleSchema
>
export type HealthDatabaseStatus = z.infer<typeof healthDatabaseStatusSchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type ChaosInboxItemRecord = z.infer<typeof chaosInboxItemRecordSchema>
export type ChaosInboxListRecordResponse = z.infer<
  typeof chaosInboxListRecordResponseSchema
>
export type ChaosInboxCreatedRecordResponse = z.infer<
  typeof chaosInboxCreatedRecordResponseSchema
>
export type ChaosInboxConvertToTaskRecordResponse = z.infer<
  typeof chaosInboxConvertToTaskRecordResponseSchema
>
export type DailyPlanRecord = z.infer<typeof dailyPlanRecordSchema>
export type EmojiAssetRecord = z.infer<typeof emojiAssetRecordSchema>
export type EmojiSetRecord = z.infer<typeof emojiSetRecordSchema>
export type LifeSphereRecord = z.infer<typeof lifeSphereRecordSchema>
export type SessionActor = z.infer<typeof sessionActorSchema>
export type SessionResponse = z.infer<typeof sessionResponseSchema>
export type SessionWorkspace = z.infer<typeof sessionWorkspaceSchema>
export type SessionWorkspaceMembership = z.infer<
  typeof sessionWorkspaceMembershipSchema
>
export type UserProfile = z.infer<typeof userProfileSchema>
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>
export type StorageDriver = z.infer<typeof storageDriverSchema>
export type WorkspaceGroupRole = z.infer<typeof workspaceGroupRoleSchema>
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>
export type WorkspaceInvitationCreateInput = z.infer<
  typeof workspaceInvitationCreateInputSchema
>
export type WorkspaceInvitationListResponse = z.infer<
  typeof workspaceInvitationListResponseSchema
>
export type WorkspaceInvitationRecord = z.infer<
  typeof workspaceInvitationRecordSchema
>
export type WorkspaceUserRecord = z.infer<typeof workspaceUserRecordSchema>
export type WorkspaceUserListResponse = z.infer<
  typeof workspaceUserListResponseSchema
>
export type WorkspaceUserGroupRoleUpdateInput = z.infer<
  typeof workspaceUserGroupRoleUpdateInputSchema
>
export type CreateSharedWorkspaceInput = z.infer<
  typeof createSharedWorkspaceInputSchema
>
export type UpdateSharedWorkspaceInput = z.infer<
  typeof updateSharedWorkspaceInputSchema
>
export type WorkspaceSettingsUpdateInput = z.infer<
  typeof workspaceSettingsUpdateInputSchema
>
export type UpdateUserProfileInput = z.infer<
  typeof updateUserProfileInputSchema
>
export type ProjectRecord = z.infer<typeof projectRecordSchema>
export type TaskEventListFilters = z.infer<typeof taskEventListFiltersSchema>
export type TaskEventListResponse = z.infer<typeof taskEventListResponseSchema>
export type TaskEventRecord = z.infer<typeof taskEventRecordSchema>
export type TaskListFilters = z.infer<typeof taskListFiltersSchema>
export type TaskRecord = z.infer<typeof taskRecordSchema>
export type TaskTemplateRecord = z.infer<typeof taskTemplateRecordSchema>
export type TaskScheduleUpdateInput = z.infer<
  typeof taskScheduleUpdateInputSchema
>
export type TaskStatusUpdateInput = z.infer<typeof taskStatusUpdateInputSchema>
export type TaskDetailsUpdateInput = z.infer<
  typeof taskDetailsUpdateInputSchema
>
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>
