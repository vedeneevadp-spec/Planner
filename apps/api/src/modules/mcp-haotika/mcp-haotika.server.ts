import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  getClientAddress,
  type RateLimiter,
} from '../../bootstrap/rate-limit.js'
import {
  type AiContextService,
  AiContextValidationError,
  HAOTIKA_MCP_SCOPES,
  type HaotikaMcpScope,
} from '../ai-context/index.js'
import type { SessionService } from '../session/index.js'
import { createToolOutputSummary, hashIpAddress } from './mcp-haotika.audit.js'
import {
  createMcpResource,
  type McpOAuthService,
  parseRequestedScopes,
} from './mcp-haotika.auth.js'
import type { McpPlannerService } from './mcp-haotika.planner.js'
import { mcpToolNameSchema } from './mcp-haotika.schemas.js'
import {
  executeMcpTool,
  getRequiredScopesForTool,
  MCP_HAOTIKA_SERVER_INSTRUCTIONS,
  MCP_HAOTIKA_TOOLS,
} from './mcp-haotika.tools.js'
import {
  type McpAuditLogRepository,
  type McpAuthContext,
  type McpErrorPayload,
  McpHaotikaError,
  type McpHaotikaRuntimeConfig,
} from './mcp-haotika.types.js'

const MCP_PROTOCOL_VERSION = '2025-11-25'
const MCP_REQUEST_BODY_LIMIT_BYTES = 256 * 1024
const MCP_MAX_BATCH_SIZE = 20
const MCP_MAX_CONCURRENCY = 4
const MCP_HAOTIKA_PUBLIC_DOCS = [
  'Haotika MCP Connector',
  '',
  'Personal planner MCP server with task and shopping actions for ChatGPT.',
  'Transport: Streamable HTTP-compatible JSON-RPC over POST /mcp.',
  'Auth: OAuth authorization-code flow with PKCE S256 and resource-bound tokens.',
  `Tools: ${MCP_HAOTIKA_TOOLS.map((tool) => tool.name).join(', ')}.`,
  `Limits: ${MCP_REQUEST_BODY_LIMIT_BYTES / 1024} KiB per request, ${MCP_MAX_BATCH_SIZE} JSON-RPC messages per batch, ${MCP_MAX_CONCURRENCY} concurrent messages per request.`,
  'Task and shopping writes require separate OAuth scopes: haotika:tasks.write and haotika:shopping.write. Existing read-only grants stay read-only.',
  'Refresh the plugin tools after an update. search_planner supports timezone and taskCursor. Reauthorize to enable the requested write scopes.',
  'Use list/get tools for exact IDs and current versions. Creates require a new UUIDv7 id reused for retries. No delete tools or access to other workspaces.',
].join('\n')

interface RegisterMcpHaotikaRoutesOptions {
  aiContextService: AiContextService
  plannerService?: McpPlannerService | undefined
  auditRepository: McpAuditLogRepository
  config: McpHaotikaRuntimeConfig
  oauthService: McpOAuthService
  rateLimiter: RateLimiter
  sessionService: SessionService
}

interface JsonRpcRequest {
  id?: number | string | null
  jsonrpc?: string
  method?: string
  params?: unknown
}

interface ResolvedMcpAuthContext extends Omit<McpAuthContext, 'tokenId'> {
  tokenId: string | null
}

