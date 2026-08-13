import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import fastifyRateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'

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
      aiContextService: {
        getTodayContext: () =>
          Promise.resolve({
            date: '2026-06-21',
            generatedAt: '2026-06-21T00:00:00.000Z',
            timezone: 'Europe/Astrakhan',
          }),
      } as unknown as AiContextService,
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
