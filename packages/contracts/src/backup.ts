import { z } from 'zod'

export const USER_BACKUP_FORMAT = 'planner.user-backup'
export const USER_BACKUP_FORMAT_VERSION = 1

export const userBackupTableNameSchema = z.enum([
  'chaos_inbox_items',
  'cleaning_task_history',
  'cleaning_task_states',
  'cleaning_tasks',
  'cleaning_zones',
  'daily_plans',
  'emoji_assets',
  'emoji_sets',
  'habit_entries',
  'habits',
  'projects',
  'self_care_appointment_details',
  'self_care_completions',
  'self_care_course_details',
  'self_care_daily_states',
  'self_care_exercise_details',
  'self_care_item_alternatives',
  'self_care_items',
  'self_care_medical_details',
  'self_care_measurement_details',
  'self_care_minimum_items',
  'self_care_occurrences',
  'self_care_procedure_details',
  'self_care_ritual_step_completions',
  'self_care_ritual_step_drafts',
  'self_care_ritual_steps',
  'self_care_schedule_rules',
  'self_care_settings',
  'task_attachments',
  'task_chains',
  'task_occurrences',
  'task_templates',
  'task_time_blocks',
  'tasks',
  'users',
  'workspace_members',
  'workspaces',
])

export const userBackupAssetKindSchema = z.enum([
  'emoji_asset',
  'profile_avatar',
])

export const userBackupRowSchema = z.record(z.string(), z.unknown())

export const userBackupAssetSchema = z.object({
  base64: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  contentType: z.string().min(1),
  kind: userBackupAssetKindSchema,
  path: z.string().min(1),
})

export const userBackupArchiveSchema = z.object({
  assets: z.array(userBackupAssetSchema).default([]),
  exportedAt: z.string(),
  format: z.literal(USER_BACKUP_FORMAT),
  source: z.object({
    appVersion: z.string().min(1),
  }),
  scope: z.object({
    userId: z.string().min(1),
    workspaceId: z.string().min(1),
    workspaceKind: z.literal('personal'),
    workspaceName: z.string().min(1),
  }),
  tables: z
    .record(z.string(), z.array(userBackupRowSchema))
    .superRefine((tables, ctx) => {
      for (const tableName of Object.keys(tables)) {
        if (!userBackupTableNameSchema.safeParse(tableName).success) {
          ctx.addIssue({
            code: 'custom',
            message: `Unsupported backup table "${tableName}".`,
            path: [tableName],
          })
        }
      }
    }),
  version: z.literal(USER_BACKUP_FORMAT_VERSION),
})

export const userBackupPreviewTableSchema = z.object({
  count: z.number().int().nonnegative(),
  name: userBackupTableNameSchema,
})

export const userBackupPreviewResponseSchema = z.object({
  archive: z.object({
    exportedAt: z.string(),
    format: z.literal(USER_BACKUP_FORMAT),
    sourceAppVersion: z.string(),
    version: z.literal(USER_BACKUP_FORMAT_VERSION),
    workspaceId: z.string(),
    workspaceKind: z.literal('personal'),
    workspaceName: z.string(),
  }),
  assets: z.object({
    count: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }),
  canRestore: z.boolean(),
  tables: z.array(userBackupPreviewTableSchema),
  warnings: z.array(z.string()),
})

export type UserBackupArchive = z.infer<typeof userBackupArchiveSchema>
export type UserBackupAsset = z.infer<typeof userBackupAssetSchema>
export type UserBackupAssetKind = z.infer<typeof userBackupAssetKindSchema>
export type UserBackupPreviewResponse = z.infer<
  typeof userBackupPreviewResponseSchema
>
export type UserBackupPreviewTable = z.infer<
  typeof userBackupPreviewTableSchema
>
export type UserBackupRow = z.infer<typeof userBackupRowSchema>
export type UserBackupTableName = z.infer<typeof userBackupTableNameSchema>