export function registerMcpHaotikaRoutes(
  app: FastifyInstance,
  options: RegisterMcpHaotikaRoutesOptions,
): void {
  registerUrlEncodedFormParser(app)

  app.get('/docs/mcp-haotika', async (_request, reply) =>
    reply.type('text/plain; charset=utf-8').send(MCP_HAOTIKA_PUBLIC_DOCS),
  )

  app.get('/.well-known/oauth-protected-resource', async (_request, reply) => {
    if (!options.config.enabled) {
      return sendMcpHttpError(
        reply,
        503,
        'MCP_DISABLED',
        'MCP connector is disabled.',
      )
    }

    return {
      authorization_servers: [options.config.oauthIssuer],
      bearer_methods_supported: ['header'],
      resource: createMcpResource(options.config.publicBaseUrl),
      resource_documentation: new URL(
        '/docs/mcp-haotika',
        options.config.publicBaseUrl,
      ).toString(),
      resource_name: 'Haotika MCP',
      scopes_supported: HAOTIKA_MCP_SCOPES,
    }
  })

  app.get(
    '/.well-known/oauth-authorization-server',
    async (_request, reply) => {
      if (!options.config.enabled) {
        return sendMcpHttpError(
          reply,
          503,
          'MCP_DISABLED',
          'MCP connector is disabled.',
        )
      }

      return createAuthorizationServerMetadata(options.config)
    },
  )

  app.get('/oauth/authorize', async (request, reply) => {
    if (!options.config.enabled) {
      return sendMcpHttpError(
        reply,
        503,
        'MCP_DISABLED',
        'MCP connector is disabled.',
      )
    }

    const query = readAuthorizeQuery(request.query)
    const validationError = validateAuthorizeQuery(query)

    return reply.type('text/html; charset=utf-8').send(
      renderAuthorizePage({
        errorMessage: validationError,
        query,
      }),
    )
  })

  app.post(
    '/oauth/authorize',
    {
      config: {
        rateLimit: {
          groupId: 'mcp-oauth-authorize',
          max: Math.max(options.config.rateLimitPerMinute * 5, 100),
          timeWindow: 60_000,
        },
      },
    },
    async (request, reply) => {
      if (!options.config.enabled) {
        return sendMcpHttpError(
          reply,
          503,
          'MCP_DISABLED',
          'MCP connector is disabled.',
        )
      }

      const form = readAuthorizeForm(request.body)
      const validationError = validateAuthorizeQuery(form)

      if (validationError) {
        return reply
          .code(400)
          .type('text/html; charset=utf-8')
          .send(
            renderAuthorizePage({
              errorMessage: validationError,
              query: form,
              values: form,
            }),
          )
      }

      try {
        await options.rateLimiter.consume({
          key: `mcp:oauth-authorize:ip:${getClientAddress(request)}`,
          limit: Math.max(options.config.rateLimitPerMinute * 5, 100),
          windowMs: 60_000,
        })
        const redirectUrl = await options.oauthService.completeAuthorize(
          {
            clientId: form.client_id,
            codeChallenge: form.code_challenge,
            codeChallengeMethod: form.code_challenge_method,
            email: form.email ?? '',
            password: form.password ?? '',
            redirectUri: form.redirect_uri ?? '',
            resource: form.resource,
            scope: form.scope,
            state: form.state,
          },
          {
            ipAddress: getClientAddress(request),
            userAgent: readUserAgent(request) ?? undefined,
          },
        )

        return reply.redirect(redirectUrl, 302)
      } catch (error) {
        if (isInvalidCredentialsError(error)) {
          return reply
            .code(401)
            .type('text/html; charset=utf-8')
            .send(
              renderAuthorizePage({
                errorMessage: 'Неверный email или пароль.',
                query: form,
                values: form,
              }),
            )
        }

        if (error instanceof HttpError && error.statusCode === 429) {
          return reply
            .code(429)
            .type('text/html; charset=utf-8')
            .send(
              renderAuthorizePage({
                errorMessage: 'Слишком много попыток. Попробуйте позже.',
                query: form,
                values: form,
              }),
            )
        }

        if (error instanceof McpHaotikaError) {
          return reply
            .code(error.statusCode)
            .type('text/html; charset=utf-8')
            .send(
              renderAuthorizePage({
                errorMessage: error.message,
                query: form,
                values: form,
              }),
            )
        }

        throw error
      }
    },
  )

  app.post('/oauth/token', async (request, reply) => {
    if (!options.config.enabled) {
      return sendOAuthError(
        reply,
        503,
        'temporarily_unavailable',
        'MCP connector is disabled.',
      )
    }

    const body = readTokenRequestBody(request.body)
    const clientCredentials = readClientCredentials(request, body)

    if (
      body.grant_type !== 'authorization_code' &&
      body.grant_type !== 'refresh_token'
    ) {
      return sendOAuthError(
        reply,
        400,
        'unsupported_grant_type',
        'Only authorization_code and refresh_token grants are supported.',
      )
    }

    try {
      const response = await options.oauthService.exchangeToken({
        clientId: clientCredentials.clientId,
        clientSecret: clientCredentials.clientSecret,
        code: body.code,
        codeVerifier: body.code_verifier,
        grantType: body.grant_type,
        redirectUri: body.redirect_uri,
        refreshToken: body.refresh_token,
        resource: body.resource,
      })

      return reply.send(response)
    } catch (error) {
      if (error instanceof McpHaotikaError) {
        return sendOAuthError(
          reply,
          error.statusCode,
          error.code === 'VALIDATION_ERROR'
            ? 'invalid_request'
            : 'invalid_grant',
          error.message,
        )
      }

      throw error
    }
  })

  app.post('/oauth/revoke', async (request, reply) => {
    const body = readTokenRequestBody(request.body)

    await options.oauthService.revoke(body.token)

    return reply.code(200).send({})
  })

  app.post(
    '/mcp',
    {
      bodyLimit: MCP_REQUEST_BODY_LIMIT_BYTES,
      config: {
        rateLimit: {
          groupId: 'mcp-json-rpc',
          max: getMcpIpRateLimit(options),
          timeWindow: 60_000,
        },
      },
    },
    async (request, reply) => {
      if (!options.config.enabled) {
        return sendMcpHttpError(
          reply,
          503,
          'MCP_DISABLED',
          'MCP connector is disabled.',
        )
      }

      await assertMcpRequestRateLimit(options, request)
      const payload = request.body

      if (Array.isArray(payload)) {
        if (payload.length === 0 || payload.length > MCP_MAX_BATCH_SIZE) {
          return reply
            .code(400)
            .send(
              createJsonRpcError(
                null,
                -32600,
                `Batch must contain between 1 and ${MCP_MAX_BATCH_SIZE} messages.`,
              ),
            )
        }

        const responses = (
          await mapWithConcurrency(payload, MCP_MAX_CONCURRENCY, (message) =>
            handleJsonRpcMessage(message, request, reply, options),
          )
        ).filter((message) => message !== null)

        return responses.length ? reply.send(responses) : reply.code(204).send()
      }

      const response = await handleJsonRpcMessage(
        payload,
        request,
        reply,
        options,
      )

      return response === null ? reply.code(204).send() : reply.send(response)
    },
  )
}

