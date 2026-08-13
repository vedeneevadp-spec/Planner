import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const backupConnectionString = process.env.BACKUP_DATABASE_URL?.trim()
const ownerConnectionString = (
  process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL
)?.trim()

if (!backupConnectionString) {
  throw new Error('BACKUP_DATABASE_URL is required.')
}

if (!ownerConnectionString) {
  throw new Error('MIGRATE_DATABASE_URL is required for backup verification.')
}

if (backupConnectionString === ownerConnectionString) {
  throw new Error(
    'BACKUP_DATABASE_URL must not reuse the migration/owner connection.',
  )
}

const owner = new Client(createPgConnectionConfig(ownerConnectionString))
const backup = new Client(createPgConnectionConfig(backupConnectionString))

try {
  await owner.connect()
  await preparePgAdminConnection(owner)
  await backup.connect()

  const ownerIdentity = await readIdentity(owner)
  const backupIdentity = await readIdentity(backup)

  if (backupIdentity.roleName === ownerIdentity.roleName) {
    throw new Error('Backup database must use a dedicated login role.')
  }

  if (
    backupIdentity.superuser ||
    backupIdentity.createDatabase ||
    backupIdentity.createRole ||
    backupIdentity.bypassRls ||
    backupIdentity.replication
  ) {
    throw new Error(
      `Backup role ${backupIdentity.roleName} has privileged PostgreSQL role attributes.`,
    )
  }

  const databaseAccess = await readDatabaseAccess(
    owner,
    backupIdentity.roleName,
  )

  if (databaseAccess.canCreateInAppSchema) {
    throw new Error(
      `Backup role ${backupIdentity.roleName} can create objects in schema app.`,
    )
  }

  await owner.query('begin isolation level repeatable read read only')
  const snapshotResult = await owner.query('select pg_export_snapshot() as id')
  const snapshotId = snapshotResult.rows[0]?.id

  if (!snapshotId) {
    throw new Error('Could not export a production verification snapshot.')
  }

  await backup.query('begin isolation level repeatable read read only')
  await backup.query(`set transaction snapshot ${quoteLiteral(snapshotId)}`)

  const relations = await readAppRelations(owner, backupIdentity.roleName)
  const missingSelect = relations
    .filter((relation) => !relation.canSelect)
    .map((relation) => relation.name)
  const writableRelations = relations
    .filter((relation) => relation.canWrite)
    .map((relation) => relation.name)
  const missingBackupPolicies = relations
    .filter((relation) => relation.rlsEnabled && !relation.hasBackupPolicy)
    .map((relation) => relation.name)

  if (missingSelect.length > 0) {
    throw new Error(
      `Backup role lacks SELECT on app relations: ${missingSelect.join(', ')}.`,
    )
  }

  if (writableRelations.length > 0) {
    throw new Error(
      `Backup role has write privileges on app relations: ${writableRelations.join(', ')}.`,
    )
  }

  const sequenceAccess = await readAppSequences(owner, backupIdentity.roleName)
  const unreadableSequences = sequenceAccess
    .filter((sequence) => !sequence.canSelect)
    .map((sequence) => sequence.name)
  const writableSequences = sequenceAccess
    .filter((sequence) => sequence.canWrite)
    .map((sequence) => sequence.name)

  if (unreadableSequences.length > 0) {
    throw new Error(
      `Backup role lacks SELECT on app sequences: ${unreadableSequences.join(', ')}.`,
    )
  }

  if (writableSequences.length > 0) {
    throw new Error(
      `Backup role can advance app sequences: ${writableSequences.join(', ')}.`,
    )
  }

  if (missingBackupPolicies.length > 0) {
    throw new Error(
      `RLS relations lack planner_backup_select_all: ${missingBackupPolicies.join(', ')}.`,
    )
  }

  const executableFunctions = await readExecutableAppFunctions(
    owner,
    backupIdentity.roleName,
  )

  if (executableFunctions.length > 0) {
    throw new Error(
      `Backup role can execute app functions: ${executableFunctions.join(', ')}.`,
    )
  }

  for (const relation of relations) {
    const relationName = `app.${quoteIdentifier(relation.name)}`
    const [ownerCount, backupCount] = await Promise.all([
      owner.query(`select count(*)::bigint as count from ${relationName}`),
      backup.query(`select count(*)::bigint as count from ${relationName}`),
    ])
    const expected = ownerCount.rows[0]?.count
    const actual = backupCount.rows[0]?.count

    if (actual !== expected) {
      throw new Error(
        `Backup role sees ${actual ?? 'unknown'} rows in app.${relation.name}; expected ${expected ?? 'unknown'} from the same snapshot.`,
      )
    }
  }

  await backup.query('rollback')
  await owner.query('rollback')

  console.log(
    `Backup database check passed for ${relations.length} app relations as ${backupIdentity.roleName}.`,
  )
} catch (error) {
  await backup.query('rollback').catch(() => undefined)
  await owner.query('rollback').catch(() => undefined)
  throw error
} finally {
  await closePgClient(backup)
  await closePgClient(owner)
}

