import {
  type AdminUserRecord,
  type AppRole,
  type AssignableAppRole,
  type CreateSharedWorkspaceInput,
  generateUuidV7,
  type SessionWorkspaceMembership,
  type UpdateSharedWorkspaceInput,
  type UpdateUserProfileInput,
  type UserProfile,
  type WorkspaceGroupRole,
  type WorkspaceKind,
  type WorkspaceRole,
} from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import { isTransientDatabaseError } from '../../infrastructure/db/errors.js'
import type { DatabaseExecutor } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  SessionContext,
  SessionSnapshot,
  WorkspaceInvitationCreateInput,
  WorkspaceInvitationRecord,
  WorkspaceSettings,
  WorkspaceSettingsUpdateInput,
  WorkspaceUserGroupRole,
  WorkspaceUserRecord,
} from './session.model.js'
import type { SessionRepository } from './session.repository.js'

interface SessionRow {
  actorAvatarUrl: string | null
  actorDisplayName: string
  actorEmail: string
  actorId: string
  appRole: AppRole
  groupRole: WorkspaceGroupRole | null
  role: WorkspaceRole
  taskCompletionConfettiEnabled: boolean
  workspaceId: string
  workspaceKind: WorkspaceKind
  workspaceName: string
  workspaceSlug: string
}

interface AdminUserRow {
  appRole: AppRole
  displayName: string
  email: string
  id: string
  lastSeenAt: unknown
  taskCount: number
  updatedAt: unknown
}

interface WorkspaceMembershipRow {
  groupRole: WorkspaceGroupRole | null
  id: string
  kind: WorkspaceKind
  name: string
  role: WorkspaceRole
  slug: string
}

interface WorkspaceUserRow {
  displayName: string
  email: string
  groupRole: WorkspaceGroupRole | null
  id: string
  isOwner: boolean
  joinedAt: unknown
  membershipId: string
  updatedAt: unknown
  userId: string
}

interface WorkspaceInvitationRow {
  email: string
  groupRole: WorkspaceGroupRole
  id: string
  invitedAt: unknown
  updatedAt: unknown
}

interface UserProfileRow {
  avatarUrl: string | null
  displayName: string
  email: string
  id: string
  updatedAt: unknown
}

interface PendingWorkspaceInvitationRow {
  email: string
  groupRole: WorkspaceGroupRole
  id: string
  invitedBy: string | null
  workspaceId: string
}

interface ExistingWorkspaceMemberRow {
  deletedAt: string | null
  id: string
  role: WorkspaceRole
}

interface AppActorRow {
  appRole: AppRole
  avatarUrl: string | null
  displayName: string
  email: string
  id: string
  locale: string
  timezone: string
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async resolve(context: SessionContext): Promise<SessionSnapshot> {
    if (!context.auth) {
      const session = context.workspaceId
        ? await this.resolveExplicitSession(this.db, context, null)
        : await this.resolveDefaultSession(this.db, context, null)
      const workspaces = await this.loadSessionWorkspacesWithRetry(
        session.actorId,
      )

      return this.mapSessionSnapshot(context, session, workspaces)
    }

    const authenticatedActor = await this.ensureAuthenticatedActorWorkspace(
      this.db,
      context.auth,
      context.workspaceId,
    )
    const session = context.workspaceId
      ? await this.resolveExplicitSession(this.db, context, authenticatedActor)
      : await this.resolveDefaultSession(this.db, context, authenticatedActor)
    const workspaces = await this.loadSessionWorkspacesWithRetry(
      session.actorId,
    )

    return this.mapSessionSnapshot(context, session, workspaces)
  }

