import type {
  NewTaskInput,
  Task,
  TaskScheduleInput,
  TaskStatus,
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
  project?: string | undefined
  status?: TaskStatus | undefined
}

export interface TaskReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  workspaceId: string
}

export interface TaskWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
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
