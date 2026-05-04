import {
  type AdminUserRecord,
  type AssignableAppRole,
  type CreateSharedWorkspaceInput,
  generateUuidV7,
  type UpdateSharedWorkspaceInput,
  type WorkspaceGroupRole,
  type WorkspaceKind,
  type WorkspaceRole,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  SessionContext,
  SessionSnapshot,
  SessionWorkspaceMembership,
  WorkspaceInvitationCreateInput,
  WorkspaceInvitationRecord,
  WorkspaceUserGroupRole,
  WorkspaceUserRecord,
} from './session.model.js'
import type { SessionRepository } from './session.repository.js'

interface MemoryWorkspace {
  createdAt: string
  id: string
  kind: WorkspaceKind
  name: string
  ownerUserId: string
  slug: string
  taskCompletionConfettiEnabled: boolean
}

interface MemoryMembership {
  deletedAt: string | null
  groupRole: WorkspaceGroupRole | null
  id: string
  invitedBy: string | null
  joinedAt: string
  role: WorkspaceRole
  updatedAt: string
  userId: string
  workspaceId: string
}

interface MemoryInvitation {
  acceptedAt: string | null
  acceptedBy: string | null
  deletedAt: string | null
  email: string
  groupRole: WorkspaceGroupRole
  id: string
  invitedAt: string
  invitedBy: string | null
  updatedAt: string
  workspaceId: string
}

const DEFAULT_ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const DEFAULT_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

const DEFAULT_MEMORY_WORKSPACE: MemoryWorkspace = {
  createdAt: new Date(0).toISOString(),
  id: DEFAULT_WORKSPACE_ID,
  kind: 'personal',
  name: 'Personal Workspace',
  ownerUserId: DEFAULT_ACTOR_ID,
  slug: 'personal',
  taskCompletionConfettiEnabled: true,
}

