import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const requireRuntimeNonOwner = process.env.DB_SECURITY_REQUIRE_NON_OWNER === '1'
const rlsMode = normalizeRlsMode(process.env.API_DB_RLS_MODE)

const protectedTables = [
  'chaos_inbox_items',
  'daily_plans',
  'emoji_assets',
  'emoji_sets',
  'life_spheres',
  'projects',
  'push_devices',
  'task_reminders',
  'task_templates',
  'task_time_blocks',
  'tasks',
  'workspace_members',
  'workspaces',
]

const client = new Client(createPgConnectionConfig(connectionString))

try {
  await client.connect()
  await preparePgAdminConnection(client)

  const rlsResult = await client.query(
    `
      select relname as table_name, relrowsecurity as rls_enabled
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'app'
        and relname = any($1)
      order by relname
    `,
    [protectedTables],
  )
  const rlsByTable = new Map(
    rlsResult.rows.map((row) => [row.table_name, row.rls_enabled]),
  )

  for (const tableName of protectedTables) {
    if (!rlsByTable.get(tableName)) {
      throw new Error(`RLS is not enabled for app.${tableName}.`)
    }
  }

  const ownerResult = await client.query(
    `
      select current_user = tableowner as is_owner, tablename
      from pg_tables
      where schemaname = 'app'
        and tablename = any($1)
      order by tablename
    `,
    [protectedTables],
  )
  const ownedTables = ownerResult.rows
    .filter((row) => row.is_owner)
    .map((row) => row.tablename)

  if (ownedTables.length > 0) {
    const message = `Current DB user owns protected app tables: ${ownedTables.join(', ')}. Use a non-owner runtime DB role for stricter RLS enforcement.`

    if (requireRuntimeNonOwner) {
      throw new Error(message)
    }

    console.warn(`[db-security] ${message}`)
  }

  await verifyRuntimeRlsMode(client, rlsMode)

  console.log('Database security check passed.')
} finally {
  await closePgClient(client)
}

function normalizeRlsMode(value) {
  const normalized = value?.trim().toLowerCase() || 'transaction_local'

  if (normalized === 'enabled') {
    return 'transaction_local'
  }

  if (
    normalized === 'claims_only' ||
    normalized === 'disabled' ||
    normalized === 'session_connection' ||
    normalized === 'transaction_local'
  ) {
    return normalized
  }

  throw new Error(`Invalid API_DB_RLS_MODE: ${value}`)
}

async function verifyRuntimeRlsMode(client, mode) {
  if (mode === 'disabled') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'API_DB_RLS_MODE=disabled is not allowed when NODE_ENV=production.',
      )
    }

    console.warn(
      '[db-security] API_DB_RLS_MODE=disabled skips DB RLS runtime enforcement.',
    )
    return
  }

  if (mode === 'claims_only') {
    console.warn(
      '[db-security] API_DB_RLS_MODE=claims_only sets request.jwt.claims but does not SET ROLE authenticated. Use transaction_local after the runtime DB role can SET ROLE authenticated.',
    )
    return
  }

  const roleResult = await client.query(
    `
      select
        pg_has_role(current_user, 'authenticated', 'member') as is_member,
        pg_has_role(current_user, 'authenticated', 'set') as can_set_role
    `,
  )
  const roleState = roleResult.rows[0]

  if (!roleState?.is_member || !roleState.can_set_role) {
    throw new Error(
      'API_DB_RLS_MODE=transaction_local requires the runtime DB user to be a member of role authenticated and to be allowed to SET ROLE authenticated.',
    )
  }

  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query('rollback')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}
