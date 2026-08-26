import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import Fastify, { type FastifyInstance } from 'fastify'
import fastifyRateLimit from 'fastify-rate-limit'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  MemoryRateLimiter,
  type RateLimiter,
} from '../../bootstrap/rate-limit.js'
import type { AiContextService } from '../ai-context/index.js'
import { MemorySessionRepository, SessionService } from '../session/index.js'
import { MemoryMcpAuditLogRepository } from './mcp-haotika.audit.js'
import {
  McpOAuthService,
  MemoryMcpOAuthTokenRepository,
} from './mcp-haotika.auth.js'
import { registerMcpHaotikaRoutes } from './mcp-haotika.server.js'

void describe('MCP Haotika server', () => {
  let app: FastifyInstance | null = null

  void afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  void it('returns an MCP auth error that can trigger ChatGPT linking', async () => {
    app = createMcpTestApp({
      devNoAuth: false,
      rateLimitPerMinute: 30,
    })

    const response = await app.inject({
      method: 'POST',
      payload: {
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: { date: '2026-06-21' },
          name: 'get_today_context',
        },
      },
      url: '/mcp',
    })

    assert.equal(response.statusCode, 401)
    assert.equal(typeof response.headers['www-authenticate'], 'string')

    const body = readMcpJsonRpcResponse(response)

    assert.equal(body.result?.isError, true)
    assert.equal(body.result?.structuredContent.error.code, 'UNAUTHORIZED')
    assert.equal(typeof body.result?._meta['mcp/www_authenticate'], 'string')
  })

  void it('rate limits tool calls per token or dev user', async () => {
    app = createMcpTestApp({
      devNoAuth: true,
      rateLimitPerMinute: 1,
    })

    const request = {
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: { date: '2026-06-21' },
        name: 'get_today_context',
      },
    }
    const firstResponse = await app.inject({
      method: 'POST',
      payload: request,
      url: '/mcp',
    })
    const secondResponse = await app.inject({
      method: 'POST',
      payload: { ...request, id: 2 },
      url: '/mcp',
    })

    const firstBody = readMcpJsonRpcResponse(firstResponse)
    const secondBody = readMcpJsonRpcResponse(secondResponse)

    assert.equal(firstBody.result?.isError, undefined)
    assert.equal(secondBody.result?.isError, true)
    assert.equal(
      secondBody.result?.structuredContent.error.code,
      'RATE_LIMIT_EXCEEDED',
    )
  })

  void it('rejects request bodies above the MCP endpoint budget', async () => {
    app = createMcpTestApp({
      devNoAuth: true,
      rateLimitPerMinute: 30,
    })

    const response = await app.inject({
      method: 'POST',
      payload: {
        id: 1,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: { query: 'x'.repeat(300 * 1024) },
          name: 'search_planner',
        },
      },
      url: '/mcp',
    })

    assert.equal(response.statusCode, 413)
  })

  void it('rejects an oversized batch before tool fan-out', async () => {
    let toolCalls = 0

    app = createMcpTestApp({
      aiContextService: {
        getTodayContext: () => {
          toolCalls += 1

          return Promise.resolve(createTodayContextResult())
        },
      } as unknown as AiContextService,
      devNoAuth: true,
      rateLimitPerMinute: 30,
    })

    const response = await app.inject({
      method: 'POST',
      payload: Array.from({ length: 21 }, (_, index) =>
        createTodayToolCall(index + 1),
      ),
      url: '/mcp',
    })

    assert.equal(response.statusCode, 400)
    assert.equal(
      response.json<{ error: { code: number } }>().error.code,
      -32600,
    )
    assert.equal(toolCalls, 0)
  })

  void it('rate limits the HTTP request before batch fan-out', async () => {
    let rateLimitCalls = 0
    let toolCalls = 0

    app = createMcpTestApp({
      aiContextService: {
        getTodayContext: () => {
          toolCalls += 1

          return Promise.resolve(createTodayContextResult())
        },
      } as unknown as AiContextService,
      devNoAuth: true,
      rateLimiter: {
        consume(options) {
          rateLimitCalls += 1
          assert.match(options.key, /^mcp:request:ip:/)

          return Promise.reject(
            new HttpError(
              429,
              'rate_limit_exceeded',
              'Too many requests. Please try again later.',
            ),
          )
        },
      },
      rateLimitPerMinute: 30,
    })

    const response = await app.inject({
      method: 'POST',
      payload: [createTodayToolCall(1), createTodayToolCall(2)],
      url: '/mcp',
    })

    assert.equal(response.statusCode, 429)
    assert.equal(rateLimitCalls, 1)
    assert.equal(toolCalls, 0)
  })

  void it('limits batch execution concurrency and preserves response order', async () => {
    let activeToolCalls = 0
    let maxActiveToolCalls = 0
    let toolCalls = 0

    app = createMcpTestApp({
      aiContextService: {
        getTodayContext: () =>
          new Promise((resolve) => {
            activeToolCalls += 1
            toolCalls += 1
            maxActiveToolCalls = Math.max(maxActiveToolCalls, activeToolCalls)

            setImmediate(() => {
              activeToolCalls -= 1
              resolve(createTodayContextResult())
            })
          }),
      } as unknown as AiContextService,
      devNoAuth: true,
      rateLimitPerMinute: 100,
    })

    const response = await app.inject({
      method: 'POST',
      payload: Array.from({ length: 20 }, (_, index) =>
        createTodayToolCall(index + 1),
      ),
      url: '/mcp',
    })

    assert.equal(response.statusCode, 200)

    const body = response.json<Array<{ id: number }>>()

    assert.deepEqual(
      body.map((message) => message.id),
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
    assert.equal(toolCalls, 20)
    assert.equal(maxActiveToolCalls, 4)
  })

  void it('keeps initialize and tools/list compatible within batch budgets', async () => {
    app = createMcpTestApp({
      devNoAuth: true,
      rateLimitPerMinute: 30,
    })

    const response = await app.inject({
      method: 'POST',
      payload: [
        { id: 1, jsonrpc: '2.0', method: 'initialize' },
        { id: 2, jsonrpc: '2.0', method: 'tools/list' },
      ],
      url: '/mcp',
    })

    assert.equal(response.statusCode, 200)

    const body = response.json<
      Array<{
        id: number
        result: {
          protocolVersion?: string
          tools?: Array<{ name: string }>
        }
      }>
    >()

    assert.equal(body[0]?.result.protocolVersion, '2025-11-25')
    assert.equal(
      body[1]?.result.tools?.some((tool) => tool.name === 'get_today_context'),
      true,
    )
  })

  void it('renders a safe OAuth page when the shared credential limit is reached', async () => {
    app = createMcpTestApp({
      devNoAuth: false,
      oauthService: {
        completeAuthorize: () =>
          Promise.reject(
            new HttpError(
              429,
              'rate_limit_exceeded',
              'Too many requests. Please try again later.',
            ),
          ),
      } as unknown as McpOAuthService,
      rateLimitPerMinute: 30,
    })

    const response = await app.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      payload: new URLSearchParams({
        client_id: 'chatgpt',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        email: 'owner@example.test',
        password: 'wrong-password',
        redirect_uri: 'https://chatgpt.test/oauth/callback',
        response_type: 'code',
      }).toString(),
      url: '/oauth/authorize',
    })

    assert.equal(response.statusCode, 429)
    assert.match(String(response.headers['content-type']), /text\/html/)
    assert.match(response.body, /Слишком много попыток/)
    assert.doesNotMatch(response.body, /Too many requests/)
  })

  void it('rate limits OAuth authorize before password verification', async () => {
    let authorizeCalls = 0

    app = createMcpTestApp({
      devNoAuth: false,
      oauthService: {
        completeAuthorize: () => {
          authorizeCalls += 1

          return Promise.resolve(
            'https://chatgpt.test/oauth/callback?code=code',
          )
        },
      } as unknown as McpOAuthService,
      rateLimiter: {
        consume(options) {
          assert.match(options.key, /^mcp:oauth-authorize:ip:/)

          return Promise.reject(
            new HttpError(
              429,
              'rate_limit_exceeded',
              'Too many requests. Please try again later.',
            ),
          )
        },
      },
      rateLimitPerMinute: 30,
    })

    const response = await app.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      payload: new URLSearchParams({
        client_id: 'chatgpt',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        email: 'owner@example.test',
        password: 'wrong-password',
        redirect_uri: 'https://chatgpt.test/oauth/callback',
        response_type: 'code',
      }).toString(),
      url: '/oauth/authorize',
    })

    assert.equal(response.statusCode, 429)
    assert.equal(authorizeCalls, 0)
    assert.match(response.body, /Слишком много попыток/)
  })

  void it('enforces the Fastify OAuth route limit before verification', async () => {
    let authorizeCalls = 0

    app = createMcpTestApp({
      devNoAuth: false,
      oauthService: {
        completeAuthorize: () => {
          authorizeCalls += 1

          return Promise.resolve(
            'https://chatgpt.test/oauth/callback?code=code',
          )
        },
      } as unknown as McpOAuthService,
      rateLimiter: {
        consume() {
          return Promise.resolve()
        },
      },
      rateLimitPerMinute: 1,
    })

    let response: Awaited<ReturnType<FastifyInstance['inject']>> | null = null

    for (let requestIndex = 0; requestIndex <= 100; requestIndex += 1) {
      response = await app.inject({
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        payload: new URLSearchParams({
          client_id: 'chatgpt',
          code_challenge: 'challenge',
          code_challenge_method: 'S256',
          email: 'owner@example.test',
          password: 'wrong-password',
          redirect_uri: 'https://chatgpt.test/oauth/callback',
          response_type: 'code',
        }).toString(),
        url: '/oauth/authorize',
      })
    }

    assert.ok(response)
    assert.equal(response.statusCode, 429)
    assert.equal(authorizeCalls, 100)
    assert.equal(typeof response.headers['retry-after'], 'string')
  })
})

