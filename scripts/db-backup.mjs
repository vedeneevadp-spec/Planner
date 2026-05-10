import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const pgDumpConnectionString = createPgDumpConnectionString(connectionString)
const backupDirectory = process.env.DB_BACKUP_DIR ?? 'backups'
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const outputPath = path.join(backupDirectory, `planner-${timestamp}.dump`)

await mkdir(backupDirectory, { recursive: true })
await run('pg_dump', [
  '--format=custom',
  '--no-owner',
  '--no-privileges',
  '--file',
  outputPath,
  pgDumpConnectionString,
])

console.log(`Database backup written to ${outputPath}`)

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
    })

    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            'pg_dump was not found. Install PostgreSQL client tools or set DEPLOY_SKIP_DB_BACKUP=1 for deploys that use provider snapshots.',
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