async function readIdentity(client) {
  const result = await client.query(`
    select
      current_user as role_name,
      roles.rolsuper as superuser,
      roles.rolcreatedb as create_database,
      roles.rolcreaterole as create_role,
      roles.rolbypassrls as bypass_rls,
      roles.rolreplication as replication
    from pg_roles roles
    where roles.rolname = current_user
  `)
  const row = result.rows[0]

  if (!row) {
    throw new Error('Could not resolve PostgreSQL role attributes.')
  }

  return {
    bypassRls: row.bypass_rls,
    createDatabase: row.create_database,
    createRole: row.create_role,
    replication: row.replication,
    roleName: row.role_name,
    superuser: row.superuser,
  }
}

async function readAppRelations(client, roleName) {
  const result = await client.query(
    `
      select
        relation.relname as name,
        relation.relrowsecurity as rls_enabled,
        has_table_privilege($1, relation.oid, 'SELECT') as can_select,
        (
          has_table_privilege($1, relation.oid, 'INSERT')
          or has_table_privilege($1, relation.oid, 'UPDATE')
          or has_table_privilege($1, relation.oid, 'DELETE')
          or has_table_privilege($1, relation.oid, 'TRUNCATE')
          or has_table_privilege($1, relation.oid, 'REFERENCES')
          or has_table_privilege($1, relation.oid, 'TRIGGER')
        ) as can_write,
        exists (
          select 1
          from pg_policy policy
          where policy.polrelid = relation.oid
            and policy.polname = 'planner_backup_select_all'
            and policy.polcmd in ('*', 'r')
        ) as has_backup_policy
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relkind in ('p', 'r')
      order by relation.relname
    `,
    [roleName],
  )

  return result.rows.map((row) => ({
    canSelect: row.can_select,
    canWrite: row.can_write,
    hasBackupPolicy: row.has_backup_policy,
    name: row.name,
    rlsEnabled: row.rls_enabled,
  }))
}

async function readAppSequences(client, roleName) {
  const result = await client.query(
    `
      select
        relation.relname as name,
        has_sequence_privilege($1, relation.oid, 'SELECT') as can_select,
        (
          has_sequence_privilege($1, relation.oid, 'USAGE')
          or has_sequence_privilege($1, relation.oid, 'UPDATE')
        ) as can_write
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relkind = 'S'
      order by relation.relname
    `,
    [roleName],
  )

  return result.rows.map((row) => ({
    canSelect: row.can_select,
    canWrite: row.can_write,
    name: row.name,
  }))
}

async function readDatabaseAccess(client, roleName) {
  const result = await client.query(
    `
      select has_schema_privilege($1, 'app', 'CREATE') as can_create_in_app_schema
    `,
    [roleName],
  )

  return {
    canCreateInAppSchema: result.rows[0]?.can_create_in_app_schema === true,
  }
}

async function readExecutableAppFunctions(client, roleName) {
  const result = await client.query(
    `
      select
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid) as arguments
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and has_function_privilege($1, procedure.oid, 'EXECUTE')
      order by procedure.proname, arguments
    `,
    [roleName],
  )

  return result.rows.map((row) => `app.${row.proname}(${row.arguments})`)
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}
