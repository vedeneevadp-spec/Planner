import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  chaosInboxListRecordResponseSchema,
  sessionResponseSchema,
  taskListResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { z } from 'zod'

import { buildApiApp } from '../../bootstrap/build-app.js'
import { createApiConfig } from '../../bootstrap/config.js'
import { JwtRequestAuthenticator } from '../../infrastructure/auth/jwt-request-authenticator.js'
import {
  ChaosInboxService,
  MemoryChaosInboxRepository,
} from '../chaos-inbox/index.js'
import { MemorySessionRepository, SessionService } from '../session/index.js'
import { MemoryTaskRepository, TaskService } from '../tasks/index.js'

const JWT_SECRET = 'planner-test-jwt-secret-with-at-least-32-chars'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const aliceResponseSchema = z
  .object({
    response: z.object({ text: z.string() }).passthrough().optional(),
    start_account_linking: z.unknown().optional(),
  })
  .passthrough()

void describe('alice routes', () => {
  let app: FastifyInstance | null = null

  void afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  void it('returns account linking response when a task command has no token', async () => {
    app = buildTestApp()

    const response = await app.inject({
      method: 'POST',
      payload: {
        meta: {
          interfaces: {
            account_linking: {},
          },
          timezone: 'UTC',
        },
        request: {
          command: 'добавь задачу купить молоко',
          type: 'SimpleUtterance',
        },
        session: {
          new: false,
        },
        version: '1.0',
      },
      url: '/api/v1/alice/webhook',
    })

    assert.equal(response.statusCode, 200)

    const body = aliceResponseSchema.parse(response.json())

    assert.ok(body.start_account_linking)
  })

  void it('creates a planner task from an authenticated Alice command', async () => {
    const config = createTestConfig()
    const token = await createAccessToken(config)

    app = buildTestApp(config)

    const response = await app.inject({
      method: 'POST',
      payload: {
        meta: {
          interfaces: {
            account_linking: {},
          },
          timezone: 'UTC',
        },
        request: {
          command: 'добавь задачу купить молоко завтра в 9 часов',
          nlu: {
            entities: [
              {
                type: 'YANDEX.DATETIME',
                value: {
                  day: 1,
                  day_is_relative: true,
                  hour: 9,
                  minute: 0,
                },
              },
            ],
          },
          type: 'SimpleUtterance',
        },
        session: {
          new: false,
          user: {
            access_token: token,
          },
        },
        version: '1.0',
      },
      url: '/api/v1/alice/webhook',
    })

    assert.equal(response.statusCode, 200)
    assert.match(
      aliceResponseSchema.parse(response.json()).response?.text ?? '',
      /Добавила задачу/u,
    )

    const sessionResponse = await app.inject({
      headers: {
        authorization: `Bearer ${token}`,
      },
      method: 'GET',
      url: '/api/v1/session',
    })
    const session = sessionResponseSchema.parse(sessionResponse.json())
    const tasksResponse = await app.inject({
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': session.workspaceId,
      },
      method: 'GET',
      url: '/api/v1/tasks',
    })
    const tasks = taskListResponseSchema.parse(tasksResponse.json())

    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]?.title, 'купить молоко')
    assert.equal(tasks[0]?.plannedDate, getTomorrowUtcDateKey())
    assert.equal(tasks[0]?.plannedStartTime, '09:00')
  })

  void it('adds a voice shopping command to the shopping list', async () => {
    const config = createTestConfig()
    const token = await createAccessToken(config)

    app = buildTestApp(config)

    const response = await app.inject({
      method: 'POST',
      payload: {
        meta: {
          interfaces: {
            account_linking: {},
          },
          timezone: 'UTC',
        },
        request: {
          command: 'надо купить молоко',
          type: 'SimpleUtterance',
        },
        session: {
          new: false,
          user: {
            access_token: token,
          },
        },
        version: '1.0',
      },
      url: '/api/v1/alice/webhook',
    })

    assert.equal(response.statusCode, 200)
    assert.match(
      aliceResponseSchema.parse(response.json()).response?.text ?? '',
      /список покупок/u,
    )

    const sessionResponse = await app.inject({
      headers: {
        authorization: `Bearer ${token}`,
      },
      method: 'GET',
      url: '/api/v1/session',
    })
    const session = sessionResponseSchema.parse(sessionResponse.json())
    const shoppingResponse = await app.inject({
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': session.workspaceId,
      },
      method: 'GET',
      url: '/api/v1/chaos-inbox?kind=shopping&limit=200',
    })
    const shoppingList = chaosInboxListRecordResponseSchema.parse(
      shoppingResponse.json(),
    )

    assert.equal(shoppingList.items.length, 1)
    assert.equal(shoppingList.items[0]?.kind, 'shopping')
    assert.equal(shoppingList.items[0]?.source, 'voice')
    assert.equal(shoppingList.items[0]?.text, 'молоко')
  })

  void it('understands reversed shopping phrasing', async () => {
    const config = createTestConfig()
    const token = await createAccessToken(config)

    app = buildTestApp(config)

    const response = await app.inject({
      method: 'POST',
      payload: {
        meta: {
          interfaces: {
            account_linking: {},
          },
          timezone: 'UTC',
        },
        request: {
          command: 'запиши молоко в покупки',
          type: 'SimpleUtterance',
        },
        session: {
          new: false,
          user: {
            access_token: token,
          },
        },
        version: '1.0',
      },
      url: '/api/v1/alice/webhook',
    })

    assert.equal(response.statusCode, 200)
    assert.match(
      aliceResponseSchema.parse(response.json()).response?.text ?? '',
      /список покупок/u,
    )
  })

  void it('reads planned tasks for tomorrow', async () => {
    const config = createTestConfig()
    const token = await createAccessToken(config)

    app = buildTestApp(config)

    const createResponse = await app.inject({
      method: 'POST',
      payload: {
        meta: {
          interfaces: {
            account_linking: {},
          },
          timezone: 'UTC',
        },
        request: {
          command: 'добавь задачу позвонить маме завтра в 9 часов',
          nlu: {
            entities: [
              {
                type: 'YANDEX.DATETIME',
                value: {
                  day: 1,
                  day_is_relative: true,
                  hour: 9,
                  minute: 0,
                },
              },
            ],
          },
          type: 'SimpleUtterance',
        },
        session: {
          new: false,
          user: {
            access_token: token,
          },
        },
        version: '1.0',
      },
      url: '/api/v1/alice/webhook',
    })

    assert.equal(createResponse.statusCode, 200)

    const listResponse = await app.inject({
      method: 'POST',
      payload: {
        meta: {
          interfaces: {
            account_linking: {},
          },
          timezone: 'UTC',
        },
        request: {
          command: 'прочитай задачи на завтра',
          type: 'SimpleUtterance',
        },
        session: {
          new: false,
          user: {
            access_token: token,
          },
        },
        version: '1.0',
      },
      url: '/api/v1/alice/webhook',
    })
    const responseText =
      aliceResponseSchema.parse(listResponse.json()).response?.text ?? ''

    assert.equal(listResponse.statusCode, 200)
    assert.match(responseText, /На завтра/u)
    assert.match(responseText, /позвонить маме/u)
    assert.match(responseText, /09:00/u)
  })
})

function buildTestApp(config = createTestConfig()): FastifyInstance {
  const taskService = new TaskService(new MemoryTaskRepository())

  return buildApiApp({
    chaosInboxService: new ChaosInboxService(
      new MemoryChaosInboxRepository(),
      taskService,
    ),
    config,
    database: null,
    requestAuthenticator: new JwtRequestAuthenticator(config.jwtAuth!),
    sessionService: new SessionService(new MemorySessionRepository()),
    taskService,
  })
}

function createTestConfig() {
  return createApiConfig({
    API_AUTH_MODE: 'jwt',
    API_STORAGE_DRIVER: 'memory',
    AUTH_JWT_SECRET: JWT_SECRET,
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv)
}

async function createAccessToken(
  config: ReturnType<typeof createTestConfig>,
): Promise<string> {
  return new SignJWT({
    email: 'alice@planner.local',
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience(config.jwtAuth!.audience)
    .setExpirationTime('1h')
    .setIssuedAt()
    .setIssuer(config.jwtAuth!.issuer)
    .setSubject(USER_ID)
    .sign(new TextEncoder().encode(JWT_SECRET))
}

function getTomorrowUtcDateKey(): string {
  const date = new Date()

  date.setUTCDate(date.getUTCDate() + 1)

  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}
