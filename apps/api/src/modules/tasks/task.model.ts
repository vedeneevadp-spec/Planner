import type {
  NewTaskInput,
  Task,
  TaskCompletionType,
  TaskCursorDateMode,
  TaskCursorDirection,
  TaskCursorListFilters,
  TaskCursorScope,
  TaskEventListFilters,
  TaskEventRecord,
  TaskNextStageInput,
  TaskNextStageUndoInput,
  TaskScheduleInput,
  TaskStageType,
  TaskStatus,
  TaskUpdateInput,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export interface StoredTaskRecord extends Task {
  workspaceId: string
  updatedAt: string
  deletedAt: string | null
  version: number
}

export interface TaskListFilters {
  limit?: number | undefined
  offset?: number | undefined
  plannedDate?: string | undefined
  projectId?: string | undefined
  project?: string | undefined
  sphereId?: string | undefined
  status?: TaskStatus | undefined
}

export interface TaskListPageResult {
  hasMore: boolean
  items: StoredTaskRecord[]
  limit: number
  nextOffset: number | null
  offset: number
}

export interface TaskCursorAnchor {
  createdAt: string
  id: string
}

export interface TaskCursorPageQuery {
  anchor?: TaskCursorAnchor | undefined
  dateFrom?: string | undefined
  dateMode: TaskCursorDateMode
  dateTo?: string | undefined
  direction: TaskCursorDirection
  limit: number
  scope: TaskCursorScope
}

export interface TaskCursorPageResult {
  hasMore: boolean
  items: StoredTaskRecord[]
  totalCount: number
}

export interface TaskCursorListResult extends TaskCursorPageResult {
  limit: number
  nextCursor: string | null
  returnedCount: number
  truncated: boolean
}

export type TaskCursorFilters = TaskCursorListFilters

export interface TaskReadModelSourceResult {
  returnedCount: number
  totalCount: number
  truncated: boolean
}

export interface TaskReadModelResult {
  eventCursor: number
  historyNextCursor: string | null
  items: StoredTaskRecord[]
  returnedCount: number
  sources: {
    active: TaskReadModelSourceResult
    history: TaskReadModelSourceResult
    range: TaskReadModelSourceResult
  }
  totalCount: number
  truncated: boolean
}

export type StoredTaskEventRecord = TaskEventRecord

export interface TaskEventListResult {
  events: StoredTaskEventRecord[]
  nextEventId: number
}

export type TaskEventFilters = TaskEventListFilters

export interface TaskReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  clientTimeZone?: string | undefined
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface PersonalWorkspaceTarget {
  id: string
  name: string
}

export interface TaskWriteContext {
  actorUserId: string
  actorDisplayName: string
  auth: AuthenticatedRequestContext | null
  clientTimeZone?: string | undefined
  groupRole?: WorkspaceGroupRole | null | undefined
  personalWorkspace?: PersonalWorkspaceTarget | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
  workspaceName?: string | undefined
}

export interface CreateTaskCommand {
  context: TaskWriteContext
  input: NewTaskInput
}

export interface UpdateTaskStatusCommand {
  context: TaskWriteContext
  taskId: string
  status: TaskStatus
  expectedVersion?: number
}

export interface CompleteRecurringTaskCommand {
  context: TaskWriteContext
  expectedVersion?: number
  nextPlannedDate: string
  nextTaskInput: NewTaskInput
  recurrenceSeriesId: string
  taskId: string
}

export interface UpdateTaskCommand {
  context: TaskWriteContext
  input: TaskUpdateInput
  taskId: string
  expectedVersion?: number
}

export interface UpdateTaskScheduleCommand {
  context: TaskWriteContext
  taskId: string
  schedule: TaskScheduleInput
  expectedVersion?: number
}

export interface DeleteTaskCommand {
  context: TaskWriteContext
  taskId: string
  expectedVersion?: number
}

export interface CreateTaskNextStageCommand {
  context: TaskWriteContext
  input: TaskNextStageInput
  taskId: string
}

export interface TaskNextStageResult {
  currentTask: StoredTaskRecord
  nextTask: StoredTaskRecord
  undo: TaskNextStageUndoInput
}

export interface UndoTaskNextStageCommand {
  context: TaskWriteContext
  input: TaskNextStageUndoInput
  taskId: string
}

export interface UndoTaskNextStageResult {
  currentTask: StoredTaskRecord
  removedTaskId: string
}

export interface DetachTaskChainCommand {
  context: TaskWriteContext
  expectedVersion?: number
  taskId: string
}

export interface CloseTaskChainCommand {
  context: TaskWriteContext
  expectedVersion?: number
  taskId: string
}

export type StoredTaskStageType = TaskStageType
export type StoredTaskCompletionType = TaskCompletionType

export interface CopyTaskToPersonalCommand {
  context: TaskWriteContext
  expectedVersion?: number
  task: StoredTaskRecord
  targetWorkspace: PersonalWorkspaceTarget
}

export interface MoveTaskToPersonalCommand {
  context: TaskWriteContext
  expectedVersion?: number
  task: StoredTaskRecord
  targetWorkspace: PersonalWorkspaceTarget
}
