import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { Client } from 'pg'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'

interface RlsFixture {
  prefix: string
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
  'users_select_self',
  'workspace_members_select_self',
  'workspaces_select_member',
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
    prefix: `rls-${suffix}`,
    taskAId: randomUUID(),
    taskBId: randomUUID(),
    userAId: randomUUID(),
    userBId: randomUUID(),
    workspaceAId: randomUUID(),
    workspaceBId: randomUUID(),
  }
}

async function seedFixture({
  prefix,
  taskAId,
  taskBId,
  userAId,
  userBId,
  workspaceAId,
  workspaceBId,
}: RlsFixture): Promise<void> {
  await cleanupFixture({
    prefix,
    taskAId,
    taskBId,
    userAId,
    userBId,
    workspaceAId,
    workspaceBId,
  })

  await client.query(
    `
      insert into app.users (id, email, display_name)
      values
        ($1, $2, $3),
        ($4, $5, $6)
    `,
    [
      userAId,
      `${prefix}-a@example.test`,
      `${prefix} A`,
      userBId,
      `${prefix}-b@example.test`,
      `${prefix} B`,
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
      workspaceAId,
      userAId,
      `${prefix} A`,
      `${prefix}-a`,
      workspaceBId,
      userBId,
      `${prefix} B`,
      `${prefix}-b`,
    ],
  )
  await client.query(
    `
      insert into app.workspace_members (workspace_id, user_id, role)
      values
        ($1, $2, 'owner'),
        ($3, $4, 'owner')
    `,
    [workspaceAId, userAId, workspaceBId, userBId],
  )
  await insertTask({
    id: taskAId,
    title: `${prefix}-a`,
    userId: userAId,
    workspaceId: workspaceAId,
  })
  await insertTask({
    id: taskBId,
    title: `${prefix}-b`,
    userId: userBId,
    workspaceId: workspaceBId,
  })
}

async function cleanupFixture(value: RlsFixture): Promise<void> {
  await client.query('reset role')
  await client.query("select set_config('request.jwt.claims', '{}', false)")
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
      where workspace_id in ($1, $2)
        or user_id in ($3, $4)
    `,
    [value.workspaceAId, value.workspaceBId, value.userAId, value.userBId],
  )
  await client.query(
    `
      delete from app.workspaces
      where id in ($1, $2)
    `,
    [value.workspaceAId, value.workspaceBId],
  )
  await client.query(
    `
      delete from app.users
      where id in ($1, $2)
    `,
    [value.userAId, value.userBId],
  )
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
