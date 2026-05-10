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

  console.log('Database security check passed.')
} finally {
  await closePgClient(client)
}
