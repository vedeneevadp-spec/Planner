import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import readline from 'node:readline'

import { npmCommand, runCommand } from './command-utils.mjs'

const npm = npmCommand()
const children = new Set()
const devApiBaseUrl = 'http://127.0.0.1:3001'
const devUserId = '11111111-1111-4111-8111-111111111111'
const devWorkspaceId = '22222222-2222-4222-8222-222222222222'
let shuttingDown = false

async function main() {
  await ensureDependencies()
  await runCommand(npm, ['run', 'db:up'])
  await runCommand(npm, ['run', 'db:migrate'])
  await runCommand(npm, ['run', 'db:seed'])

  console.log('')
  console.log('Dev runtime is ready.')
  console.log('API: http://127.0.0.1:3001')
  console.log('Web: http://127.0.0.1:5173')
  console.log('Press Ctrl+C to stop API and web.')
  console.log('')

  const api = startLongRunningCommand('api', ['run', 'dev:api:postgres'])
  const web = startLongRunningCommand(
    'web',
    [
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
      '--strictPort',
    ],
    {
      VITE_ACTOR_USER_ID: devUserId,
      VITE_API_BASE_URL: devApiBaseUrl,
      VITE_AUTH_PROVIDER: 'disabled',
      VITE_WORKSPACE_ID: devWorkspaceId,
    },
  )

  await Promise.race([waitForExit(api, 'api'), waitForExit(web, 'web')])
}

async function ensureDependencies() {
  if (existsSync('node_modules')) {
    return
  }

  console.log('node_modules not found. Installing dependencies with npm ci...')
  await runCommand(npm, ['ci'])
}

function startLongRunningCommand(label, args, env = {}) {
  const child = spawn(npm, args, {
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  children.add(child)
  pipeWithPrefix(label, child.stdout)
  pipeWithPrefix(label, child.stderr)
  child.once('exit', () => {
    children.delete(child)
  })

  return child
}

function pipeWithPrefix(label, stream) {
  const lines = readline.createInterface({ input: stream })

  lines.on('line', (line) => {
    console.log(`[${label}] ${line}`)
  })
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', async (code, signal) => {
      if (shuttingDown) {
        resolve()
        return
      }

      await shutdown(signal ?? 'SIGTERM')

      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          `${label} dev process exited with ${signal ?? `code ${code ?? 'unknown'}`}`,
        ),
      )
    })
  })
}

async function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve()
            return
          }

          child.once('exit', resolve)
          child.kill(signal)
          setTimeout(resolve, 3000)
        }),
    ),
  )
}

process.once('SIGINT', async () => {
  await shutdown('SIGINT')
  process.exit(0)
})

process.once('SIGTERM', async () => {
  await shutdown('SIGTERM')
  process.exit(0)
})

main().catch(async (error) => {
  await shutdown()
  console.error(error)
  process.exit(1)
})
