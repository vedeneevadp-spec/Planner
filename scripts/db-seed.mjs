import { Client } from 'pg'

import { createPgConnectionConfig } from './pg-connection-config.mjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'

const devUser = {
  displayName: 'Planner Dev User',
  email: 'dev@planner.local',
  id: '11111111-1111-4111-8111-111111111111',
}

const devWorkspace = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Planner Personal Workspace',
  ownerUserId: devUser.id,
  slug: 'personal',
}

const devMembership = {
  id: '33333333-3333-4333-8333-333333333333',
  role: 'owner',
  userId: devUser.id,
  workspaceId: devWorkspace.id,
}

async function main() {
  const client = createClient()

  await client.connect()

  try {
    await client.query('begin')

    await client.query(
      // noinspection SqlNoDataSourceInspection
      `
        insert into app.users (
          id,
          email,
          display_name
        )
        values ($1, $2, $3)
        on conflict (id) do update
        set
          email = excluded.email,
          display_name = excluded.display_name
      `,
      [devUser.id, devUser.email, devUser.displayName],
    )

    await client.query(
      // noinspection SqlNoDataSourceInspection
      `
        insert into app.workspaces (
          id,
          owner_user_id,
          name,
          slug
        )
        values ($1, $2, $3, $4)
        on conflict (id) do update
        set
          owner_user_id = excluded.owner_user_id,
          name = excluded.name,
          slug = excluded.slug
      `,
      [
        devWorkspace.id,
        devWorkspace.ownerUserId,
        devWorkspace.name,
        devWorkspace.slug,
      ],
    )

    await client.query(
      // noinspection SqlNoDataSourceInspection
      `
        insert into app.workspace_members (
          id,
          workspace_id,
          user_id,
          role
        )
        values ($1, $2, $3, $4::app.workspace_role)
        on conflict (workspace_id, user_id) do update
        set
          role = excluded.role
      `,
      [
        devMembership.id,
        devMembership.workspaceId,
        devMembership.userId,
        devMembership.role,
      ],
    )

    await client.query('commit')

    console.log('Seed completed.')
    console.log(`User ID: ${devUser.id}`)
    console.log(`Workspace ID: ${devWorkspace.id}`)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

function createClient() {
  const client = new Client(createPgConnectionConfig(connectionString))

  client.on('error', (error) => {
    console.error(
      `Database client error (${error.code ?? 'unknown'}): ${error.message}`,
    )
  })

  return client
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
