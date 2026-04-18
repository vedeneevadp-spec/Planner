import type { WorkspaceRole } from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export interface SessionActor {
  displayName: string
  email: string
  id: string
}

export interface SessionWorkspace {
  id: string
  name: string
  slug: string
}

export interface SessionSnapshot {
  actor: SessionActor
  actorUserId: string
  role: WorkspaceRole
  source: 'access_token' | 'default' | 'headers'
  workspace: SessionWorkspace
  workspaceId: string
}

export interface SessionContext {
  auth: AuthenticatedRequestContext | null
  actorUserId: string | undefined
  workspaceId: string | undefined
}
