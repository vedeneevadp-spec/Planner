import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import Fastify, { type FastifyInstance } from 'fastify'

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
})

function createMcpTestApp(options: {
  devNoAuth: boolean
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

  registerMcpHaotikaRoutes(app, {
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
    oauthService: new McpOAuthService(
      new MemoryMcpOAuthTokenRepository(),
      config,
    ),
    sessionService,
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
