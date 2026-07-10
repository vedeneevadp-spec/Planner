import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { Client } from 'pg'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'

interface RlsFixture {
  groupAdminUserId: string
  invitationId: string
  memberUserId: string
  ownerUserId: string
  prefix: string
  recipientUserId: string
  rejoinInvitationId: string
  rejoiningUserId: string
  seededOwnerUserId: string | null
  sharedWorkspaceId: string
  taskAId: string
  taskBId: string
  userAId: string
  userBId: string
  workspaceAId: string
  workspaceBId: string
}

const client = new Client({
  connectionString,
  connectionTimeoutMillis: 10_000,
  query_timeout: 30_000,
})
let fixture: RlsFixture

const RLS_ENABLED_TABLES = [
  'auth_credentials',
  'auth_password_reset_tokens',
  'auth_refresh_tokens',
  'chaos_inbox_items',
  'daily_plans',
  'emoji_assets',
  'emoji_sets',
  'habit_entries',
  'habits',
  'life_spheres',
  'oauth_authorization_codes',
  'projects',
  'push_devices',
  'task_attachments',
  'task_reminders',
  'task_templates',
  'task_time_blocks',
  'tasks',
  'users',
  'workspace_invitations',
  'workspace_members',
  'workspaces',
]

const EXPECTED_POLICY_NAMES = [
  'chaos_inbox_items_delete_member',
  'chaos_inbox_items_insert_member',
  'chaos_inbox_items_select_member',
  'chaos_inbox_items_update_member',
  'daily_plans_delete_member',
  'daily_plans_insert_member',
  'daily_plans_select_member',
  'daily_plans_update_member',
  'emoji_assets_delete_admin',
  'emoji_assets_insert_admin',
  'emoji_assets_select_member',
  'emoji_assets_update_admin',
  'emoji_sets_delete_admin',
  'emoji_sets_insert_admin',
  'emoji_sets_select_member',
  'emoji_sets_update_admin',
  'habit_entries_delete_member',
  'habit_entries_insert_member',
  'habit_entries_select_member',
  'habit_entries_update_member',
  'habits_delete_member',
  'habits_insert_member',
  'habits_select_member',
  'habits_update_member',
  'life_spheres_delete_member',
  'life_spheres_insert_member',
  'life_spheres_select_member',
  'life_spheres_update_member',
  'projects_delete_member',
  'projects_insert_member',
  'projects_select_member',
  'projects_update_member',
  'push_devices_delete_self',
  'push_devices_insert_self',
  'push_devices_select_self',
  'push_devices_update_self',
  'task_attachments_delete_member',
  'task_attachments_insert_member',
  'task_attachments_select_member',
  'task_attachments_update_member',
  'task_reminders_delete_self',
  'task_reminders_insert_self',
  'task_reminders_select_self',
  'task_reminders_update_self',
  'task_templates_delete_member',
  'task_templates_insert_member',
  'task_templates_select_member',
  'task_templates_update_member',
  'tasks_delete_member',
  'tasks_insert_member',
  'tasks_select_member',
  'tasks_update_member',
  'users_select_self_or_managed_workspace_member',
  'users_select_owner',
  'users_update_owner',
  'workspace_invitations_delete_manage',
  'workspace_invitations_insert_manage',
  'workspace_invitations_select_manage_or_recipient',
  'workspace_invitations_update_manage_or_recipient',
  'workspace_members_insert_self',
  'workspace_members_select_self_or_managed',
  'workspace_members_update_manage_or_invited_self',
  'workspaces_delete_shared_owner',
  'workspaces_insert_shared_owner',
  'workspaces_select_invited_email',
  'workspaces_select_member',
  'workspaces_update_shared_owner',
  'workspaces_update_settings_admin',
]

