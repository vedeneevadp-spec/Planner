import type {
  AssignableAppRole,
  CreateSharedWorkspaceInput,
  UpdateSharedWorkspaceInput,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import { isTransientDatabaseError } from '../../infrastructure/db/errors.js'
import {
  NoopProfileAvatarStorage,
  type ProfileAvatarStorage,
} from './profile-avatar.storage.js'
import type {
  SessionContext,
  SessionSnapshot,
  UpdateUserProfileInput,
  UserPreferencesUpdateInput,
  UserProfile,
  WorkspaceInvitationCreateInput,
  WorkspaceSettingsUpdateInput,
  WorkspaceUserGroupRole,
} from './session.model.js'
import type { SessionRepository } from './session.repository.js'

const AUTH_SESSION_CACHE_TTL_MS = 30_000

interface CachedSessionSnapshot {
  expiresAt: number
  snapshot: SessionSnapshot
}

export class SessionService {
  private readonly authSessionCache = new Map<string, CachedSessionSnapshot>()
  private readonly profileAvatarStorage: ProfileAvatarStorage
  private readonly repository: SessionRepository

  constructor(
    repository: SessionRepository,
    profileAvatarStorage: ProfileAvatarStorage = new NoopProfileAvatarStorage(),
  ) {
    this.repository = repository
    this.profileAvatarStorage = profileAvatarStorage
  }

  async resolveSession(context: SessionContext) {
    const cacheKey = getAuthSessionCacheKey(context)

    if (cacheKey) {
      const cached = this.authSessionCache.get(cacheKey)

      if (cached && cached.expiresAt > Date.now()) {
        return cached.snapshot
      }
    }

    const snapshot = await withRepositoryErrorMapping(() =>
      this.repository.resolve(context),
    )

    if (cacheKey) {
      this.authSessionCache.set(cacheKey, {
        expiresAt: Date.now() + AUTH_SESSION_CACHE_TTL_MS,
        snapshot,
      })
    }

    return snapshot
  }

  async listAdminUsers(context: SessionContext) {
    const session = await this.resolveSession(context)

    assertCanManageAdminUsers(session)

    return withRepositoryErrorMapping(() =>
      this.repository.listAdminUsers(session),
    )
  }

  async createSharedWorkspace(
    context: SessionContext,
    input: CreateSharedWorkspaceInput,
  ) {
    const session = await this.resolveSession(context)
    const workspace = await withRepositoryErrorMapping(() =>
      this.repository.createSharedWorkspace(session, input),
    )

    this.authSessionCache.clear()

    return workspace
  }

  async updateSharedWorkspace(
    context: SessionContext,
    input: UpdateSharedWorkspaceInput,
  ) {
    const session = await this.resolveSession(context)

    assertCanManageSharedWorkspace(session)

    const workspace = await withRepositoryErrorMapping(() =>
      this.repository.updateSharedWorkspace(session, input),
    )

    this.authSessionCache.clear()

    return workspace
  }

  async deleteSharedWorkspace(context: SessionContext) {
    const session = await this.resolveSession(context)

    assertCanManageSharedWorkspace(session)

    await withRepositoryErrorMapping(() =>
      this.repository.deleteSharedWorkspace(session),
    )

    this.authSessionCache.clear()
  }

  async listWorkspaceUsers(context: SessionContext) {
    const session = await this.resolveSession(context)

    assertSharedWorkspace(session)

    return withRepositoryErrorMapping(() =>
      this.repository.listWorkspaceUsers(session),
    )
  }

  async listWorkspaceInvitations(context: SessionContext) {
    const session = await this.resolveSession(context)

    assertSharedWorkspace(session)
    assertCanManageWorkspaceParticipants(session)

    return withRepositoryErrorMapping(() =>
      this.repository.listWorkspaceInvitations(session),
    )
  }

  async createWorkspaceInvitation(
    context: SessionContext,
    input: WorkspaceInvitationCreateInput,
  ) {
    const session = await this.resolveSession(context)

    assertSharedWorkspace(session)
    assertCanManageWorkspaceParticipants(session)

    const invitation = await withRepositoryErrorMapping(() =>
      this.repository.createWorkspaceInvitation(session, input),
    )

    this.authSessionCache.clear()

    return invitation
  }

  async updateWorkspaceUserGroupRole(
    context: SessionContext,
    membershipId: string,
    groupRole: WorkspaceUserGroupRole,
  ) {
    const session = await this.resolveSession(context)

    assertSharedWorkspace(session)
    assertCanManageWorkspaceParticipants(session)

    const user = await withRepositoryErrorMapping(() =>
      this.repository.updateWorkspaceUserGroupRole(
        session,
        membershipId,
        groupRole,
      ),
    )

    this.authSessionCache.clear()

    return user
  }

  async removeWorkspaceUser(context: SessionContext, membershipId: string) {
    const session = await this.resolveSession(context)

    assertSharedWorkspace(session)
    assertCanManageWorkspaceParticipants(session)

    await withRepositoryErrorMapping(() =>
      this.repository.removeWorkspaceUser(session, membershipId),
    )

    this.authSessionCache.clear()
  }

  async revokeWorkspaceInvitation(
    context: SessionContext,
    invitationId: string,
  ) {
    const session = await this.resolveSession(context)

    assertSharedWorkspace(session)
    assertCanManageWorkspaceParticipants(session)

    await withRepositoryErrorMapping(() =>
      this.repository.revokeWorkspaceInvitation(session, invitationId),
    )

    this.authSessionCache.clear()
  }

  async updateAdminUserRole(
    context: SessionContext,
    userId: string,
    role: AssignableAppRole,
  ) {
    const session = await this.resolveSession(context)

    assertCanManageAdminUsers(session)

    const user = await withRepositoryErrorMapping(() =>
      this.repository.updateAdminUserRole(session, userId, role),
    )

    this.authSessionCache.clear()

    return user
  }

  async updateWorkspaceSettings(
    context: SessionContext,
    input: WorkspaceSettingsUpdateInput,
  ) {
    const session = await this.resolveSession(context)

    assertCanManageWorkspaceSettings(session)

    const settings = await withRepositoryErrorMapping(() =>
      this.repository.updateWorkspaceSettings(session, input),
    )

    this.authSessionCache.clear()

    return settings
  }

  async updateUserPreferences(
    context: SessionContext,
    input: UserPreferencesUpdateInput,
  ) {
    const session = await this.resolveSession(context)
    const preferences = await withRepositoryErrorMapping(() =>
      this.repository.updateUserPreferences(session, input),
    )

    this.authSessionCache.clear()

    return preferences
  }

  async updateUserProfile(
    context: SessionContext,
    input: UpdateUserProfileInput,
  ): Promise<UserProfile> {
    const session = await this.resolveSession(context)
    const previousAvatarUrl = session.actor.avatarUrl
    let nextAvatarUrl = previousAvatarUrl
    let storedAvatarUrl: string | null = null

    if (input.avatarDataUrl) {
      storedAvatarUrl = await this.profileAvatarStorage.storeProfileAvatar({
        dataUrl: input.avatarDataUrl,
        userId: session.actorUserId,
      })
      nextAvatarUrl = storedAvatarUrl
    } else if (input.removeAvatar) {
      nextAvatarUrl = null
    }

    try {
      const profile = await withRepositoryErrorMapping(() =>
        this.repository.updateUserProfile(session, {
          ...input,
          avatarUrl: nextAvatarUrl,
        }),
      )

      this.authSessionCache.clear()

      if (
        previousAvatarUrl &&
        previousAvatarUrl !== nextAvatarUrl &&
        !previousAvatarUrl.startsWith('data:')
      ) {
        await this.profileAvatarStorage.deleteProfileAvatar(previousAvatarUrl)
      }

      return profile
    } catch (error) {
      if (storedAvatarUrl) {
        try {
          await this.profileAvatarStorage.deleteProfileAvatar(storedAvatarUrl)
        } catch {
          // Best-effort cleanup for freshly uploaded avatars.
        }
      }

      throw error
    }
  }
}

async function withRepositoryErrorMapping<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof HttpError) {
      throw error
    }

    if (isTransientDatabaseError(error)) {
      throw new HttpError(
        503,
        'database_unavailable',
        'Database request timed out. Please retry the action.',
      )
    }

    throw error
  }
}