export class MemorySessionRepository implements SessionRepository {
  private users: AdminUserRecord[] = [
    {
      appRole: 'owner',
      displayName: 'Tikondra',
      email: 'dev@planner.local',
      id: DEFAULT_ACTOR_ID,
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
  private workspaces: MemoryWorkspace[] = [{ ...DEFAULT_MEMORY_WORKSPACE }]
  private memberships: MemoryMembership[] = [
    {
      deletedAt: null,
      groupRole: null,
      id: generateUuidV7(),
      invitedBy: null,
      joinedAt: new Date(0).toISOString(),
      role: 'owner',
      updatedAt: new Date(0).toISOString(),
      userId: DEFAULT_ACTOR_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
    },
  ]
  private invitations: MemoryInvitation[] = []

  resolve(context: SessionContext): Promise<SessionSnapshot> {
    if (context.auth) {
      const actor = this.resolveAuthenticatedActor(
        context.auth.claims.sub,
        context.auth.claims.email ??
          `${context.auth.claims.sub}@users.planner.local`,
      )

      this.claimWorkspaceInvitations(actor)

      if (!this.hasAnyWorkspaceMembership(actor.id) && !context.workspaceId) {
        this.provisionPersonalWorkspace(actor.id, actor.displayName)
      }

      return Promise.resolve(
        this.buildSnapshot(actor, context.workspaceId, 'access_token', true),
      )
    }

    if (context.actorUserId) {
      const actor = this.resolveLegacyActor(context.actorUserId)

      return Promise.resolve(
        this.buildSnapshot(actor, context.workspaceId, 'headers', false),
      )
    }

    return Promise.resolve(
      this.buildSnapshot(this.getDefaultActor(), undefined, 'default', false),
    )
  }

  createSharedWorkspace(
    session: SessionSnapshot,
    input: CreateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership> {
    const sharedWorkspaceCount = this.listMembershipsForUser(
      session.actorUserId,
    ).filter(
      (membership) =>
        this.getWorkspaceById(membership.workspaceId)?.kind === 'shared',
    ).length

    if (sharedWorkspaceCount >= 3) {
      throw new HttpError(
        409,
        'shared_workspace_limit_reached',
        'A user can have up to three shared workspaces.',
      )
    }

    const id = generateUuidV7()
    const now = new Date().toISOString()
    const workspace: MemoryWorkspace = {
      createdAt: now,
      id,
      kind: 'shared',
      name:
        input.name?.trim() || `Shared Workspace ${sharedWorkspaceCount + 1}`,
      ownerUserId: session.actorUserId,
      slug: `shared-${id.replaceAll('-', '').slice(-8)}`,
      taskCompletionConfettiEnabled: true,
    }

    this.workspaces = [...this.workspaces, workspace]
    this.memberships = [
      ...this.memberships,
      {
        deletedAt: null,
        groupRole: 'group_admin',
        id: generateUuidV7(),
        invitedBy: null,
        joinedAt: now,
        role: 'owner',
        updatedAt: now,
        userId: session.actorUserId,
        workspaceId: workspace.id,
      },
    ]

    return Promise.resolve(
      this.toWorkspaceMembership(workspace, 'owner', 'group_admin'),
    )
  }

  updateSharedWorkspace(
    session: SessionSnapshot,
    input: UpdateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership> {
    const workspace = this.requireOwnedSharedWorkspace(session)

    workspace.name = input.name.trim()

    return Promise.resolve(
      this.toWorkspaceMembership(workspace, session.role, session.groupRole),
    )
  }

  deleteSharedWorkspace(session: SessionSnapshot): Promise<void> {
    const workspace = this.requireOwnedSharedWorkspace(session)

    this.workspaces = this.workspaces.filter(
      (candidate) => candidate.id !== workspace.id,
    )
    this.memberships = this.memberships.filter(
      (membership) => membership.workspaceId !== workspace.id,
    )
    this.invitations = this.invitations.filter(
      (invitation) => invitation.workspaceId !== workspace.id,
    )

    return Promise.resolve()
  }

  listWorkspaceUsers(session: SessionSnapshot): Promise<WorkspaceUserRecord[]> {
    const users = this.memberships
      .filter(
        (membership) =>
          membership.workspaceId === session.workspaceId &&
          membership.deletedAt === null,
      )
      .map((membership) => {
        const user = this.getUserById(membership.userId)

        if (!user) {
          throw new Error(`Missing memory user "${membership.userId}".`)
        }

        return {
          displayName: user.displayName,
          email: user.email,
          groupRole: membership.groupRole,
          id: user.id,
          isOwner: membership.role === 'owner',
          joinedAt: membership.joinedAt,
          membershipId: membership.id,
          updatedAt: membership.updatedAt,
        } satisfies WorkspaceUserRecord
      })
      .sort(compareWorkspaceUsers)

    return Promise.resolve(users)
  }

  listWorkspaceInvitations(
    session: SessionSnapshot,
  ): Promise<WorkspaceInvitationRecord[]> {
    const invitations = this.invitations
      .filter(
        (invitation) =>
          invitation.workspaceId === session.workspaceId &&
          invitation.deletedAt === null &&
          invitation.acceptedAt === null,
      )
      .map((invitation) => ({
        email: invitation.email,
        groupRole: invitation.groupRole,
        id: invitation.id,
        invitedAt: invitation.invitedAt,
        updatedAt: invitation.updatedAt,
      }))
      .sort(
        (left, right) =>
          right.invitedAt.localeCompare(left.invitedAt) ||
          left.email.localeCompare(right.email),
      )

    return Promise.resolve(invitations)
  }

  createWorkspaceInvitation(
    session: SessionSnapshot,
    input: WorkspaceInvitationCreateInput,
  ): Promise<WorkspaceInvitationRecord> {
    const normalizedEmail = normalizeEmail(input.email)
    const activeMembership = this.findActiveMembershipByEmail(
      session.workspaceId,
      normalizedEmail,
    )

    if (activeMembership) {
      throw new HttpError(
        409,
        'workspace_user_already_exists',
        'The user is already a participant in this workspace.',
      )
    }

    const now = new Date().toISOString()
    const existingInvitation = this.invitations.find(
      (invitation) =>
        invitation.workspaceId === session.workspaceId &&
        invitation.email === normalizedEmail,
    )

    if (existingInvitation) {
      existingInvitation.acceptedAt = null
      existingInvitation.acceptedBy = null
      existingInvitation.deletedAt = null
      existingInvitation.groupRole = input.groupRole
      existingInvitation.invitedBy = session.actorUserId
      existingInvitation.updatedAt = now

      return Promise.resolve(
        this.toWorkspaceInvitationRecord(existingInvitation),
      )
    }

    const invitation: MemoryInvitation = {
      acceptedAt: null,
      acceptedBy: null,
      deletedAt: null,
      email: normalizedEmail,
      groupRole: input.groupRole,
      id: generateUuidV7(),
      invitedAt: now,
      invitedBy: session.actorUserId,
      updatedAt: now,
      workspaceId: session.workspaceId,
    }

    this.invitations = [...this.invitations, invitation]

    return Promise.resolve(this.toWorkspaceInvitationRecord(invitation))
  }

  updateWorkspaceUserGroupRole(
    session: SessionSnapshot,
    membershipId: string,
    groupRole: WorkspaceUserGroupRole,
  ): Promise<WorkspaceUserRecord> {
    const membership = this.memberships.find(
      (candidate) =>
        candidate.id === membershipId &&
        candidate.workspaceId === session.workspaceId &&
        candidate.deletedAt === null,
    )

    if (!membership) {
      throw new HttpError(
        404,
        'workspace_user_not_found',
        'Workspace participant was not found.',
      )
    }

    if (membership.role === 'owner') {
      throw new HttpError(
        400,
        'workspace_owner_group_role_immutable',
        'The workspace owner access is managed separately.',
      )
    }

    if (membership.userId === session.actorUserId) {
      throw new HttpError(
        400,
        'workspace_self_group_role_change_forbidden',
        'Change your own group role through a dedicated ownership flow.',
      )
    }

    membership.groupRole = groupRole
    membership.updatedAt = new Date().toISOString()

    return Promise.resolve(this.requireWorkspaceUserRecord(membership))
  }

  removeWorkspaceUser(
    session: SessionSnapshot,
    membershipId: string,
  ): Promise<void> {
    const membership = this.memberships.find(
      (candidate) =>
        candidate.id === membershipId &&
        candidate.workspaceId === session.workspaceId &&
        candidate.deletedAt === null,
    )

    if (!membership) {
      throw new HttpError(
        404,
        'workspace_user_not_found',
        'Workspace participant was not found.',
      )
    }

    if (membership.role === 'owner') {
      throw new HttpError(
        400,
        'workspace_owner_removal_forbidden',
        'The workspace owner cannot be removed.',
      )
    }

    if (membership.userId === session.actorUserId) {
      throw new HttpError(
        400,
        'workspace_self_removal_forbidden',
        'Remove your own membership through a dedicated leave flow.',
      )
    }

    membership.deletedAt = new Date().toISOString()
    membership.updatedAt = membership.deletedAt

    return Promise.resolve()
  }

  revokeWorkspaceInvitation(
    session: SessionSnapshot,
    invitationId: string,
  ): Promise<void> {
    const invitation = this.invitations.find(
      (candidate) =>
        candidate.id === invitationId &&
        candidate.workspaceId === session.workspaceId &&
        candidate.deletedAt === null &&
        candidate.acceptedAt === null,
    )

    if (!invitation) {
      throw new HttpError(
        404,
        'workspace_invitation_not_found',
        'Workspace invitation was not found.',
      )
    }

    invitation.deletedAt = new Date().toISOString()
    invitation.updatedAt = invitation.deletedAt

    return Promise.resolve()
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

    currentUser.appRole = role
    currentUser.updatedAt = new Date().toISOString()

    return Promise.resolve(currentUser)
  }

  updateWorkspaceSettings(
    session: SessionSnapshot,
    input: { taskCompletionConfettiEnabled: boolean },
  ) {
    const workspace = this.getWorkspaceById(session.workspaceId)

    if (!workspace) {
      throw new HttpError(
        404,
        'workspace_not_found',
        'Workspace was not found.',
      )
    }

    workspace.taskCompletionConfettiEnabled =
      input.taskCompletionConfettiEnabled

    return Promise.resolve({
      taskCompletionConfettiEnabled: workspace.taskCompletionConfettiEnabled,
    })
  }

  private buildSnapshot(
    actor: AdminUserRecord,
    requestedWorkspaceId: string | undefined,
    source: SessionSnapshot['source'],
    isAuthSession: boolean,
  ): SessionSnapshot {
    let memberships = this.listMembershipsForUser(actor.id)

    if (memberships.length === 0 && isAuthSession && !requestedWorkspaceId) {
      this.provisionPersonalWorkspace(actor.id, actor.displayName)
      memberships = this.listMembershipsForUser(actor.id)
    }

    const selectedMembership = requestedWorkspaceId
      ? memberships.find(
          (membership) => membership.workspaceId === requestedWorkspaceId,
        )
      : memberships[0]

    if (!selectedMembership) {
      if (requestedWorkspaceId) {
        return this.buildFallbackSnapshot(
          actor,
          requestedWorkspaceId,
          source,
          memberships,
        )
      }

      throw new HttpError(
        isAuthSession ? 403 : 404,
        isAuthSession ? 'workspace_access_denied' : 'session_not_found',
        isAuthSession
          ? 'The current user is not allowed to access the requested workspace.'
          : 'The requested actor and workspace pair is not available.',
      )
    }

    const workspace = this.getWorkspaceById(selectedMembership.workspaceId)

    if (!workspace) {
      throw new Error(
        `Missing memory workspace "${selectedMembership.workspaceId}".`,
      )
    }

    return {
      actor: {
        displayName: actor.displayName,
        email: actor.email,
        id: actor.id,
      },
      actorUserId: actor.id,
      appRole: actor.appRole,
      groupRole: selectedMembership.groupRole,
      role: selectedMembership.role,
      source,
      workspace: {
        id: workspace.id,
        kind: workspace.kind,
        name: workspace.name,
        slug: workspace.slug,
      },
      workspaceId: workspace.id,
      workspaceSettings: {
        taskCompletionConfettiEnabled: workspace.taskCompletionConfettiEnabled,
      },
      workspaces: memberships.map((membership) => {
        const membershipWorkspace = this.getWorkspaceById(
          membership.workspaceId,
        )

        if (!membershipWorkspace) {
          throw new Error(
            `Missing memory workspace "${membership.workspaceId}".`,
          )
        }

        return this.toWorkspaceMembership(
          membershipWorkspace,
          membership.role,
          membership.groupRole,
        )
      }),
    }
  }

  private buildFallbackSnapshot(
    actor: AdminUserRecord,
    workspaceId: string,
    source: SessionSnapshot['source'],
    memberships: MemoryMembership[],
  ): SessionSnapshot {
    const fallbackWorkspace =
      this.getWorkspaceById(workspaceId) ??
      ({
        ...DEFAULT_MEMORY_WORKSPACE,
        id: workspaceId,
      } satisfies MemoryWorkspace)
    const workspaceMemberships =
      memberships.length > 0
        ? memberships.map((membership) => {
            const membershipWorkspace = this.getWorkspaceById(
              membership.workspaceId,
            )

            if (!membershipWorkspace) {
              throw new Error(
                `Missing memory workspace "${membership.workspaceId}".`,
              )
            }

            return this.toWorkspaceMembership(
              membershipWorkspace,
              membership.role,
              membership.groupRole,
            )
          })
        : [this.toWorkspaceMembership(fallbackWorkspace, 'owner', null)]

    return {
      actor: {
        displayName: actor.displayName,
        email: actor.email,
        id: actor.id,
      },
      actorUserId: actor.id,
      appRole: actor.appRole,
      groupRole: null,
      role: 'owner',
      source,
      workspace: {
        id: fallbackWorkspace.id,
        kind: fallbackWorkspace.kind,
        name: fallbackWorkspace.name,
        slug: fallbackWorkspace.slug,
      },
      workspaceId: fallbackWorkspace.id,
      workspaceSettings: {
        taskCompletionConfettiEnabled:
          fallbackWorkspace.taskCompletionConfettiEnabled,
      },
      workspaces: workspaceMemberships,
    }
  }

  private resolveAuthenticatedActor(
    actorUserId: string,
    email: string,
  ): AdminUserRecord {
    const normalizedEmail = normalizeEmail(email)
    const existingById = this.getUserById(actorUserId)

    if (existingById) {
      existingById.email = normalizedEmail
      existingById.updatedAt = new Date().toISOString()
      return existingById
    }

    const existingByEmail = this.users.find(
      (user) => user.email === normalizedEmail,
    )

    if (existingByEmail) {
      return existingByEmail
    }

    const createdUser: AdminUserRecord = {
      appRole: 'user',
      displayName: normalizedEmail.split('@')[0] ?? 'Planner User',
      email: normalizedEmail,
      id: actorUserId,
      updatedAt: new Date().toISOString(),
    }

    this.users = [...this.users, createdUser]

    return createdUser
  }

  private resolveLegacyActor(actorUserId: string): AdminUserRecord {
    const existingUser = this.getUserById(actorUserId)

    if (existingUser) {
      return existingUser
    }

    const createdUser: AdminUserRecord = {
      appRole: 'user',
      displayName: 'Planner User',
      email: `${actorUserId}@planner.local`,
      id: actorUserId,
      updatedAt: new Date().toISOString(),
    }

    this.users = [...this.users, createdUser]

    return createdUser
  }

  private claimWorkspaceInvitations(actor: AdminUserRecord): void {
    const matchingInvitations = this.invitations.filter(
      (invitation) =>
        invitation.email === actor.email &&
        invitation.deletedAt === null &&
        invitation.acceptedAt === null,
    )

    const now = new Date().toISOString()

    for (const invitation of matchingInvitations) {
      const membership = this.memberships.find(
        (candidate) =>
          candidate.workspaceId === invitation.workspaceId &&
          candidate.userId === actor.id,
      )

      if (!membership) {
        this.memberships = [
          ...this.memberships,
          {
            deletedAt: null,
            groupRole: invitation.groupRole,
            id: generateUuidV7(),
            invitedBy: invitation.invitedBy,
            joinedAt: now,
            role: 'user',
            updatedAt: now,
            userId: actor.id,
            workspaceId: invitation.workspaceId,
          },
        ]
      } else if (membership.deletedAt) {
        membership.deletedAt = null
        membership.groupRole = invitation.groupRole
        membership.invitedBy = invitation.invitedBy
        membership.joinedAt = now
        membership.role = membership.role === 'owner' ? 'owner' : 'user'
        membership.updatedAt = now
      }

      invitation.acceptedAt = now
      invitation.acceptedBy = actor.id
      invitation.updatedAt = now
    }
  }

  private hasAnyWorkspaceMembership(actorUserId: string): boolean {
    return this.memberships.some(
      (membership) =>
        membership.userId === actorUserId && membership.deletedAt === null,
    )
  }

  private listMembershipsForUser(actorUserId: string): MemoryMembership[] {
    return this.memberships
      .filter(
        (membership) =>
          membership.userId === actorUserId && membership.deletedAt === null,
      )
      .sort((left, right) => {
        const leftWorkspace = this.getWorkspaceById(left.workspaceId)
        const rightWorkspace = this.getWorkspaceById(right.workspaceId)

        return (
          (leftWorkspace?.createdAt ?? '').localeCompare(
            rightWorkspace?.createdAt ?? '',
          ) || left.joinedAt.localeCompare(right.joinedAt)
        )
      })
  }

  private provisionPersonalWorkspace(
    actorUserId: string,
    displayName: string,
  ): void {
    const existingPersonalWorkspace = this.workspaces.find(
      (workspace) =>
        workspace.kind === 'personal' && workspace.ownerUserId === actorUserId,
    )

    if (existingPersonalWorkspace) {
      const existingMembership = this.memberships.find(
        (membership) =>
          membership.workspaceId === existingPersonalWorkspace.id &&
          membership.userId === actorUserId,
      )

      if (!existingMembership) {
        const now = new Date().toISOString()
        this.memberships = [
          ...this.memberships,
          {
            deletedAt: null,
            groupRole: null,
            id: generateUuidV7(),
            invitedBy: null,
            joinedAt: now,
            role: 'owner',
            updatedAt: now,
            userId: actorUserId,
            workspaceId: existingPersonalWorkspace.id,
          },
        ]
      }

      return
    }

    const workspaceId = generateUuidV7()
    const now = new Date().toISOString()
    const workspace: MemoryWorkspace = {
      createdAt: now,
      id: workspaceId,
      kind: 'personal',
      name: `${displayName}'s Workspace`,
      ownerUserId: actorUserId,
      slug: `personal-${actorUserId.replaceAll('-', '').slice(0, 12)}`,
      taskCompletionConfettiEnabled: true,
    }

    this.workspaces = [...this.workspaces, workspace]
    this.memberships = [
      ...this.memberships,
      {
        deletedAt: null,
        groupRole: null,
        id: generateUuidV7(),
        invitedBy: null,
        joinedAt: now,
        role: 'owner',
        updatedAt: now,
        userId: actorUserId,
        workspaceId,
      },
    ]
  }

  private toWorkspaceMembership(
    workspace: MemoryWorkspace,
    role: WorkspaceRole,
    groupRole: WorkspaceGroupRole | null,
  ): SessionWorkspaceMembership {
    return {
      groupRole,
      id: workspace.id,
      kind: workspace.kind,
      name: workspace.name,
      role,
      slug: workspace.slug,
    }
  }

  private toWorkspaceInvitationRecord(
    invitation: MemoryInvitation,
  ): WorkspaceInvitationRecord {
    return {
      email: invitation.email,
      groupRole: invitation.groupRole,
      id: invitation.id,
      invitedAt: invitation.invitedAt,
      updatedAt: invitation.updatedAt,
    }
  }

  private requireWorkspaceUserRecord(
    membership: MemoryMembership,
  ): WorkspaceUserRecord {
    const user = this.getUserById(membership.userId)

    if (!user) {
      throw new Error(`Missing memory user "${membership.userId}".`)
    }

    return {
      displayName: user.displayName,
      email: user.email,
      groupRole: membership.groupRole,
      id: user.id,
      isOwner: membership.role === 'owner',
      joinedAt: membership.joinedAt,
      membershipId: membership.id,
      updatedAt: membership.updatedAt,
    }
  }

  private findActiveMembershipByEmail(
    workspaceId: string,
    email: string,
  ): MemoryMembership | undefined {
    return this.memberships.find((membership) => {
      if (
        membership.workspaceId !== workspaceId ||
        membership.deletedAt !== null
      ) {
        return false
      }

      const user = this.getUserById(membership.userId)

      return user?.email === email
    })
  }

  private getUserById(userId: string): AdminUserRecord | undefined {
    return this.users.find((user) => user.id === userId)
  }

  private getWorkspaceById(workspaceId: string): MemoryWorkspace | undefined {
    return this.workspaces.find((workspace) => workspace.id === workspaceId)
  }

  private requireOwnedSharedWorkspace(
    session: SessionSnapshot,
  ): MemoryWorkspace {
    const workspace = this.getWorkspaceById(session.workspaceId)

    if (!workspace) {
      throw new HttpError(
        404,
        'workspace_not_found',
        'Workspace was not found.',
      )
    }

    if (workspace.kind !== 'shared') {
      throw new HttpError(
        400,
        'shared_workspace_required',
        'Only shared workspaces can be renamed or deleted.',
      )
    }

    if (workspace.ownerUserId !== session.actorUserId) {
      throw new HttpError(
        403,
        'shared_workspace_creator_required',
        'Only the workspace creator can rename or delete it.',
      )
    }

    return workspace
  }

  private getDefaultActor(): AdminUserRecord {
    const actor = this.getUserById(DEFAULT_ACTOR_ID)

    if (!actor) {
      throw new Error('Default memory actor is missing.')
    }

    return actor
  }
}

function compareWorkspaceUsers(
  left: WorkspaceUserRecord,
  right: WorkspaceUserRecord,
): number {
  return (
    compareWorkspaceUserRole(
      left.isOwner,
      left.groupRole,
      right.isOwner,
      right.groupRole,
    ) ||
    left.displayName.localeCompare(right.displayName) ||
    left.email.localeCompare(right.email)
  )
}

function compareWorkspaceUserRole(
  leftIsOwner: boolean,
  leftGroupRole: WorkspaceGroupRole | null,
  rightIsOwner: boolean,
  rightGroupRole: WorkspaceGroupRole | null,
): number {
  const order = {
    group_admin: 1,
    member: 3,
    owner: 0,
    senior_member: 2,
  } satisfies Record<
    'group_admin' | 'member' | 'owner' | 'senior_member',
    number
  >

  const leftKey = leftIsOwner ? 'owner' : (leftGroupRole ?? 'member')
  const rightKey = rightIsOwner ? 'owner' : (rightGroupRole ?? 'member')

  return order[leftKey] - order[rightKey]
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
