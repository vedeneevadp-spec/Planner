import type {
  AssignableAppRole,
  CreateSharedWorkspaceInput,
  UpdateSharedWorkspaceInput,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import type {
  AdminUserRecord,
  ReceivedWorkspaceInvitationRecord,
  SessionContext,
  SessionSnapshot,
  SessionWorkspaceMembership,
  UpdateUserProfileInput,
  UserPreferences,
  UserPreferencesUpdateInput,
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
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<SessionWorkspaceMembership>
  updateSharedWorkspace(
    session: SessionSnapshot,
    input: UpdateSharedWorkspaceInput,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<SessionWorkspaceMembership>
  deleteSharedWorkspace(
    session: SessionSnapshot,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<void>
  leaveSharedWorkspace(
    session: SessionSnapshot,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<void>
  listWorkspaceUsers(
    session: SessionSnapshot,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<WorkspaceUserRecord[]>
  listWorkspaceInvitations(
    session: SessionSnapshot,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<WorkspaceInvitationRecord[]>
  createWorkspaceInvitation(
    session: SessionSnapshot,
    input: WorkspaceInvitationCreateInput,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<WorkspaceInvitationRecord>
  updateWorkspaceUserGroupRole(
    session: SessionSnapshot,
    membershipId: string,
    groupRole: WorkspaceUserGroupRole,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<WorkspaceUserRecord>
  removeWorkspaceUser(
    session: SessionSnapshot,
    membershipId: string,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<void>
  revokeWorkspaceInvitation(
    session: SessionSnapshot,
    invitationId: string,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<void>
  listReceivedWorkspaceInvitations(
    session: SessionSnapshot,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<ReceivedWorkspaceInvitationRecord[]>
  acceptWorkspaceInvitation(
    session: SessionSnapshot,
    invitationId: string,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<void>
  declineWorkspaceInvitation(
    session: SessionSnapshot,
    invitationId: string,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<void>
  listAdminUsers(
    session: SessionSnapshot,
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<AdminUserRecord[]>
  updateAdminUserRole(
    session: SessionSnapshot,
    authContext: AuthenticatedRequestContext | null,
    userId: string,
    role: AssignableAppRole,
  ): Promise<AdminUserRecord>
  updateWorkspaceSettings(
    session: SessionSnapshot,
    authContext: AuthenticatedRequestContext | null,
    input: WorkspaceSettingsUpdateInput,
  ): Promise<WorkspaceSettings>
  updateUserPreferences(
    session: SessionSnapshot,
    authContext: AuthenticatedRequestContext | null,
    input: UserPreferencesUpdateInput,
  ): Promise<UserPreferences>
  updateUserProfile(
    session: SessionSnapshot,
    input: UpdateUserProfileInput & {
      avatarUrl: string | null
    },
    authContext?: AuthenticatedRequestContext | null,
  ): Promise<UserProfile>
}
