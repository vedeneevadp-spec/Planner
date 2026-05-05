import type {
  AssignableAppRole,
  CreateSharedWorkspaceInput,
  UpdateSharedWorkspaceInput,
} from '@planner/contracts'

import type {
  AdminUserRecord,
  SessionContext,
  SessionSnapshot,
  SessionWorkspaceMembership,
  UpdateUserProfileInput,
  UserProfile,
  WorkspaceInvitationCreateInput,
  WorkspaceInvitationRecord,
  WorkspaceSettings,
  WorkspaceSettingsUpdateInput,
  WorkspaceUserGroupRole,
  WorkspaceUserRecord,
} from './session.model.js'

export interface SessionRepository {
  resolve(context: SessionContext): Promise<SessionSnapshot>
  createSharedWorkspace(
    session: SessionSnapshot,
    input: CreateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership>
  updateSharedWorkspace(
    session: SessionSnapshot,
    input: UpdateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership>
  deleteSharedWorkspace(session: SessionSnapshot): Promise<void>
  listWorkspaceUsers(session: SessionSnapshot): Promise<WorkspaceUserRecord[]>
  listWorkspaceInvitations(
    session: SessionSnapshot,
  ): Promise<WorkspaceInvitationRecord[]>
  createWorkspaceInvitation(
    session: SessionSnapshot,
    input: WorkspaceInvitationCreateInput,
  ): Promise<WorkspaceInvitationRecord>
  updateWorkspaceUserGroupRole(
    session: SessionSnapshot,
    membershipId: string,
    groupRole: WorkspaceUserGroupRole,
  ): Promise<WorkspaceUserRecord>
  removeWorkspaceUser(
    session: SessionSnapshot,
    membershipId: string,
  ): Promise<void>
  revokeWorkspaceInvitation(
    session: SessionSnapshot,
    invitationId: string,
  ): Promise<void>
  listAdminUsers(session: SessionSnapshot): Promise<AdminUserRecord[]>
  updateAdminUserRole(
    session: SessionSnapshot,
    userId: string,
    role: AssignableAppRole,
  ): Promise<AdminUserRecord>
  updateWorkspaceSettings(
    session: SessionSnapshot,
    input: WorkspaceSettingsUpdateInput,
  ): Promise<WorkspaceSettings>
  updateUserProfile(
    session: SessionSnapshot,
    input: UpdateUserProfileInput & {
      avatarUrl: string | null
    },
  ): Promise<UserProfile>
}