async function handleJsonRpcMessage(
  rawMessage: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterMcpHaotikaRoutesOptions,
) {
  const message = isRecord(rawMessage) ? (rawMessage as JsonRpcRequest) : {}
  const id = message.id

  if (message.jsonrpc !== '2.0' || !message.method) {
    return createJsonRpcError(id, -32600, 'Invalid Request')
  }

  if (!hasJsonRpcId(message)) {
    return null
  }

  switch (message.method) {
    case 'initialize':
      return {
        id,
        jsonrpc: '2.0',
        result: {
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          instructions: MCP_HAOTIKA_SERVER_INSTRUCTIONS,
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: {
            name: 'haotika-mcp',
            version: '0.2.0',
          },
        },
      }
    case 'ping':
      return { id, jsonrpc: '2.0', result: {} }
    case 'tools/list':
      return {
        id,
        jsonrpc: '2.0',
        result: {
          tools: MCP_HAOTIKA_TOOLS,
        },
      }
    case 'tools/call':
      return handleToolCall(id, message.params, request, reply, options)
    default:
      return createJsonRpcError(id, -32601, 'Method not found')
  }
}

async function handleToolCall(
  id: JsonRpcRequest['id'],
  params: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterMcpHaotikaRoutesOptions,
) {
  if (!isRecord(params)) {
    return createToolJsonRpcResult(
      id,
      createToolError('VALIDATION_ERROR', 'Tool params are required.'),
    )
  }

  const parsedName = mcpToolNameSchema.safeParse(params.name)

  if (!parsedName.success) {
    return createToolJsonRpcResult(
      id,
      createToolError('VALIDATION_ERROR', 'Unknown tool name.'),
    )
  }

  const toolName = parsedName.data
  const toolArguments = params.arguments ?? {}
  const requiredScopes = getRequiredScopesForTool(toolName, toolArguments)

  try {
    const auth = await resolveMcpAuth(request, options, requiredScopes)
    await assertMcpRateLimit(options, auth, request)
    const output = await executeMcpTool({
      aiContextService: options.aiContextService,
      plannerService: options.plannerService,
      arguments: toolArguments,
      name: toolName,
      userId: auth.userId,
    })

    const audit = {
      input: toolArguments,
      ipHash: hashIpAddress(getClientAddress(request)),
      outputSummary: createToolOutputSummary(output),
      tokenId: auth.tokenId,
      toolName,
      userAgent: readUserAgent(request),
      userId: auth.userId,
    }
    // A logging outage must not turn a successful mutation into a retryable failure.
    try {
      await options.auditRepository.createLog(audit)
    } catch (error) {
      request.log.error(
        { err: error, toolName },
        'MCP audit log failed after tool completion.',
      )
    }

    return createToolJsonRpcResult(id, {
      content: [
        {
          text: 'Haotika tool completed. See the structured result.',
          type: 'text',
        },
      ],
      structuredContent: output,
    })
  } catch (error) {
    request.log.error(
      {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        toolName,
      },
      'MCP tool call failed.',
    )

    const mcpError = mapToolError(error)
    applyToolHttpErrorHeaders(reply, mcpError)

    return createToolJsonRpcResult(
      id,
      createToolError(
        mcpError.code,
        mcpError.message,
        mcpError.wwwAuthenticate,
      ),
    )
  }
}

