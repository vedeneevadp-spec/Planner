import type {
  AssignableAppRole,
  CreateSharedWorkspaceInput,
} from '@planner/contracts'

import type {
  AdminUserRecord,
  SessionContext,
  SessionSnapshot,
  SessionWorkspaceMembership,
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
}
