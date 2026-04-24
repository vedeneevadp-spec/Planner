import {
  type AdminUserRecord,
  type AssignableAppRole,
  type CreateSharedWorkspaceInput,
  generateUuidV7,
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
  appRole: 'owner',
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
  private users: AdminUserRecord[] = [
    {
      appRole: 'owner',
      displayName: DEFAULT_MEMORY_SESSION.actor.displayName,
      email: DEFAULT_MEMORY_SESSION.actor.email,
      id: DEFAULT_MEMORY_SESSION.actorUserId,
      updatedAt: new Date(0).toISOString(),
    },
    {
      appRole: 'user',
      displayName: 'Planner Reader',
      email: 'reader@planner.local',
      id: '44444444-4444-4444-8444-444444444444',
      updatedAt: new Date(0).toISOString(),
    },
  ]
  private workspaces: SessionWorkspaceMembership[] = [DEFAULT_MEMORY_WORKSPACE]

  resolve(context: SessionContext): Promise<SessionSnapshot> {
    if (context.auth) {
      const workspace = this.resolveWorkspace(
        context.workspaceId ?? this.session.workspaceId,
      )
      const actor = this.resolveActor(
        context.auth.claims.sub,
        context.auth.claims.email ?? this.session.actor.email,
      )

      return Promise.resolve({
        ...this.session,
        actor: {
          displayName: actor.displayName,
          email: actor.email,
          id: actor.id,
        },
        actorUserId: actor.id,
        appRole: actor.appRole,
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
      const actor = this.resolveActor(
        context.actorUserId,
        this.session.actor.email,
        this.session.actor.displayName,
      )

      return Promise.resolve({
        ...this.session,
        actor: {
          displayName: actor.displayName,
          email: actor.email,
          id: actor.id,
        },
        actorUserId: actor.id,
        appRole: actor.appRole,
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

  listAdminUsers() {
    return Promise.resolve(this.users)
  }

  updateAdminUserRole(
    session: SessionSnapshot,
    userId: string,
    role: AssignableAppRole,
  ) {
    if (session.appRole !== 'owner') {
      throw new HttpError(
        403,
        'owner_required',
        'Only the global owner can manage application users.',
      )
    }

    const currentUser = this.users.find((user) => user.id === userId)

    if (!currentUser) {
      throw new HttpError(
        404,
        'admin_user_not_found',
        'Application user was not found.',
      )
    }

    if (currentUser.appRole === 'owner') {
      throw new HttpError(
        400,
        'owner_role_immutable',
        'The global owner role cannot be changed.',
      )
    }

    const updatedUser = {
      ...currentUser,
      appRole: role,
      updatedAt: new Date().toISOString(),
    } satisfies AdminUserRecord

    this.users = this.users.map((user) =>
      user.id === userId ? updatedUser : user,
    )

    if (userId === this.session.actorUserId) {
      this.session = {
        ...this.session,
        appRole: role,
      }
    }

    return Promise.resolve(updatedUser)
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

  private resolveActor(
    actorUserId: string,
    email: string,
    displayName = this.session.actor.displayName,
  ): AdminUserRecord {
    const existingUser = this.users.find((user) => user.id === actorUserId)

    if (existingUser) {
      return existingUser
    }

    const createdUser: AdminUserRecord = {
      appRole: 'user',
      displayName,
      email,
      id: actorUserId,
      updatedAt: new Date().toISOString(),
    }

    this.users = [...this.users, createdUser]

    return createdUser
  }
}