function applyToolHttpErrorHeaders(
  reply: FastifyReply,
  error: McpHaotikaError,
): void {
  if (
    error.wwwAuthenticate &&
    (error.statusCode === 401 || error.statusCode === 403)
  ) {
    reply
      .code(error.statusCode)
      .header('WWW-Authenticate', error.wwwAuthenticate)
  }
}

async function resolveMcpAuth(
  request: FastifyRequest,
  options: RegisterMcpHaotikaRoutesOptions,
  requiredScopes: readonly HaotikaMcpScope[],
): Promise<ResolvedMcpAuthContext> {
  const authorization =
    typeof request.headers.authorization === 'string'
      ? request.headers.authorization
      : undefined

  if (options.config.devNoAuth && !authorization) {
    const session = await options.sessionService.resolveSession({
      actorUserId: undefined,
      auth: null,
      workspaceId: undefined,
    })

    return {
      scopes: [...HAOTIKA_MCP_SCOPES],
      tokenId: null,
      userId: session.actorUserId,
    }
  }

  return options.oauthService.authenticateBearer(authorization, requiredScopes)
}

async function assertMcpRateLimit(
  options: RegisterMcpHaotikaRoutesOptions,
  auth: ResolvedMcpAuthContext,
  request: FastifyRequest,
): Promise<void> {
  try {
    await Promise.all([
      options.rateLimiter.consume({
        key: `mcp:credential:${auth.tokenId ?? auth.userId}`,
        limit: options.config.rateLimitPerMinute,
        windowMs: 60_000,
      }),
      options.rateLimiter.consume({
        key: `mcp:ip:${getClientAddress(request)}`,
        limit: Math.max(options.config.rateLimitPerMinute * 5, 100),
        windowMs: 60_000,
      }),
    ])
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode !== 429) {
      throw error
    }

    throw new McpHaotikaError(
      'RATE_LIMIT_EXCEEDED',
      'Rate limit exceeded.',
      429,
    )
  }
}

async function assertMcpRequestRateLimit(
  options: RegisterMcpHaotikaRoutesOptions,
  request: FastifyRequest,
): Promise<void> {
  await options.rateLimiter.consume({
    key: `mcp:request:ip:${getClientAddress(request)}`,
    limit: getMcpIpRateLimit(options),
    windowMs: 60_000,
  })
}

