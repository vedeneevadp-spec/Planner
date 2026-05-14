import { z } from 'zod'

import {
  chaosInboxConvertToTaskResponseSchema,
  chaosInboxCreatedResponseSchema,
  chaosInboxItemSchema,
  chaosInboxListResponseSchema,
} from './chaos-inbox.js'
import {
  cleaningTaskHistoryItemSchema,
  cleaningTaskSchema,
  cleaningTaskStateSchema,
  cleaningZoneSchema,
} from './cleaning.js'
import { dailyPlanSchema, energyModeSchema } from './daily-plan.js'
import { emojiAssetSchema, emojiSetSchema } from './emoji-set.js'
import { habitEntrySchema, habitSchema, habitStatsSchema } from './habit.js'
import {
  lifeSphereSchema,
  weeklySphereStatsResponseSchema,
} from './life-sphere.js'
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

export const authEmailSchema = z.string().trim().toLowerCase().email().max(320)

export const authPasswordSchema = z.string().min(6).max(128)

export const authUserSchema = z.object({
  email: authEmailSchema,
  id: z.string().uuid(),
})

export const authTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string(),
  refreshToken: z.string().min(1).optional(),
  user: authUserSchema,
})

export const authSignInInputSchema = z.object({
  email: authEmailSchema,
  password: z.string().min(1).max(128),
})

export const authSignUpInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  email: authEmailSchema,
  password: authPasswordSchema,
})

export const authRefreshInputSchema = z.object({
  refreshToken: z.string().min(1).optional(),
})

export const authSignOutInputSchema = authRefreshInputSchema

export const authPasswordResetRequestInputSchema = z.object({
  email: authEmailSchema,
})

export const authPasswordResetConfirmInputSchema = z.object({
  password: authPasswordSchema,
  token: z.string().min(1),
})

export const authPasswordUpdateInputSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  password: authPasswordSchema,
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

export const calendarViewModeSchema = z.enum(['week', 'month', 'schedule'])

export const userPreferencesSchema = z.object({
  calendarViewMode: calendarViewModeSchema,
  energyMode: energyModeSchema,
})

