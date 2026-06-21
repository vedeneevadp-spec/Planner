import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'

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

try {
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
    clientInfo: { name: 'haotika-smoke', version: '0.1.0' },
    protocolVersion: '2025-11-25',
  })

  const listToolsResponse = await mcpRequest('tools/list')
  const toolNames = readToolNames(listToolsResponse)
  assertArrayIncludesAll(toolNames, REQUIRED_TOOLS, 'MCP tools/list')

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
    ].join(' '),
  )
} catch (error) {
  console.error(formatError(error))
  process.exitCode = 1
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

async function completeOAuthFlow(credentials: {
  email: string
  password: string
}): Promise<JsonObject> {
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
    scope,
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

  if (typeof authChallenge !== 'string' || !authChallenge.includes('Bearer')) {
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
