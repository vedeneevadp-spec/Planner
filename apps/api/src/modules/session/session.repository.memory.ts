import type { SessionContext, SessionSnapshot } from './session.model.js'
import type { SessionRepository } from './session.repository.js'

const DEFAULT_MEMORY_SESSION: SessionSnapshot = {
  actor: {
    displayName: 'Planner Dev User',
    email: 'dev@planner.local',
    id: '11111111-1111-4111-8111-111111111111',
  },
  actorUserId: '11111111-1111-4111-8111-111111111111',
  role: 'owner',
  source: 'default',
  workspace: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Planner Personal Workspace',
    slug: 'personal',
  },
  workspaceId: '22222222-2222-4222-8222-222222222222',
}

export class MemorySessionRepository implements SessionRepository {
  resolve(context: SessionContext): Promise<SessionSnapshot> {
    if (context.auth) {
      return Promise.resolve({
        actor: {
          ...DEFAULT_MEMORY_SESSION.actor,
          email: context.auth.claims.email ?? DEFAULT_MEMORY_SESSION.actor.email,
          id: context.auth.claims.sub,
        },
        actorUserId: context.auth.claims.sub,
        role: DEFAULT_MEMORY_SESSION.role,
        source: 'access_token',
        workspace: {
          ...DEFAULT_MEMORY_SESSION.workspace,
          id: context.workspaceId ?? DEFAULT_MEMORY_SESSION.workspace.id,
        },
        workspaceId: context.workspaceId ?? DEFAULT_MEMORY_SESSION.workspace.id,
      })
    }

    if (context.actorUserId && context.workspaceId) {
      return Promise.resolve({
        actor: {
          ...DEFAULT_MEMORY_SESSION.actor,
          id: context.actorUserId,
        },
        actorUserId: context.actorUserId,
        role: DEFAULT_MEMORY_SESSION.role,
        source: 'headers',
        workspace: {
          ...DEFAULT_MEMORY_SESSION.workspace,
          id: context.workspaceId,
        },
        workspaceId: context.workspaceId,
      })
    }

    return Promise.resolve(DEFAULT_MEMORY_SESSION)
  }
}
