import type { ColumnType, Generated } from 'kysely'

export type JsonObject = Record<string, unknown>
export type DateColumn = ColumnType<string, string, string>
export type TimestampColumn = ColumnType<string, string | Date, string | Date>

export interface AppTasksTable {
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
  sort_key: string
  status: 'todo' | 'done'
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppUsersTable {
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
  name: string
  owner_user_id: string
  slug: string
  updated_at: Generated<TimestampColumn>
  version: Generated<number>
}

export interface AppWorkspaceMembersTable {
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  id: Generated<string>
  invited_by: string | null
  joined_at: Generated<TimestampColumn>
  role: 'owner' | 'admin' | 'member' | 'viewer'
  updated_at: Generated<TimestampColumn>
  user_id: string
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
  'app.outbox': AppOutboxTable
  'app.task_events': AppTaskEventsTable
  'app.task_time_blocks': AppTaskTimeBlocksTable
  'app.tasks': AppTasksTable
  'app.users': AppUsersTable
  'app.workspace_members': AppWorkspaceMembersTable
  'app.workspaces': AppWorkspacesTable
}
