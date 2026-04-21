import type {
  NewTaskTemplateInput,
  TaskTemplateRecord,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredTaskTemplateRecord = TaskTemplateRecord

export interface TaskTemplateReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
  workspaceId: string
}

export interface TaskTemplateWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
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
