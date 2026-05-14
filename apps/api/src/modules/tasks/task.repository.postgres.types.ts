import type { Selectable, SelectQueryBuilder } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'

export type TaskRow = Selectable<DatabaseSchema['app.tasks']>
export type ProjectRow = Selectable<DatabaseSchema['app.projects']>
export type TaskTimeBlockRow = Selectable<
  DatabaseSchema['app.task_time_blocks']
>
export type TaskEventRow = Selectable<DatabaseSchema['app.task_events']>
export type TaskRowsQuery = SelectQueryBuilder<
  DatabaseSchema,
  'app.tasks',
  TaskRow
>
export type TaskListRow = TaskRow & {
  assignee_display_name?: string | null
  author_display_name?: string | null
  project_title?: ProjectRow['title'] | null
  time_block_ends_at: TaskTimeBlockRow['ends_at'] | null
  time_block_starts_at: TaskTimeBlockRow['starts_at'] | null
}

export interface ResolvedTaskProject {
  id: string
  title: string
}

export interface ResolvedTaskAssignee {
  displayName: string
  id: string
}

export const LEGACY_PROJECT_NAME_KEY = 'legacyProjectName'
export const MANUAL_TIME_BLOCK_SOURCE = 'manual'
export const TASK_ICON_KEY = 'taskIcon'
export const TASK_IMPORTANCE_KEY = 'taskImportance'
export const TASK_RECURRENCE_KEY = 'taskRecurrence'
export const TASK_REMIND_BEFORE_START_KEY = 'taskRemindBeforeStart'
export const TASK_REQUIRES_CONFIRMATION_KEY = 'taskRequiresConfirmation'
export const TASK_ROUTINE_KEY = 'taskRoutine'
export const TASK_URGENCY_KEY = 'taskUrgency'
export const DEFAULT_TASK_IMPORTANCE = 'not_important'
export const DEFAULT_TASK_URGENCY = 'not_urgent'
export const TASK_LIST_BATCH_SIZE = 20
