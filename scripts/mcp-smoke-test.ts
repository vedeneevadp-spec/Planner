import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'

import { generateUuidV7 } from '@planner/contracts'

const READ_SCOPES = [
  'haotika:tasks.read',
  'haotika:calendar.read',
  'haotika:shopping.read',
  'haotika:cleaning.read',
  'haotika:selfcare.read',
  'haotika:habits.read',
  'haotika:stats.read',
] as const

const REQUIRED_TOOLS = [
  'get_today_context',
  'get_week_context',
  'search_planner',
  'get_overload_context',
  'get_selfcare_context',
  'list_tasks',
  'get_task',
  'create_task',
  'update_task',
  'complete_task',
  'list_shopping',
  'get_shopping_item',
  'create_shopping_item',
  'update_shopping_item',
  'complete_shopping_item',
] as const

type JsonObject = Record<string, unknown>

const baseUrl = normalizeBaseUrl(
  process.env.MCP_SMOKE_BASE_URL ?? 'http://127.0.0.1:3001',
)
const resource = normalizeResource(
  process.env.MCP_SMOKE_RESOURCE ?? new URL('/mcp', baseUrl).toString(),
)
const issuer = normalizeBaseUrl(process.env.MCP_SMOKE_ISSUER ?? baseUrl)
const redirectUri =
  process.env.MCP_SMOKE_REDIRECT_URI ??
  'http://127.0.0.1:4173/mcp-smoke/callback'
const clientId = process.env.MCP_SMOKE_CLIENT_ID ?? 'chatgpt-smoke'
const scope = process.env.MCP_SMOKE_SCOPE ?? READ_SCOPES.join(' ')
const checkWrites = process.env.MCP_SMOKE_WRITES === 'true'
let disposableAccessToken: string | undefined

