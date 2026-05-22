import { randomUUID } from 'node:crypto'
import { after, before } from 'node:test'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import { defineSessionRepositoryContractSuite } from './session.repository.contract.js'
import { PostgresSessionRepository } from './session.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

defineSessionRepositoryContractSuite({
  async createHarness() {
    const repository = new PostgresSessionRepository(connection.db)
    const trackedUserIds = new Set<string>()
    const ownerUserId = randomUUID()
    const memberUserId = randomUUID()

    trackedUserIds.add(ownerUserId)
    trackedUserIds.add(memberUserId)
    await cleanupUsers([...trackedUserIds])

    await seedUserSession({
      appRole: 'user',
      email: `contract-owner-${ownerUserId}@example.test`,
      userId: ownerUserId,
    })
    await seedUserSession({
      appRole: 'user',
      email: `contract-member-${memberUserId}@example.test`,
      userId: memberUserId,
    })

    const ownerSession = await repository.resolve({
      actorUserId: ownerUserId,
      auth: null,
      workspaceId: undefined,
    })
    const memberSession = await repository.resolve({
      actorUserId: memberUserId,
      auth: null,
      workspaceId: undefined,
    })
    const immutableOwnerUserId =
      await resolveImmutableOwnerUserId(trackedUserIds)

    return {
      cleanup: () => cleanupUsers([...trackedUserIds]),
      createAuthenticatedSession: async (input) => {
        trackedUserIds.add(input.userId)

        await seedUserSession({
          appRole: 'user',
          email: input.email,
          userId: input.userId,
        })

        return repository.resolve({
          actorUserId: input.userId,
          auth: null,
          workspaceId: input.workspaceId,
        })
      },
      immutableOwnerUserId,
      memberSession,
      ownerSession,
      repository,
      resolveActorSession: (input) =>
        repository.resolve({
          actorUserId: input.userId,
          auth: null,
          workspaceId: input.workspaceId,
        }),
    }
  },
  name: 'PostgresSessionRepository contract',
})

async function seedUserSession(input: {
  appRole: 'owner' | 'admin' | 'user' | 'guest'
  email: string
  userId: string
}): Promise<void> {
  const workspaceId = randomUUID()
  const membershipId = randomUUID()
  const slug = `contract-${input.userId.replaceAll('-', '').slice(0, 24)}`

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
    [
      input.userId,
      input.email,
      input.email.split('@')[0] ?? 'contract-user',
      input.appRole,
    ],
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
      values ($1, $2, $3, $4, 'personal', '', true)
      on conflict (id) do nothing
    `,
    [workspaceId, input.userId, `${input.email} Workspace`, slug],
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
      values ($1, $2, $3, 'owner', null)
      on conflict (workspace_id, user_id) do update
      set
        deleted_at = null,
        role = 'owner',
        group_role = null
    `,
    [membershipId, workspaceId, input.userId],
  )
}

async function resolveImmutableOwnerUserId(
  trackedUserIds: Set<string>,
): Promise<string> {
  const existingOwner = await connection.pool.query<{ id: string }>(
    `
      select id
      from app.users
      where app_role = 'owner'
        and deleted_at is null
      order by created_at asc
      limit 1
    `,
  )

  if (existingOwner.rows[0]?.id) {
    return existingOwner.rows[0].id
  }

  const ownerUserId = randomUUID()

  trackedUserIds.add(ownerUserId)
  await seedUserSession({
    appRole: 'owner',
    email: `contract-immutable-owner-${ownerUserId}@example.test`,
    userId: ownerUserId,
  })

  return ownerUserId
}

async function cleanupUsers(userIds: string[]): Promise<void> {
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
