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

const USER_BACKUP_V1_COLUMNS = {
  users:
    'id,email,display_name,avatar_url,timezone,locale,default_time_zone,last_seen_time_zone,time_zone_mode,calendar_view_mode,energy_mode,voice_assistant_enabled,created_at,updated_at,deleted_at,version',
  workspaces:
    'id,owner_user_id,name,slug,kind,description,default_time_zone,task_completion_confetti_enabled,wake_word_training_mode_enabled,created_at,updated_at,deleted_at,version',
  workspace_members:
    'id,workspace_id,user_id,role,group_role,invited_by,joined_at,created_at,updated_at,deleted_at,version',
  projects:
    'id,workspace_id,title,slug,description,color,icon,position,status,metadata,created_by,updated_by,created_at,updated_at,deleted_at,version',
  tasks:
    'id,workspace_id,project_id,sphere_id,parent_task_id,previous_task_id,chain_id,stage_index,stage_type,title,description,status,priority,sort_key,due_at,due_on,planned_on,local_date,local_time,time_kind,time_zone,time_zone_inferred,starts_at_utc,recurrence_rule,recurrence_start_date,recurrence_time_zone,resource,metadata,assignee_user_id,completion_type,completed_at,created_by,updated_by,created_at,updated_at,deleted_at,version',
  task_chains:
    'id,workspace_id,root_task_id,title,status,metadata,created_by,updated_by,created_at,updated_at,deleted_at,version',
  task_time_blocks:
    'id,workspace_id,task_id,starts_at,ends_at,timezone,position,source,metadata,created_by,updated_by,created_at,updated_at,deleted_at,version',
  task_occurrences:
    'id,task_id,occurrence_date,local_time,time_zone,starts_at_utc,status,created_at,updated_at',
  task_attachments:
    'id,workspace_id,task_id,storage_bucket,storage_object_path,original_filename,content_type,size_bytes,metadata,created_by,updated_by,created_at,updated_at,deleted_at,version',
  task_templates:
    'id,workspace_id,project_id,title,description,due_on,planned_on,planned_start_time,planned_end_time,metadata,created_by,updated_by,created_at,updated_at,deleted_at,version',
  daily_plans:
    'id,workspace_id,user_id,date,energy_mode,focus_task_ids,routine_task_ids,support_task_ids,overload_score,created_by,updated_by,created_at,updated_at,deleted_at,version',
  emoji_sets:
    'id,workspace_id,title,slug,description,source,status,metadata,created_by,updated_by,created_at,updated_at,deleted_at,version',
  emoji_assets:
    'id,workspace_id,emoji_set_id,shortcode,label,kind,value,keywords,sort_order,metadata,created_by,updated_by,created_at,updated_at,deleted_at,version',
  chaos_inbox_items:
    'id,workspace_id,user_id,text,source,kind,status,priority,shopping_category,is_favorite,due_on,sphere_id,converted_task_id,converted_note_id,activated_at,completed_at,created_by,updated_by,created_at,updated_at,deleted_at,version',
  cleaning_zones:
    'id,workspace_id,user_id,title,description,day_of_week,sort_order,is_active,created_by,updated_by,created_at,updated_at,deleted_at,version',
  cleaning_tasks:
    'id,workspace_id,user_id,zone_id,title,description,frequency_type,frequency_interval,custom_interval_days,day_of_week,season_months,is_seasonal,estimated_minutes,energy,priority,scope,depth,impact_score,assignee,tags,sort_order,is_active,created_by,updated_by,created_at,updated_at,deleted_at,version',
  cleaning_task_states:
    'task_id,workspace_id,user_id,next_due_at,last_completed_at,last_skipped_at,last_postponed_at,postpone_count,created_by,updated_by,created_at,updated_at,version',
  cleaning_task_history:
    'id,workspace_id,user_id,task_id,zone_id,date,action,note,target_date,created_by,created_at',
  habits:
    'id,workspace_id,user_id,sphere_id,title,description,icon,color,frequency,days_of_week,start_date,end_date,target_type,target_value,unit,reminder_time,sort_order,is_active,created_by,updated_by,created_at,updated_at,deleted_at,version',
  habit_entries:
    'id,workspace_id,user_id,habit_id,date,status,value,target_value,note,created_by,updated_by,created_at,updated_at,deleted_at,version',
  self_care_items:
    'id,workspace_id,user_id,type,category,custom_category_id,title,description,icon,color,importance,preferred_time_of_day,default_duration_minutes,minimum_version_title,minimum_version_description,minimum_version_duration_minutes,is_private,is_active,is_archived,created_from_template_id,migrated_from_habit_id,created_by,updated_by,created_at,updated_at,deleted_at,version',
  self_care_item_alternatives:
    'id,item_id,title,description,counts_as_completion',
  self_care_schedule_rules:
    'id,item_id,repeat_kind,interval_value,interval_unit,days_of_week,day_of_month,week_of_month,month_of_year,start_date,end_date,preferred_time,timezone,reminder_offsets_minutes,generate_in_calendar,generate_in_task_list,allow_multiple_per_day,flexible_target_count,flexible_period,created_at,updated_at',
  self_care_occurrences:
    'id,item_id,schedule_rule_id,user_id,scheduled_for,due_at,status,completed_at,moved_to,generated_at,reminder_offsets_minutes,reminder_time_zone,created_by,updated_by,created_at,updated_at,version',
  self_care_completions:
    'id,item_id,occurrence_id,user_id,scheduled_for,completed_at,status,duration_minutes,note,completed_variant,alternative_title,mood_before,mood_after,energy_before,energy_after,price,currency,measurement_value,measurement_unit,exercise_sets,created_by,created_at',
  self_care_ritual_steps:
    'id,item_id,title,sort_order,is_optional,default_checked,created_at,updated_at',
  self_care_ritual_step_completions: 'id,completion_id,step_id,is_done',
  self_care_ritual_step_drafts:
    'id,item_id,occurrence_id,user_id,workspace_id,date,step_ids,created_at,updated_at',
  self_care_procedure_details:
    'id,item_id,specialist_name,place,contact,default_price,currency,created_at,updated_at',
  self_care_appointment_details:
    'id,item_id,occurrence_id,starts_at,ends_at,specialist_name,specialist_contact,place,preparation_note,result_note,price,currency,created_at,updated_at',
  self_care_medical_details:
    'id,item_id,doctor_name,clinic_name,clinic_address,phone,website,analysis_list,result_note,next_control_date,document_urls,reminder_strategy,created_at,updated_at',
  self_care_course_details:
    'id,item_id,course_type,total_count,completed_count,start_date,end_date,is_completed,is_paused,repeat_after_completion,break_days,created_at,updated_at',
  self_care_measurement_details:
    'id,item_id,value_label,unit,target_min,target_max,created_at,updated_at',
  self_care_exercise_details:
    'id,item_id,metric_type,unit,planned_value,planned_sets,use_sets,created_at,updated_at',
  self_care_daily_states:
    'id,user_id,date,mood,energy,stress,sleep_quality,pain,note,created_at,updated_at',
  self_care_settings:
    'id,user_id,currency,default_reminder_tone,quiet_hours_start,quiet_hours_end,show_self_care_in_main_tasks,show_appointments_in_calendar,show_daily_rituals_in_calendar,gentle_mode_enabled_today,gentle_mode_date,created_at,updated_at',
  self_care_minimum_items:
    'id,user_id,title,sort_order,is_active,linked_item_id,created_at,updated_at',
} as const satisfies Record<z.infer<typeof userBackupTableNameSchema>, string>

