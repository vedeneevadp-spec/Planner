import {
  type AdminUserRecord,
  type AppRole,
  type AssignableAppRole,
  type CalendarViewMode,
  type CreateSharedWorkspaceInput,
  type EnergyMode,
  generateUuidV7,
  type ReceivedWorkspaceInvitationRecord,
  type SessionWorkspaceMembership,
  type UpdateSharedWorkspaceInput,
  type UpdateUserProfileInput,
  type UserProfile,
  type WorkspaceRole,
} from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import { isTransientDatabaseError } from '../../infrastructure/db/errors.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
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
import {
  mapAdminUserRecord,
  mapReceivedWorkspaceInvitationRecord,
  mapUserProfileRecord,
  mapWorkspaceInvitationRecord,
  mapWorkspaceUserRecord,
} from './session.repository.postgres.mappers.js'
import {
  countSharedWorkspaces,
  createAdminUserQuery,
  createReceivedWorkspaceInvitationQuery,
  createSessionQuery,
  createWorkspaceInvitationQuery,
  createWorkspaceUserQuery,
  findActorByEmail,
  findActorById,
  findReceivedWorkspaceInvitationById,
  findSessionByActorId,
  findWorkspaceInvitationById,
  findWorkspaceMemberByUserId,
  findWorkspaceUserByEmail,
  findWorkspaceUserByMembershipId,
  listSessionWorkspaces,
} from './session.repository.postgres.queries.js'
import type {
  AppActorRow,
  SessionRow,
  WorkspaceMembershipRow,
} from './session.repository.postgres.rows.js'

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

    return withOptionalRls(this.db, context.auth, async (executor) => {
      const authenticatedActor = await this.ensureAuthenticatedActorWorkspace(
        executor,
        context.auth!,
        context.workspaceId,
      )
      const session = context.workspaceId
        ? await this.resolveExplicitSession(
            executor,
            context,
            authenticatedActor,
          )
        : await this.resolveDefaultSession(
            executor,
            context,
            authenticatedActor,
          )
      const workspaces = await listSessionWorkspaces(executor, session.actorId)

      return this.mapSessionSnapshot(context, session, workspaces)
    })
  }

  async createSharedWorkspace(
    session: SessionSnapshot,
    input: CreateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership> {
    return this.db.transaction().execute(async (trx) => {
      const existingSharedWorkspaces = await countSharedWorkspaces(
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

  async leaveSharedWorkspace(session: SessionSnapshot): Promise<void> {
    const deletedMembership = await this.db
      .updateTable('app.workspace_members')
      .set({ deleted_at: new Date() })
      .where('workspace_id', '=', session.workspaceId)
      .where('user_id', '=', session.actorUserId)
      .where('role', '<>', 'owner')
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst()

    if (!deletedMembership) {
      throw new HttpError(
        session.role === 'owner' ? 400 : 404,
        session.role === 'owner'
          ? 'workspace_owner_leave_forbidden'
          : 'workspace_user_not_found',
        session.role === 'owner'
          ? 'The workspace owner cannot leave their own shared workspace.'
          : 'Workspace participant was not found.',
      )
    }
  }

  async listWorkspaceUsers(
    session: SessionSnapshot,
  ): Promise<WorkspaceUserRecord[]> {
    const rows = await createWorkspaceUserQuery(this.db, session.workspaceId)
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
    const rows = await createWorkspaceInvitationQuery(
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
      const existingMember = await findWorkspaceUserByEmail(
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
            declined_at: null,
            declined_by: null,
            group_role: input.groupRole,
            invited_by: session.actorUserId,
          }),
        )
        .returning([
          'email',
          'declined_at as declinedAt',
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
      const existingMember = await findWorkspaceUserByMembershipId(
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

      const updatedMember = await findWorkspaceUserByMembershipId(
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
      const existingMember = await findWorkspaceUserByMembershipId(
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
      const existingInvitation = await findWorkspaceInvitationById(
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

  async listReceivedWorkspaceInvitations(
    session: SessionSnapshot,
  ): Promise<ReceivedWorkspaceInvitationRecord[]> {
    const rows = await createReceivedWorkspaceInvitationQuery(
      this.db,
      session.actor.email,
    )
      .orderBy('invitation.created_at', 'desc')
      .orderBy('workspace.name', 'asc')
      .execute()

    return rows.map(mapReceivedWorkspaceInvitationRecord)
  }

  async acceptWorkspaceInvitation(
    session: SessionSnapshot,
    invitationId: string,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const invitation = await findReceivedWorkspaceInvitationById(
        trx,
        session.actor.email,
        invitationId,
      )

      if (!invitation) {
        throw new HttpError(
          404,
          'workspace_invitation_not_found',
          'Workspace invitation was not found.',
        )
      }

      const existingMember = await findWorkspaceMemberByUserId(
        trx,
        invitation.workspaceId,
        session.actorUserId,
      )

      if (!existingMember) {
        await trx
          .insertInto('app.workspace_members')
          .values({
            group_role: invitation.groupRole,
            id: generateUuidV7(),
            invited_by: invitation.invitedBy,
            role: 'user',
            user_id: session.actorUserId,
            workspace_id: invitation.workspaceId,
          })
          .execute()
      } else if (existingMember.deletedAt) {
        await trx
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

      await trx
        .updateTable('app.workspace_invitations')
        .set({
          accepted_at: new Date(),
          accepted_by: session.actorUserId,
        })
        .where('id', '=', invitationId)
        .where('accepted_at', 'is', null)
        .where('declined_at', 'is', null)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    })
  }

  async declineWorkspaceInvitation(
    session: SessionSnapshot,
    invitationId: string,
  ): Promise<void> {
    const declinedInvitation = await this.db
      .updateTable('app.workspace_invitations')
      .set({
        declined_at: new Date(),
        declined_by: session.actorUserId,
      })
      .where('id', '=', invitationId)
      .where('email', '=', session.actor.email)
      .where('accepted_at', 'is', null)
      .where('declined_at', 'is', null)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst()

    if (!declinedInvitation) {
      throw new HttpError(
        404,
        'workspace_invitation_not_found',
        'Workspace invitation was not found.',
      )
    }
  }

  async listAdminUsers(
    session: SessionSnapshot,
    authContext: AuthenticatedRequestContext | null = null,
  ): Promise<AdminUserRecord[]> {
    const rows = await withOptionalRls(
      this.db,
      authContext,
      (executor) =>
        createAdminUserQuery(executor)
          .orderBy(
            sql<number>`case when actor.app_role = 'owner' then 0 else 1 end`,
          )
          .orderBy('actor.display_name', 'asc')
          .orderBy('actor.email', 'asc')
          .execute(),
      session.actorUserId,
    )

    return rows.map(mapAdminUserRecord)
  }

  async updateAdminUserRole(
    session: SessionSnapshot,
    authContext: AuthenticatedRequestContext | null,
    userId: string,
    role: AssignableAppRole,
  ): Promise<AdminUserRecord> {
    return withWriteTransaction(
      this.db,
      authContext,
      async (trx) => {
        const currentUser = await createAdminUserQuery(trx)
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

        const updatedUser = await createAdminUserQuery(trx)
          .where('actor.id', '=', userId)
          .executeTakeFirst()

        if (!updatedUser) {
          throw new Error('Failed to resolve updated application user.')
        }

        return mapAdminUserRecord(updatedUser)
      },
      session.actorUserId,
    )
  }

  async updateWorkspaceSettings(
    session: SessionSnapshot,
    authContext: AuthenticatedRequestContext | null,
    input: WorkspaceSettingsUpdateInput,
  ): Promise<WorkspaceSettings> {
    const updatedWorkspace = await withWriteTransaction(
      this.db,
      authContext,
      (trx) =>
        trx
          .updateTable('app.workspaces')
          .set({
            task_completion_confetti_enabled:
              input.taskCompletionConfettiEnabled,
            wake_word_training_mode_enabled: input.wakeWordTrainingModeEnabled,
          })
          .where('id', '=', session.workspaceId)
          .where('deleted_at', 'is', null)
          .returning([
            'task_completion_confetti_enabled as taskCompletionConfettiEnabled',
            'wake_word_training_mode_enabled as wakeWordTrainingModeEnabled',
          ])
          .executeTakeFirst(),
    )

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
      wakeWordTrainingModeEnabled: updatedWorkspace.wakeWordTrainingModeEnabled,
    }
  }

  async updateUserPreferences(
    session: SessionSnapshot,
    authContext: AuthenticatedRequestContext | null,
    input: { calendarViewMode?: CalendarViewMode; energyMode?: EnergyMode },
  ) {
    if (authContext) {
      const preferences = await withWriteTransaction(
        this.db,
        authContext,
        async (trx) => {
          const result = await sql<{
            calendarViewMode: CalendarViewMode
            energyMode: EnergyMode
          }>`
            select
              calendar_view_mode as "calendarViewMode",
              energy_mode as "energyMode"
            from app.update_current_user_preferences(
              ${input.calendarViewMode ?? null},
              ${input.energyMode ?? null}
            )
          `.execute(trx)

          return result.rows[0]
        },
        session.actorUserId,
      )

      if (!preferences) {
        throw new HttpError(
          404,
          'user_preferences_not_found',
          'User was not found.',
        )
      }

      return preferences
    }

    const update = {
      ...(input.calendarViewMode
        ? { calendar_view_mode: input.calendarViewMode }
        : {}),
      ...(input.energyMode ? { energy_mode: input.energyMode } : {}),
    }
    const updatedPreferences = await this.db
      .updateTable('app.users')
      .set(update)
      .where('id', '=', session.actorUserId)
      .where('deleted_at', 'is', null)
      .returning([
        'calendar_view_mode as calendarViewMode',
        'energy_mode as energyMode',
      ])
      .executeTakeFirst()

    if (!updatedPreferences) {
      throw new HttpError(
        404,
        'user_preferences_not_found',
        'User was not found.',
      )
    }

    return {
      calendarViewMode: updatedPreferences.calendarViewMode,
      energyMode: updatedPreferences.energyMode,
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

  private async loadSessionWorkspacesWithRetry(
    actorUserId: string,
  ): Promise<WorkspaceMembershipRow[]> {
    try {
      return await listSessionWorkspaces(this.db, actorUserId)
    } catch (error) {
      if (!isTransientDatabaseError(error)) {
        throw error
      }

      return listSessionWorkspaces(this.db, actorUserId)
    }
  }

  private async resolveDefaultSession(
    executor: DatabaseExecutor,
    context: SessionContext,
    authenticatedActor: AppActorRow | null,
  ): Promise<SessionRow> {
    const actorUserId = authenticatedActor?.id ?? context.actorUserId
    const session = actorUserId
      ? await findSessionByActorId(executor, actorUserId)
      : await createSessionQuery(executor).executeTakeFirst()

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
      ? await findSessionByActorId(executor, actorUserId, workspaceId)
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
    const existingSession = await findSessionByActorId(executor, actor.id)

    if (!existingSession && !requestedWorkspaceId) {
      await this.provisionPersonalWorkspace(executor, actor, 'owner')
    }

    return actor
  }

  private async ensureAuthenticatedActor(
    executor: DatabaseExecutor,
    authContext: AuthenticatedRequestContext,
    requestedWorkspaceId?: string,
  ): Promise<AppActorRow> {
    const authActor = await findActorById(executor, authContext.claims.sub)
    const authEmail = this.resolveAuthEmail(authContext)
    const emailActor = await findActorByEmail(executor, authEmail)

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
      await findSessionByActorId(executor, actorUserId, workspaceId),
    )
  }

  private async hasAnyWorkspaceAccess(
    executor: DatabaseExecutor,
    actorUserId: string,
  ): Promise<boolean> {
    return Boolean(await findSessionByActorId(executor, actorUserId))
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
        calendarViewMode: 'week',
        energyMode: 'normal',
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
        calendar_view_mode: actor.calendarViewMode,
        energy_mode: actor.energyMode,
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
        'calendar_view_mode as calendarViewMode',
        'energy_mode as energyMode',
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

    const existingActor = await findActorById(executor, actor.id)

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
      select provisioned_workspace_id as workspace_id
      from app.session_provision_personal_workspace(
        ${actor.id}::uuid,
        ${generateUuidV7()}::uuid,
        ${generateUuidV7()}::uuid,
        ${this.createPersonalWorkspaceName(actor.displayName)},
        ${workspaceSlug},
        ${role}::app.workspace_role
      )
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
      userPreferences: {
        calendarViewMode: session.calendarViewMode,
        energyMode: session.energyMode,
      },
      workspace: {
        id: session.workspaceId,
        kind: session.workspaceKind,
        name: session.workspaceName,
        slug: session.workspaceSlug,
      },
      workspaceId: session.workspaceId,
      workspaceSettings: {
        taskCompletionConfettiEnabled: session.taskCompletionConfettiEnabled,
        wakeWordTrainingModeEnabled: session.wakeWordTrainingModeEnabled,
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
