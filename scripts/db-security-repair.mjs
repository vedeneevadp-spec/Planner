import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const connectionString =
  process.env.MIGRATE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const args = new Set(process.argv.slice(2))
const dryRun =
  args.has('--dry-run') || process.env.DB_SECURITY_REPAIR_DRY_RUN === '1'
const internalTables = [
  'device_sessions',
  'outbox',
  'schema_migrations',
  'sync_cursors',
]
const revokedRoles = ['authenticated', 'public']

if (args.has('--help') || args.has('-h')) {
  printHelp()
  process.exit(0)
}

const client = new Client(createPgConnectionConfig(connectionString))

try {
  await client.connect()
  await preparePgAdminConnection(client)

  const before = await readInternalTableGrants(client)
  const owners = await readInternalTableOwners(client)
  const statements = createRepairStatements(owners)

  if (dryRun) {
    console.log('Database security repair dry run.')
    console.log(formatGrantSummary('Current grants', before))
    console.log(
      statements.map((statement) => `Would run: ${statement}`).join('\n'),
    )
    process.exit(0)
  }

  for (const statement of statements) {
    await client.query(statement)
  }

  const after = await readInternalTableGrants(client)

  if (after.length > 0) {
    throw new Error(
      [
        'Database security repair did not remove all internal table grants:',
        formatGrantRows(after),
      ].join(' '),
    )
  }

  console.log(formatGrantSummary('Removed grants', before))
  console.log('Database security repair completed.')
} finally {
  await closePgClient(client)
}

async function readInternalTableGrants(client) {
  const result = await client.query(
    `
      select table_name, grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'app'
         and table_name = any($1::text[])
         and lower(grantee) = any($2::text[])
       order by table_name, grantee, privilege_type
    `,
    [internalTables, revokedRoles],
  )

  return result.rows.map((row) => ({
    grantee: String(row.grantee),
    privilegeType: String(row.privilege_type),
    tableName: String(row.table_name),
  }))
}

async function readInternalTableOwners(client) {
  const result = await client.query(
    `
      select distinct pg_get_userbyid(pg_class.relowner) as owner_name
        from pg_class
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
       where pg_namespace.nspname = 'app'
         and pg_class.relkind in ('r', 'p')
         and pg_class.relname = any($1::text[])
       order by owner_name
    `,
    [internalTables],
  )

  return result.rows
    .map((row) => row.owner_name)
    .filter((ownerName) => typeof ownerName === 'string' && ownerName.length)
}

function createRepairStatements(owners) {
  const tableList = internalTables
    .map((tableName) => `app.${quoteIdentifier(tableName)}`)
    .join(', ')
  const statements = revokedRoles.map(
    (role) =>
      `revoke all privileges on table ${tableList} from ${quoteGrantRole(role)}`,
  )

  for (const owner of owners) {
    for (const role of revokedRoles) {
      statements.push(
        [
          'alter default privileges',
          `for role ${quoteIdentifier(owner)}`,
          'in schema app',
          `revoke all privileges on tables from ${quoteGrantRole(role)}`,
        ].join(' '),
      )
    }
  }

  return statements
}

function formatGrantSummary(label, grants) {
  return `${label}: ${grants.length === 0 ? 'none' : formatGrantRows(grants)}`
}

function formatGrantRows(grants) {
  return grants
    .map(
      (grant) =>
        `app.${grant.tableName}:${grant.grantee}:${grant.privilegeType}`,
    )
    .join(', ')
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function quoteGrantRole(value) {
  return value.toLowerCase() === 'public' ? 'public' : quoteIdentifier(value)
}

function printHelp() {
  console.log(`
Usage:
  npm run db:security:repair
  npm run db:security:repair -- --dry-run

Environment:
  MIGRATE_DATABASE_URL  Preferred owner/admin database URL.
  DATABASE_URL          Fallback database URL.

Repairs:
  Revokes direct authenticated/public privileges from internal app tables and
  removes matching default table privileges for the current internal table
  owners. Run npm run db:security:check after repair.
`)
}
