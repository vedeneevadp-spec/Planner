import type { SessionContext, SessionSnapshot } from './session.model.js'
import type { SessionRepository } from './session.repository.js'

const AUTH_SESSION_CACHE_TTL_MS = 30_000

interface CachedSessionSnapshot {
  expiresAt: number
  snapshot: SessionSnapshot
}

export class SessionService {
  private readonly authSessionCache = new Map<string, CachedSessionSnapshot>()

  constructor(private readonly repository: SessionRepository) {}

  async resolveSession(context: SessionContext) {
    const cacheKey = this.getAuthSessionCacheKey(context)

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

  private getAuthSessionCacheKey(context: SessionContext): string | null {
    if (!context.auth) {
      return null
    }

    return [
      context.auth.claims.sub,
      context.auth.claims.sessionId ?? 'session',
      context.workspaceId ?? 'default',
    ].join(':')
  }
}