function getAuthSessionCacheKey(context: SessionContext): string | null {
  if (!context.auth) {
    return null
  }

  return [
    context.auth.claims.sub,
    context.auth.claims.sessionId ?? 'session',
    context.workspaceId ?? 'default',
  ].join(':')
}

function assertSharedWorkspace(session: SessionSnapshot): void {
  if (session.workspace.kind === 'shared') {
    return
  }

  throw new HttpError(
    400,
    'shared_workspace_required',
    'Only shared workspaces support participant management.',
  )
}

function assertCanManageWorkspaceParticipants(session: SessionSnapshot): void {
  if (session.role === 'owner' || session.groupRole === 'group_admin') {
    return
  }

  throw new HttpError(
    403,
    'workspace_participants_manage_forbidden',
    'Only workspace owners and group admins can manage participants.',
  )
}

function assertCanManageSharedWorkspace(session: SessionSnapshot): void {
  if (session.workspace.kind !== 'shared') {
    throw new HttpError(
      400,
      'shared_workspace_required',
      'Only shared workspaces can be renamed or deleted.',
    )
  }

  if (session.role === 'owner') {
    return
  }

  throw new HttpError(
    403,
    'shared_workspace_creator_required',
    'Only the workspace creator can rename or delete it.',
  )
}

function assertCanManageAdminUsers(session: SessionSnapshot): void {
  if (session.appRole === 'owner') {
    return
  }

  throw new HttpError(
    403,
    'owner_required',
    'Only the global owner can manage application users.',
  )
}

function assertCanManageWorkspaceSettings(session: SessionSnapshot): void {
  if (session.appRole === 'admin' || session.appRole === 'owner') {
    return
  }

  throw new HttpError(
    403,
    'workspace_settings_manage_forbidden',
    'Only application admins can update workspace settings.',
  )
}
