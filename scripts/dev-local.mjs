import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import readline from 'node:readline'
import { promisify } from 'node:util'

import { npmCommand, runCommand } from './command-utils.mjs'

const npm = npmCommand()
const execFileAsync = promisify(execFile)
const children = new Set()
const apiBaseUrl = 'http://127.0.0.1:3001'
const webBaseUrl = 'http://127.0.0.1:5173'
const devPorts = [
  { name: 'API', port: 3001 },
  { name: 'web', port: 5173 },
]
const devUserId = '11111111-1111-4111-8111-111111111111'
const devWorkspaceId = '22222222-2222-4222-8222-222222222222'
const repoRoot = process.cwd()
let shuttingDown = false

async function main() {
  await ensureDependencies()
  await ensureDevPortsAreFree()
  await runCommand(npm, ['run', 'db:up'])
  await runCommand(npm, ['run', 'db:migrate'])
  await runCommand(npm, ['run', 'db:seed'])

  console.log('')
  console.log('Dev runtime is ready.')
  console.log(`API: ${apiBaseUrl}`)
  console.log(`Web: ${webBaseUrl}`)
  console.log('Database: local Docker Postgres.')
  console.log('Press Ctrl+C to stop API and web.')
  console.log('')

  const api = startLongRunningCommand('api', ['run', 'dev:api:postgres'], {
    API_PORT: '3001',
  })
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
      VITE_API_BASE_URL: apiBaseUrl,
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

async function ensureDevPortsAreFree() {
  for (const { name, port } of devPorts) {
    const processes = await getListeningProcesses(port)

    for (const processInfo of processes) {
      if (!isPlannerDevProcess(processInfo.command)) {
        throw new Error(
          `${name} port ${port} is already used by another process: ${processInfo.pid} ${processInfo.command}`,
        )
      }

      console.log(
        `Stopping previous ${name} dev process on port ${port} (pid ${processInfo.pid}).`,
      )
      await stopProcess(processInfo.pid)
    }

    await waitForPortToBeFree(port)
  }
}

async function getListeningProcesses(port) {
  const stdout = await runCapture('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'])
  const pids = [
    ...new Set(
      stdout
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => /^\d+$/.test(value)),
    ),
  ]

  return Promise.all(pids.map(getProcessInfo))
}

async function getProcessInfo(pid) {
  const stdout = await runCapture('ps', [
    '-p',
    pid,
    '-o',
    'pid=',
    '-o',
    'command=',
  ])
  const match = stdout.trim().match(/^(\d+)\s+([\s\S]+)$/)

  return {
    command: match?.[2] ?? stdout.trim(),
    pid,
  }
}

async function runCapture(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf8',
    })

    return stdout
  } catch (error) {
    if (typeof error?.code === 'number' && error.code === 1) {
      return error.stdout ?? ''
    }

    throw error
  }
}

function isPlannerDevProcess(command) {
  return (
    command.includes(repoRoot) &&
    (command.includes('vite --config apps/web/vite.config.ts') ||
      command.includes('tsx watch src/server.ts') ||
      command.includes('src/server.ts') ||
      command.includes('scripts/dev-local.mjs'))
  )
}

async function stopProcess(pid) {
  const numericPid = Number(pid)

  if (!Number.isInteger(numericPid) || !isProcessRunning(numericPid)) {
    return
  }

  process.kill(numericPid, 'SIGTERM')
  await waitForProcessExit(numericPid, 1500)

  if (isProcessRunning(numericPid)) {
    process.kill(numericPid, 'SIGKILL')
    await waitForProcessExit(numericPid, 1500)
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return
    }

    await wait(100)
  }
}

async function waitForPortToBeFree(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const processes = await getListeningProcesses(port)

    if (processes.length === 0) {
      return
    }

    await wait(100)
  }

  throw new Error(
    `Port ${port} is still in use after stopping old dev process.`,
  )
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false
    }

    throw error
  }
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

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
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
