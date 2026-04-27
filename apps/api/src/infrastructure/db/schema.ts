import type { ColumnType, Generated } from 'kysely'

export type JsonObject = Record<string, unknown>
export type DateColumn = ColumnType<string, string, string>
export type TimeColumn = ColumnType<string, string, string>
export type TimestampColumn = ColumnType<string, string | Date, string | Date>

export interface AppTasksTable {
  assignee_user_id: string | null
  completed_at: TimestampColumn | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  description: string
  due_at: TimestampColumn | null
  due_on: DateColumn | null
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  parent_task_id: string | null
  planned_on: DateColumn | null
  priority: number
  project_id: string | null
  resource: number | null
  sphere_id: string | null
  sort_key: string
  status: 'todo' | 'in_progress' | 'done'
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppChaosInboxItemsTable {
  converted_note_id: string | null
  converted_task_id: string | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  due_on: DateColumn | null
  id: Generated<string>
  kind: 'unknown' | 'task' | 'note' | 'shopping' | 'event' | 'idea'
  priority: 'low' | 'medium' | 'high' | null
  source: 'manual' | 'quick_add' | 'widget' | 'voice'
  sphere_id: string | null
  status: 'new' | 'in_review' | 'converted' | 'archived'
  text: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppDailyPlansTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  date: DateColumn
  deleted_at: TimestampColumn | null
  energy_mode: 'minimum' | 'normal' | 'maximum'
  focus_task_ids: ColumnType<string[], string[] | string, string[] | string>
  id: Generated<string>
  overload_score: number
  routine_task_ids: ColumnType<string[], string[] | string, string[] | string>
  support_task_ids: ColumnType<string[], string[] | string, string[] | string>
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppLifeSpheresTable {
  color: string | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  icon: string | null
  id: Generated<string>
  is_active: boolean
  is_default: boolean
  name: string
  sort_order: number
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppTaskTemplatesTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  description: string
  due_on: DateColumn | null
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  planned_end_time: TimeColumn | null
  planned_on: DateColumn | null
  planned_start_time: TimeColumn | null
  project_id: string | null
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppUsersTable {
  app_role: 'owner' | 'admin' | 'user' | 'guest'
  avatar_url: string | null
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  display_name: string
  email: string
  id: Generated<string>
  locale: string
  timezone: string
  updated_at: Generated<TimestampColumn>
  version: Generated<number>
}

export interface AppWorkspacesTable {
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  description: string
  id: Generated<string>
  kind: 'personal' | 'shared'
  name: string
  owner_user_id: string
  slug: string
  updated_at: Generated<TimestampColumn>
  version: Generated<number>
}

export interface AppWorkspaceMembersTable {
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  group_role: 'group_admin' | 'senior_member' | 'member' | null
  id: Generated<string>
  invited_by: string | null
  joined_at: Generated<TimestampColumn>
  role: 'owner' | 'admin' | 'user' | 'guest'
  updated_at: Generated<TimestampColumn>
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppWorkspaceInvitationsTable {
  accepted_at: TimestampColumn | null
  accepted_by: string | null
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  email: string
  group_role: 'group_admin' | 'senior_member' | 'member'
  id: Generated<string>
  invited_by: string | null
  updated_at: Generated<TimestampColumn>
  version: Generated<number>
  workspace_id: string
}

export interface AppProjectsTable {
  color: string | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  description: string
  icon: string
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  position: number
  slug: string
  status: 'active' | 'archived'
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppEmojiSetsTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  description: string
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  slug: string
  source: 'custom'
  status: 'active' | 'archived'
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppEmojiAssetsTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  emoji_set_id: string
  id: Generated<string>
  keywords: ColumnType<string[], string[] | string, string[] | string>
  kind: 'image'
  label: string
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  shortcode: string
  sort_order: number
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  value: string
  version: Generated<number>
  workspace_id: string
}

export interface AppTaskTimeBlocksTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  ends_at: TimestampColumn
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  position: number
  source: string
  starts_at: TimestampColumn
  task_id: string
  timezone: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppTaskEventsTable {
  actor_user_id: string | null
  event_id: Generated<string>
  event_type: string
  id: Generated<number>
  occurred_at: Generated<TimestampColumn>
  payload: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  task_id: string | null
  workspace_id: string
}

export interface AppTaskAttachmentsTable {
  content_type: string
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  original_filename: string
  size_bytes: number
  storage_bucket: string
  storage_object_path: string
  task_id: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppDeviceSessionsTable {
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  device_fingerprint: string
  id: Generated<string>
  last_seen_at: Generated<TimestampColumn>
  updated_at: Generated<TimestampColumn>
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppOutboxTable {
  aggregate_id: string
  aggregate_type: string
  attempts: Generated<number>
  available_at: Generated<TimestampColumn>
  created_at: Generated<TimestampColumn>
  id: Generated<number>
  last_error: string | null
  locked_at: TimestampColumn | null
  payload: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  processed_at: TimestampColumn | null
  status: Generated<'pending' | 'processing' | 'completed' | 'failed'>
  topic: string
}

export interface DatabaseSchema {
  'app.chaos_inbox_items': AppChaosInboxItemsTable
  'app.device_sessions': AppDeviceSessionsTable
  'app.daily_plans': AppDailyPlansTable
  'app.emoji_assets': AppEmojiAssetsTable
  'app.emoji_sets': AppEmojiSetsTable
  'app.life_spheres': AppLifeSpheresTable
  'app.outbox': AppOutboxTable
  'app.projects': AppProjectsTable
  'app.task_attachments': AppTaskAttachmentsTable
  'app.task_events': AppTaskEventsTable
  'app.task_templates': AppTaskTemplatesTable
  'app.task_time_blocks': AppTaskTimeBlocksTable
  'app.tasks': AppTasksTable
  'app.users': AppUsersTable
  'app.workspace_invitations': AppWorkspaceInvitationsTable
  'app.workspace_members': AppWorkspaceMembersTable
  'app.workspaces': AppWorkspacesTable
}
