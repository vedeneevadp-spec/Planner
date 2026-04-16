import process from 'node:process'
import { spawn } from 'node:child_process'
import net from 'node:net'

import { getSupabaseRuntimeDatabaseUrl, npmCommand } from './supabase-utils.mjs'

const children = new Map()
let shuttingDown = false
let exitCode = 0

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

const apiPort = await findAvailablePort(3001)
const webPort = await findAvailablePort(5173)

const sharedApiEnv = {
  ...process.env,
  API_HOST: '127.0.0.1',
  API_PORT: String(apiPort),
  API_STORAGE_DRIVER: 'postgres',
  DATABASE_URL: getSupabaseRuntimeDatabaseUrl(),
}

const processes = [
  {
    name: 'api',
    color: '\x1b[36m',
    command: npmCommand(),
    args: ['run', '-w', 'apps/api', 'dev'],
    env: sharedApiEnv,
  },
  {
    name: 'web',
    color: '\x1b[35m',
    command: npmCommand(),
    args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)],
    env: {
      ...process.env,
      VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      VITE_OPEN_BROWSER: 'false',
    },
  },
]

for (const entry of processes) {
  const child = spawn(entry.command, entry.args, {
    env: entry.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  children.set(entry.name, child)
  pipeOutput(entry, child.stdout, process.stdout)
  pipeOutput(entry, child.stderr, process.stderr)

  child.once('exit', (code, signal) => {
    children.delete(entry.name)

    if (shuttingDown) {
      if (children.size === 0) {
        process.exit(exitCode)
      }

      return
    }

    if (code !== 0) {
      exitCode = code ?? 1
    }

    if (signal) {
      exitCode = 1
      writeLine(entry, process.stderr, `stopped by signal ${signal}`)
    }

    shutdown(code === 0 ? 'SIGTERM' : 'SIGINT')
  })

  child.once('error', (error) => {
    exitCode = 1
    writeLine(entry, process.stderr, `failed to start: ${error.message}`)
    shutdown('SIGINT')
  })
}

process.stdout.write(
  [
    'Supabase dev stack is starting.',
    `API: http://127.0.0.1:${apiPort}`,
    `Web: http://127.0.0.1:${webPort}`,
  ].join('\n') + '\n',
)

function shutdown(signal) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children.values()) {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  if (children.size === 0) {
    process.exit(exitCode)
  }
}

function pipeOutput(entry, stream, output) {
  let buffer = ''

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      writeLine(entry, output, line)
    }
  })

  stream.on('end', () => {
    if (buffer.length > 0) {
      writeLine(entry, output, buffer)
    }
  })
}

function writeLine(entry, output, line) {
  const reset = '\x1b[0m'
  output.write(`${entry.color}[${entry.name}]${reset} ${line}\n`)
}

async function findAvailablePort(startPort) {
  let port = startPort

  while (!(await isPortAvailable(port))) {
    port += 1
  }

  return port
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true))
    })
  })
}
