import type {
  NewTaskInput,
  Task,
  TaskEventListFilters,
  TaskEventRecord,
  TaskScheduleInput,
  TaskStatus,
  TaskUpdateInput,
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
  plannedDate?: string | undefined
  projectId?: string | undefined
  project?: string | undefined
  status?: TaskStatus | undefined
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
  role?: WorkspaceRole | undefined
  workspaceId: string
}

export interface TaskWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
  workspaceId: string
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
