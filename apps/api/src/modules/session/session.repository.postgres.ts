import type { Kysely } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
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

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async resolve(context: SessionContext): Promise<SessionSnapshot> {
    const session = context.actorUserId && context.workspaceId
      ? await this.resolveExplicitSession(context.actorUserId, context.workspaceId)
      : await this.resolveDefaultSession()

    return {
      actor: {
        displayName: session.actorDisplayName,
        email: session.actorEmail,
        id: session.actorId,
      },
      actorUserId: session.actorId,
      role: session.role,
      source: context.actorUserId && context.workspaceId ? 'headers' : 'default',
      workspace: {
        id: session.workspaceId,
        name: session.workspaceName,
        slug: session.workspaceSlug,
      },
      workspaceId: session.workspaceId,
    }
  }

  private createBaseQuery() {
    return this.db
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

  private async resolveDefaultSession(): Promise<SessionRow> {
    const session = await this.createBaseQuery()
      .orderBy('workspace.created_at', 'asc')
      .orderBy('membership.joined_at', 'asc')
      .executeTakeFirst()

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
    actorUserId: string,
    workspaceId: string,
  ): Promise<SessionRow> {
    const session = await this.createBaseQuery()
      .where('actor.id', '=', actorUserId)
      .where('workspace.id', '=', workspaceId)
      .executeTakeFirst()

    if (!session) {
      throw new HttpError(
        404,
        'session_not_found',
        'The requested actor and workspace pair is not available.',
      )
    }

    return session
  }
}
