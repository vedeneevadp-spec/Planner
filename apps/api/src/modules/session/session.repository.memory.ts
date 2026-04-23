import {
  type CreateSharedWorkspaceInput,
  generateUuidV7,
  type WorkspaceRole,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  SessionContext,
  SessionSnapshot,
  SessionWorkspaceMembership,
} from './session.model.js'
import type { SessionRepository } from './session.repository.js'

const DEFAULT_MEMORY_WORKSPACE: SessionWorkspaceMembership = {
  groupRole: null,
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'personal',
  name: 'Planner Personal Workspace',
  role: 'owner',
  slug: 'personal',
}

const DEFAULT_MEMORY_SESSION: SessionSnapshot = {
  actor: {
    displayName: 'Planner Dev User',
    email: 'dev@planner.local',
    id: '11111111-1111-4111-8111-111111111111',
  },
  actorUserId: '11111111-1111-4111-8111-111111111111',
  groupRole: DEFAULT_MEMORY_WORKSPACE.groupRole,
  role: 'owner',
  source: 'default',
  workspace: {
    id: DEFAULT_MEMORY_WORKSPACE.id,
    kind: DEFAULT_MEMORY_WORKSPACE.kind,
    name: DEFAULT_MEMORY_WORKSPACE.name,
    slug: DEFAULT_MEMORY_WORKSPACE.slug,
  },
  workspaceId: DEFAULT_MEMORY_WORKSPACE.id,
  workspaces: [DEFAULT_MEMORY_WORKSPACE],
}

export class MemorySessionRepository implements SessionRepository {
  private session: SessionSnapshot = DEFAULT_MEMORY_SESSION
  private workspaces: SessionWorkspaceMembership[] = [DEFAULT_MEMORY_WORKSPACE]

  resolve(context: SessionContext): Promise<SessionSnapshot> {
    if (context.auth) {
      const workspace = this.resolveWorkspace(
        context.workspaceId ?? this.session.workspaceId,
      )

      return Promise.resolve({
        ...this.session,
        actor: {
          ...this.session.actor,
          email: context.auth.claims.email ?? this.session.actor.email,
          id: context.auth.claims.sub,
        },
        actorUserId: context.auth.claims.sub,
        groupRole: workspace.groupRole,
        role: workspace.role,
        source: 'access_token',
        workspace: {
          id: workspace.id,
          kind: workspace.kind,
          name: workspace.name,
          slug: workspace.slug,
        },
        workspaceId: workspace.id,
        workspaces: this.workspaces,
      })
    }

    if (context.actorUserId && context.workspaceId) {
      const workspace = this.resolveWorkspace(context.workspaceId)

      return Promise.resolve({
        ...this.session,
        actor: {
          ...this.session.actor,
          id: context.actorUserId,
        },
        actorUserId: context.actorUserId,
        groupRole: workspace.groupRole,
        role: workspace.role,
        source: 'headers',
        workspace: {
          id: workspace.id,
          kind: workspace.kind,
          name: workspace.name,
          slug: workspace.slug,
        },
        workspaceId: workspace.id,
        workspaces: this.workspaces,
      })
    }

    return Promise.resolve(this.session)
  }

  listWorkspaceUsers(session: SessionSnapshot) {
    return Promise.resolve([
      {
        displayName: session.actor.displayName,
        email: session.actor.email,
        groupRole: session.groupRole,
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
    this.workspaces = this.workspaces.map((workspace) =>
      workspace.id === session.workspaceId ? { ...workspace, role } : workspace,
    )

    return Promise.resolve({
      displayName: session.actor.displayName,
      email: session.actor.email,
      groupRole: session.groupRole,
      id: session.actorUserId,
      joinedAt: new Date(0).toISOString(),
      membershipId: '33333333-3333-4333-8333-333333333333',
      role,
      updatedAt: new Date().toISOString(),
    })
  }

  createSharedWorkspace(
    _session: SessionSnapshot,
    input: CreateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership> {
    const sharedWorkspaceCount = this.workspaces.filter(
      (workspace) => workspace.kind === 'shared',
    ).length

    if (sharedWorkspaceCount >= 3) {
      throw new HttpError(
        409,
        'shared_workspace_limit_reached',
        'A user can have up to three shared workspaces.',
      )
    }

    const id = generateUuidV7()
    const workspace: SessionWorkspaceMembership = {
      groupRole: 'group_admin',
      id,
      kind: 'shared',
      name: input.name?.trim() || `Shared Workspace ${sharedWorkspaceCount + 1}`,
      role: 'owner',
      slug: `shared-${id.replaceAll('-', '').slice(-8)}`,
    }

    this.workspaces = [...this.workspaces, workspace]
    this.session = {
      ...this.session,
      workspaces: this.workspaces,
    }

    return Promise.resolve(workspace)
  }

  private resolveWorkspace(workspaceId: string): SessionWorkspaceMembership {
    const workspace = this.workspaces.find(
      (candidate) => candidate.id === workspaceId,
    )

    if (workspace) {
      return workspace
    }

    return {
      groupRole: null,
      id: workspaceId,
      kind: 'personal',
      name: this.session.workspace.name,
      role: this.session.role,
      slug: this.session.workspace.slug,
    }
  }
}