const USER_BACKUP_STRUCTURED_COLUMNS = new Set([
  'analysis_list',
  'days_of_week',
  'document_urls',
  'exercise_sets',
  'focus_task_ids',
  'keywords',
  'metadata',
  'recurrence_rule',
  'reminder_offsets_minutes',
  'reminder_strategy',
  'routine_task_ids',
  'season_months',
  'step_ids',
  'support_task_ids',
  'tags',
])

const userBackupScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

const userBackupV1RowSchemas = Object.fromEntries(
  Object.entries(USER_BACKUP_V1_COLUMNS).map(([tableName, columns]) => [
    tableName,
    createUserBackupV1RowSchema(tableName, columns.split(',')),
  ]),
) as Record<z.infer<typeof userBackupTableNameSchema>, z.ZodType<UserBackupRow>>

function createUserBackupV1RowSchema(
  tableName: string,
  columns: string[],
): z.ZodType<UserBackupRow> {
  const shape = Object.fromEntries(
    columns.map((column) => [
      column,
      (USER_BACKUP_STRUCTURED_COLUMNS.has(column)
        ? z.unknown()
        : userBackupScalarSchema
      ).optional(),
    ]),
  )

  return z
    .object(shape)
    .strict()
    .superRefine((row, ctx) => {
      const identifierColumn =
        tableName === 'cleaning_task_states' ? 'task_id' : 'id'
      const id = row[identifierColumn]

      if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) {
        ctx.addIssue({
          code: 'custom',
          message: 'Backup row id must be a UUID.',
          path: [identifierColumn],
        })
      }

      for (const [column, value] of Object.entries(row)) {
        if (
          value !== null &&
          value !== undefined &&
          (column === 'id' || column.endsWith('_id')) &&
          (typeof value !== 'string' ||
            !z.string().uuid().safeParse(value).success)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `${column} must be a UUID or null.`,
            path: [column],
          })
        }

        if (
          value !== null &&
          value !== undefined &&
          isTimestampColumn(column) &&
          (typeof value !== 'string' ||
            !z.string().datetime({ offset: true }).safeParse(value).success)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `${column} must be an ISO timestamp or null.`,
            path: [column],
          })
        }
      }
    })
}

function isTimestampColumn(column: string): boolean {
  return (
    (column.endsWith('_at') && column !== 'next_due_at') ||
    column === 'starts_at' ||
    column === 'ends_at' ||
    column === 'starts_at_utc'
  )
}

export const userBackupAssetSchema = z.object({
  base64: z
    .string()
    .min(1)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  byteLength: z.number().int().nonnegative(),
  contentType: z.enum(['image/gif', 'image/jpeg', 'image/png', 'image/webp']),
  kind: userBackupAssetKindSchema,
  path: z.string().min(1),
})

export const userBackupArchiveSchema = z.object({
  assets: z.array(userBackupAssetSchema).default([]),
  exportedAt: z.string().datetime({ offset: true }),
  format: z.literal(USER_BACKUP_FORMAT),
  source: z.object({
    appVersion: z.string().min(1),
  }),
  scope: z.object({
    userId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    workspaceKind: z.literal('personal'),
    workspaceName: z.string().min(1),
  }),
  tables: z
    .partialRecord(userBackupTableNameSchema, z.array(userBackupRowSchema))
    .superRefine((tables, ctx) => {
      for (const [tableName, rows] of Object.entries(tables)) {
        const parsedTableName = userBackupTableNameSchema.safeParse(tableName)

        if (!parsedTableName.success || !rows) {
          continue
        }

        const rowSchema = userBackupV1RowSchemas[parsedTableName.data]

        for (const [index, row] of rows.entries()) {
          const result = rowSchema.safeParse(row)

          if (!result.success) {
            for (const issue of result.error.issues) {
              ctx.addIssue({
                code: 'custom',
                message: issue.message,
                path: [tableName, index, ...issue.path],
              })
            }
          }
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
