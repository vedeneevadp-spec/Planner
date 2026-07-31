import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Client } from 'pg'

import { runInfrastructureBackupCommand } from './infrastructure-backup-command.mjs'
import {
  createDatabaseUrl,
  createDrillDatabaseName,
  findLatestInfrastructureBackupSet,
  verifyInfrastructureBackupSet,
  writeJsonAtomic,
} from './infrastructure-backup-helpers.mjs'

const environment = process.env
const adminDatabaseUrl = environment.RESTORE_DRILL_ADMIN_DATABASE_URL?.trim()

if (!adminDatabaseUrl) {
  throw new Error(
    'RESTORE_DRILL_ADMIN_DATABASE_URL is required for an isolated restore drill.',
  )
}

const backupRoot = path.resolve(
  environment.INFRASTRUCTURE_BACKUP_DIR ??
    path.join(environment.DB_BACKUP_DIR ?? 'backups', 'infrastructure'),
)
const reportPath = path.resolve(
  environment.RESTORE_DRILL_STATUS_PATH ??
    path.join(backupRoot, 'restore-drill-status.json'),
)
const startedAt = new Date().toISOString()
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'planner-restore-drill-'),
)
const databaseName = createDrillDatabaseName()
const drillDatabaseUrl = createDatabaseUrl(adminDatabaseUrl, databaseName)
let databaseCreated = false
let drillRolesCreated = []

try {
  const backupSetDirectory = await resolveBackupSetDirectory(temporaryDirectory)
  const verified = await verifyInfrastructureBackupSet(backupSetDirectory, {
    runCommand: runInfrastructureBackupCommand,
  })

  drillRolesCreated = await ensureDrillRoles(adminDatabaseUrl)
  await runInfrastructureBackupCommand('createdb', [
    '--maintenance-db',
    adminDatabaseUrl,
    databaseName,
  ])
  databaseCreated = true

  await runInfrastructureBackupCommand('pg_restore', [
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    drillDatabaseUrl,
    verified.dumpPath,
  ])

  await runInfrastructureBackupCommand(
    process.execPath,
    ['scripts/db-migrate.mjs'],
    {
      env: {
        ...environment,
        DATABASE_URL: drillDatabaseUrl,
        MIGRATE_DATABASE_URL: drillDatabaseUrl,
        DB_MIGRATE_MODE: '',
      },
    },
  )

  const validation = await validateRestoredDatabase(
    drillDatabaseUrl,
    verified.assetDirectory,
  )
  const completedAt = new Date().toISOString()

  await writeJsonAtomic(reportPath, {
    backupId: verified.manifest.backupId,
    completedAt,
    database: {
      invalidConstraints: validation.invalidConstraints,
      migrationCount: validation.migrationCount,
      userCount: validation.userCount,
      workspaceCount: validation.workspaceCount,
    },
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    restoredAssetReferences: validation.assetReferenceCount,
    startedAt,
    status: 'success',
  })
  console.log(
    `[backup] Restore drill succeeded for ${verified.manifest.backupId}.`,
  )
} catch (error) {
  await writeJsonAtomic(reportPath, {
    error: error instanceof Error ? error.message : String(error),
    failedAt: new Date().toISOString(),
    startedAt,
    status: 'failed',
  }).catch(() => undefined)
  throw error
} finally {
  if (databaseCreated) {
    await runInfrastructureBackupCommand('dropdb', [
      '--maintenance-db',
      adminDatabaseUrl,
      '--force',
      '--if-exists',
      databaseName,
    ]).catch((error) => {
      console.error(
        `[backup] Failed to remove restore drill database ${databaseName}:`,
        error,
      )
    })
  }

  if (drillRolesCreated.length > 0) {
    await removeDrillRoles(adminDatabaseUrl, drillRolesCreated).catch(
      (error) => {
        console.error(
          '[backup] Failed to remove temporary restore drill roles:',
          error,
        )
      },
    )
  }

  await rm(temporaryDirectory, { force: true, recursive: true })
}

async function resolveBackupSetDirectory(restoreRoot) {
  if (environment.BACKUP_SET_DIR?.trim()) {
    return path.resolve(environment.BACKUP_SET_DIR)
  }

  if (!environment.RESTIC_REPOSITORY?.trim()) {
    const latest = await findLatestInfrastructureBackupSet(backupRoot)

    return latest.directory
  }

  await runInfrastructureBackupCommand('restic', [
    'restore',
    'latest',
    '--tag',
    'planner',
    '--tag',
    'kind:infrastructure',
    '--target',
    restoreRoot,
  ])

  const latest = await findLatestInfrastructureBackupSet(restoreRoot)

  return latest.directory
}

async function validateRestoredDatabase(connectionString, assetDirectory) {
  const client = new Client({ connectionString })

  await client.connect()

  try {
    const summary = await client.query(`
      select
        (select count(*)::int from app.schema_migrations) as migration_count,
        (select count(*)::int from app.users) as user_count,
        (select count(*)::int from app.workspaces) as workspace_count,
        (
          select count(*)::int
          from pg_constraint
          where convalidated is false
        ) as invalid_constraints
    `)
    const references = await client.query(`
      select avatar_url as value, 'profile' as kind
      from app.users
      where avatar_url like '%/api/v1/profile-assets/%'
      union all
      select value, 'icon' as kind
      from app.emoji_assets
      where value like '%/api/v1/icon-assets/%'
    `)

    for (const reference of references.rows) {
      const fileName = extractAssetFileName(reference.value)
      const relativePath =
        reference.kind === 'profile'
          ? path.join('profiles', fileName)
          : fileName

      try {
        await access(path.join(assetDirectory, relativePath))
      } catch {
        throw new Error(
          `Restored database references a missing asset: ${reference.value}`,
        )
      }
    }

    const row = summary.rows[0]

    if (!row || row.invalid_constraints !== 0) {
      throw new Error('Restored database contains invalid constraints.')
    }

    return {
      assetReferenceCount: references.rowCount ?? references.rows.length,
      invalidConstraints: row.invalid_constraints,
      migrationCount: row.migration_count,
      userCount: row.user_count,
      workspaceCount: row.workspace_count,
    }
  } finally {
    await client.end()
  }
}

async function ensureDrillRoles(connectionString) {
  const client = new Client({ connectionString })
  const requiredRoles = ['authenticated']
  const createdRoles = []

  await client.connect()

  try {
    const existing = await client.query(
      'select rolname from pg_roles where rolname = any($1::text[])',
      [requiredRoles],
    )
    const existingRoleNames = new Set(existing.rows.map((row) => row.rolname))

    for (const roleName of requiredRoles) {
      if (existingRoleNames.has(roleName)) {
        continue
      }

      await client.query(`create role ${quoteIdentifier(roleName)} nologin`)
      createdRoles.push(roleName)
    }

    return createdRoles
  } finally {
    await client.end()
  }
}

async function removeDrillRoles(connectionString, roleNames) {
  const client = new Client({ connectionString })

  await client.connect()

  try {
    for (const roleName of roleNames) {
      await client.query(`drop role if exists ${quoteIdentifier(roleName)}`)
    }
  } finally {
    await client.end()
  }
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe Postgres identifier: ${value}`)
  }

  return `"${value}"`
}

function extractAssetFileName(value) {
  const fileName = String(value).split('/').pop()

  if (!fileName || !/^[a-z0-9][a-z0-9._-]*$/i.test(fileName)) {
    throw new Error(`Unsafe restored asset path: ${String(value)}`)
  }

  return fileName
}