void describe('Postgres RLS policies', () => {
  void before(async () => {
    await client.connect()
    fixture = createFixture()
    await seedFixture(fixture)
  })

  void after(async () => {
    if (fixture) {
      await cleanupFixture(fixture)
    }

    await client.end()
  })

  void test('limits task reads to workspaces available to the current JWT subject', async () => {
    const userATasks = await withAuthenticatedTransaction(
      fixture.userAId,
      async () => listFixtureTaskIds(),
    )
    const userBTasks = await withAuthenticatedTransaction(
      fixture.userBId,
      async () => listFixtureTaskIds(),
    )

    assert.deepEqual(userATasks, [fixture.taskAId])
    assert.deepEqual(userBTasks, [fixture.taskBId])
  })

  void test('rejects writes into another user workspace and allows own workspace writes', async () => {
    const blockedTaskId = randomUUID()

    await assert.rejects(
      () =>
        withAuthenticatedTransaction(fixture.userAId, () =>
          insertTask({
            id: blockedTaskId,
            title: `${fixture.prefix}-blocked`,
            userId: fixture.userAId,
            workspaceId: fixture.workspaceBId,
          }),
        ),
      (error: unknown) =>
        isDatabaseError(error) &&
        error.code === '42501' &&
        error.message.includes('row-level security'),
    )

    const allowedTaskId = randomUUID()
    await withAuthenticatedTransaction(fixture.userAId, () =>
      insertTask({
        id: allowedTaskId,
        title: `${fixture.prefix}-allowed`,
        userId: fixture.userAId,
        workspaceId: fixture.workspaceAId,
      }),
    )

    const visibleTaskIds = await withAuthenticatedTransaction(
      fixture.userAId,
      async () => listFixtureTaskIds(),
    )

    assert.deepEqual(
      visibleTaskIds.sort(),
      [allowedTaskId, fixture.taskAId].sort(),
    )
  })

  void test('keeps transaction-local RLS claims from leaking after commit', async () => {
    const visibleWithClaims = await withAuthenticatedTransaction(
      fixture.userAId,
      async () => listFixtureTaskIds(),
    )

    assert.ok(visibleWithClaims.length > 0)

    const visibleWithoutClaims = await withTransaction(async () => {
      await client.query('set local role authenticated')

      return listFixtureTaskIds()
    })

    assert.deepEqual(visibleWithoutClaims, [])
  })

  void test('keeps legacy and function application-role updates owner-only', async () => {
    const ownerVisibleUserIds = await withAuthenticatedTransaction(
      fixture.ownerUserId,
      async () => listFixtureUserIds(),
    )
    const memberVisibleUserIds = await withAuthenticatedTransaction(
      fixture.userBId,
      async () => listFixtureUserIds(),
    )

    assert.deepEqual(
      ownerVisibleUserIds.sort(),
      [
        fixture.groupAdminUserId,
        fixture.memberUserId,
        fixture.recipientUserId,
        fixture.rejoiningUserId,
        fixture.userAId,
        fixture.userBId,
      ].sort(),
    )
    assert.deepEqual(memberVisibleUserIds, [fixture.userBId])

    await assert.rejects(
      withAuthenticatedTransaction(fixture.userBId, async () => {
        await client.query(
          `
            update app.users
            set app_role = 'admin'
            where id = $1
          `,
          [fixture.userBId],
        )
      }),
      /Application role update is not allowed/,
    )

    const memberUpdateResult = await withAuthenticatedTransaction(
      fixture.userBId,
      async () =>
        client.query<{ updated: boolean }>(
          `select app.set_user_app_role($1, 'admin') as updated`,
          [fixture.userBId],
        ),
    )

    assert.equal(memberUpdateResult.rows[0]?.updated, false)

    const ownerUpdateResult = await withAuthenticatedTransaction(
      fixture.ownerUserId,
      async () =>
        client.query<{ updated: boolean }>(
          `select app.set_user_app_role($1, 'admin') as updated`,
          [fixture.userBId],
        ),
    )

    assert.equal(ownerUpdateResult.rows[0]?.updated, true)

    await withAuthenticatedTransaction(fixture.ownerUserId, async () => {
      await client.query(
        `
          update app.users
          set app_role = 'test'
          where id = $1
        `,
        [fixture.userBId],
      )
    })

    const updatedRole = await withAuthenticatedTransaction(
      fixture.ownerUserId,
      async () => resolveFixtureUserRole(fixture.userBId),
    )

    assert.equal(updatedRole, 'test')

    await assert.rejects(
      withAuthenticatedTransaction(fixture.ownerUserId, async () => {
        await client.query(
          `
            update app.users
            set app_role = 'admin'
            where id = $1
          `,
          [fixture.ownerUserId],
        )
      }),
      /Application role update is not allowed/,
    )
  })

  void test('allows legacy invitation transitions without exposing invitation scope', async () => {
    const accepted = await withAuthenticatedRollback(
      fixture.recipientUserId,
      async () =>
        client.query<{ accepted_by: string }>(
          `
            update app.workspace_invitations
            set accepted_at = now(), accepted_by = $1
            where id = $2
              and accepted_at is null
              and declined_at is null
              and deleted_at is null
            returning accepted_by
          `,
          [fixture.recipientUserId, fixture.invitationId],
        ),
    )

    assert.equal(accepted.rows[0]?.accepted_by, fixture.recipientUserId)

    const declined = await withAuthenticatedRollback(
      fixture.recipientUserId,
      async () =>
        client.query<{ declined_by: string }>(
          `
            update app.workspace_invitations
            set declined_at = now(), declined_by = $1
            where id = $2
              and email = $3
              and accepted_at is null
              and declined_at is null
              and deleted_at is null
            returning declined_by
          `,
          [
            fixture.recipientUserId,
            fixture.invitationId,
            `${fixture.prefix}-recipient@example.test`,
          ],
        ),
    )

    assert.equal(declined.rows[0]?.declined_by, fixture.recipientUserId)

    for (const functionName of [
      'accept_workspace_invitation',
      'decline_workspace_invitation',
    ]) {
      const functionResult = await withAuthenticatedRollback(
        fixture.recipientUserId,
        async () =>
          client.query<{ updated: boolean }>(
            `select app.${functionName}($1) as updated`,
            [fixture.invitationId],
          ),
      )

      assert.equal(functionResult.rows[0]?.updated, true)
    }

    const reinvited = await withAuthenticatedRollback(
      fixture.groupAdminUserId,
      async () =>
        client.query<{ group_role: string; invited_by: string }>(
          `
            insert into app.workspace_invitations (
              id,
              workspace_id,
              email,
              group_role,
              invited_by
            )
            values ($1, $2, $3, 'senior_member', $4)
            on conflict (workspace_id, email) do update
            set
              accepted_at = null,
              accepted_by = null,
              deleted_at = null,
              declined_at = null,
              declined_by = null,
              group_role = excluded.group_role,
              invited_by = excluded.invited_by
            returning group_role::text, invited_by
          `,
          [
            randomUUID(),
            fixture.sharedWorkspaceId,
            `${fixture.prefix}-recipient@example.test`,
            fixture.groupAdminUserId,
          ],
        ),
    )

    assert.deepEqual(reinvited.rows[0], {
      group_role: 'senior_member',
      invited_by: fixture.groupAdminUserId,
    })

    const revoked = await withAuthenticatedRollback(
      fixture.groupAdminUserId,
      async () =>
        client.query<{ id: string }>(
          `
            update app.workspace_invitations
            set deleted_at = now()
            where id = $1
              and accepted_at is null
              and deleted_at is null
            returning id
          `,
          [fixture.invitationId],
        ),
    )

    assert.equal(revoked.rows[0]?.id, fixture.invitationId)

    await assert.rejects(
      withAuthenticatedRollback(fixture.recipientUserId, async () => {
        await client.query(
          `
            update app.workspace_invitations
            set group_role = 'group_admin'
            where id = $1
          `,
          [fixture.invitationId],
        )
      }),
      isInsufficientPrivilege,
    )
    await assert.rejects(
      withAuthenticatedRollback(fixture.recipientUserId, async () => {
        await client.query(
          `
            update app.workspace_invitations
            set workspace_id = $1
            where id = $2
          `,
          [fixture.workspaceAId, fixture.invitationId],
        )
      }),
      isInsufficientPrivilege,
    )
    await assert.rejects(
      withAuthenticatedRollback(fixture.recipientUserId, async () => {
        await client.query(
          `
            update app.workspace_invitations
            set accepted_at = now(), accepted_by = $1, deleted_at = now()
            where id = $2
          `,
          [fixture.recipientUserId, fixture.invitationId],
        )
      }),
      isInsufficientPrivilege,
    )
  })

  void test('allows legacy membership lifecycle updates without role or identity escalation', async () => {
    const leftMembership = await withAuthenticatedRollback(
      fixture.memberUserId,
      async () =>
        client.query<{ user_id: string }>(
          `
            update app.workspace_members
            set deleted_at = now()
            where workspace_id = $1
              and user_id = $2
              and role <> 'owner'
              and deleted_at is null
            returning user_id
          `,
          [fixture.sharedWorkspaceId, fixture.memberUserId],
        ),
    )

    assert.equal(leftMembership.rows[0]?.user_id, fixture.memberUserId)

    const functionLeave = await withAuthenticatedRollback(
      fixture.memberUserId,
      async () =>
        client.query<{ updated: boolean }>(
          `select app.leave_shared_workspace($1) as updated`,
          [fixture.sharedWorkspaceId],
        ),
    )

    assert.equal(functionLeave.rows[0]?.updated, true)

    const updatedGroupRole = await withAuthenticatedRollback(
      fixture.groupAdminUserId,
      async () =>
        client.query<{ group_role: string }>(
          `
            update app.workspace_members
            set group_role = 'senior_member'
            where workspace_id = $1
              and user_id = $2
              and deleted_at is null
            returning group_role::text
          `,
          [fixture.sharedWorkspaceId, fixture.memberUserId],
        ),
    )

    assert.equal(updatedGroupRole.rows[0]?.group_role, 'senior_member')

    const removedMember = await withAuthenticatedRollback(
      fixture.groupAdminUserId,
      async () =>
        client.query<{ user_id: string }>(
          `
            update app.workspace_members
            set deleted_at = now()
            where workspace_id = $1
              and user_id = $2
              and deleted_at is null
            returning user_id
          `,
          [fixture.sharedWorkspaceId, fixture.memberUserId],
        ),
    )

    assert.equal(removedMember.rows[0]?.user_id, fixture.memberUserId)

    const rejoinedMember = await withAuthenticatedRollback(
      fixture.rejoiningUserId,
      async () =>
        client.query<{ user_id: string }>(
          `
            update app.workspace_members
            set
              deleted_at = null,
              group_role = 'member',
              invited_by = $1,
              role = 'user'
            where workspace_id = $2
              and user_id = $3
            returning user_id
          `,
          [
            fixture.ownerUserId,
            fixture.sharedWorkspaceId,
            fixture.rejoiningUserId,
          ],
        ),
    )

    assert.equal(rejoinedMember.rows[0]?.user_id, fixture.rejoiningUserId)

    await assert.rejects(
      withAuthenticatedRollback(fixture.groupAdminUserId, async () => {
        await client.query(
          `
            update app.workspace_members
            set role = 'owner'
            where workspace_id = $1
              and user_id = $2
          `,
          [fixture.sharedWorkspaceId, fixture.memberUserId],
        )
      }),
      isInsufficientPrivilege,
    )
    await assert.rejects(
      withAuthenticatedRollback(fixture.groupAdminUserId, async () => {
        await client.query(
          `
            update app.workspace_members
            set user_id = $1
            where workspace_id = $2
              and user_id = $3
          `,
          [
            fixture.groupAdminUserId,
            fixture.sharedWorkspaceId,
            fixture.memberUserId,
          ],
        )
      }),
      isInsufficientPrivilege,
    )
    await assert.rejects(
      withAuthenticatedRollback(fixture.groupAdminUserId, async () => {
        await client.query(
          `
            update app.workspace_members
            set invited_by = $1
            where workspace_id = $2
              and user_id = $3
          `,
          [
            fixture.groupAdminUserId,
            fixture.sharedWorkspaceId,
            fixture.memberUserId,
          ],
        )
      }),
      isInsufficientPrivilege,
    )
  })

  void test('keeps RLS enabled on all protected tables', async () => {
    const result = await client.query<{ table_name: string }>(
      `
        select relname as table_name
        from pg_class
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'app'
          and pg_class.relkind = 'r'
          and pg_class.relrowsecurity = true
        order by relname
      `,
    )
    const enabledTables = new Set(result.rows.map((row) => row.table_name))

    for (const tableName of RLS_ENABLED_TABLES) {
      assert.ok(
        enabledTables.has(tableName),
        `${tableName} must have RLS enabled.`,
      )
    }
  })

  void test('keeps expected workspace and self access policies installed', async () => {
    const result = await client.query<{ policyname: string }>(
      `
        select policyname
        from pg_policies
        where schemaname = 'app'
        order by policyname
      `,
    )
    const policyNames = new Set(result.rows.map((row) => row.policyname))

    for (const policyName of EXPECTED_POLICY_NAMES) {
      assert.ok(policyNames.has(policyName), `${policyName} policy is missing.`)
    }
  })
})

