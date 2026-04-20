import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const retries = 5
const retryDelayMs = 1000

const devUser = {
  displayName: 'Planner Dev User',
  email: 'vedeneeva.d.p@gmail.com',
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

const seedStatements = [
  {
    name: 'dev user',
    parameters: [devUser.id, devUser.email, devUser.displayName],
    sql: `
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
  },
  {
    name: 'dev workspace',
    parameters: [
      devWorkspace.id,
      devWorkspace.ownerUserId,
      devWorkspace.name,
      devWorkspace.slug,
    ],
    sql: `
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
  },
  {
    name: 'dev membership',
    parameters: [
      devMembership.id,
      devMembership.workspaceId,
      devMembership.userId,
      devMembership.role,
    ],
    sql: `
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
  },
]

async function main() {
  for (const statement of seedStatements) {
    await runSeedStatement(statement)
  }

  console.log('Seed completed.')
  console.log(`User ID: ${devUser.id}`)
  console.log(`Workspace ID: ${devWorkspace.id}`)
}

async function runSeedStatement(statement) {
  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const client = createClient()

    try {
      await client.connect()
      await preparePgAdminConnection(client)
      await client.query(statement.sql, statement.parameters)
      return
    } catch (error) {
      lastError = error

      if (!isTransientConnectionError(error) || attempt === retries) {
        throw error
      }

      console.log(
        `Transient database error during seed "${statement.name}". Retry ${attempt}/${retries} in ${retryDelayMs}ms.`,
      )
      await wait(retryDelayMs)
    } finally {
      await closePgClient(client)
    }
  }

  throw lastError
}

function createClient() {
  const client = new Client(createPgConnectionConfig(connectionString))

  client.on('error', (error) => {
    if (isTransientConnectionError(error)) {
      return
    }

    console.error(
      `Database client error (${error.code ?? 'unknown'}): ${error.message}`,
    )
  })

  return client
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

function isTransientConnectionError(error) {
  if (typeof error?.code === 'string') {
    return ['ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(error.code)
  }

  return (
    error instanceof Error &&
    (error.message.includes('Client has encountered a connection error') ||
      error.message.includes('Connection terminated') ||
      error.message.includes('Query read timeout') ||
      error.message.includes('timeout'))
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
