import type {
  AssignableAppRole,
  CreateSharedWorkspaceInput,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { SessionContext, SessionSnapshot } from './session.model.js'
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

    const snapshot = await this.repository.resolve(context)

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

    return this.repository.listAdminUsers(session)
  }

  async createSharedWorkspace(
    context: SessionContext,
    input: CreateSharedWorkspaceInput,
  ) {
    const session = await this.resolveSession(context)
    const workspace = await this.repository.createSharedWorkspace(
      session,
      input,
    )

    this.authSessionCache.clear()

    return workspace
  }

  async updateAdminUserRole(
    context: SessionContext,
    userId: string,
    role: AssignableAppRole,
  ) {
    const session = await this.resolveSession(context)

    assertCanManageAdminUsers(session)

    const user = await this.repository.updateAdminUserRole(
      session,
      userId,
      role,
    )

    this.authSessionCache.clear()

    return user
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