function createFixture(): RlsFixture {
  const suffix = randomUUID()

  return {
    groupAdminUserId: randomUUID(),
    invitationId: randomUUID(),
    memberUserId: randomUUID(),
    ownerUserId: randomUUID(),
    prefix: `rls-${suffix}`,
    recipientUserId: randomUUID(),
    rejoinInvitationId: randomUUID(),
    rejoiningUserId: randomUUID(),
    seededOwnerUserId: null,
    sharedWorkspaceId: randomUUID(),
    taskAId: randomUUID(),
    taskBId: randomUUID(),
    userAId: randomUUID(),
    userBId: randomUUID(),
    workspaceAId: randomUUID(),
    workspaceBId: randomUUID(),
  }
}

async function seedFixture(value: RlsFixture): Promise<void> {
  await cleanupFixture(value)
  value.ownerUserId = await resolveOrSeedOwnerUserId(value)

  await client.query(
    `
      insert into app.users (id, email, display_name)
      values
        ($1, $2, $3),
        ($4, $5, $6)
    `,
    [
      value.userAId,
      `${value.prefix}-a@example.test`,
      `${value.prefix} A`,
      value.userBId,
      `${value.prefix}-b@example.test`,
      `${value.prefix} B`,
    ],
  )
  await client.query(
    `
      insert into app.users (id, email, display_name)
      values
        ($1, $2, $3),
        ($4, $5, $6),
        ($7, $8, $9),
        ($10, $11, $12)
    `,
    [
      value.groupAdminUserId,
      `${value.prefix}-group-admin@example.test`,
      `${value.prefix} Group Admin`,
      value.memberUserId,
      `${value.prefix}-member@example.test`,
      `${value.prefix} Member`,
      value.recipientUserId,
      `${value.prefix}-recipient@example.test`,
      `${value.prefix} Recipient`,
      value.rejoiningUserId,
      `${value.prefix}-rejoining@example.test`,
      `${value.prefix} Rejoining`,
    ],
  )
  await client.query(
    `
      insert into app.workspaces (id, owner_user_id, name, slug)
      values
        ($1, $2, $3, $4),
        ($5, $6, $7, $8)
    `,
    [
      value.workspaceAId,
      value.userAId,
      `${value.prefix} A`,
      `${value.prefix}-a`,
      value.workspaceBId,
      value.userBId,
      `${value.prefix} B`,
      `${value.prefix}-b`,
    ],
  )
  await client.query(
    `
      insert into app.workspace_members (workspace_id, user_id, role)
      values
        ($1, $2, 'owner'),
        ($3, $4, 'owner')
    `,
    [value.workspaceAId, value.userAId, value.workspaceBId, value.userBId],
  )
  await client.query(
    `
      insert into app.workspaces (
        id,
        owner_user_id,
        name,
        slug,
        kind
      )
      values ($1, $2, $3, $4, 'shared')
    `,
    [
      value.sharedWorkspaceId,
      value.ownerUserId,
      `${value.prefix} Shared`,
      `${value.prefix}-shared`,
    ],
  )
  await client.query(
    `
      insert into app.workspace_members (
        workspace_id,
        user_id,
        role,
        group_role,
        invited_by,
        deleted_at
      )
      values
        ($1, $2, 'owner', 'group_admin', null, null),
        ($1, $3, 'user', 'group_admin', $2, null),
        ($1, $4, 'user', 'member', $2, null),
        ($1, $5, 'user', 'member', $2, now())
    `,
    [
      value.sharedWorkspaceId,
      value.ownerUserId,
      value.groupAdminUserId,
      value.memberUserId,
      value.rejoiningUserId,
    ],
  )
  await client.query(
    `
      insert into app.workspace_invitations (
        id,
        workspace_id,
        email,
        group_role,
        invited_by
      )
      values
        ($1, $2, $3, 'member', $4),
        ($5, $2, $6, 'member', $4)
    `,
    [
      value.invitationId,
      value.sharedWorkspaceId,
      `${value.prefix}-recipient@example.test`,
      value.ownerUserId,
      value.rejoinInvitationId,
      `${value.prefix}-rejoining@example.test`,
    ],
  )
  await insertTask({
    id: value.taskAId,
    title: `${value.prefix}-a`,
    userId: value.userAId,
    workspaceId: value.workspaceAId,
  })
  await insertTask({
    id: value.taskBId,
    title: `${value.prefix}-b`,
    userId: value.userBId,
    workspaceId: value.workspaceBId,
  })
}

