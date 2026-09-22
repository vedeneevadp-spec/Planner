import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  chaosInboxItemRecordSchema,
  chaosInboxListRecordResponseSchema,
  sessionResponseSchema,
  taskListResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
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
    response: z
      .object({ end_session: z.boolean(), text: z.string() })
      .passthrough()
      .optional(),
    start_account_linking: z.unknown().optional(),
    version: z.literal('1.0'),
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

  for (const scenario of [
    {
      name: 'offers help without requiring account linking',
      command: 'помощь',
      authenticated: false,
      endSession: false,
      text: /Я добавляю задачи и покупки в Chaotika/u,
    },
    {
      name: 'ends the dialogue without requiring account linking',
      command: 'выход',
      authenticated: false,
      endSession: true,
      text: /Готово, выхожу/u,
    },
    {
      name: 'greets a linked account on an empty launch',
      command: '',
      authenticated: true,
      endSession: false,
      text: /Могу добавить задачу или покупку/u,
    },
    {
      name: 'asks to clarify an incomplete task instead of creating it',
      command: 'добавь задачу завтра',
      authenticated: true,
      endSession: false,
      text: /Что добавить/u,
    },
  ]) {
    void it(scenario.name, async () => {
      const config = createTestConfig()
      const token = await createAccessToken(config)
      app = buildTestApp(config)

      const response = await app.inject({
        method: 'POST',
        payload: createAliceRequest(scenario.command, {
          ...(scenario.authenticated ? { token } : {}),
        }),
        url: '/api/v1/alice/webhook',
      })
      const body = aliceResponseSchema.parse(response.json())

      assert.equal(response.statusCode, 200)
      assert.equal(response.headers['cache-control'], 'no-store')
      assert.equal(body.start_account_linking, undefined)
      assert.equal(body.response?.end_session, scenario.endSession)
      assert.match(body.response?.text ?? '', scenario.text)

      const sessionResponse = await app.inject({
        headers: { authorization: `Bearer ${token}` },
        method: 'GET',
        url: '/api/v1/session',
      })
      const session = sessionResponseSchema.parse(sessionResponse.json())
      const headers = {
        authorization: `Bearer ${token}`,
        'x-workspace-id': session.workspaceId,
      }
      const tasksResponse = await app.inject({
        headers,
        method: 'GET',
        url: '/api/v1/tasks',
      })
      const shoppingResponse = await app.inject({
        headers,
        method: 'GET',
        url: '/api/v1/chaos-inbox?kind=shopping',
      })

      assert.equal(tasksResponse.statusCode, 200)
      assert.deepEqual(taskListResponseSchema.parse(tasksResponse.json()), [])
      assert.equal(shoppingResponse.statusCode, 200)
      assert.deepEqual(
        chaosInboxListRecordResponseSchema.parse(shoppingResponse.json()).items,
        [],
      )
    })
  }

  void it('starts account linking for an unlinked empty launch', async () => {
    app = buildTestApp()

    const response = await app.inject({
      method: 'POST',
      payload: createAliceRequest(''),
      url: '/api/v1/alice/webhook',
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(aliceResponseSchema.parse(response.json()), {
      start_account_linking: {},
      version: '1.0',
    })
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

    const item = shoppingList.items[0]
    assert.ok(item)
    const headers = {
      authorization: `Bearer ${token}`,
      'x-workspace-id': session.workspaceId,
    }
    const updateResponse = await app.inject({
      headers,
      method: 'PATCH',
      payload: { isFavorite: true, shoppingCategory: 'groceries' },
      url: `/api/v1/chaos-inbox/${item.id}`,
    })
    const updated = chaosInboxItemRecordSchema.parse(updateResponse.json())

    assert.equal(updateResponse.statusCode, 200)
    assert.equal(updated.id, item.id)
    assert.equal(updated.isFavorite, true)
    assert.equal(updated.shoppingCategory, 'groceries')
    assert.equal(updated.source, 'voice')
    assert.equal(updated.text, 'молоко')

    const rereadResponse = await app.inject({
      headers,
      method: 'GET',
      url: '/api/v1/chaos-inbox?kind=shopping',
    })

    assert.equal(rereadResponse.statusCode, 200)
    assert.deepEqual(
      chaosInboxListRecordResponseSchema.parse(rereadResponse.json()).items,
      [updated],
    )
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

  void it('creates and reads today using the Alice timezone across UTC midnight', async (context) => {
    context.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-09-18T23:30:00.000Z'),
    })
    const config = createTestConfig()
    const token = await createAccessToken(config)
    app = buildTestApp(config)

    for (const [timeZone, title] of [
      ['Asia/Novosibirsk', 'позвонить маме'],
      ['UTC', 'проверить отчет'],
    ] as const) {
      const createResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        payload: createAliceRequest(
          `добавь задачу ${title} сегодня в 9 часов`,
          {
            timeZone,
            token,
          },
        ),
        url: '/api/v1/alice/webhook',
      })

      assert.equal(createResponse.statusCode, 200)
      assert.match(
        aliceResponseSchema.parse(createResponse.json()).response?.text ?? '',
        /Добавила задачу/u,
      )
    }

    const sessionResponse = await app.inject({
      headers: { authorization: `Bearer ${token}` },
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
    assert.equal(tasks.length, 2)
    const localTask = tasks.find((task) => task.title === 'позвонить маме')
    assert.equal(localTask?.plannedDate, '2026-09-19')
    assert.equal(localTask?.plannedStartTime, '09:00')
    assert.equal(
      tasks.find((task) => task.title === 'проверить отчет')?.plannedDate,
      '2026-09-18',
    )

    const response = await app.inject({
      method: 'POST',
      payload: createAliceRequest('прочитай задачи на сегодня', {
        timeZone: 'Asia/Novosibirsk',
        token,
      }),
      url: '/api/v1/alice/webhook',
    })
    const body = aliceResponseSchema.parse(response.json())

    assert.equal(response.statusCode, 200)
    assert.equal(body.response?.end_session, false)
    assert.match(body.response?.text ?? '', /На сегодня/u)
    assert.match(body.response?.text ?? '', /09:00 позвонить маме/u)
    assert.doesNotMatch(body.response?.text ?? '', /проверить отчет/u)
  })
})

function createAliceRequest(
  command: string,
  { token, timeZone = 'UTC' }: { token?: string; timeZone?: string } = {},
) {
  return {
    meta: { interfaces: { account_linking: {} }, timezone: timeZone },
    request: { command, type: 'SimpleUtterance' },
    session: {
      new: !command,
      ...(token ? { user: { access_token: token } } : {}),
    },
    version: '1.0',
  }
}

function buildTestApp(config = createTestConfig()): FastifyInstance {
  const taskService = new TaskService(new MemoryTaskRepository())

  return buildApiApp({
    chaosInboxService: new ChaosInboxService(new MemoryChaosInboxRepository()),
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
  })
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
