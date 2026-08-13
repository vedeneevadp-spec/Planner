import { spawn } from 'node:child_process'
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

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

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? 'inherit',
    })

    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            `${command} was not found. Install PostgreSQL client tools matching the server version; do not skip a production backup without a verified restore point.`,
          ),
        )
        return
      }

      reject(error)
    })
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          `${formatCommand(command, args)} failed with exit code ${code ?? 'unknown'}`,
        ),
      )
    })
  })
}

async function collect(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      reject(
        new Error(
          `${command} failed with exit code ${code ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
        ),
      )
    })
  })
}

function createPgDumpConnectionString(value) {
  try {
    const url = new URL(value)

    url.searchParams.delete('uselibpqcompat')

    return url.toString()
  } catch {
    return value
      .replace(/([?&])uselibpqcompat=true(&|$)/, '$1')
      .replace(/[?&]$/, '')
  }
}

function formatCommand(command, args) {
  return [
    command,
    ...args.map((arg) =>
      arg === pgDumpConnectionString ? redactConnectionString(arg) : arg,
    ),
  ].join(' ')
}

function redactConnectionString(value) {
  try {
    const url = new URL(value)

    if (url.password) {
      url.password = '***'
    }

    return url.toString()
  } catch {
    return '<redacted-database-url>'
  }
}