async function cleanupFixture(value: RlsFixture): Promise<void> {
  await client.query('reset role')
  await client.query("select set_config('request.jwt.claims', '{}', false)")
  await client.query(
    `
      delete from app.workspace_invitations
      where workspace_id = $1
        or id in ($2, $3)
    `,
    [value.sharedWorkspaceId, value.invitationId, value.rejoinInvitationId],
  )
  await client.query(
    `
      delete from app.task_events
      where workspace_id in ($1, $2)
    `,
    [value.workspaceAId, value.workspaceBId],
  )
  await client.query(
    `
      delete from app.tasks
      where workspace_id in ($1, $2)
        or title like $3
    `,
    [value.workspaceAId, value.workspaceBId, `${value.prefix}%`],
  )
  await client.query(
    `
      delete from app.workspace_members
      where workspace_id in ($1, $2, $3)
        or user_id in ($4, $5, $6, $7, $8, $9)
    `,
    [
      value.workspaceAId,
      value.workspaceBId,
      value.sharedWorkspaceId,
      value.userAId,
      value.userBId,
      value.groupAdminUserId,
      value.memberUserId,
      value.recipientUserId,
      value.rejoiningUserId,
    ],
  )
  await client.query(
    `
      delete from app.workspaces
      where id in ($1, $2, $3)
    `,
    [value.workspaceAId, value.workspaceBId, value.sharedWorkspaceId],
  )
  await client.query(
    `
      delete from app.users
      where id in ($1, $2, $3, $4, $5, $6)
    `,
    [
      value.userAId,
      value.userBId,
      value.groupAdminUserId,
      value.memberUserId,
      value.recipientUserId,
      value.rejoiningUserId,
    ],
  )

  if (value.seededOwnerUserId) {
    await client.query(
      `
        delete from app.users
        where id = $1
      `,
      [value.seededOwnerUserId],
    )
  }
}