function getMcpIpRateLimit(options: RegisterMcpHaotikaRoutesOptions): number {
  return Math.max(options.config.rateLimitPerMinute * 5, 100)
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  mapper: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const iterator = items.entries()
  const results = new Array<Output>(items.length)
  const workerCount = Math.min(concurrency, items.length)

  const worker = async () => {
    for (;;) {
      const next = iterator.next()

      if (next.done) {
        return
      }

      const [index, item] = next.value
      results[index] = await mapper(item, index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker))

  return results
}

function createToolJsonRpcResult(
  id: JsonRpcRequest['id'],
  result: Record<string, unknown>,
) {
  return {
    id,
    jsonrpc: '2.0',
    result,
  }
}

function createToolError(
  code: McpErrorPayload['error']['code'],
  message: string,
  wwwAuthenticate?: string,
) {
  return {
    _meta: {
      ...(wwwAuthenticate ? { 'mcp/www_authenticate': [wwwAuthenticate] } : {}),
    },
    content: [{ text: message, type: 'text' }],
    isError: true,
    structuredContent: {
      error: {
        code,
        message,
      },
    } satisfies McpErrorPayload,
  }
}

function createJsonRpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
) {
  return {
    error: {
      code,
      message,
    },
    id: id ?? null,
    jsonrpc: '2.0',
  }
}

function mapToolError(error: unknown): McpHaotikaError {
  if (error instanceof McpHaotikaError) {
    return error
  }

  if (error instanceof AiContextValidationError) {
    return new McpHaotikaError('VALIDATION_ERROR', error.message, 400)
  }

  if (error instanceof HttpError && error.statusCode < 500) {
    const code =
      error.statusCode === 409
        ? 'CONFLICT'
        : error.statusCode === 404
          ? 'NOT_FOUND'
          : error.statusCode === 403
            ? 'FORBIDDEN'
            : error.statusCode === 429
              ? 'RATE_LIMIT_EXCEEDED'
              : 'VALIDATION_ERROR'
    return new McpHaotikaError(code, error.message, error.statusCode)
  }

  return new McpHaotikaError('INTERNAL_ERROR', 'Internal MCP tool error.', 500)
}

function createAuthorizationServerMetadata(config: McpHaotikaRuntimeConfig) {
  return {
    authorization_endpoint: new URL(
      '/oauth/authorize',
      config.oauthIssuer,
    ).toString(),
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    issuer: config.oauthIssuer,
    response_types_supported: ['code'],
    revocation_endpoint: new URL(
      '/oauth/revoke',
      config.oauthIssuer,
    ).toString(),
    scopes_supported: HAOTIKA_MCP_SCOPES,
    token_endpoint: new URL('/oauth/token', config.oauthIssuer).toString(),
    token_endpoint_auth_methods_supported: ['none'],
  }
}

function readAuthorizeQuery(query: unknown): Record<string, string> {
  if (!isRecord(query)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : '',
    ]),
  )
}

function readAuthorizeForm(body: unknown): Record<string, string> {
  return readAuthorizeQuery(body)
}

function validateAuthorizeQuery(
  query: Record<string, string>,
): string | undefined {
  if (query.response_type !== 'code') {
    return 'Некорректный response_type.'
  }

  if (!query.redirect_uri) {
    return 'Не указан redirect_uri.'
  }

  if (!query.client_id) {
    return 'Не указан client_id.'
  }

  if (!query.code_challenge) {
    return 'Не указан PKCE code_challenge.'
  }

  if (query.code_challenge_method !== 'S256') {
    return 'Поддерживается только PKCE S256.'
  }

  try {
    parseRequestedScopes(query.scope)
  } catch {
    return 'Запрошены неподдерживаемые разрешения.'
  }

  return undefined
}

function readTokenRequestBody(body: unknown): Record<string, string> {
  if (!isRecord(body)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : '',
    ]),
  )
}

function readClientCredentials(
  request: FastifyRequest,
  body: Record<string, string>,
): { clientId?: string | undefined; clientSecret?: string | undefined } {
  const authorization = request.headers.authorization

  if (typeof authorization === 'string' && authorization.startsWith('Basic ')) {
    const decoded = Buffer.from(
      authorization.slice('Basic '.length),
      'base64',
    ).toString('utf8')
    const separatorIndex = decoded.indexOf(':')

    if (separatorIndex >= 0) {
      return {
        clientId: decoded.slice(0, separatorIndex),
        clientSecret: decoded.slice(separatorIndex + 1),
      }
    }
  }

  return {
    clientId: body.client_id,
    clientSecret: body.client_secret,
  }
}