function createMcpTestApp(options: {
  aiContextService?: AiContextService
  devNoAuth: boolean
  oauthService?: McpOAuthService
  rateLimiter?: RateLimiter
  rateLimitPerMinute: number
}): FastifyInstance {
  const app = Fastify({ logger: false })
  const config = {
    allowedRedirectUris: ['https://chatgpt.test/oauth/callback'],
    devNoAuth: options.devNoAuth,
    enabled: true,
    oauthIssuer: 'https://chaotika.test',
    publicBaseUrl: 'https://chaotika.test',
    rateLimitPerMinute: options.rateLimitPerMinute,
  }
  const sessionService = new SessionService(new MemorySessionRepository())

  app.register(async (instance) => {
    instance.register(fastifyRateLimit, {
      errorResponseBuilder: () =>
        new HttpError(
          429,
          'rate_limit_exceeded',
          'Too many requests. Please try again later.',
        ),
      global: false,
    })
    await instance.after()
    registerMcpHaotikaRoutes(instance, {
      aiContextService:
        options.aiContextService ??
        ({
          getTodayContext: () => Promise.resolve(createTodayContextResult()),
        } as unknown as AiContextService),
      auditRepository: new MemoryMcpAuditLogRepository(),
      config,
      oauthService:
        options.oauthService ??
        new McpOAuthService(new MemoryMcpOAuthTokenRepository(), config),
      rateLimiter: options.rateLimiter ?? new MemoryRateLimiter(),
      sessionService,
    })
  })

  return app
}

function createTodayToolCall(id: number) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      arguments: { date: '2026-06-21' },
      name: 'get_today_context',
    },
  }
}

function createTodayContextResult() {
  return {
    date: '2026-06-21',
    generatedAt: '2026-06-21T00:00:00.000Z',
    timezone: 'Europe/Astrakhan',
  }
}

interface McpJsonRpcToolResponse {
  result?: {
    _meta: Record<string, unknown>
    isError?: boolean
    structuredContent: {
      error: {
        code: string
      }
    }
  }
}

function readMcpJsonRpcResponse(response: {
  json: () => unknown
}): McpJsonRpcToolResponse {
  const body = response.json()

  assert.equal(isRecord(body), true)

  return body as McpJsonRpcToolResponse
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
