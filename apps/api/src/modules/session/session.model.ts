import type { WorkspaceRole } from '@planner/contracts'

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
  source: 'default' | 'headers'
  workspace: SessionWorkspace
  workspaceId: string
}

export interface SessionContext {
  actorUserId: string | undefined
  workspaceId: string | undefined
}
