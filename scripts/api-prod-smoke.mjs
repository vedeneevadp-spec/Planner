import { spawn } from 'node:child_process'
import process from 'node:process'
import { setTimeout as wait } from 'node:timers/promises'

const defaultPort = process.env.SMOKE_API_PORT ?? process.env.API_PORT ?? '3101'
const baseUrl = normalizeBaseUrl(
  process.env.SMOKE_API_BASE_URL ?? `http://127.0.0.1:${defaultPort}`,
)
const shouldStartApi = process.env.SMOKE_API_BASE_URL === undefined
const startupTimeoutMs = Number(process.env.SMOKE_API_TIMEOUT_MS ?? '30000')

let apiProcessState = null

try {
  assertSmokeTargetAllowed(baseUrl)

  if (shouldStartApi) {
    apiProcessState = startLocalProductionApi(defaultPort)
  }

  const health = await waitForProductionHealth(baseUrl, apiProcessState)
  const result = await runSmoke(baseUrl, health)

  console.log(
    [
      'Production API smoke passed.',
      `baseUrl=${baseUrl}`,
      `appEnv=${result.appEnv}`,
      `databaseStatus=${result.databaseStatus}`,
      `workspaceId=${result.workspaceId}`,
    ].join(' '),
  )
} catch (error) {
  console.error(formatError(error))

  const logs = apiProcessState?.logs ?? []
  if (logs.length > 0) {
    console.error('Last API logs:')
    for (const line of logs.slice(-20)) {
      console.error(line)
    }
  }

  process.exitCode = 1
} finally {
  if (apiProcessState) {
    await stopProcess(apiProcessState)
  }
}

function startLocalProductionApi(port) {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npmBin, ['run', '-w', 'apps/api', 'start'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_AUTH_MODE: process.env.API_AUTH_MODE ?? 'jwt',
      API_CORS_ORIGIN: process.env.API_CORS_ORIGIN ?? 'http://127.0.0.1:5173',
      API_DB_RLS_MODE: process.env.API_DB_RLS_MODE ?? 'transaction_local',
      API_HOST: process.env.API_HOST ?? '127.0.0.1',
      API_PORT: port,
      API_STORAGE_DRIVER: process.env.API_STORAGE_DRIVER ?? 'postgres',
      AUTH_JWT_SECRET:
        process.env.AUTH_JWT_SECRET ??
        'planner-smoke-jwt-secret-with-at-least-32-chars',
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://planner:planner@127.0.0.1:54329/planner_development',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const state = {
    child,
    exited: false,
    exitCode: null,
    logs: [],
    signal: null,
  }

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => collectLogLines(state, chunk))
  child.stderr.on('data', (chunk) => collectLogLines(state, chunk))
  child.on('exit', (code, signal) => {
    state.exited = true
    state.exitCode = code
    state.signal = signal
  })

  return state
}

async function waitForProductionHealth(targetBaseUrl, processState) {
  const deadline = Date.now() + startupTimeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    assertApiProcessStillRunning(processState)

    try {
      const health = await requestJson(targetBaseUrl, '/api/health')
      const healthError = validateProductionHealth(health)

      if (!healthError) {
        return health
      }

      lastError = new Error(healthError)
    } catch (error) {
      lastError = error
    }

    await wait(500)
  }

  const suffix = lastError ? ` Last error: ${formatError(lastError)}` : ''
  throw new Error(
    `API did not become production-healthy at ${targetBaseUrl}.${suffix}`,
  )
}

