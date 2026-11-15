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
import {
  type AccessSessionValidator,
  JwtRequestAuthenticator,
} from '../../infrastructure/auth/jwt-request-authenticator.js'
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

  void it('uses the same revoked-session check for bearer and Alice body tokens', async () => {
    const config = createTestConfig()
    const token = await createAccessToken(config)
    let calls = 0
    app = buildTestApp(config, {
      isSessionActive(userId, sessionId) {
        assert.equal(userId, USER_ID)
        assert.equal(sessionId, '88888888-8888-4888-8888-888888888888')
        calls += 1
        return Promise.resolve(false)
      },
    })
    const regular = await app.inject({
      url: '/api/v1/session',
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(regular.statusCode, 401)
    for (const bodyToken of [true, false]) {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/alice/webhook',
        headers: bodyToken ? {} : { authorization: `Bearer ${token}` },
        payload: createAliceRequest(
          'добавь задачу проверить отчёт',
          bodyToken ? { token } : {},
        ),
      })
      assert.deepEqual(response.json(), {
        start_account_linking: {},
        version: '1.0',
      })
    }
    assert.equal(calls, 3)
  })

  void it('keeps the original session epoch when a refreshed Alice JWT has a newer iat', async (t) => {
    const config = createTestConfig()
    const sessionId = '018bcfe5-6800-7000-8000-000000000001'
    const spy = t.mock.method(TaskService.prototype, 'createTask')
    app = buildTestApp(config)
    for (const issuedAt of [1700000000, Math.floor(Date.now() / 1000)]) {
      const token = await createAccessToken(config, { sessionId, issuedAt })
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/alice/webhook',
        payload: createAliceRequest('добавь задачу проверить отчёт', { token }),
      })
      assert.equal(response.statusCode, 200)
    }
    assert.equal(spy.mock.calls.length, 2)
    for (const call of spy.mock.calls) {
      const context = call.arguments[0]
      assert.equal(
        context.auth?.integrationIssuedAt,
        '2023-11-14T22:13:20.000Z',
      )
    }
  })

  void it('explains restore conflicts without asking Alice to retry a stale command', async (t) => {
    const config = createTestConfig()
    const token = await createAccessToken(config)
    t.mock.method(TaskService.prototype, 'createTask', () =>
      Promise.reject(
        Object.assign(new Error('workspace_restored'), { code: 'P4009' }),
      ),
    )
    app = buildTestApp(config)
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/alice/webhook',
      payload: createAliceRequest('добавь задачу проверить отчёт', { token }),
    })
    const body = aliceResponseSchema.parse(response.json())
    assert.equal(response.statusCode, 200)
    assert.match(
      body.response?.text ?? '',
      /Данные восстановлены.*заново привяжите/,
    )
    assert.doesNotMatch(body.response?.text ?? '', /Попробуйте еще раз/)
  })

  void it('never calls a paid parser anonymously and bounds authenticated calls', async (t) => {
    let providerCalls = 0
    t.mock.method(globalThis, 'fetch', () => {
      providerCalls += 1
      return Promise.resolve(new Response(JSON.stringify({ output: [] })))
    })
    const config = createTestConfig()
    config.aliceCommandLlm = {
      apiFormat: 'responses',
      endpoint: 'https://example.invalid',
      model: 'test',
      apiKey: 'synthetic-test-key',
      provider: 'openai-compatible',
      timeoutMs: 1000,
    }
    app = buildTestApp(config)
    for (const command of [
      'помощь',
      'выход',
      'нужно как-нибудь разобраться с делами',
    ]) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/alice/webhook',
        payload: createAliceRequest(command),
      })
    }
    assert.equal(providerCalls, 0)
    const token = await createAccessToken(config)
    for (let attempt = 0; attempt < 31; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/alice/webhook',
        payload: createAliceRequest('нужно как-нибудь разобраться с делами', {
          token,
        }),
      })
    }
    assert.equal(providerCalls, 30)
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

function buildTestApp(
  config = createTestConfig(),
  sessionValidator?: AccessSessionValidator,
): FastifyInstance {
  const taskService = new TaskService(new MemoryTaskRepository())

  return buildApiApp({
    chaosInboxService: new ChaosInboxService(new MemoryChaosInboxRepository()),
    config,
    database: null,
    requestAuthenticator: new JwtRequestAuthenticator(
      config.jwtAuth!,
      sessionValidator,
    ),
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
  options: { sessionId?: string; issuedAt?: number } = {},
): Promise<string> {
  return new SignJWT({
    email: 'alice@planner.local',
    role: 'authenticated',
    session_id: options.sessionId ?? '88888888-8888-4888-8888-888888888888',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience(config.jwtAuth!.audience)
    .setExpirationTime('1h')
    .setIssuedAt(options.issuedAt)
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
