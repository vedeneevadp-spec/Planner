import {
  type AdminUserRecord,
  type AppRole,
  type AssignableAppRole,
  type CreateSharedWorkspaceInput,
  generateUuidV7,
  type SessionWorkspaceMembership,
  type WorkspaceGroupRole,
  type WorkspaceKind,
  type WorkspaceRole,
} from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import type { DatabaseExecutor } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type { SessionContext, SessionSnapshot } from './session.model.js'
import type { SessionRepository } from './session.repository.js'

interface SessionRow {
  actorDisplayName: string
  actorEmail: string
  actorId: string
  appRole: AppRole
  groupRole: WorkspaceGroupRole | null
  role: WorkspaceRole
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
      const workspaces = await this.listSessionWorkspaces(
        this.db,
        session.actorId,
      )

      return this.mapSessionSnapshot(context, session, workspaces)
    }

    return this.db.connection().execute(async (connection) => {
      const authenticatedActor = await this.ensureAuthenticatedActorWorkspace(
        connection,
        context.auth!,
        context.workspaceId,
      )
      const session = context.workspaceId
        ? await this.resolveExplicitSession(
            connection,
            context,
            authenticatedActor,
          )
        : await this.resolveDefaultSession(
            connection,
            context,
            authenticatedActor,
          )
      const workspaces = await this.listSessionWorkspaces(
        connection,
        session.actorId,
      )

      return this.mapSessionSnapshot(context, session, workspaces)
    })
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

  async listAdminUsers(_session: SessionSnapshot): Promise<AdminUserRecord[]> {
    const rows = await this.createAdminUserQuery(this.db)
      .orderBy(sql<number>`case when actor.app_role = 'owner' then 0 else 1 end`)
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
        'actor.display_name as actorDisplayName',
        'actor.email as actorEmail',
        'actor.id as actorId',
        'actor.app_role as appRole',
        'membership.group_role as groupRole',
        'membership.role as role',
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
      ])
      .where('actor.deleted_at', 'is', null)
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
    const existingSession = await this.findSessionByActorId(executor, actor.id)

    if (existingSession) {
      return actor
    }

    if (!requestedWorkspaceId) {
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

  private async syncAuthenticatedActorProfile(
    executor: DatabaseExecutor,
    actor: AppActorRow,
    authContext: AuthenticatedRequestContext,
  ): Promise<AppActorRow> {
    const desiredEmail = this.resolveAuthEmail(authContext)
    const desiredDisplayName =
      this.resolveAuthProvidedDisplayName(authContext) ?? actor.displayName

    if (
      actor.email === desiredEmail &&
      actor.displayName === desiredDisplayName
    ) {
      return {
        ...actor,
        displayName: desiredDisplayName,
        email: desiredEmail,
      }
    }

    await executor
      .updateTable('app.users')
      .set({
        display_name: desiredDisplayName,
        email: desiredEmail,
      })
      .where('id', '=', actor.id)
      .execute()

    return {
      ...actor,
      displayName: desiredDisplayName,
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
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
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
