import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const adminConnectionString =
  process.env.MIGRATE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const runtimeRole = process.env.DB_RUNTIME_ROLE ?? 'planner_runtime'
const runtimePassword = process.env.DB_RUNTIME_PASSWORD

if (!runtimePassword) {
  throw new Error('DB_RUNTIME_PASSWORD is required.')
}

assertSafeRoleName(runtimeRole)

const client = new Client(createPgConnectionConfig(adminConnectionString))

try {
  await client.connect()
  await preparePgAdminConnection(client)

  const databaseName = await readCurrentDatabase(client)
  await ensureAuthenticatedRole(client)
  await createOrUpdateRuntimeRole(client, runtimeRole, runtimePassword)
  await grantRuntimeAccess(client, {
    databaseName,
    runtimeRole,
  })
  await verifyRuntimeRole({
    connectionString:
      process.env.DB_RUNTIME_DATABASE_URL ??
      createRuntimeConnectionString(adminConnectionString, {
        password: runtimePassword,
        role: runtimeRole,
      }),
    runtimeRole,
  })

  console.log(
    `Runtime DB role is ready: ${runtimeRole}. Configure DATABASE_URL with this role and keep MIGRATE_DATABASE_URL on the owner/admin role.`,
  )
} finally {
  await closePgClient(client)
}

function assertSafeRoleName(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    throw new Error(
      'DB_RUNTIME_ROLE must be a PostgreSQL identifier: letters, numbers, underscore, max 63 chars, not starting with a number.',
    )
  }
}

async function readCurrentDatabase(client) {
  const result = await client.query(
    'select current_database() as database_name',
  )
  const databaseName = result.rows[0]?.database_name

  if (!databaseName) {
    throw new Error('Could not resolve current database name.')
  }

  return databaseName
}

async function ensureAuthenticatedRole(client) {
  const result = await client.query(
    "select 1 from pg_roles where rolname = 'authenticated'",
  )

  if (result.rowCount && result.rowCount > 0) {
    return
  }

  await client.query('create role authenticated nologin')
}

async function createOrUpdateRuntimeRole(client, role, password) {
  const roleIdentifier = quoteIdentifier(role)
  const result = await client.query(
    'select 1 from pg_roles where rolname = $1',
    [role],
  )

  if (result.rowCount && result.rowCount > 0) {
    await client.query(
      `alter role ${roleIdentifier} login inherit password ${quoteLiteral(password)}`,
    )
    return
  }

  await client.query(
    `create role ${roleIdentifier} login inherit password ${quoteLiteral(password)}`,
  )
}

async function grantRuntimeAccess(client, { databaseName, runtimeRole }) {
  const databaseIdentifier = quoteIdentifier(databaseName)
  const roleIdentifier = quoteIdentifier(runtimeRole)

  await client.query(
    `grant connect on database ${databaseIdentifier} to ${roleIdentifier}`,
  )
  await client.query(`grant authenticated to ${roleIdentifier}`)
  await client.query('grant usage on schema app to authenticated')
  await client.query('grant usage on schema public to authenticated')
  await client.query(
    'grant usage, select on all sequences in schema app to authenticated',
  )
}

async function verifyRuntimeRole({ connectionString, runtimeRole }) {
  const runtimeClient = new Client(createPgConnectionConfig(connectionString))

  try {
    await runtimeClient.connect()

    const roleResult = await runtimeClient.query(
      `
        select
          current_user,
          pg_has_role(current_user, 'authenticated', 'member') as is_member,
          pg_has_role(current_user, 'authenticated', 'set') as can_set_role
      `,
    )
    const roleState = roleResult.rows[0]

    if (roleState?.current_user !== runtimeRole) {
      throw new Error(
        `Runtime verification connected as ${roleState?.current_user ?? 'unknown'}, expected ${runtimeRole}.`,
      )
    }

    if (!roleState?.is_member || !roleState.can_set_role) {
      throw new Error(
        `Runtime role ${runtimeRole} cannot SET ROLE authenticated.`,
      )
    }

    await runtimeClient.query('begin')
    try {
      await runtimeClient.query('set local role authenticated')
      await runtimeClient.query('rollback')
    } catch (error) {
      await runtimeClient.query('rollback').catch(() => undefined)
      throw error
    }
  } finally {
    await closePgClient(runtimeClient)
  }
}

function createRuntimeConnectionString(value, { password, role }) {
  try {
    const url = new URL(value)

    url.username = role
    url.password = password

    return url.toString()
  } catch {
    throw new Error(
      'DB_RUNTIME_DATABASE_URL is required when MIGRATE_DATABASE_URL is not a URL.',
    )
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}
