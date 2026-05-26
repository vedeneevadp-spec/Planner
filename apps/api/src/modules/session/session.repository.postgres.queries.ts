import { sql } from 'kysely'

import type { DatabaseExecutor } from '../../infrastructure/db/rls.js'
import type {
  AppActorRow,
  ExistingWorkspaceMemberRow,
  ReceivedWorkspaceInvitationRow,
  SessionRow,
  WorkspaceInvitationRow,
  WorkspaceMembershipRow,
  WorkspaceUserRow,
} from './session.repository.postgres.rows.js'

export function createAdminUserQuery(executor: DatabaseExecutor) {
  return executor
    .selectFrom('app.users as actor')
    .select([
      'actor.app_role as appRole',
      'actor.display_name as displayName',
      'actor.email as email',
      'actor.id as id',
      'actor.updated_at as updatedAt',
      sql<unknown>`app.admin_user_last_seen_at(actor.id)`.as('lastSeenAt'),
      sql<number>`app.admin_user_task_count(actor.id)`.as('taskCount'),
    ])
    .where('actor.deleted_at', 'is', null)
}

export function createReceivedWorkspaceInvitationQuery(
  executor: DatabaseExecutor,
  email: string,
) {
  return executor
    .selectFrom('app.workspace_invitations as invitation')
    .innerJoin(
      'app.workspaces as workspace',
      'workspace.id',
      'invitation.workspace_id',
    )
    .select([
      'invitation.group_role as groupRole',
      'invitation.id as id',
      'invitation.invited_by as invitedBy',
      'invitation.created_at as invitedAt',
      'invitation.updated_at as updatedAt',
      'workspace.id as workspaceId',
      'workspace.kind as workspaceKind',
      'workspace.name as workspaceName',
      'workspace.slug as workspaceSlug',
    ])
    .where('invitation.email', '=', email)
    .where('invitation.accepted_at', 'is', null)
    .where('invitation.declined_at', 'is', null)
    .where('invitation.deleted_at', 'is', null)
    .where('workspace.kind', '=', 'shared')
    .where('workspace.deleted_at', 'is', null)
}

export function createSessionQuery(
  executor: DatabaseExecutor,
  workspaceId?: string,
) {
  let query = createSessionBaseQuery(executor)

  if (workspaceId) {
    query = query.where('workspace.id', '=', workspaceId)
  } else {
    query = query
      .orderBy('workspace.created_at', 'asc')
      .orderBy('membership.joined_at', 'asc')
  }

  return query
}

export function createWorkspaceInvitationQuery(
  executor: DatabaseExecutor,
  workspaceId: string,
) {
  return executor
    .selectFrom('app.workspace_invitations as invitation')
    .select([
      'invitation.email as email',
      'invitation.declined_at as declinedAt',
      'invitation.group_role as groupRole',
      'invitation.id as id',
      'invitation.created_at as invitedAt',
      'invitation.updated_at as updatedAt',
    ])
    .where('invitation.workspace_id', '=', workspaceId)
    .where('invitation.accepted_at', 'is', null)
    .where('invitation.deleted_at', 'is', null)
}

export function createWorkspaceUserQuery(
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

export async function countSharedWorkspaces(
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

export function findActorByEmail(
  executor: DatabaseExecutor,
  email: string,
): Promise<AppActorRow | undefined> {
  return executor
    .selectFrom('app.users')
    .select(actorSelect)
    .where('deleted_at', 'is', null)
    .where('email', '=', email)
    .executeTakeFirst()
}

export function findActorById(
  executor: DatabaseExecutor,
  actorUserId: string,
): Promise<AppActorRow | undefined> {
  return executor
    .selectFrom('app.users')
    .select(actorSelect)
    .where('deleted_at', 'is', null)
    .where('id', '=', actorUserId)
    .executeTakeFirst()
}

export function findReceivedWorkspaceInvitationById(
  executor: DatabaseExecutor,
  email: string,
  invitationId: string,
): Promise<ReceivedWorkspaceInvitationRow | undefined> {
  return createReceivedWorkspaceInvitationQuery(executor, email)
    .where('invitation.id', '=', invitationId)
    .executeTakeFirst()
}

export function findSessionByActorId(
  executor: DatabaseExecutor,
  actorUserId: string,
  workspaceId?: string,
): Promise<SessionRow | undefined> {
  return createSessionQuery(executor, workspaceId)
    .where('actor.id', '=', actorUserId)
    .executeTakeFirst()
}

export function findWorkspaceInvitationById(
  executor: DatabaseExecutor,
  workspaceId: string,
  invitationId: string,
): Promise<WorkspaceInvitationRow | undefined> {
  return createWorkspaceInvitationQuery(executor, workspaceId)
    .where('invitation.id', '=', invitationId)
    .executeTakeFirst()
}

export function findWorkspaceMemberByUserId(
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

export function findWorkspaceUserByEmail(
  executor: DatabaseExecutor,
  workspaceId: string,
  email: string,
): Promise<WorkspaceUserRow | undefined> {
  return createWorkspaceUserQuery(executor, workspaceId)
    .where('actor.email', '=', email)
    .executeTakeFirst()
}

export function findWorkspaceUserByMembershipId(
  executor: DatabaseExecutor,
  workspaceId: string,
  membershipId: string,
): Promise<WorkspaceUserRow | undefined> {
  return createWorkspaceUserQuery(executor, workspaceId)
    .where('membership.id', '=', membershipId)
    .executeTakeFirst()
}

export function listSessionWorkspaces(
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

const actorSelect = [
  'app_role as appRole',
  'avatar_url as avatarUrl',
  'calendar_view_mode as calendarViewMode',
  'energy_mode as energyMode',
  'display_name as displayName',
  'email',
  'id',
  'locale',
  'timezone',
] as const

function createSessionBaseQuery(executor: DatabaseExecutor) {
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
      'actor.calendar_view_mode as calendarViewMode',
      'actor.energy_mode as energyMode',
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