  async createSharedWorkspace(
    session: SessionSnapshot,
    input: CreateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership> {
    return this.db.transaction().execute(async (trx) => {
      const existingSharedWorkspaces = await this.countSharedWorkspaces(
        trx,
        session.actorUserId,
      )

      if (existingSharedWorkspaces >= 3) {
        throw new HttpError(
          409,
          'shared_workspace_limit_reached',
          'A user can have up to three shared workspaces.',
        )
      }

      const workspaceId = generateUuidV7()
      const workspaceName =
        input.name?.trim() || `Shared Workspace ${existingSharedWorkspaces + 1}`
      const workspaceSlug = this.createSharedWorkspaceSlug(
        session.actorUserId,
        workspaceId,
      )

      const workspace = await trx
        .insertInto('app.workspaces')
        .values({
          description: '',
          id: workspaceId,
          kind: 'shared',
          name: workspaceName,
          owner_user_id: session.actorUserId,
          slug: workspaceSlug,
          task_completion_confetti_enabled: true,
        })
        .returning(['id', 'kind', 'name', 'slug'])
        .executeTakeFirstOrThrow()

      await trx
        .insertInto('app.workspace_members')
        .values({
          group_role: 'group_admin',
          id: generateUuidV7(),
          role: 'owner',
          user_id: session.actorUserId,
          workspace_id: workspace.id,
        })
        .execute()

      return {
        groupRole: 'group_admin',
        id: workspace.id,
        kind: workspace.kind,
        name: workspace.name,
        role: 'owner',
        slug: workspace.slug,
      }
    })
  }

  async updateSharedWorkspace(
    session: SessionSnapshot,
    input: UpdateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership> {
    return this.db.transaction().execute(async (trx) => {
      const workspace = await trx
        .updateTable('app.workspaces')
        .set({
          name: input.name.trim(),
        })
        .where('id', '=', session.workspaceId)
        .where('kind', '=', 'shared')
        .where('owner_user_id', '=', session.actorUserId)
        .where('deleted_at', 'is', null)
        .returning(['id', 'kind', 'name', 'slug'])
        .executeTakeFirst()

      if (!workspace) {
        throw new HttpError(
          403,
          'shared_workspace_creator_required',
          'Only the workspace creator can rename or delete it.',
        )
      }

      return {
        groupRole: session.groupRole,
        id: workspace.id,
        kind: workspace.kind,
        name: workspace.name,
        role: session.role,
        slug: workspace.slug,
      }
    })
  }

  async deleteSharedWorkspace(session: SessionSnapshot): Promise<void> {
    const deletedWorkspace = await this.db
      .deleteFrom('app.workspaces')
      .where('id', '=', session.workspaceId)
      .where('kind', '=', 'shared')
      .where('owner_user_id', '=', session.actorUserId)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst()

    if (!deletedWorkspace) {
      throw new HttpError(
        403,
        'shared_workspace_creator_required',
        'Only the workspace creator can rename or delete it.',
      )
    }
  }

  async listWorkspaceUsers(
    session: SessionSnapshot,
  ): Promise<WorkspaceUserRecord[]> {
    const rows = await this.createWorkspaceUserQuery(
      this.db,
      session.workspaceId,
    )
      .orderBy(
        sql<number>`case
          when membership.role = 'owner' then 0
          when membership.group_role = 'group_admin' then 1
          when membership.group_role = 'senior_member' then 2
          else 3
        end`,
      )
      .orderBy('actor.display_name', 'asc')
      .orderBy('actor.email', 'asc')
      .execute()

    return rows.map(mapWorkspaceUserRecord)
  }

  async listWorkspaceInvitations(
    session: SessionSnapshot,
  ): Promise<WorkspaceInvitationRecord[]> {
    const rows = await this.createWorkspaceInvitationQuery(
      this.db,
      session.workspaceId,
    )
      .orderBy('invitation.created_at', 'desc')
      .orderBy('invitation.email', 'asc')
      .execute()

    return rows.map(mapWorkspaceInvitationRecord)
  }

  async createWorkspaceInvitation(
    session: SessionSnapshot,
    input: WorkspaceInvitationCreateInput,
  ): Promise<WorkspaceInvitationRecord> {
    return this.db.transaction().execute(async (trx) => {
      const normalizedEmail = normalizeEmail(input.email)
      const existingMember = await this.findWorkspaceUserByEmail(
        trx,
        session.workspaceId,
        normalizedEmail,
      )

      if (existingMember) {
        throw new HttpError(
          409,
          'workspace_user_already_exists',
          'The user is already a participant in this workspace.',
        )
      }

      const invitation = await trx
        .insertInto('app.workspace_invitations')
        .values({
          email: normalizedEmail,
          group_role: input.groupRole,
          id: generateUuidV7(),
          invited_by: session.actorUserId,
          workspace_id: session.workspaceId,
        })
        .onConflict((conflict) =>
          conflict.columns(['workspace_id', 'email']).doUpdateSet({
            accepted_at: null,
            accepted_by: null,
            deleted_at: null,
            group_role: input.groupRole,
            invited_by: session.actorUserId,
          }),
        )
        .returning([
          'email',
          'group_role as groupRole',
          'id',
          'created_at as invitedAt',
          'updated_at as updatedAt',
        ])
        .executeTakeFirstOrThrow()

      return mapWorkspaceInvitationRecord(invitation)
    })
  }

  async updateWorkspaceUserGroupRole(
    session: SessionSnapshot,
    membershipId: string,
    groupRole: WorkspaceUserGroupRole,
  ): Promise<WorkspaceUserRecord> {
    return this.db.transaction().execute(async (trx) => {
      const existingMember = await this.findWorkspaceUserByMembershipId(
        trx,
        session.workspaceId,
        membershipId,
      )

      if (!existingMember) {
        throw new HttpError(
          404,
          'workspace_user_not_found',
          'Workspace participant was not found.',
        )
      }

      if (existingMember.isOwner) {
        throw new HttpError(
          400,
          'workspace_owner_group_role_immutable',
          'The workspace owner access is managed separately.',
        )
      }

      if (existingMember.userId === session.actorUserId) {
        throw new HttpError(
          400,
          'workspace_self_group_role_change_forbidden',
          'Change your own group role through a dedicated ownership flow.',
        )
      }

      await trx
        .updateTable('app.workspace_members')
        .set({ group_role: groupRole })
        .where('id', '=', membershipId)
        .where('workspace_id', '=', session.workspaceId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()

      const updatedMember = await this.findWorkspaceUserByMembershipId(
        trx,
        session.workspaceId,
        membershipId,
      )

      if (!updatedMember) {
        throw new Error('Failed to resolve updated workspace participant.')
      }

      return mapWorkspaceUserRecord(updatedMember)
    })
  }

  async removeWorkspaceUser(
    session: SessionSnapshot,
    membershipId: string,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const existingMember = await this.findWorkspaceUserByMembershipId(
        trx,
        session.workspaceId,
        membershipId,
      )

      if (!existingMember) {
        throw new HttpError(
          404,
          'workspace_user_not_found',
          'Workspace participant was not found.',
        )
      }

      if (existingMember.isOwner) {
        throw new HttpError(
          400,
          'workspace_owner_removal_forbidden',
          'The workspace owner cannot be removed.',
        )
      }

      if (existingMember.userId === session.actorUserId) {
        throw new HttpError(
          400,
          'workspace_self_removal_forbidden',
          'Remove your own membership through a dedicated leave flow.',
        )
      }

      await trx
        .updateTable('app.workspace_members')
        .set({ deleted_at: new Date() })
        .where('id', '=', membershipId)
        .where('workspace_id', '=', session.workspaceId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    })
  }

  async revokeWorkspaceInvitation(
    session: SessionSnapshot,
    invitationId: string,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const existingInvitation = await this.findWorkspaceInvitationById(
        trx,
        session.workspaceId,
        invitationId,
      )

      if (!existingInvitation) {
        throw new HttpError(
          404,
          'workspace_invitation_not_found',
          'Workspace invitation was not found.',
        )
      }

      await trx
        .updateTable('app.workspace_invitations')
        .set({ deleted_at: new Date() })
        .where('id', '=', invitationId)
        .where('workspace_id', '=', session.workspaceId)
        .where('accepted_at', 'is', null)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    })
  }

