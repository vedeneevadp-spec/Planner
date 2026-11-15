import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { runInfrastructureBackupCommand } from './infrastructure-backup-command.mjs'

import {
  hashFile,
  pruneDeployDatabaseBackups,
  readPositiveInteger,
  writeJsonAtomic,
} from './infrastructure-backup-helpers.mjs'

const connectionString =
  process.env.BACKUP_DATABASE_URL ??
  process.env.MIGRATE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const pgDumpConnectionString = createPgDumpConnectionString(connectionString)
const backupDirectory = process.env.DB_BACKUP_DIR ?? 'backups'
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const outputPath = path.join(backupDirectory, `planner-${timestamp}.dump`)

await mkdir(backupDirectory, { recursive: true })
await run('pg_dump', [
  '--format=custom',
  '--enable-row-security',
  '--no-owner',
  '--no-privileges',
  '--file',
  outputPath,
  pgDumpConnectionString,
])
await chmod(outputPath, 0o600)
await run('pg_restore', ['--list', outputPath], { stdio: 'ignore' })

const digest = await hashFile(outputPath)
const metadata = await stat(outputPath)
const pgDumpVersion = await collect('pg_dump', ['--version'])

await writeFile(
  `${outputPath}.sha256`,
  `${digest}  ${path.basename(outputPath)}\n`,
  {
    mode: 0o600,
  },
)
await writeJsonAtomic(`${outputPath}.manifest.json`, {
  completedAt: new Date().toISOString(),
  dumpByteLength: metadata.size,
  dumpFile: path.basename(outputPath),
  dumpSha256: digest,
  format: 'planner.deploy-database-backup',
  pgDumpVersion,
  version: 1,
})

const keepCount = readPositiveInteger(
  process.env.DB_DEPLOY_BACKUP_KEEP,
  'DB_DEPLOY_BACKUP_KEEP',
  10,
)
const removed = await pruneDeployDatabaseBackups(backupDirectory, keepCount)

console.log(
  `Database backup written and verified: ${outputPath} (removed ${removed.length} expired backup(s))`,
)

function run(command, args, options = {}) {
  return runInfrastructureBackupCommand(command, args, options)
}

function collect(command, args) {
  return runInfrastructureBackupCommand(command, args, { capture: true })
}

function createPgDumpConnectionString(value) {
  const url = new URL(value)
  url.searchParams.delete('uselibpqcompat')
  return url.toString()
}
