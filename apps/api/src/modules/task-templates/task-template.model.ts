import type {
  NewTaskTemplateInput,
  TaskTemplateRecord,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredTaskTemplateRecord = TaskTemplateRecord

export interface TaskTemplateReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface TaskTemplateWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface CreateTaskTemplateCommand {
  context: TaskTemplateWriteContext
  input: NewTaskTemplateInput
}

export interface DeleteTaskTemplateCommand {
  context: TaskTemplateWriteContext
  templateId: string
}
