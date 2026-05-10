import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
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
  connectionString,
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
          `${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`,
        ),
      )
    })
  })
}
