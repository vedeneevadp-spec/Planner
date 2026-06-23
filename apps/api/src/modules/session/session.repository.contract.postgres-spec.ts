import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import {
  createSessionAuthContext,
  defineSessionRepositoryContractSuite,
} from './session.repository.contract.js'
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

void test('PostgresSessionRepository exposes admin user metrics under runtime RLS', async () => {
  const repository = new PostgresSessionRepository(connection.db)
  const memberUserId = randomUUID()
  const memberEmail = `contract-admin-metrics-member-${memberUserId}@example.test`
  const taskId = randomUUID()
  const refreshTokenId = randomUUID()
  const refreshSessionId = randomUUID()
  const lastSeenAt = new Date('2026-05-24T01:02:03.000Z')
  const owner = await resolveOwnerUser()
  const cleanupUserIds = owner.seeded
    ? [owner.id, memberUserId]
    : [memberUserId]

  try {
    await seedUserSession({
      appRole: 'user',
      email: memberEmail,
      userId: memberUserId,
    })

    const memberWorkspaceId = await resolvePersonalWorkspaceId(memberUserId)
    await connection.pool.query(
      `
        insert into app.tasks (
          id,
          workspace_id,
          title,
          description,
          created_by,
          updated_by
        )
        values ($1, $2, 'RLS hidden member task', '', $3, $3)
      `,
      [taskId, memberWorkspaceId, memberUserId],
    )
    await connection.pool.query(
      `
        insert into app.auth_refresh_tokens (
          id,
          user_id,
          token_hash,
          session_id,
          expires_at,
          created_at,
          last_used_at
        )
        values ($1, $2, $3, $4, '2099-01-01T00:00:00Z', $5, $5)
      `,
      [
        refreshTokenId,
        memberUserId,
        `contract-admin-metrics-token-${refreshTokenId}`,
        refreshSessionId,
        lastSeenAt,
      ],
    )

    const ownerSession = await repository.resolve({
      actorUserId: owner.id,
      auth: null,
      workspaceId: undefined,
    })
    const users = await repository.listAdminUsers(
      ownerSession,
      createSessionAuthContext({
        email: owner.email,
        userId: owner.id,
      }),
    )
    const member = users.find((user) => user.id === memberUserId)

    assert.ok(member)
    assert.equal(member.taskCount, 1)
    assert.equal(member.lastSeenAt, lastSeenAt.toISOString())
  } finally {
    await cleanupUsers(cleanupUserIds)
  }
})

void test('PostgresSessionRepository updates user preferences under runtime RLS', async () => {
  const repository = new PostgresSessionRepository(connection.db)
  const userId = randomUUID()
  const email = `contract-preferences-${userId}@example.test`

  try {
    await seedUserSession({
      appRole: 'user',
      email,
      userId,
    })

    const session = await repository.resolve({
      actorUserId: userId,
      auth: null,
      workspaceId: undefined,
    })
    const preferences = await repository.updateUserPreferences(
      session,
      createSessionAuthContext({
        email,
        userId,
      }),
      {
        energyMode: 'minimum',
      },
    )
    const updatedSession = await repository.resolve({
      actorUserId: userId,
      auth: null,
      workspaceId: undefined,
    })

    assert.deepEqual(preferences, {
      calendarViewMode: 'week',
      defaultTimeZone: null,
      energyMode: 'minimum',
      lastSeenTimeZone: null,
      timeZoneMode: 'device',
      voiceAssistantEnabled: true,
    })
    assert.equal(updatedSession.userPreferences.energyMode, 'minimum')
  } finally {
    await cleanupUsers([userId])
  }
})

void test('PostgresSessionRepository updates workspace settings under runtime RLS', async () => {
  const repository = new PostgresSessionRepository(connection.db)
  const userId = randomUUID()
  const email = `contract-workspace-settings-${userId}@example.test`

  try {
    await seedUserSession({
      appRole: 'admin',
      email,
      userId,
    })

    const session = await repository.resolve({
      actorUserId: userId,
      auth: null,
      workspaceId: undefined,
    })
    const settings = await repository.updateWorkspaceSettings(
      session,
      createSessionAuthContext({
        email,
        userId,
      }),
      {
        taskCompletionConfettiEnabled: false,
        wakeWordTrainingModeEnabled: true,
      },
    )
    const updatedSession = await repository.resolve({
      actorUserId: userId,
      auth: null,
      workspaceId: session.workspaceId,
    })

    assert.deepEqual(settings, {
      defaultTimeZone: null,
      taskCompletionConfettiEnabled: false,
      wakeWordTrainingModeEnabled: true,
    })
    assert.deepEqual(updatedSession.workspaceSettings, settings)
  } finally {
    await cleanupUsers([userId])
  }
})

async function seedUserSession(input: {
  appRole: 'owner' | 'admin' | 'test' | 'user' | 'guest'
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

async function resolveOwnerUser(): Promise<{
  email: string
  id: string
  seeded: boolean
}> {
  const existingOwner = await connection.pool.query<{
    email: string
    id: string
  }>(
    `
      select id, email
      from app.users
      where app_role = 'owner'
        and deleted_at is null
      order by created_at asc
      limit 1
    `,
  )

  if (existingOwner.rows[0]) {
    return {
      email: existingOwner.rows[0].email,
      id: existingOwner.rows[0].id,
      seeded: false,
    }
  }

  const ownerUserId = randomUUID()
  const ownerEmail = `contract-admin-metrics-owner-${ownerUserId}@example.test`

  await seedUserSession({
    appRole: 'owner',
    email: ownerEmail,
    userId: ownerUserId,
  })

  return {
    email: ownerEmail,
    id: ownerUserId,
    seeded: true,
  }
}

async function resolvePersonalWorkspaceId(userId: string): Promise<string> {
  const workspace = await connection.pool.query<{ id: string }>(
    `
      select workspace.id
      from app.workspaces as workspace
      where workspace.owner_user_id = $1
        and workspace.kind = 'personal'
        and workspace.deleted_at is null
      order by workspace.created_at asc
      limit 1
    `,
    [userId],
  )

  const workspaceId = workspace.rows[0]?.id

  if (!workspaceId) {
    throw new Error(`Failed to resolve personal workspace for ${userId}.`)
  }

  return workspaceId
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