async function runSmoke(targetBaseUrl, health) {
  const smokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `prod-smoke-${smokeId}@example.test`
  const password = 'prod-smoke-password'

  const auth = await requestJson(targetBaseUrl, '/api/v1/auth/sign-up', {
    method: 'POST',
    body: {
      displayName: 'Production Smoke',
      email,
      password,
    },
  })
  assertString(auth.accessToken, 'auth.accessToken')
  assertString(auth.user?.id, 'auth.user.id')

  const authHeaders = {
    authorization: `Bearer ${auth.accessToken}`,
  }
  const session = await requestJson(targetBaseUrl, '/api/v1/session', {
    headers: authHeaders,
  })
  assertString(session.actorUserId, 'session.actorUserId')
  assertString(session.workspaceId, 'session.workspaceId')
  if (session.source !== 'access_token') {
    throw new Error(
      `Expected access_token session source, got ${session.source}`,
    )
  }

  const workspaceHeaders = {
    ...authHeaders,
    'x-workspace-id': session.workspaceId,
  }

  const tasks = await requestJson(targetBaseUrl, '/api/v1/tasks', {
    headers: workspaceHeaders,
  })
  if (!Array.isArray(tasks)) {
    throw new Error('Expected /api/v1/tasks to return an array.')
  }

  const createdTask = await requestJson(targetBaseUrl, '/api/v1/tasks', {
    method: 'POST',
    headers: workspaceHeaders,
    body: {
      assigneeUserId: null,
      dueDate: null,
      note: '',
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
      project: '',
      projectId: null,
      requiresConfirmation: false,
      resource: 0,
      sphereId: null,
      title: `Production smoke ${smokeId}`,
    },
  })
  assertString(createdTask.id, 'createdTask.id')
  assertPositiveInteger(createdTask.version, 'createdTask.version')
  if (createdTask.status !== 'todo') {
    throw new Error(
      `Expected created task status todo, got ${createdTask.status}`,
    )
  }

  const doneTask = await requestJson(
    targetBaseUrl,
    `/api/v1/tasks/${encodeURIComponent(createdTask.id)}/status`,
    {
      method: 'PATCH',
      headers: workspaceHeaders,
      body: {
        expectedVersion: createdTask.version,
        status: 'done',
      },
    },
  )
  assertPositiveInteger(doneTask.version, 'doneTask.version')
  if (doneTask.status !== 'done') {
    throw new Error(`Expected task status done, got ${doneTask.status}`)
  }

  await requestJson(
    targetBaseUrl,
    `/api/v1/tasks/${encodeURIComponent(createdTask.id)}?expectedVersion=${doneTask.version}`,
    {
      method: 'DELETE',
      headers: workspaceHeaders,
      expectJson: false,
    },
  )

  return {
    appEnv: health.appEnv,
    databaseStatus: health.databaseStatus,
    userId: auth.user.id,
    workspaceId: session.workspaceId,
  }
}

async function requestJson(targetBaseUrl, path, options = {}) {
  const response = await fetch(`${targetBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(body)}`,
    )
  }

  if (options.expectJson === false) {
    return null
  }

  if (body === null) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned empty body.`)
  }

  return body
}

function validateProductionHealth(health) {
  if (health?.status !== 'ok') {
    return `Expected health.status=ok, got ${health?.status}`
  }

  if (health.appEnv !== 'production') {
    return `Expected health.appEnv=production, got ${health.appEnv}`
  }

  if (health.storageDriver !== 'postgres') {
    return `Expected health.storageDriver=postgres, got ${health.storageDriver}`
  }

  if (health.databaseStatus !== 'up') {
    return `Expected health.databaseStatus=up, got ${health.databaseStatus}`
  }

  return null
}

function assertApiProcessStillRunning(processState) {
  if (!processState?.exited) {
    return
  }

  const exitReason =
    processState.signal === null
      ? `exit code ${processState.exitCode}`
      : `signal ${processState.signal}`

  throw new Error(`API process exited before smoke completed (${exitReason}).`)
}

async function stopProcess(processState) {
  if (processState.exited) {
    return
  }

  processState.child.kill('SIGTERM')
  const deadline = Date.now() + 5000
  while (!processState.exited && Date.now() < deadline) {
    await wait(100)
  }

  if (!processState.exited) {
    processState.child.kill('SIGKILL')
  }
}

function collectLogLines(state, chunk) {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) {
      state.logs.push(trimmed)
    }
  }

  if (state.logs.length > 100) {
    state.logs.splice(0, state.logs.length - 100)
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected non-empty string at ${label}.`)
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected positive integer at ${label}.`)
  }
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '')
}

function assertSmokeTargetAllowed(value) {
  if (isLoopbackUrl(value)) {
    return
  }

  if (process.env.ALLOW_REMOTE_SMOKE === '1') {
    return
  }

  throw new Error(
    [
      `Refusing to run production API smoke against non-local URL: ${value}.`,
      'The smoke creates a user, workspace and task.',
      'Set ALLOW_REMOTE_SMOKE=1 only when this is intentional.',
    ].join(' '),
  )
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value)

    return new Set(['0.0.0.0', '127.0.0.1', '::1', 'localhost']).has(
      url.hostname,
    )
  } catch {
    return false
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