function sendMcpHttpError(
  reply: FastifyReply,
  statusCode: number,
  code: McpErrorPayload['error']['code'],
  message: string,
) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
    },
  } satisfies McpErrorPayload)
}

function sendOAuthError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  description: string,
) {
  return reply.code(statusCode).send({
    error,
    error_description: description,
  })
}

function renderAuthorizePage({
  errorMessage,
  query,
  values,
}: {
  errorMessage?: string | undefined
  query: Record<string, string>
  values?: Record<string, string> | undefined
}): string {
  let scopes: HaotikaMcpScope[] = []
  try {
    scopes = parseRequestedScopes(query.scope)
  } catch {
    // Invalid scopes are explained by validateAuthorizeQuery and cannot be granted.
  }
  const scopeLabels: Record<HaotikaMcpScope, string> = {
    'haotika:tasks.read': 'чтение задач',
    'haotika:calendar.read': 'чтение календаря',
    'haotika:shopping.read': 'чтение списка покупок',
    'haotika:cleaning.read': 'чтение уборки',
    'haotika:selfcare.read': 'чтение заботы о себе',
    'haotika:habits.read': 'чтение привычек',
    'haotika:stats.read': 'чтение статистики нагрузки',
    'haotika:tasks.write': 'создание, изменение и завершение задач',
    'haotika:shopping.write':
      'добавление, изменение и отметка купленных товаров в списке',
  }
  const canWrite = scopes.some((scope) => scope.endsWith('.write'))
  const permissions = scopes
    .map((scope) => `<li>${scopeLabels[scope]}</li>`)
    .join('\n')
  const hiddenFieldEntries = [
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'code_challenge',
    'code_challenge_method',
    'resource',
  ].map((name) => [name, query[name] ?? ''] as const)
  const hiddenFields = hiddenFieldEntries
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('\n')
  const errorBlock = errorMessage
    ? `<p class="error">${escapeHtml(errorMessage)}</p>`
    : ''

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Связать Haotika с ChatGPT</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fb; color: #17202a; }
    main { width: min(460px, calc(100vw - 32px)); background: #fff; border: 1px solid #d8dee8; border-radius: 8px; padding: 24px; box-shadow: 0 12px 28px rgba(25, 35, 55, 0.08); }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
    p { margin: 0 0 18px; color: #526071; line-height: 1.45; }
    ul { margin: 0 0 18px; padding-left: 20px; color: #344054; line-height: 1.55; }
    label { display: grid; gap: 6px; margin: 14px 0; font-size: 14px; color: #2e3a47; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #c7d0dd; border-radius: 6px; padding: 11px 12px; font: inherit; }
    button { width: 100%; border: 0; border-radius: 6px; padding: 12px; background: #1f6feb; color: white; font: inherit; font-weight: 600; cursor: pointer; }
    .error { color: #a42020; background: #fff0f0; border: 1px solid #ffc9c9; border-radius: 6px; padding: 10px 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Связать Haotika с ChatGPT</h1>
    <p>${canWrite ? 'ChatGPT запрашивает доступ к вашему личному планеру:' : 'ChatGPT запрашивает доступ только на чтение:'}</p>
    <ul>${permissions}</ul>
    ${canWrite ? '<p>Изменения задач и списка покупок сохраняются в Хаотике. Доступ действует только для вашего личного пространства.</p>' : ''}
    ${errorBlock}
    <form method="post" action="/oauth/authorize">
      ${hiddenFields}
      <label>Email
        <input type="email" name="email" autocomplete="email" value="${escapeHtml(values?.email ?? '')}" required>
      </label>
      <label>Пароль
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <button type="submit">${canWrite ? 'Разрешить указанный доступ' : 'Разрешить доступ на чтение'}</button>
    </form>
  </main>
</body>
</html>`
}

function registerUrlEncodedFormParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    return
  }

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))))
    },
  )
}

function readUserAgent(request: FastifyRequest): string | null {
  return typeof request.headers['user-agent'] === 'string'
    ? request.headers['user-agent']
    : null
}

function hasJsonRpcId(message: JsonRpcRequest): boolean {
  return message.id !== undefined
}

function isInvalidCredentialsError(error: unknown): boolean {
  return isRecord(error) && error.code === 'auth_invalid_credentials'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return character
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
