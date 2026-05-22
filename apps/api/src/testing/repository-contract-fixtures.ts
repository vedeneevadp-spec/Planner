import { randomUUID } from 'node:crypto'

import type { DatabaseConnection } from '../infrastructure/db/client.js'

type AppRole = 'admin' | 'guest' | 'owner' | 'user'
type WorkspaceGroupRole = 'group_admin' | 'member' | 'senior_member'
type WorkspaceKind = 'personal' | 'shared'
type WorkspaceRole = 'admin' | 'guest' | 'owner' | 'user'

export interface RepositoryContractWorkspaceFixture {
  displayName: string
  email: string
  userId: string
  workspaceId: string
  workspaceName: string
}

export async function seedRepositoryContractWorkspace(
  connection: DatabaseConnection,
  input: {
    appRole?: AppRole | undefined
    displayName?: string | undefined
    email?: string | undefined
    groupRole?: WorkspaceGroupRole | null | undefined
    kind?: WorkspaceKind | undefined
    role?: WorkspaceRole | undefined
    userId?: string | undefined
    workspaceId?: string | undefined
    workspaceName?: string | undefined
    workspaceSlug?: string | undefined
  } = {},
): Promise<RepositoryContractWorkspaceFixture> {
  const userId = input.userId ?? randomUUID()
  const workspaceId = input.workspaceId ?? randomUUID()
  const email = input.email ?? `contract-${userId}@example.test`
  const displayName =
    input.displayName ?? email.split('@')[0] ?? 'Contract User'
  const workspaceName = input.workspaceName ?? `${displayName} Workspace`
  const workspaceSlug =
    input.workspaceSlug ??
    `contract-${workspaceId.replaceAll('-', '').slice(0, 24)}`

  await connection.pool.query(
    `
      insert into app.users (
        id,
        email,
        display_name,
        app_role,
        locale,
        timezone
      )
      values ($1, $2, $3, $4::app.app_role, 'en-US', 'UTC')
      on conflict (id) do update
      set
        email = excluded.email,
        display_name = excluded.display_name,
        app_role = excluded.app_role,
        deleted_at = null
    `,
    [userId, email, displayName, input.appRole ?? 'user'],
  )
  await connection.pool.query(
    `
      insert into app.workspaces (
        id,
        owner_user_id,
        name,
        slug,
        kind,
        description,
        task_completion_confetti_enabled
      )
      values ($1, $2, $3, $4, $5::app.workspace_kind, '', true)
      on conflict (id) do update
      set
        name = excluded.name,
        slug = excluded.slug,
        kind = excluded.kind,
        deleted_at = null
    `,
    [
      workspaceId,
      userId,
      workspaceName,
      workspaceSlug,
      input.kind ?? 'personal',
    ],
  )
  await connection.pool.query(
    `
      insert into app.workspace_members (
        id,
        workspace_id,
        user_id,
        role,
        group_role
      )
      values ($1, $2, $3, $4::app.workspace_role, $5::app.workspace_group_role)
      on conflict (workspace_id, user_id) do update
      set
        deleted_at = null,
        role = excluded.role,
        group_role = excluded.group_role
    `,
    [
      randomUUID(),
      workspaceId,
      userId,
      input.role ?? 'owner',
      input.groupRole ?? null,
    ],
  )

  return {
    displayName,
    email,
    userId,
    workspaceId,
    workspaceName,
  }
}

export async function seedRepositoryContractProject(
  connection: DatabaseConnection,
  input: {
    actorUserId: string
    projectId?: string | undefined
    title: string
    workspaceId: string
  },
): Promise<string> {
  const projectId = input.projectId ?? randomUUID()

  await connection.pool.query(
    `
      insert into app.projects (
        id,
        workspace_id,
        title,
        description,
        color,
        icon,
        slug,
        position,
        status,
        metadata,
        created_by,
        updated_by
      )
      values ($1, $2, $3, '', '#2f6f62', 'folder', $4, 0, 'active', '{}', $5, $5)
      on conflict (id) do update
      set
        title = excluded.title,
        deleted_at = null,
        status = 'active'
    `,
    [
      projectId,
      input.workspaceId,
      input.title,
      `contract-project-${projectId.replaceAll('-', '').slice(0, 18)}`,
      input.actorUserId,
    ],
  )

  return projectId
}

export async function cleanupRepositoryContractUsers(
  connection: DatabaseConnection,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) {
    return
  }

  await connection.pool.query(
    `
      delete from app.workspace_invitations
      where workspace_id in (
        select id
        from app.workspaces
        where owner_user_id = any($1::uuid[])
      )
        or invited_by = any($1::uuid[])
        or accepted_by = any($1::uuid[])
        or declined_by = any($1::uuid[])
    `,
    [userIds],
  )
  await connection.pool.query(
    `
      delete from app.workspace_members
      where user_id = any($1::uuid[])
        or workspace_id in (
          select id
          from app.workspaces
          where owner_user_id = any($1::uuid[])
        )
    `,
    [userIds],
  )
  await connection.pool.query(
    `
      delete from app.workspaces
      where owner_user_id = any($1::uuid[])
    `,
    [userIds],
  )
  await connection.pool.query(
    `
      delete from app.users
      where id = any($1::uuid[])
    `,
    [userIds],
  )
}
