import type { WorkspaceRole } from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
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
  private session: SessionSnapshot = DEFAULT_MEMORY_SESSION

  resolve(context: SessionContext): Promise<SessionSnapshot> {
    if (context.auth) {
      return Promise.resolve({
        ...this.session,
        actor: {
          ...this.session.actor,
          email: context.auth.claims.email ?? this.session.actor.email,
          id: context.auth.claims.sub,
        },
        actorUserId: context.auth.claims.sub,
        source: 'access_token',
        workspace: {
          ...this.session.workspace,
          id: context.workspaceId ?? this.session.workspace.id,
        },
        workspaceId: context.workspaceId ?? this.session.workspace.id,
      })
    }

    if (context.actorUserId && context.workspaceId) {
      return Promise.resolve({
        ...this.session,
        actor: {
          ...this.session.actor,
          id: context.actorUserId,
        },
        actorUserId: context.actorUserId,
        source: 'headers',
        workspace: {
          ...this.session.workspace,
          id: context.workspaceId,
        },
        workspaceId: context.workspaceId,
      })
    }

    return Promise.resolve(this.session)
  }

  listWorkspaceUsers(session: SessionSnapshot) {
    return Promise.resolve([
      {
        displayName: session.actor.displayName,
        email: session.actor.email,
        id: session.actorUserId,
        joinedAt: new Date(0).toISOString(),
        membershipId: '33333333-3333-4333-8333-333333333333',
        role: session.role,
        updatedAt: new Date(0).toISOString(),
      },
    ])
  }

  updateWorkspaceUserRole(
    session: SessionSnapshot,
    userId: string,
    role: WorkspaceRole,
  ) {
    if (userId !== session.actorUserId) {
      throw new HttpError(
        404,
        'workspace_user_not_found',
        'Workspace user was not found.',
      )
    }

    if (session.role === 'owner' && role !== 'owner') {
      throw new HttpError(
        400,
        'last_owner_required',
        'Workspace must keep at least one owner.',
      )
    }

    this.session = {
      ...this.session,
      role,
    }

    return Promise.resolve({
      displayName: session.actor.displayName,
      email: session.actor.email,
      id: session.actorUserId,
      joinedAt: new Date(0).toISOString(),
      membershipId: '33333333-3333-4333-8333-333333333333',
      role,
      updatedAt: new Date().toISOString(),
    })
  }
}
