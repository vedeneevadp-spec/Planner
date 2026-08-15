import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'
import {
  internalAppTables,
  restrictedAppFunctionRoles,
} from './db-security-repair-config.mjs'

const connectionString =
  process.env.MIGRATE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const args = new Set(process.argv.slice(2))
const dryRun =
  args.has('--dry-run') || process.env.DB_SECURITY_REPAIR_DRY_RUN === '1'
const revokedTableRoles = ['authenticated', 'public']

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
  const availableFunctionRoles = await readAvailableRoles(
    client,
    restrictedAppFunctionRoles,
  )
  const beforeFunctionGrants = await readRestrictedAppFunctionGrants(
    client,
    availableFunctionRoles,
  )
  const statements = createRepairStatements(owners, availableFunctionRoles)

  if (dryRun) {
    console.log('Database security repair dry run.')
    console.log(formatGrantSummary('Current grants', before))
    console.log(
      `Restricted app function grants: ${beforeFunctionGrants.length}`,
    )
    console.log(
      statements.map((statement) => `Would run: ${statement}`).join('\n'),
    )
    process.exit(0)
  }

  for (const statement of statements) {
    await client.query(statement)
  }

  const after = await readInternalTableGrants(client)
  const afterFunctionGrants = await readRestrictedAppFunctionGrants(
    client,
    availableFunctionRoles,
  )

  if (after.length > 0) {
    throw new Error(
      [
        'Database security repair did not remove all internal table grants:',
        formatGrantRows(after),
      ].join(' '),
    )
  }

  if (afterFunctionGrants.length > 0) {
    throw new Error(
      [
        'Database security repair did not remove restricted app function grants:',
        formatFunctionGrantRows(afterFunctionGrants),
      ].join(' '),
    )
  }

  console.log(formatGrantSummary('Removed grants', before))
  console.log(
    `Removed restricted app function grants: ${beforeFunctionGrants.length}`,
  )
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
    [internalAppTables, revokedTableRoles],
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
    [internalAppTables],
  )

  return result.rows
    .map((row) => row.owner_name)
    .filter((ownerName) => typeof ownerName === 'string' && ownerName.length)
}

function createRepairStatements(owners, availableFunctionRoles) {
  const tableList = internalAppTables
    .map((tableName) => `app.${quoteIdentifier(tableName)}`)
    .join(', ')
  const statements = revokedTableRoles.map(
    (role) =>
      `revoke all privileges on table ${tableList} from ${quoteGrantRole(role)}`,
  )

  for (const owner of owners) {
    for (const role of revokedTableRoles) {
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

  for (const role of availableFunctionRoles) {
    statements.push(
      `revoke execute on all functions in schema app from ${quoteGrantRole(role)}`,
    )
  }

  return statements
}

async function readAvailableRoles(client, roleNames) {
  const databaseRoles = roleNames.filter((roleName) => roleName !== 'public')
  const result = await client.query(
    `
      select rolname
        from pg_roles
       where rolname = any($1::text[])
       order by rolname
    `,
    [databaseRoles],
  )
  const existingRoles = new Set(result.rows.map((row) => String(row.rolname)))

  return roleNames.filter(
    (roleName) => roleName === 'public' || existingRoles.has(roleName),
  )
}

async function readRestrictedAppFunctionGrants(client, roleNames) {
  if (roleNames.length === 0) {
    return []
  }

  const result = await client.query(
    `
      select
        procedure.oid::regprocedure::text as function_name,
        restricted.role_name
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      cross join unnest($1::text[]) as restricted(role_name)
      where namespace.nspname = 'app'
        and (
          (
            restricted.role_name = 'public'
            and exists (
              select 1
              from aclexplode(
                coalesce(
                  procedure.proacl,
                  acldefault('f', procedure.proowner)
                )
              ) as privilege
              where privilege.grantee = 0
                and privilege.privilege_type = 'EXECUTE'
            )
          )
          or (
            restricted.role_name <> 'public'
            and has_function_privilege(
              restricted.role_name,
              procedure.oid,
              'EXECUTE'
            )
          )
        )
      order by function_name, restricted.role_name
    `,
    [roleNames],
  )

  return result.rows.map((row) => ({
    functionName: String(row.function_name),
    roleName: String(row.role_name),
  }))
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

function formatFunctionGrantRows(grants) {
  return grants
    .map((grant) => `${grant.functionName}:${grant.roleName}:EXECUTE`)
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
  owners. Also revokes EXECUTE on app functions from PUBLIC and the production
  backup role. Run npm run db:security:check after repair.
`)
}