try {
  if (
    checkWrites &&
    (process.env.MCP_SMOKE_CREATE_USER !== 'true' ||
      process.env.MCP_SMOKE_EMAIL ||
      process.env.MCP_SMOKE_PASSWORD)
  ) {
    throw new Error('Write smoke requires a newly created disposable user.')
  }
  const credentials = await resolveSmokeCredentials()

  const protectedResource = await getJson(
    '/.well-known/oauth-protected-resource',
  )
  assertEqual(protectedResource.resource, resource, 'protected resource')
  assertArrayIncludesAll(
    protectedResource.scopes_supported,
    READ_SCOPES,
    'protected scopes_supported',
  )

  const authorizationServer = await getJson(
    '/.well-known/oauth-authorization-server',
  )
  assertEqual(authorizationServer.issuer, issuer, 'authorization issuer')
  assertArrayIncludes(
    authorizationServer.code_challenge_methods_supported,
    'S256',
    'code_challenge_methods_supported',
  )
  assertArrayIncludesAll(
    authorizationServer.scopes_supported,
    READ_SCOPES,
    'authorization scopes_supported',
  )

  await mcpRequest('initialize', {
    capabilities: {},
    clientInfo: { name: 'haotika-smoke', version: '0.2.0' },
    protocolVersion: '2025-11-25',
  })

  const listToolsResponse = await mcpRequest('tools/list')
  const toolNames = readToolNames(listToolsResponse)
  assertArrayIncludesAll(toolNames, REQUIRED_TOOLS, 'MCP tools/list')
  const tools = readRecord(listToolsResponse.body.result, 'tools/list result')
    .tools as JsonObject[]
  const search = tools.find((tool) => tool.name === 'search_planner')
  const properties = readRecord(
    readRecord(search?.inputSchema, 'search schema').properties,
    'search properties',
  )
  if (!properties.taskCursor || !properties.timezone)
    throw new Error('Search pagination/timezone schema is outdated.')

  const unauthorizedResponse = await mcpRequest(
    'tools/call',
    { arguments: {}, name: 'get_today_context' },
    { expectStatus: 401 },
  )
  assertToolAuthChallenge(unauthorizedResponse.body)
  assertHeaderIncludes(
    unauthorizedResponse.headers,
    'www-authenticate',
    'resource_metadata=',
  )

  const tokenResponse = await completeOAuthFlow(credentials)
  const accessToken = tokenResponse.access_token
  assertString(accessToken, 'access_token')

  const todayResponse = await mcpRequest(
    'tools/call',
    { arguments: {}, name: 'get_today_context' },
    { accessToken },
  )
  const todayResult = readRecord(todayResponse.body.result, 'MCP result')

  if (todayResult.isError === true) {
    throw new Error(
      `Authorized get_today_context returned an MCP error: ${JSON.stringify(
        todayResponse.body,
      )}`,
    )
  }

  const todayContext = readRecord(todayResult.structuredContent, 'TodayContext')
  const todayDate = todayContext.date

  assertString(todayDate, 'TodayContext.date')
  assertString(todayContext.generatedAt, 'TodayContext.generatedAt')

  if (checkWrites) {
    await checkPlannerWrites(credentials, accessToken)
  }

  await revokeToken(accessToken)

  const revokedResponse = await mcpRequest(
    'tools/call',
    { arguments: {}, name: 'get_today_context' },
    { accessToken, expectStatus: 401 },
  )
  assertToolAuthChallenge(revokedResponse.body)

  console.log(
    [
      'Haotika MCP smoke passed.',
      `baseUrl=${baseUrl}`,
      `resource=${resource}`,
      `issuer=${issuer}`,
      `tools=${toolNames.join(',')}`,
      `todayDate=${todayDate}`,
      `writes=${checkWrites ? 'passed' : 'not requested'}`,
    ].join(' '),
  )
} catch (error) {
  console.error(formatError(error))
  process.exitCode = 1
} finally {
  if (disposableAccessToken) {
    const session = await requestJson('/api/v1/session', {
      headers: { authorization: `Bearer ${disposableAccessToken}` },
    })
    const workspaceId = session.workspaceId
    assertString(workspaceId, 'cleanup workspaceId')
    const response = await fetch(new URL('/api/v1/profile', baseUrl), {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${disposableAccessToken}`,
        'x-workspace-id': workspaceId,
      },
    })
    if (response.status !== 204) {
      console.error(
        `Disposable user cleanup failed: HTTP ${response.status} ${await response.text()}`,
      )
      process.exitCode = 1
    } else {
      console.log('Disposable smoke user removed.')
    }
  }
}

async function checkPlannerWrites(
  credentials: { email: string; password: string },
  readToken: string,
): Promise<void> {
  const denied = await mcpRequest(
    'tools/call',
    {
      name: 'create_task',
      arguments: { id: generateUuidV7(), title: 'Denied smoke task' },
    },
    { accessToken: readToken, expectStatus: 403 },
  )
  assertToolAuthChallenge(denied.body)
  assertHeaderIncludes(
    denied.headers,
    'www-authenticate',
    'haotika:tasks.write',
  )
  const grant = await completeOAuthFlow(
    credentials,
    [...READ_SCOPES, 'haotika:tasks.write', 'haotika:shopping.write'].join(' '),
  )
  const accessToken = grant.access_token
  assertString(accessToken, 'write access_token')
  async function call(name: string, args: JsonObject): Promise<JsonObject> {
    const response = await mcpRequest(
      'tools/call',
      { name, arguments: args },
      { accessToken },
    )
    const result = readRecord(response.body.result, name)
    if (result.isError)
      throw new Error(`${name} failed: ${JSON.stringify(result)}`)
    return readRecord(result.structuredContent, `${name} result`)
  }
  try {
    const taskInput = {
      id: generateUuidV7(),
      title: 'MCP disposable task',
      note: 'Synthetic verification',
    }
    let task = readRecord(
      (await call('create_task', taskInput)).task,
      'created task',
    )
    assertEqual(task.id, taskInput.id, 'created task ID')
    const replay = readRecord(
      (await call('create_task', taskInput)).task,
      'replayed task',
    )
    assertEqual(replay.version, task.version, 'task creation replay')
    task = readRecord(
      (await call('get_task', { id: task.id })).task,
      'task detail',
    )
    task = readRecord(
      (
        await call('update_task', {
          id: task.id,
          expectedVersion: task.version,
          title: 'MCP disposable task updated',
          plannedDate: '2026-11-14',
        })
      ).task,
      'updated task',
    )
    assertEqual(task.title, 'MCP disposable task updated', 'updated task title')
    task = readRecord(
      (
        await call('complete_task', {
          id: task.id,
          expectedVersion: task.version,
        })
      ).task,
      'completed task',
    )
    assertEqual(task.status, 'done', 'task completion')
    const listedTasks = await call('list_tasks', {
      search: 'MCP disposable task',
      status: 'done',
      limit: 1,
    })
    if (!Array.isArray(listedTasks.items) || listedTasks.items.length !== 1)
      throw new Error('Completed task missing from list.')

    const shoppingInput = {
      id: generateUuidV7(),
      text: 'MCP disposable shopping',
    }
    let item = readRecord(
      (await call('create_shopping_item', shoppingInput)).item,
      'created shopping item',
    )
    assertEqual(item.id, shoppingInput.id, 'created shopping ID')
    item = readRecord(
      (await call('get_shopping_item', { id: item.id })).item,
      'shopping detail',
    )
    item = readRecord(
      (
        await call('update_shopping_item', {
          id: item.id,
          text: 'MCP disposable shopping updated',
        })
      ).item,
      'updated shopping',
    )
    assertEqual(
      item.text,
      'MCP disposable shopping updated',
      'updated shopping text',
    )
    item = readRecord(
      (await call('complete_shopping_item', { id: item.id })).item,
      'completed shopping',
    )
    assertEqual(item.status, 'archived', 'shopping completion')
    const repeated = readRecord(
      (await call('complete_shopping_item', { id: item.id })).item,
      'repeated shopping completion',
    )
    assertEqual(repeated.version, item.version, 'shopping completion replay')
    assertEqual(
      repeated.completedAt,
      item.completedAt,
      'shopping completion timestamp',
    )
    const listedShopping = await call('list_shopping', {
      search: 'MCP disposable shopping',
      status: 'archived',
      limit: 1,
    })
    if (
      !Array.isArray(listedShopping.items) ||
      listedShopping.items.length !== 1
    )
      throw new Error('Completed shopping missing from list.')
  } finally {
    await revokeToken(accessToken)
  }
}

async function resolveSmokeCredentials(): Promise<{
  email: string
  password: string
}> {
  const configuredEmail = process.env.MCP_SMOKE_EMAIL
  const configuredPassword = process.env.MCP_SMOKE_PASSWORD

  if (configuredEmail && configuredPassword) {
    return { email: configuredEmail, password: configuredPassword }
  }

  if (process.env.MCP_SMOKE_CREATE_USER !== 'true') {
    throw new Error(
      'Set MCP_SMOKE_EMAIL and MCP_SMOKE_PASSWORD, or set MCP_SMOKE_CREATE_USER=true for a disposable local user.',
    )
  }

  const randomSuffix = randomBytes(4).toString('hex')
  const email = `mcp-smoke-${Date.now()}-${randomSuffix}@example.test`
  const password = `mcp-smoke-${randomBytes(12).toString('base64url')}`

  const signupResponse = await requestJson('/api/v1/auth/sign-up', {
    body: {
      displayName: 'MCP Smoke',
      email,
      password,
    },
    method: 'POST',
  })
  const accessToken = signupResponse.accessToken

  assertString(accessToken, 'signup accessToken')
  disposableAccessToken = accessToken

  await requestJson('/api/v1/workspaces/shared', {
    body: {
      name: 'MCP Smoke Workspace',
    },
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  return { email, password }
}

async function completeOAuthFlow(
  credentials: {
    email: string
    password: string
  },
  requestedScope = scope,
): Promise<JsonObject> {
  const codeVerifier = randomBytes(48).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  const state = `smoke-${randomBytes(8).toString('hex')}`
  const authorizeBody = new URLSearchParams({
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    email: credentials.email,
    password: credentials.password,
    redirect_uri: redirectUri,
    resource,
    response_type: 'code',
    scope: requestedScope,
    state,
  })

  const authorizeResponse = await fetch(
    new URL('/oauth/authorize', baseUrl).toString(),
    {
      body: authorizeBody,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      redirect: 'manual',
    },
  )
  const location = authorizeResponse.headers.get('location')

  if (authorizeResponse.status !== 302 || !location) {
    throw new Error(
      `OAuth authorize failed: status=${authorizeResponse.status} body=${await authorizeResponse.text()}`,
    )
  }

  const callbackUrl = new URL(location, redirectUri)
  const code = callbackUrl.searchParams.get('code')

  assertEqual(callbackUrl.searchParams.get('state'), state, 'OAuth state')
  assertString(code, 'OAuth code')

  return requestJson('/oauth/token', {
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      resource,
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  })
}

async function revokeToken(token: string): Promise<void> {
  await requestJson('/oauth/revoke', {
    body: new URLSearchParams({ token }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  })
}

async function mcpRequest(
  method: string,
  params?: Record<string, unknown>,
  options: {
    accessToken?: string
    expectStatus?: number
  } = {},
): Promise<{
  body: JsonObject
  headers: Headers
  status: number
}> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  }

  if (options.accessToken) {
    headers.authorization = `Bearer ${options.accessToken}`
  }

  const response = await fetch(resource, {
    body: JSON.stringify({
      id: randomBytes(4).readUInt32BE(0),
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    }),
    headers,
    method: 'POST',
  })
  const body = parseJsonObject(await response.text(), `MCP ${method} response`)
  const expectedStatus = options.expectStatus ?? 200

  if (response.status !== expectedStatus) {
    throw new Error(
      `MCP ${method} expected HTTP ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`,
    )
  }

  if (body.error) {
    throw new Error(
      `MCP ${method} returned JSON-RPC error: ${JSON.stringify(body)}`,
    )
  }

  return { body, headers: response.headers, status: response.status }
}

async function getJson(path: string): Promise<JsonObject> {
  return requestJson(path)
}

async function requestJson(
  path: string,
  options: {
    body?: unknown
    headers?: Record<string, string>
    method?: string
  } = {},
): Promise<JsonObject> {
  const url = new URL(path, baseUrl).toString()
  const headers = options.headers ?? {
    accept: 'application/json',
    'content-type': 'application/json',
  }
  const requestInit: RequestInit = {
    headers,
    method: options.method ?? 'GET',
  }

  if (options.body instanceof URLSearchParams) {
    requestInit.body = options.body
  } else if (options.body !== undefined) {
    requestInit.body = JSON.stringify(options.body)
  }

  const response = await fetch(url, requestInit)
  const text = await response.text()
  const parsed = parseJsonObject(text, `${options.method ?? 'GET'} ${path}`)

  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} failed with HTTP ${response.status}: ${text}`,
    )
  }

  return parsed
}

function readToolNames(response: { body: JsonObject }): string[] {
  const result = readRecord(response.body.result, 'tools/list result')
  const tools = result.tools

  if (!Array.isArray(tools)) {
    throw new Error(
      `tools/list did not return an array: ${JSON.stringify(response.body)}`,
    )
  }

  return tools.map((tool, index) => {
    const toolRecord = readRecord(tool, `tools[${index}]`)
    const name = toolRecord.name

    assertString(name, `tools[${index}].name`)

    return name
  })
}

function assertToolAuthChallenge(body: JsonObject): void {
  const result = readRecord(body.result, 'MCP tool result')

  if (result.isError !== true) {
    throw new Error(`Expected MCP tool error result: ${JSON.stringify(body)}`)
  }

  const meta = readRecord(result._meta, 'MCP tool result _meta')
  const authChallenge = meta['mcp/www_authenticate']

  const challenges = Array.isArray(authChallenge)
    ? authChallenge
    : [authChallenge]
  if (
    !challenges.some(
      (value) => typeof value === 'string' && value.includes('Bearer'),
    )
  ) {
    throw new Error(`Missing mcp/www_authenticate: ${JSON.stringify(body)}`)
  }
}

function assertHeaderIncludes(
  headers: Headers,
  name: string,
  expected: string,
): void {
  const value = headers.get(name)

  if (!value?.includes(expected)) {
    throw new Error(`Expected ${name} to include ${expected}, got ${value}`)
  }
}

function assertArrayIncludesAll(
  actual: unknown,
  expected: readonly string[],
  label: string,
): void {
  for (const item of expected) {
    assertArrayIncludes(actual, item, label)
  }
}

function assertArrayIncludes(
  actual: unknown,
  expected: string,
  label: string,
): void {
  if (!Array.isArray(actual) || !actual.includes(expected)) {
    throw new Error(
      `Expected ${label} to include ${expected}. Got ${JSON.stringify(actual)}`,
    )
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Expected ${label} to be a non-empty string.`)
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${label}=${formatUnknown(expected)}, got ${formatUnknown(actual)}`,
    )
  }
}

function readRecord(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} to be an object.`)
  }

  return value
}

function parseJsonObject(text: string, label: string): JsonObject {
  if (!text) {
    return {}
  }

  const parsed: unknown = JSON.parse(text)

  if (!isRecord(parsed)) {
    throw new Error(`Expected ${label} to return a JSON object.`)
  }

  return parsed
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatUnknown(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, '')
}

function normalizeResource(value: string): string {
  return value
}

function formatError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}