export const sessionResponseSchema = z.object({
  actor: sessionActorSchema,
  actorUserId: z.string(),
  appRole: appRoleSchema,
  groupRole: workspaceGroupRoleSchema.nullable(),
  role: workspaceRoleSchema,
  source: z.enum(['access_token', 'default', 'headers']),
  userPreferences: userPreferencesSchema,
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
  lastSeenAt: z.string().nullable().default(null),
  taskCount: z.number().int().nonnegative().default(0),
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

export const userPreferencesUpdateInputSchema = z
  .object({
    calendarViewMode: calendarViewModeSchema.optional(),
    energyMode: energyModeSchema.optional(),
  })
  .refine(
    (value) => Boolean(value.calendarViewMode || value.energyMode),
    'At least one preference must be updated.',
  )

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
  .refine((value) => !(value.removeAvatar && value.avatarDataUrl), {
    message: 'Avatar upload and avatar removal are mutually exclusive.',
    path: ['avatarDataUrl'],
  })

export const pushPlatformSchema = z.enum(['android'])

export const pushDeviceUpsertInputSchema = z.object({
  appVersion: z.string().trim().min(1).max(32).optional(),
  deviceName: z.string().trim().min(1).max(120).optional(),
  installationId: z.string().trim().min(1).max(120),
  locale: z.string().trim().min(1).max(35).optional(),
  platform: pushPlatformSchema,
  token: z.string().trim().min(1).max(4096),
})

export const pushDeviceRecordSchema = z.object({
  appVersion: z.string().nullable(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
  deviceName: z.string().nullable(),
  id: z.string(),
  installationId: z.string(),
  lastRegisteredAt: z.string(),
  locale: z.string().nullable(),
  platform: pushPlatformSchema,
  token: z.string(),
  updatedAt: z.string(),
  userId: z.string(),
  version: z.number().int().positive(),
  workspaceId: z.string(),
})

export const pushTestNotificationInputSchema = z.object({
  body: z.string().trim().min(1).max(500),
  data: z.record(z.string(), z.string()).optional(),
  title: z.string().trim().min(1).max(120),
})

export const pushTestNotificationResponseSchema = z.object({
  deliveredCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  invalidTokenCount: z.number().int().nonnegative(),
})

export const taskListFiltersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  plannedDate: z.string().optional(),
  projectId: z.string().optional(),
  sphereId: z.string().optional(),
  project: z.string().optional(),
  status: taskStatusSchema.optional(),
})

export const taskListResponseSchema = z.array(taskRecordSchema)
export const taskListPageResponseSchema = z.object({
  hasMore: z.boolean(),
  items: z.array(taskRecordSchema),
  limit: z.number().int().min(1).max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
})
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
export const habitRecordSchema = habitSchema.extend({
  workspaceId: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
})
export const habitEntryRecordSchema = habitEntrySchema.extend({
  workspaceId: z.string(),
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
})
export const habitListResponseSchema = z.array(habitRecordSchema)
export const habitStatsResponseSchema = z.object({
  from: z.string(),
  habits: z.array(habitRecordSchema),
  stats: z.array(habitStatsSchema),
  to: z.string(),
})
export const habitTodayItemSchema = z.object({
  entry: habitEntryRecordSchema.nullable(),
  habit: habitRecordSchema,
  isDueToday: z.boolean(),
  progressPercent: z.number().int().min(0).max(100),
  stats: habitStatsSchema,
})
export const habitTodayResponseSchema = z.object({
  date: z.string(),
  items: z.array(habitTodayItemSchema),
})

export const cleaningZoneRecordSchema = cleaningZoneSchema.extend({
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
  workspaceId: z.string(),
})
export const cleaningTaskRecordSchema = cleaningTaskSchema.extend({
  deletedAt: z.string().nullable(),
  version: z.number().int().positive(),
  workspaceId: z.string(),
})
export const cleaningTaskStateRecordSchema = cleaningTaskStateSchema.extend({
  version: z.number().int().positive(),
  workspaceId: z.string(),
})
export const cleaningTaskHistoryItemRecordSchema =
  cleaningTaskHistoryItemSchema.extend({
    workspaceId: z.string(),
  })
export const cleaningTaskWithStateSchema = z.object({
  isDue: z.boolean(),
  isOverdue: z.boolean(),
  reasons: z.array(z.string()),
  score: z.number(),
  state: cleaningTaskStateRecordSchema,
  task: cleaningTaskRecordSchema,
  zone: cleaningZoneRecordSchema,
})
export const cleaningSummarySchema = z.object({
  accumulatedCount: z.number().int().nonnegative(),
  activeZoneCount: z.number().int().nonnegative(),
  completedTodayCount: z.number().int().nonnegative(),
  dueCount: z.number().int().nonnegative(),
  quickCount: z.number().int().nonnegative(),
  seasonalCount: z.number().int().nonnegative(),
  urgentCount: z.number().int().nonnegative(),
})
export const cleaningListResponseSchema = z.object({
  history: z.array(cleaningTaskHistoryItemRecordSchema),
  states: z.array(cleaningTaskStateRecordSchema),
  tasks: z.array(cleaningTaskRecordSchema),
  zones: z.array(cleaningZoneRecordSchema),
})
export const cleaningTodayResponseSchema = z.object({
  accumulatedItems: z.array(cleaningTaskWithStateSchema),
  date: z.string(),
  dayOfWeek: z.number().int().min(1).max(7),
  history: z.array(cleaningTaskHistoryItemRecordSchema),
  items: z.array(cleaningTaskWithStateSchema),
  quickItems: z.array(cleaningTaskWithStateSchema),
  seasonalItems: z.array(cleaningTaskWithStateSchema),
  summary: cleaningSummarySchema,
  urgentItems: z.array(cleaningTaskWithStateSchema),
  zones: z.array(cleaningZoneRecordSchema),
})
export const cleaningTaskActionResponseSchema = z.object({
  historyItem: cleaningTaskHistoryItemRecordSchema,
  state: cleaningTaskStateRecordSchema,
})
export const lifeSphereListRecordResponseSchema = z.array(
  lifeSphereRecordSchema,
)
export const weeklySphereStatsRecordResponseSchema =
  weeklySphereStatsResponseSchema.extend({
    spheres: z.array(lifeSphereRecordSchema),
  })
export const taskTemplateListResponseSchema = z.array(taskTemplateRecordSchema)
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
export type AuthPasswordResetConfirmInput = z.infer<
  typeof authPasswordResetConfirmInputSchema
>
export type AuthPasswordResetRequestInput = z.infer<
  typeof authPasswordResetRequestInputSchema
>
export type AuthPasswordUpdateInput = z.infer<
  typeof authPasswordUpdateInputSchema
>
export type AuthRefreshInput = z.infer<typeof authRefreshInputSchema>
export type AuthSignInInput = z.infer<typeof authSignInInputSchema>
export type AuthSignOutInput = z.infer<typeof authSignOutInputSchema>
export type AuthSignUpInput = z.infer<typeof authSignUpInputSchema>
export type AuthTokenResponse = z.infer<typeof authTokenResponseSchema>
export type AuthUser = z.infer<typeof authUserSchema>
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
export type CleaningListResponse = z.infer<typeof cleaningListResponseSchema>
export type CleaningSummary = z.infer<typeof cleaningSummarySchema>
export type CleaningTaskActionResponse = z.infer<
  typeof cleaningTaskActionResponseSchema
>
export type CleaningTaskHistoryItemRecord = z.infer<
  typeof cleaningTaskHistoryItemRecordSchema
>
export type CleaningTaskRecord = z.infer<typeof cleaningTaskRecordSchema>
export type CleaningTaskStateRecord = z.infer<
  typeof cleaningTaskStateRecordSchema
>
export type CleaningTaskWithState = z.infer<typeof cleaningTaskWithStateSchema>
export type CleaningTodayResponse = z.infer<typeof cleaningTodayResponseSchema>
export type CleaningZoneRecord = z.infer<typeof cleaningZoneRecordSchema>
export type DailyPlanRecord = z.infer<typeof dailyPlanRecordSchema>
export type EmojiAssetRecord = z.infer<typeof emojiAssetRecordSchema>
export type EmojiSetRecord = z.infer<typeof emojiSetRecordSchema>
export type HabitEntryRecord = z.infer<typeof habitEntryRecordSchema>
export type HabitListResponse = z.infer<typeof habitListResponseSchema>
export type HabitRecord = z.infer<typeof habitRecordSchema>
export type HabitStatsResponse = z.infer<typeof habitStatsResponseSchema>
export type HabitTodayItem = z.infer<typeof habitTodayItemSchema>
export type HabitTodayResponse = z.infer<typeof habitTodayResponseSchema>
export type LifeSphereRecord = z.infer<typeof lifeSphereRecordSchema>
export type SessionActor = z.infer<typeof sessionActorSchema>
export type SessionResponse = z.infer<typeof sessionResponseSchema>
export type SessionWorkspace = z.infer<typeof sessionWorkspaceSchema>
export type SessionWorkspaceMembership = z.infer<
  typeof sessionWorkspaceMembershipSchema
>
export type CalendarViewMode = z.infer<typeof calendarViewModeSchema>
export type UserPreferences = z.infer<typeof userPreferencesSchema>
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
export type PushPlatform = z.infer<typeof pushPlatformSchema>
export type PushDeviceUpsertInput = z.infer<typeof pushDeviceUpsertInputSchema>
export type PushDeviceRecord = z.infer<typeof pushDeviceRecordSchema>
export type PushTestNotificationInput = z.infer<
  typeof pushTestNotificationInputSchema
>
export type PushTestNotificationResponse = z.infer<
  typeof pushTestNotificationResponseSchema
>
export type UpdateSharedWorkspaceInput = z.infer<
  typeof updateSharedWorkspaceInputSchema
>
export type WorkspaceSettingsUpdateInput = z.infer<
  typeof workspaceSettingsUpdateInputSchema
>
export type UserPreferencesUpdateInput = z.infer<
  typeof userPreferencesUpdateInputSchema
>
export type UpdateUserProfileInput = z.infer<
  typeof updateUserProfileInputSchema
>
export type TaskEventListFilters = z.infer<typeof taskEventListFiltersSchema>
export type TaskEventListResponse = z.infer<typeof taskEventListResponseSchema>
export type TaskEventRecord = z.infer<typeof taskEventRecordSchema>
export type TaskListFilters = z.infer<typeof taskListFiltersSchema>
export type TaskListPageResponse = z.infer<typeof taskListPageResponseSchema>
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
