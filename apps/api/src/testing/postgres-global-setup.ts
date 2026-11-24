// node:test --test-global-setup for the *.postgres-spec.ts suites.
//
// The database allows exactly one active app.users row with app_role 'owner'
// (users_single_owner_idx), and the first user created in a database without
// one becomes the owner. Spec files run in parallel, so on an empty database
// whichever file created a user first (Google sign-in, RLS fixtures, ...) used
// to become the global owner — without a personal workspace — and the owner-
// dependent session specs failed with session_not_found while also leaving a
// workspace behind that broke the other file's cleanup.
//
// Before any spec file runs, make sure an owner with a personal workspace
// exists. Fixture users created later are then always ordinary users.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'

const DEFAULT_DATABASE_URL =
  'postgres://planner:planner@127.0.0.1:54329/planner_development'

export async function globalSetup(): Promise<void> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  })

  await client.connect()

  try {
    await client.query('begin')
    // Same key as app.auth_create_user_with_credential uses for the owner choice.
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended('app.users:first_owner', 0))`,
    )

    const owner = await client.query<{
      email: string
      has_personal_workspace: boolean
    }>(
      `
        select
          users.email::text as email,
          exists (
            select 1
            from app.workspace_members as members
            join app.workspaces as workspaces
              on workspaces.id = members.workspace_id
            where members.user_id = users.id
              and members.deleted_at is null
              and workspaces.kind = 'personal'
              and workspaces.deleted_at is null
          ) as has_personal_workspace
        from app.users as users
        where users.app_role = 'owner'
          and users.deleted_at is null
        limit 1
      `,
    )
    const existing = owner.rows[0]

    if (existing) {
      if (!existing.has_personal_workspace) {
        throw new Error(
          `The global owner ${existing.email} has no personal workspace; owner-dependent Postgres specs need one. Use a fresh test database or give the owner a workspace.`,
        )
      }
    } else {
      await seedTestOwner(client)
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

async function seedTestOwner(client: Client): Promise<void> {
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const email = `postgres-test-owner-${userId}@example.test`

  await client.query(
    `
      insert into app.users (id, email, display_name, app_role, locale, timezone)
      values ($1, $2, 'Postgres Test Owner', 'owner', 'en-US', 'UTC')
    `,
    [userId, email],
  )
  await client.query(
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
      values ($1, $2, 'Postgres Test Owner Workspace', $3, 'personal', '', true)
    `,
    [
      workspaceId,
      userId,
      `test-owner-${userId.replaceAll('-', '').slice(0, 24)}`,
    ],
  )
  await client.query(
    `
      insert into app.workspace_members (id, workspace_id, user_id, role, group_role)
      values ($1, $2, $3, 'owner', null)
    `,
    [randomUUID(), workspaceId, userId],
  )
}
