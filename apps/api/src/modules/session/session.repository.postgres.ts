import { generateUuidV7 } from '@planner/contracts'
import { type Kysely } from 'kysely'

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
  role: 'owner' | 'admin' | 'member' | 'viewer'
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
}

interface AppActorRow {
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
    const authenticatedActor = context.auth
      ? await this.ensureAuthenticatedActorWorkspace(
          context.auth,
          context.workspaceId,
        )
      : null

    const session = context.workspaceId
      ? await this.resolveExplicitSession(context, authenticatedActor)
      : await this.resolveDefaultSession(context, authenticatedActor)

    return {
      actor: {
        displayName: session.actorDisplayName,
        email: session.actorEmail,
        id: session.actorId,
      },
      actorUserId: session.actorId,
      role: session.role,
      source: context.auth
        ? 'access_token'
        : context.actorUserId && context.workspaceId
          ? 'headers'
          : 'default',
      workspace: {
        id: session.workspaceId,
        name: session.workspaceName,
        slug: session.workspaceSlug,
      },
      workspaceId: session.workspaceId,
    }
  }

  private createBaseQuery(executor: DatabaseExecutor) {
    return executor
      .selectFrom('app.workspace_members as membership')
      .innerJoin('app.users as actor', 'actor.id', 'membership.user_id')
      .innerJoin('app.workspaces as workspace', 'workspace.id', 'membership.workspace_id')
      .select([
        'actor.display_name as actorDisplayName',
        'actor.email as actorEmail',
        'actor.id as actorId',
        'membership.role as role',
        'workspace.id as workspaceId',
        'workspace.name as workspaceName',
        'workspace.slug as workspaceSlug',
      ])
      .where('membership.deleted_at', 'is', null)
      .where('actor.deleted_at', 'is', null)
      .where('workspace.deleted_at', 'is', null)
  }

  private async resolveDefaultSession(
    context: SessionContext,
    authenticatedActor: AppActorRow | null,
  ): Promise<SessionRow> {
    const actorUserId = authenticatedActor?.id ?? context.actorUserId
    const session = actorUserId
      ? await this.findSessionByActorId(this.db, actorUserId)
      : await this.createSessionQuery(this.db).executeTakeFirst()

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
    context: SessionContext,
    authenticatedActor: AppActorRow | null,
  ): Promise<SessionRow> {
    const workspaceId = context.workspaceId ?? ''
    const actorUserId = authenticatedActor?.id ?? context.actorUserId
    const session = actorUserId
      ? await this.findSessionByActorId(this.db, actorUserId, workspaceId)
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
    authContext: AuthenticatedRequestContext,
    requestedWorkspaceId?: string,
  ): Promise<AppActorRow> {
    return this.db.transaction().execute(async (trx) => {
      const actor = await this.ensureAuthenticatedActor(
        trx,
        authContext,
        requestedWorkspaceId,
      )
      const existingSession = await this.findSessionByActorId(trx, actor.id)

      if (existingSession) {
        return actor
      }

      const workspaceSlug = this.createPersonalWorkspaceSlug(actor.id)
      const insertedWorkspace = await trx
        .insertInto('app.workspaces')
        .values({
          description: '',
          id: generateUuidV7(),
          name: this.createPersonalWorkspaceName(actor.displayName),
          owner_user_id: actor.id,
          slug: workspaceSlug,
        })
        .onConflict((conflict) => conflict.column('slug').doNothing())
        .returning('id')
        .executeTakeFirst()
      const personalWorkspaceId =
        insertedWorkspace?.id ??
        (
          await trx
            .selectFrom('app.workspaces')
            .select('id')
            .where('slug', '=', workspaceSlug)
            .executeTakeFirst()
        )?.id

      if (!personalWorkspaceId) {
        throw new Error('Failed to provision a personal workspace.')
      }

      await trx
        .insertInto('app.workspace_members')
        .values({
          id: generateUuidV7(),
          role: 'owner',
          user_id: actor.id,
          workspace_id: personalWorkspaceId,
        })
        .onConflict((conflict) =>
          conflict.columns(['workspace_id', 'user_id']).doNothing(),
        )
        .execute()

      return actor
    })
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

  private createSessionQuery(
    executor: DatabaseExecutor,
    workspaceId?: string,
  ) {
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
      return this.syncAuthenticatedActorProfile(executor, authActor, authContext)
    }

    if (emailActor) {
      return this.syncAuthenticatedActorProfile(executor, emailActor, authContext)
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

    const authHasAnyWorkspace = await this.hasAnyWorkspaceAccess(executor, authActor.id)
    const emailHasAnyWorkspace = await this.hasAnyWorkspaceAccess(executor, emailActor.id)

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

    if (actor.email === desiredEmail && actor.displayName === desiredDisplayName) {
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
    const actor: AppActorRow = {
      avatarUrl: null,
      displayName: this.resolveAuthDisplayName(authContext),
      email: this.resolveAuthEmail(authContext),
      id: authContext.claims.sub,
      locale: 'en-US',
      timezone: 'UTC',
    }

    return this.createActorRecord(executor, actor)
  }

  private async createActorRecord(
    executor: DatabaseExecutor,
    actor: AppActorRow,
  ): Promise<AppActorRow> {
    const insertedActor = await executor
      .insertInto('app.users')
      .values({
        avatar_url: actor.avatarUrl,
        display_name: actor.displayName,
        email: actor.email,
        id: actor.id,
        locale: actor.locale,
        timezone: actor.timezone,
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .returning([
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
      throw new Error(`Failed to resolve actor "${actor.id}" after provisioning.`)
    }

    return existingActor
  }

  private resolveAuthEmail(authContext: AuthenticatedRequestContext): string {
    const payloadEmail = this.getStringClaim(authContext.claims.payload, 'email')
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
      (userMetadata ? this.getStringClaim(userMetadata, 'display_name') : null) ??
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
