import type {
  NewProjectInput,
  ProjectRecord,
  ProjectUpdateInput,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export interface StoredProjectRecord extends ProjectRecord {
  workspaceId: string
  updatedAt: string
  deletedAt: string | null
  version: number
}

export interface ProjectReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
  workspaceId: string
}

export interface ProjectWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
  workspaceId: string
}

export interface CreateProjectCommand {
  context: ProjectWriteContext
  input: NewProjectInput
}

export interface UpdateProjectCommand {
  context: ProjectWriteContext
  input: ProjectUpdateInput
  projectId: string
}
