import { execFileSync } from 'node:child_process'
import { lstat, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'

import { runInfrastructureBackupCommand } from './infrastructure-backup-command.mjs'
import {
  INFRASTRUCTURE_BACKUP_DIRECTORY_PATTERN,
  verifyInfrastructureBackupSet,
} from './infrastructure-backup-helpers.mjs'
import { createPgConnectionConfig } from './pg-connection-config.mjs'

const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000

export async function planAssetCollection({
  assetDirectory,
  liveReferences,
  backupReferences,
  now = Date.now(),
}) {
  const retained = new Set([...liveReferences, ...backupReferences])
  const candidates = []
  async function scan(relative = '') {
    const directory = path.join(assetDirectory, relative)
    if (
      !(await lstat(directory)).isDirectory() ||
      (await lstat(directory)).isSymbolicLink()
    ) {
      throw new Error(
        'Asset directories must be real directories, not symlinks.',
      )
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name
      const file = await lstat(path.join(assetDirectory, name))
      if (file.isSymbolicLink())
        throw new Error(`Symlink in asset tree: ${name}`)
      if (file.isDirectory()) {
        await scan(name)
        continue
      }
      if (!file.isFile()) throw new Error(`Unsupported asset: ${name}`)
      if (retained.has(name) || now - file.mtimeMs < MIN_AGE_MS) continue
      candidates.push({
        path: name,
        bytes: file.size,
        mtimeMs: file.mtimeMs,
        ino: file.ino,
      })
    }
  }
  await scan()
  return candidates.sort((a, b) => a.path.localeCompare(b.path))
}

export async function applyAssetCollection(assetDirectory, plan) {
  for (const entry of plan) {
    const target = path.resolve(assetDirectory, entry.path)
    if (!target.startsWith(`${path.resolve(assetDirectory)}${path.sep}`))
      throw new Error('Unsafe asset path.')
    const current = await lstat(target)
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.ino !== entry.ino ||
      current.size !== entry.bytes ||
      current.mtimeMs !== entry.mtimeMs
    ) {
      throw new Error(`Asset changed since scan: ${entry.path}`)
    }
    await unlink(target)
  }
}

export function assertNoOtherDatabaseSessions(rows) {
  if (rows.length)
    throw new Error(
      'Asset collection requires all API, restore, worker and backup connections to be stopped.',
    )
}

export async function readOtherDatabaseSessions(client) {
  // pg_stat_activity is cached within a transaction, independently of MVCC.
  // Refresh that cache so the final check notices newly opened connections.
  await client.query('select pg_stat_clear_snapshot()')
  return (
    await client.query(
      "select pid from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend'",
    )
  ).rows
}

function assetPath(value, prefix) {
  const url = new URL(value, 'https://planner.invalid')
  if (!url.pathname.startsWith(prefix))
    throw new Error('Unexpected asset reference.')
  const name = decodeURIComponent(url.pathname.slice(prefix.length))
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === '..')
    throw new Error('Unsafe asset reference.')
  return prefix.includes('profile-assets') ? `profiles/${name}` : name
}

async function main() {
  const assetDirectory = path.resolve(process.env.API_ICON_ASSET_DIR ?? '')
  const backupRoot = path.resolve(process.env.INFRASTRUCTURE_BACKUP_DIR ?? '')
  if (
    !process.env.API_ICON_ASSET_DIR ||
    !process.env.INFRASTRUCTURE_BACKUP_DIR ||
    !process.env.DATABASE_URL
  ) {
    throw new Error(
      'API_ICON_ASSET_DIR, INFRASTRUCTURE_BACKUP_DIR and DATABASE_URL are required. Default is dry-run; --apply requires stopped services.',
    )
  }
  if (
    backupRoot.startsWith(`${assetDirectory}${path.sep}`) ||
    assetDirectory.startsWith(`${backupRoot}${path.sep}`) ||
    assetDirectory === backupRoot
  ) {
    throw new Error('Asset and backup directories must be separate.')
  }
  const apply = process.argv.includes('--apply')
  if (apply) {
    // Explicit offline maintenance, not a background deletion job. Unit state
    // plus database quiescence prevents unknown in-flight upload/restore commits.
    for (const unit of [
      'planner-api.service',
      'planner-user-backup-restore.service',
      'planner-task-reminders.service',
      'planner-backup.service',
      'planner-backup.timer',
      'planner-backup-prune.service',
      'planner-backup-prune.timer',
      'planner-restore-drill.service',
      'planner-restore-drill.timer',
    ]) {
      const state = execFileSync(
        'systemctl',
        ['show', '--property=ActiveState', '--value', unit],
        { encoding: 'utf8' },
      ).trim()
      if (state !== 'inactive' && state !== 'failed')
        throw new Error(`Stop ${unit} before --apply.`)
    }
  }
  const backupReferences = new Set()
  let backups = 0
  for (const entry of await readdir(backupRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.incomplete-'))
      throw new Error(
        'An incomplete backup must be resolved before asset collection.',
      )
    if (
      !entry.isDirectory() ||
      !INFRASTRUCTURE_BACKUP_DIRECTORY_PATTERN.test(entry.name)
    )
      continue
    const { manifest } = await verifyInfrastructureBackupSet(
      path.join(backupRoot, entry.name),
      { runCommand: runInfrastructureBackupCommand },
    )
    for (const reference of manifest.assets.references ??
      manifest.assets.files.map((file) => file.path))
      backupReferences.add(reference)
    backups++
  }
  if (!backups)
    throw new Error(
      'At least one verified local infrastructure backup is required.',
    )
  const client = new Client(createPgConnectionConfig(process.env.DATABASE_URL))
  await client.connect()
  try {
    const access = await client.query(`
      select count(*)::int as readable_tables from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      join pg_roles r on r.rolname=current_user
      where n.nspname='app' and c.relname in ('users', 'emoji_assets')
        and has_table_privilege(c.oid, 'SELECT')
        and (r.rolsuper or r.rolbypassrls or
          (c.relowner=r.oid and not c.relforcerowsecurity))
    `)
    if (access.rows[0]?.readable_tables !== 2)
      throw new Error(
        'Asset collection requires an owner/BYPASSRLS connection with complete user and icon references.',
      )
    await client.query('begin isolation level repeatable read read only')
    if (apply)
      assertNoOtherDatabaseSessions(await readOtherDatabaseSessions(client))
    const { rows } =
      await client.query(`select avatar_url as value, '/api/v1/profile-assets/' as prefix from app.users where avatar_url like '%/api/v1/profile-assets/%'
      union all select value, '/api/v1/icon-assets/' as prefix from app.emoji_assets where value like '%/api/v1/icon-assets/%'`)
    const plan = await planAssetCollection({
      assetDirectory,
      liveReferences: rows.map((row) => assetPath(row.value, row.prefix)),
      backupReferences,
    })
    if (apply) {
      assertNoOtherDatabaseSessions(await readOtherDatabaseSessions(client))
      await applyAssetCollection(assetDirectory, plan)
    }
    console.log(
      JSON.stringify(
        {
          mode: apply ? 'applied' : 'dry-run',
          verifiedBackups: backups,
          bytes: plan.reduce((total, file) => total + file.bytes, 0),
          files: plan.map((file) => file.path),
        },
        null,
        2,
      ),
    )
  } finally {
    try {
      await client.query('rollback')
    } finally {
      await client.end()
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
