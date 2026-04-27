import type {
  AssignableAppRole,
  CreateSharedWorkspaceInput,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import { isTransientDatabaseError } from '../../infrastructure/db/errors.js'
import type {
  SessionContext,
  SessionSnapshot,
  WorkspaceInvitationCreateInput,
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
  private readonly repository: SessionRepository

  constructor(repository: SessionRepository) {
    this.repository = repository
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

    return withRepositoryErrorMapping(() => this.repository.listAdminUsers(session))
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
