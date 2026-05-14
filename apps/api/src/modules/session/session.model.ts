import type {
  AdminUserRecord as ContractAdminUserRecord,
  AppRole,
  AssignableWorkspaceGroupRole,
  SessionWorkspaceMembership as ContractSessionWorkspaceMembership,
  UpdateSharedWorkspaceInput as ContractUpdateSharedWorkspaceInput,
  UpdateUserProfileInput as ContractUpdateUserProfileInput,
  UserPreferences as ContractUserPreferences,
  UserPreferencesUpdateInput as ContractUserPreferencesUpdateInput,
  UserProfile as ContractUserProfile,
  WorkspaceGroupRole,
  WorkspaceInvitationCreateInput as ContractWorkspaceInvitationCreateInput,
  WorkspaceInvitationRecord as ContractWorkspaceInvitationRecord,
  WorkspaceKind,
  WorkspaceRole,
  WorkspaceSettings as ContractWorkspaceSettings,
  WorkspaceSettingsUpdateInput as ContractWorkspaceSettingsUpdateInput,
  WorkspaceUserRecord as ContractWorkspaceUserRecord,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export interface SessionActor {
  avatarUrl: string | null
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
  workspaceSettings: WorkspaceSettings
  workspaces: SessionWorkspaceMembership[]
  userPreferences: UserPreferences
}

export interface SessionContext {
  auth: AuthenticatedRequestContext | null
  actorUserId: string | undefined
  workspaceId: string | undefined
}

export type SessionWorkspaceMembership = ContractSessionWorkspaceMembership
export type AdminUserRecord = ContractAdminUserRecord
export type WorkspaceSettings = ContractWorkspaceSettings
export type WorkspaceSettingsUpdateInput = ContractWorkspaceSettingsUpdateInput
export type UserPreferences = ContractUserPreferences
export type UserPreferencesUpdateInput = ContractUserPreferencesUpdateInput
export type UpdateSharedWorkspaceInput = ContractUpdateSharedWorkspaceInput
export type UpdateUserProfileInput = ContractUpdateUserProfileInput
export type UserProfile = ContractUserProfile
export type WorkspaceInvitationCreateInput =
  ContractWorkspaceInvitationCreateInput
export type WorkspaceInvitationRecord = ContractWorkspaceInvitationRecord
export type WorkspaceUserRecord = ContractWorkspaceUserRecord
export type WorkspaceUserGroupRole = AssignableWorkspaceGroupRole
