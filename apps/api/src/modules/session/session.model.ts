import type {
  AdminUserRecord as ContractAdminUserRecord,
  AppRole,
  SessionWorkspaceMembership as ContractSessionWorkspaceMembership,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export interface SessionActor {
  displayName: string
  email: string
  id: string
}

export interface SessionWorkspace {
  id: string
  kind: WorkspaceKind
  name: string
  slug: string
}

export interface SessionSnapshot {
  actor: SessionActor
  actorUserId: string
  appRole: AppRole
  groupRole: WorkspaceGroupRole | null
  role: WorkspaceRole
  source: 'access_token' | 'default' | 'headers'
  workspace: SessionWorkspace
  workspaceId: string
  workspaces: SessionWorkspaceMembership[]
}

export interface SessionContext {
  auth: AuthenticatedRequestContext | null
  actorUserId: string | undefined
  workspaceId: string | undefined
}

export type SessionWorkspaceMembership = ContractSessionWorkspaceMembership
export type AdminUserRecord = ContractAdminUserRecord