  async listAdminUsers(_session: SessionSnapshot): Promise<AdminUserRecord[]> {
    const rows = await this.createAdminUserQuery(this.db)
      .orderBy(
        sql<number>`case when actor.app_role = 'owner' then 0 else 1 end`,
      )
      .orderBy('actor.display_name', 'asc')
      .orderBy('actor.email', 'asc')
      .execute()

    return rows.map(mapAdminUserRecord)
  }

  async updateAdminUserRole(
    _session: SessionSnapshot,
    userId: string,
    role: AssignableAppRole,
  ): Promise<AdminUserRecord> {
    return this.db.transaction().execute(async (trx) => {
      const currentUser = await this.createAdminUserQuery(trx)
        .where('actor.id', '=', userId)
        .executeTakeFirst()

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

      await trx
        .updateTable('app.users')
        .set({ app_role: role })
        .where('id', '=', userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()

      const updatedUser = await this.createAdminUserQuery(trx)
        .where('actor.id', '=', userId)
        .executeTakeFirst()

      if (!updatedUser) {
        throw new Error('Failed to resolve updated application user.')
      }

      return mapAdminUserRecord(updatedUser)
    })
  }

  async updateWorkspaceSettings(
    session: SessionSnapshot,
    input: WorkspaceSettingsUpdateInput,
  ): Promise<WorkspaceSettings> {
    const updatedWorkspace = await this.db
      .updateTable('app.workspaces')
      .set({
        task_completion_confetti_enabled: input.taskCompletionConfettiEnabled,
      })
      .where('id', '=', session.workspaceId)
      .where('deleted_at', 'is', null)
      .returning(
        'task_completion_confetti_enabled as taskCompletionConfettiEnabled',
      )
      .executeTakeFirst()

    if (!updatedWorkspace) {
      throw new HttpError(
        404,
        'workspace_not_found',
        'Workspace was not found.',
      )
    }

    return {
      taskCompletionConfettiEnabled:
        updatedWorkspace.taskCompletionConfettiEnabled,
    }
  }

  async updateUserProfile(
    session: SessionSnapshot,
    input: UpdateUserProfileInput & {
      avatarUrl: string | null
    },
  ): Promise<UserProfile> {
    const updatedProfile = await this.db
      .updateTable('app.users')
      .set({
        avatar_url: input.avatarUrl,
        display_name: input.displayName?.trim() ?? session.actor.displayName,
      })
      .where('id', '=', session.actorUserId)
      .where('deleted_at', 'is', null)
      .returning([
        'avatar_url as avatarUrl',
        'display_name as displayName',
        'email',
        'id',
        'updated_at as updatedAt',
      ])
      .executeTakeFirst()

    if (!updatedProfile) {
      throw new HttpError(404, 'user_profile_not_found', 'User was not found.')
    }

    return mapUserProfileRecord(updatedProfile)
  }

  private createBaseQuery(executor: DatabaseExecutor) {
    return executor
      .selectFrom('app.workspace_members as membership')
      .innerJoin('app.users as actor', 'actor.id', 'membership.user_id')
      .innerJoin(
        'app.workspaces as workspace',
        'workspace.id',
        'membership.workspace_id',
      )
      .select([
        'actor.avatar_url as actorAvatarUrl',
        'actor.display_name as actorDisplayName',
        'actor.email as actorEmail',
        'actor.id as actorId',
        'actor.app_role as appRole',
        'membership.group_role as groupRole',
        'membership.role as role',
        'workspace.task_completion_confetti_enabled as taskCompletionConfettiEnabled',
        'workspace.id as workspaceId',
        'workspace.kind as workspaceKind',
        'workspace.name as workspaceName',
        'workspace.slug as workspaceSlug',
      ])
      .where('membership.deleted_at', 'is', null)
      .where('actor.deleted_at', 'is', null)
      .where('workspace.deleted_at', 'is', null)
  }

  private createAdminUserQuery(executor: DatabaseExecutor) {
    return executor
      .selectFrom('app.users as actor')
      .select([
        'actor.app_role as appRole',
        'actor.display_name as displayName',
        'actor.email as email',
        'actor.id as id',
        'actor.updated_at as updatedAt',
        sql<unknown>`(
          select max(coalesce(token.last_used_at, token.created_at))
          from app.auth_refresh_tokens as token
          where token.user_id = actor.id
        )`.as('lastSeenAt'),
        sql<number>`(
          select count(*)::int
          from app.tasks as task
          where task.created_by = actor.id
            and task.deleted_at is null
        )`.as('taskCount'),
      ])
      .where('actor.deleted_at', 'is', null)
  }

  private createWorkspaceUserQuery(
    executor: DatabaseExecutor,
    workspaceId: string,
  ) {
    return executor
      .selectFrom('app.workspace_members as membership')
      .innerJoin('app.users as actor', 'actor.id', 'membership.user_id')
      .select([
        'actor.display_name as displayName',
        'actor.email as email',
        'membership.group_role as groupRole',
        'membership.joined_at as joinedAt',
        'membership.id as membershipId',
        'membership.updated_at as updatedAt',
        'membership.user_id as userId',
        'actor.id as id',
        sql<boolean>`membership.role = 'owner'`.as('isOwner'),
      ])
      .where('membership.workspace_id', '=', workspaceId)
      .where('membership.deleted_at', 'is', null)
      .where('actor.deleted_at', 'is', null)
  }

  private createWorkspaceInvitationQuery(
    executor: DatabaseExecutor,
    workspaceId: string,
  ) {
    return executor
      .selectFrom('app.workspace_invitations as invitation')
      .select([
        'invitation.email as email',
        'invitation.group_role as groupRole',
        'invitation.id as id',
        'invitation.created_at as invitedAt',
        'invitation.updated_at as updatedAt',
      ])
      .where('invitation.workspace_id', '=', workspaceId)
      .where('invitation.accepted_at', 'is', null)
      .where('invitation.deleted_at', 'is', null)
  }

  private findWorkspaceUserByMembershipId(
    executor: DatabaseExecutor,
    workspaceId: string,
    membershipId: string,
  ): Promise<WorkspaceUserRow | undefined> {
    return this.createWorkspaceUserQuery(executor, workspaceId)
      .where('membership.id', '=', membershipId)
      .executeTakeFirst()
  }

  private findWorkspaceUserByEmail(
    executor: DatabaseExecutor,
    workspaceId: string,
    email: string,
  ): Promise<WorkspaceUserRow | undefined> {
    return this.createWorkspaceUserQuery(executor, workspaceId)
      .where('actor.email', '=', email)
      .executeTakeFirst()
  }

  private findWorkspaceInvitationById(
    executor: DatabaseExecutor,
    workspaceId: string,
    invitationId: string,
  ): Promise<WorkspaceInvitationRow | undefined> {
    return this.createWorkspaceInvitationQuery(executor, workspaceId)
      .where('invitation.id', '=', invitationId)
      .executeTakeFirst()
  }

  private loadPendingWorkspaceInvitationsByEmail(
    executor: DatabaseExecutor,
    email: string,
  ): Promise<PendingWorkspaceInvitationRow[]> {
    return executor
      .selectFrom('app.workspace_invitations as invitation')
      .innerJoin(
        'app.workspaces as workspace',
        'workspace.id',
        'invitation.workspace_id',
      )
      .select([
        'invitation.email as email',
        'invitation.group_role as groupRole',
        'invitation.id as id',
        'invitation.invited_by as invitedBy',
        'invitation.workspace_id as workspaceId',
      ])
      .where('invitation.email', '=', email)
      .where('invitation.accepted_at', 'is', null)
      .where('invitation.deleted_at', 'is', null)
      .where('workspace.kind', '=', 'shared')
      .where('workspace.deleted_at', 'is', null)
      .orderBy('invitation.created_at', 'asc')
      .execute()
  }

  private findWorkspaceMemberByUserId(
    executor: DatabaseExecutor,
    workspaceId: string,
    userId: string,
  ): Promise<ExistingWorkspaceMemberRow | undefined> {
    return executor
      .selectFrom('app.workspace_members')
      .select(['deleted_at as deletedAt', 'id', 'role'])
      .where('workspace_id', '=', workspaceId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
  }

  private listSessionWorkspaces(
    executor: DatabaseExecutor,
    actorUserId: string,
  ): Promise<WorkspaceMembershipRow[]> {
    return executor
      .selectFrom('app.workspace_members as membership')
      .innerJoin(
        'app.workspaces as workspace',
        'workspace.id',
        'membership.workspace_id',
      )
      .select([
        'membership.group_role as groupRole',
        'membership.role as role',
        'workspace.id as id',
        'workspace.kind as kind',
        'workspace.name as name',
        'workspace.slug as slug',
      ])
      .where('membership.user_id', '=', actorUserId)
      .where('membership.deleted_at', 'is', null)
      .where('workspace.deleted_at', 'is', null)
      .orderBy('workspace.created_at', 'asc')
      .execute()
  }

  private async loadSessionWorkspacesWithRetry(
    actorUserId: string,
  ): Promise<WorkspaceMembershipRow[]> {
    try {
      return await this.listSessionWorkspaces(this.db, actorUserId)
    } catch (error) {
      if (!isTransientDatabaseError(error)) {
        throw error
      }

      return this.listSessionWorkspaces(this.db, actorUserId)
    }
  }

  private async countSharedWorkspaces(
    executor: DatabaseExecutor,
    actorUserId: string,
  ): Promise<number> {
    const row = await executor
      .selectFrom('app.workspace_members as membership')
      .innerJoin(
        'app.workspaces as workspace',
        'workspace.id',
        'membership.workspace_id',
      )
      .select(({ fn }) => fn.countAll<number>().as('total'))
      .where('membership.user_id', '=', actorUserId)
      .where('membership.deleted_at', 'is', null)
      .where('workspace.kind', '=', 'shared')
      .where('workspace.deleted_at', 'is', null)
      .executeTakeFirst()

    return Number(row?.total ?? 0)
  }

  private async resolveDefaultSession(
    executor: DatabaseExecutor,
    context: SessionContext,
    authenticatedActor: AppActorRow | null,
  ): Promise<SessionRow> {
    const actorUserId = authenticatedActor?.id ?? context.actorUserId
    const session = actorUserId
      ? await this.findSessionByActorId(executor, actorUserId)
      : await this.createSessionQuery(executor).executeTakeFirst()

    if (!session) {
      throw new HttpError(
        404,
        'session_not_found',
        'No workspace membership is available for the current environment.',
      )
    }

    return session
  }

  private async resolveExplicitSession(
    executor: DatabaseExecutor,
    context: SessionContext,
    authenticatedActor: AppActorRow | null,
  ): Promise<SessionRow> {
    const workspaceId = context.workspaceId ?? ''
    const actorUserId = authenticatedActor?.id ?? context.actorUserId
    const session = actorUserId
      ? await this.findSessionByActorId(executor, actorUserId, workspaceId)
      : undefined

    if (!session) {
      throw new HttpError(
        context.auth ? 403 : 404,
        context.auth ? 'workspace_access_denied' : 'session_not_found',
        context.auth
          ? 'The current user is not allowed to access the requested workspace.'
          : 'The requested actor and workspace pair is not available.',
      )
    }

    return session
  }

  private async ensureAuthenticatedActorWorkspace(
    executor: DatabaseExecutor,
    authContext: AuthenticatedRequestContext,
    requestedWorkspaceId?: string,
  ): Promise<AppActorRow> {
    const actor = await this.ensureAuthenticatedActor(
      executor,
      authContext,
      requestedWorkspaceId,
    )
    const existingSessionBeforeClaim = await this.findSessionByActorId(
      executor,
      actor.id,
    )

    await this.claimWorkspaceInvitations(executor, actor)

    if (!existingSessionBeforeClaim && !requestedWorkspaceId) {
      await this.provisionPersonalWorkspace(executor, actor, 'owner')
    }

    return actor
  }

  private findSessionByActorId(
    executor: DatabaseExecutor,
    actorUserId: string,
    workspaceId?: string,
  ) {
    return this.createSessionQuery(executor, workspaceId)
      .where('actor.id', '=', actorUserId)
      .executeTakeFirst()
  }

  private createSessionQuery(executor: DatabaseExecutor, workspaceId?: string) {
    let query = this.createBaseQuery(executor)

    if (workspaceId) {
      query = query.where('workspace.id', '=', workspaceId)
    } else {
      query = query
        .orderBy('workspace.created_at', 'asc')
        .orderBy('membership.joined_at', 'asc')
    }

    return query
  }

  private findActorById(
    executor: DatabaseExecutor,
    actorUserId: string,
  ): Promise<AppActorRow | undefined> {
    return executor
      .selectFrom('app.users')
      .select([
        'app_role as appRole',
        'avatar_url as avatarUrl',
        'display_name as displayName',
        'email',
        'id',
        'locale',
        'timezone',
      ])
      .where('deleted_at', 'is', null)
      .where('id', '=', actorUserId)
      .executeTakeFirst()
  }

  private findActorByEmail(
    executor: DatabaseExecutor,
    email: string,
  ): Promise<AppActorRow | undefined> {
    return executor
      .selectFrom('app.users')
      .select([
        'app_role as appRole',
        'avatar_url as avatarUrl',
        'display_name as displayName',
        'email',
        'id',
        'locale',
        'timezone',
      ])
      .where('deleted_at', 'is', null)
      .where('email', '=', email)
      .executeTakeFirst()
  }

  private async ensureAuthenticatedActor(
    executor: DatabaseExecutor,
    authContext: AuthenticatedRequestContext,
    requestedWorkspaceId?: string,
  ): Promise<AppActorRow> {
    const authActor = await this.findActorById(executor, authContext.claims.sub)
    const authEmail = this.resolveAuthEmail(authContext)
    const emailActor = await this.findActorByEmail(executor, authEmail)

    if (authActor && emailActor && emailActor.id !== authActor.id) {
      const preferredActor = await this.selectPreferredAuthenticatedActor(
        executor,
        authActor,
        emailActor,
        requestedWorkspaceId,
      )

      return this.syncAuthenticatedActorProfile(
        executor,
        preferredActor,
        authContext,
      )
    }

    if (authActor) {
      return this.syncAuthenticatedActorProfile(
        executor,
        authActor,
        authContext,
      )
    }

    if (emailActor) {
      return this.syncAuthenticatedActorProfile(
        executor,
        emailActor,
        authContext,
      )
    }

    return this.createAuthenticatedActor(executor, authContext)
  }

  private async selectPreferredAuthenticatedActor(
    executor: DatabaseExecutor,
    authActor: AppActorRow,
    emailActor: AppActorRow,
    requestedWorkspaceId?: string,
  ): Promise<AppActorRow> {
    if (requestedWorkspaceId) {
      const authOwnsRequestedWorkspace = await this.hasWorkspaceAccess(
        executor,
        authActor.id,
        requestedWorkspaceId,
      )
      const emailOwnsRequestedWorkspace = await this.hasWorkspaceAccess(
        executor,
        emailActor.id,
        requestedWorkspaceId,
      )

      if (authOwnsRequestedWorkspace !== emailOwnsRequestedWorkspace) {
        return authOwnsRequestedWorkspace ? authActor : emailActor
      }
    }

    const authHasAnyWorkspace = await this.hasAnyWorkspaceAccess(
      executor,
      authActor.id,
    )
    const emailHasAnyWorkspace = await this.hasAnyWorkspaceAccess(
      executor,
      emailActor.id,
    )

    if (authHasAnyWorkspace !== emailHasAnyWorkspace) {
      return authHasAnyWorkspace ? authActor : emailActor
    }

    return authActor
  }

  private async hasWorkspaceAccess(
    executor: DatabaseExecutor,
    actorUserId: string,
    workspaceId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.findSessionByActorId(executor, actorUserId, workspaceId),
    )
  }

  private async hasAnyWorkspaceAccess(
    executor: DatabaseExecutor,
    actorUserId: string,
  ): Promise<boolean> {
    return Boolean(await this.findSessionByActorId(executor, actorUserId))
  }

  private async claimWorkspaceInvitations(
    executor: DatabaseExecutor,
    actor: Pick<AppActorRow, 'email' | 'id'>,
  ): Promise<void> {
    const invitations = await this.loadPendingWorkspaceInvitationsByEmail(
      executor,
      actor.email,
    )

    for (const invitation of invitations) {
      await this.claimWorkspaceInvitation(executor, actor.id, invitation)
    }
  }

  private async claimWorkspaceInvitation(
    executor: DatabaseExecutor,
    actorUserId: string,
    invitation: PendingWorkspaceInvitationRow,
  ): Promise<void> {
    const existingMember = await this.findWorkspaceMemberByUserId(
      executor,
      invitation.workspaceId,
      actorUserId,
    )

    if (!existingMember) {
      await executor
        .insertInto('app.workspace_members')
        .values({
          group_role: invitation.groupRole,
          id: generateUuidV7(),
          invited_by: invitation.invitedBy,
          role: 'user',
          user_id: actorUserId,
          workspace_id: invitation.workspaceId,
        })
        .execute()
    } else if (existingMember.deletedAt) {
      await executor
        .updateTable('app.workspace_members')
        .set({
          deleted_at: null,
          group_role: invitation.groupRole,
          invited_by: invitation.invitedBy,
          role: existingMember.role === 'owner' ? 'owner' : 'user',
        })
        .where('id', '=', existingMember.id)
        .executeTakeFirst()
    }

    await executor
      .updateTable('app.workspace_invitations')
      .set({
        accepted_at: new Date(),
        accepted_by: actorUserId,
      })
      .where('id', '=', invitation.id)
      .where('accepted_at', 'is', null)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }

  private async syncAuthenticatedActorProfile(
    executor: DatabaseExecutor,
    actor: AppActorRow,
    authContext: AuthenticatedRequestContext,
  ): Promise<AppActorRow> {
    const desiredEmail = this.resolveAuthEmail(authContext)

    if (actor.email === desiredEmail) {
      return {
        ...actor,
        email: desiredEmail,
      }
    }

    await executor
      .updateTable('app.users')
      .set({
        email: desiredEmail,
      })
      .where('id', '=', actor.id)
      .execute()

    return {
      ...actor,
      email: desiredEmail,
    }
  }

  private createAuthenticatedActor(
    executor: DatabaseExecutor,
    authContext: AuthenticatedRequestContext,
  ): Promise<AppActorRow> {
    return this.resolveInitialAppRole(executor).then((appRole) =>
      this.createActorRecord(executor, {
        appRole,
        avatarUrl: null,
        displayName: this.resolveAuthDisplayName(authContext),
        email: this.resolveAuthEmail(authContext),
        id: authContext.claims.sub,
        locale: 'en-US',
        timezone: 'UTC',
      }),
    )
  }

  private async resolveInitialAppRole(
    executor: DatabaseExecutor,
  ): Promise<AppRole> {
    const ownerCount = await executor
      .selectFrom('app.users')
      .select(({ fn }) => fn.countAll<number>().as('total'))
      .where('app_role', '=', 'owner')
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    return Number(ownerCount?.total ?? 0) > 0 ? 'user' : 'owner'
  }

  private async createActorRecord(
    executor: DatabaseExecutor,
    actor: AppActorRow,
  ): Promise<AppActorRow> {
    try {
      return await this.insertActorRecord(executor, actor)
    } catch (error) {
      if (actor.appRole === 'owner' && isUniqueConstraintError(error)) {
        return this.insertActorRecord(executor, {
          ...actor,
          appRole: 'user',
        })
      }

      throw error
    }
  }

  private async insertActorRecord(
    executor: DatabaseExecutor,
    actor: AppActorRow,
  ): Promise<AppActorRow> {
    const insertedActor = await executor
      .insertInto('app.users')
      .values({
        app_role: actor.appRole,
        avatar_url: actor.avatarUrl,
        display_name: actor.displayName,
        email: actor.email,
        id: actor.id,
        locale: actor.locale,
        timezone: actor.timezone,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .returning([
        'app_role as appRole',
        'avatar_url as avatarUrl',
        'display_name as displayName',
        'email',
        'id',
        'locale',
        'timezone',
      ])
      .executeTakeFirst()

    if (insertedActor) {
      return insertedActor
    }

    const existingActor = await this.findActorById(executor, actor.id)

    if (!existingActor) {
      throw new Error(
        `Failed to resolve actor "${actor.id}" after provisioning.`,
      )
    }

    return existingActor
  }

  private async provisionPersonalWorkspace(
    executor: DatabaseExecutor,
    actor: Pick<AppActorRow, 'displayName' | 'id'>,
    role: WorkspaceRole,
  ): Promise<void> {
    const workspaceSlug = this.createPersonalWorkspaceSlug(actor.id)
    const provisionResult = await sql<{ workspace_id: string }>`
      with inserted_workspace as (
        insert into app.workspaces (
          description,
          id,
          kind,
          name,
          owner_user_id,
          slug
        )
        values (
          '',
          ${generateUuidV7()},
          'personal'::app.workspace_kind,
          ${this.createPersonalWorkspaceName(actor.displayName)},
          ${actor.id},
          ${workspaceSlug}
        )
        on conflict (slug) do nothing
        returning id
      ),
      resolved_workspace as (
        select id as workspace_id from inserted_workspace
        union all
        select workspace.id as workspace_id
        from app.workspaces as workspace
        where workspace.slug = ${workspaceSlug}
          and not exists (select 1 from inserted_workspace)
      ),
      inserted_membership as (
        insert into app.workspace_members (
          id,
          role,
          user_id,
          workspace_id
        )
        select
          ${generateUuidV7()},
          ${role}::app.workspace_role,
          ${actor.id},
          resolved_workspace.workspace_id
        from resolved_workspace
        on conflict (workspace_id, user_id) do nothing
        returning id
      )
      select workspace_id
      from resolved_workspace
    `.execute(executor)

    if (!provisionResult.rows[0]?.workspace_id) {
      throw new Error('Failed to provision a personal workspace.')
    }
  }

  private mapSessionSnapshot(
    context: SessionContext,
    session: SessionRow,
    workspaces: SessionWorkspaceMembership[],
  ): SessionSnapshot {
    return {
      actor: {
        avatarUrl: session.actorAvatarUrl,
        displayName: session.actorDisplayName,
        email: session.actorEmail,
        id: session.actorId,
      },
      actorUserId: session.actorId,
      appRole: session.appRole,
      groupRole: session.groupRole,
      role: session.role,
      source: context.auth
        ? 'access_token'
        : context.actorUserId && context.workspaceId
          ? 'headers'
          : 'default',
      workspace: {
        id: session.workspaceId,
        kind: session.workspaceKind,
        name: session.workspaceName,
        slug: session.workspaceSlug,
      },
      workspaceId: session.workspaceId,
      workspaceSettings: {
        taskCompletionConfettiEnabled: session.taskCompletionConfettiEnabled,
      },
      workspaces,
    }
  }

  private resolveAuthEmail(authContext: AuthenticatedRequestContext): string {
    const payloadEmail = this.getStringClaim(
      authContext.claims.payload,
      'email',
    )
    const email = authContext.claims.email ?? payloadEmail

    if (email) {
      return email.toLowerCase()
    }

    return `${authContext.claims.sub}@users.planner.local`
  }

  private resolveAuthProvidedDisplayName(
    authContext: AuthenticatedRequestContext,
  ): string | null {
    const userMetadata = this.getRecordClaim(
      authContext.claims.payload,
      'user_metadata',
    )

    return (
      (userMetadata ? this.getStringClaim(userMetadata, 'full_name') : null) ??
      (userMetadata ? this.getStringClaim(userMetadata, 'name') : null) ??
      (userMetadata
        ? this.getStringClaim(userMetadata, 'display_name')
        : null) ??
      this.getStringClaim(authContext.claims.payload, 'full_name') ??
      this.getStringClaim(authContext.claims.payload, 'name') ??
      this.getStringClaim(authContext.claims.payload, 'display_name')
    )
  }

  private resolveAuthDisplayName(
    authContext: AuthenticatedRequestContext,
  ): string {
    const displayName = this.resolveAuthProvidedDisplayName(authContext)

    if (displayName) {
      return displayName
    }

    const email = this.resolveAuthEmail(authContext)
    const emailLocalPart = email.split('@')[0]?.trim()

    if (emailLocalPart) {
      return emailLocalPart
    }

    return 'Planner User'
  }

  private createPersonalWorkspaceName(displayName: string): string {
    return `${displayName}'s Workspace`
  }

  private createPersonalWorkspaceSlug(actorUserId: string): string {
    return `personal-${actorUserId.replaceAll('-', '').slice(0, 12)}`
  }

  private createSharedWorkspaceSlug(
    actorUserId: string,
    workspaceId: string,
  ): string {
    const actorPart = actorUserId.replaceAll('-', '').slice(0, 8)
    const workspacePart = workspaceId.replaceAll('-', '').slice(-8)

    return `shared-${actorPart}-${workspacePart}`
  }

  private getRecordClaim(
    payload: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> | null {
    const value = payload[key]

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as Record<string, unknown>
  }

  private getStringClaim(
    payload: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = payload[key]

    if (typeof value !== 'string') {
      return null
    }

    const normalizedValue = value.trim()

    return normalizedValue.length > 0 ? normalizedValue : null
  }
}

function mapAdminUserRecord(row: AdminUserRow): AdminUserRecord {
  return {
    appRole: row.appRole,
    displayName: row.displayName,
    email: row.email,
    id: row.id,
    lastSeenAt: serializeNullableTimestamp(row.lastSeenAt),
    taskCount: row.taskCount,
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

function mapWorkspaceUserRecord(row: WorkspaceUserRow): WorkspaceUserRecord {
  return {
    displayName: row.displayName,
    email: row.email,
    groupRole: row.groupRole,
    id: row.id,
    isOwner: row.isOwner,
    joinedAt: serializeTimestamp(row.joinedAt),
    membershipId: row.membershipId,
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

function mapWorkspaceInvitationRecord(
  row: WorkspaceInvitationRow,
): WorkspaceInvitationRecord {
  return {
    email: row.email,
    groupRole: row.groupRole,
    id: row.id,
    invitedAt: serializeTimestamp(row.invitedAt),
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

function mapUserProfileRecord(row: UserProfileRow): UserProfile {
  return {
    avatarUrl: row.avatarUrl,
    displayName: row.displayName,
    email: row.email,
    id: row.id,
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isUniqueConstraintError(error: unknown): boolean {
  return getErrorCode(error) === '23505'
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const code = error.code

  return typeof code === 'string' ? code : undefined
}