async function withAuthenticatedTransaction<T>(
  userId: string,
  callback: () => Promise<T>,
): Promise<T> {
  return withTransaction(async () => {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: 'authenticated', sub: userId }),
    ])
    await client.query('set local role authenticated')

    return callback()
  })
}

async function withAuthenticatedRollback<T>(
  userId: string,
  callback: () => Promise<T>,
): Promise<T> {
  await client.query('begin')

  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: 'authenticated', sub: userId }),
    ])
    await client.query('set local role authenticated')

    return await callback()
  } finally {
    await client.query('rollback').catch(() => undefined)
  }
}

async function withTransaction<T>(callback: () => Promise<T>): Promise<T> {
  await client.query('begin')

  try {
    const result = await callback()

    await client.query('commit')

    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)

    throw error
  }
}

async function listFixtureTaskIds(): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `
      select id
      from app.tasks
      where title like $1
      order by title
    `,
    [`${fixture.prefix}%`],
  )

  return result.rows.map((row) => row.id)
}

async function listFixtureUserIds(): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `
      select id
      from app.users
      where email like $1
      order by email
    `,
    [`${fixture.prefix}%`],
  )

  return result.rows.map((row) => row.id)
}

async function resolveFixtureUserRole(userId: string): Promise<string | null> {
  const result = await client.query<{ app_role: string }>(
    `
      select app_role::text
      from app.users
      where id = $1
    `,
    [userId],
  )

  return result.rows[0]?.app_role ?? null
}

async function resolveOrSeedOwnerUserId(value: RlsFixture): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      select id
      from app.users
      where app_role = 'owner'
        and deleted_at is null
      order by created_at asc
      limit 1
    `,
  )

  if (result.rows[0]?.id) {
    return result.rows[0].id
  }

  await client.query(
    `
      insert into app.users (id, email, display_name, app_role)
      values ($1, $2, $3, 'owner')
    `,
    [
      value.ownerUserId,
      `rls-owner-${value.ownerUserId}@example.test`,
      'RLS Owner',
    ],
  )
  value.seededOwnerUserId = value.ownerUserId

  return value.ownerUserId
}

async function insertTask({
  id,
  title,
  userId,
  workspaceId,
}: {
  id: string
  title: string
  userId: string
  workspaceId: string
}): Promise<void> {
  await client.query(
    `
      insert into app.tasks (
        id,
        workspace_id,
        title,
        description,
        created_by,
        updated_by
      )
      values ($1, $2, $3, '', $4, $4)
    `,
    [id, workspaceId, title, userId],
  )
}

function isDatabaseError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error
}

function isInsufficientPrivilege(error: unknown): boolean {
  return isDatabaseError(error) && error.code === '42501'
}
