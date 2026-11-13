import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createChaosInboxItemsInputSchema,
  generateUuidV7,
  newTaskInputSchema,
} from '@planner/contracts'
import Fastify from 'fastify'

import { MemoryRateLimiter } from '../../bootstrap/rate-limit.js'
import {
  AiContextService,
  HAOTIKA_MCP_READ_SCOPES,
  HAOTIKA_MCP_SCOPES,
  type HaotikaMcpScope,
} from '../ai-context/index.js'
import {
  ChaosInboxService,
  MemoryChaosInboxRepository,
} from '../chaos-inbox/index.js'
import { MemorySessionRepository, SessionService } from '../session/index.js'
import { MemoryTaskRepository, TaskService } from '../tasks/index.js'
import { MemoryMcpAuditLogRepository } from './mcp-haotika.audit.js'
import {
  hashOpaqueToken,
  McpOAuthService,
  MemoryMcpOAuthTokenRepository,
  parseRequestedScopes,
} from './mcp-haotika.auth.js'
import { McpPlannerService } from './mcp-haotika.planner.js'
import { registerMcpHaotikaRoutes } from './mcp-haotika.server.js'
import { MCP_HAOTIKA_TOOLS } from './mcp-haotika.tools.js'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '44444444-4444-4444-8444-444444444444'
const CONFIG = {
  allowedRedirectUris: ['https://chatgpt.test/oauth/callback'],
  devNoAuth: false,
  enabled: true,
  oauthIssuer: 'https://chaotika.test',
  publicBaseUrl: 'https://chaotika.test',
  rateLimitPerMinute: 100,
}

async function harness() {
  const app = Fastify({ logger: false })
  const sessions = new SessionService(new MemorySessionRepository())
  const tasks = new TaskService(new MemoryTaskRepository())
  const shopping = new ChaosInboxService(
    new MemoryChaosInboxRepository(new MemoryTaskRepository()),
  )
  const tokens = new MemoryMcpOAuthTokenRepository()
  const audit = new MemoryMcpAuditLogRepository()
  async function token(name: string, scopes: HaotikaMcpScope[], userId = USER) {
    await tokens.createToken({
      accessTokenHash: hashOpaqueToken(name),
      clientId: 'chatgpt',
      expiresAt: new Date(Date.now() + 60_000),
      issuer: CONFIG.oauthIssuer,
      refreshTokenHash: hashOpaqueToken(`${name}-refresh`),
      resource: `${CONFIG.publicBaseUrl}/mcp`,
      scopes,
      userId,
    })
  }
  await token('reader', [...HAOTIKA_MCP_READ_SCOPES])
  await token('writer', [...HAOTIKA_MCP_SCOPES])
  await token('other', [...HAOTIKA_MCP_SCOPES], OTHER)
  await token('shopping-only', [
    'haotika:shopping.read',
    'haotika:shopping.write',
  ])
  const oauth = new McpOAuthService(tokens, CONFIG)
  registerMcpHaotikaRoutes(app, {
    aiContextService: new AiContextService({
      sessionService: sessions,
      taskService: tasks,
      chaosInboxService: shopping,
    }),
    plannerService: new McpPlannerService({
      sessionService: sessions,
      taskService: tasks,
      shoppingService: shopping,
    }),
    auditRepository: audit,
    oauthService: oauth,
    config: CONFIG,
    rateLimiter: new MemoryRateLimiter(),
    sessionService: sessions,
  })
  async function call(name: string, args: unknown, bearer = 'writer') {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
    })
    return {
      response,
      result: response.json<{
        result: {
          isError?: boolean
          structuredContent: Record<string, unknown>
          _meta?: Record<string, unknown>
        }
      }>().result,
    }
  }
  return { app, tasks, shopping, sessions, audit, oauth, call }
}

function entity(
  result: { isError?: boolean; structuredContent: Record<string, unknown> },
  key: 'task' | 'item',
) {
  assert.equal(
    result.isError,
    undefined,
    JSON.stringify(result.structuredContent),
  )
  return result.structuredContent[key] as {
    id: string
    version: number
    title: string
    text: string
    status: string
    note: string
    plannedDate: string | null
    dueDate: string | null
    completedAt: string | null
    project: string
  }
}

void test('read-only grants cannot execute any write, and reauthorization retains existing scopes', async (t) => {
  const h = await harness()
  t.after(() => h.app.close())
  for (const tool of MCP_HAOTIKA_TOOLS.filter(
    (tool) => !tool.annotations.readOnlyHint,
  )) {
    const { response, result } = await h.call(tool.name, {}, 'reader')
    assert.equal(response.statusCode, 403)
    assert.deepEqual(
      (result.structuredContent.error as { code: string }).code,
      'FORBIDDEN_SCOPE',
    )
    assert.match(
      String(response.headers['www-authenticate']),
      /insufficient_scope/,
    )
    assert.match(
      String(result._meta?.['mcp/www_authenticate']),
      /haotika:tasks.read/,
    )
    assert.match(String(result._meta?.['mcp/www_authenticate']), /\.write/)
  }
  assert.equal(h.audit.logs.length, 0)
  const anonymous = await h.call('create_task', {}, '')
  assert.equal(anonymous.response.statusCode, 401)
  assert.match(
    String(anonymous.response.headers['www-authenticate']),
    /haotika:tasks.write/,
  )
  const wrongDomain = await h.call('complete_task', {}, 'shopping-only')
  assert.equal(wrongDomain.response.statusCode, 403)
  assert.deepEqual(parseRequestedScopes(undefined), [
    ...HAOTIKA_MCP_READ_SCOPES,
  ])
  assert.deepEqual(
    parseRequestedScopes('haotika:tasks.read haotika:tasks.write'),
    ['haotika:tasks.read', 'haotika:tasks.write'],
  )
  const refreshed = await h.oauth.exchangeToken({
    grantType: 'refresh_token',
    refreshToken: 'reader-refresh',
    clientId: 'chatgpt',
  })
  assert.equal(refreshed.scope.includes('.write'), false)
})

void test('tasks can be created, found, changed and completed with duplicate and conflict protection', async (t) => {
  const h = await harness()
  t.after(() => h.app.close())
  const input = {
    id: generateUuidV7(),
    title: 'MCP test task',
    note: 'Keep this full note',
    plannedDate: '2026-11-13',
    dueDate: '2026-11-15',
  }
  const created = entity((await h.call('create_task', input)).result, 'task')
  const retry = entity((await h.call('create_task', input)).result, 'task')
  assert.equal(retry.id, created.id)
  assert.equal(retry.version, created.version)
  const listed = (await h.call('list_tasks', { search: 'MCP test', limit: 1 }))
    .result.structuredContent
  assert.equal((listed.items as Array<{ id: string }>)[0]?.id, created.id)
  const latest = entity(
    (await h.call('get_task', { id: created.id })).result,
    'task',
  )
  assert.equal(latest.note, input.note)
  assert.equal(Object.hasOwn(latest, 'userId'), false)
  const updated = entity(
    (
      await h.call('update_task', {
        id: latest.id,
        expectedVersion: latest.version,
        title: 'Renamed task',
        plannedDate: null,
      })
    ).result,
    'task',
  )
  assert.equal(updated.title, 'Renamed task')
  assert.equal(updated.note, input.note)
  assert.equal(updated.plannedDate, null)
  assert.equal(updated.dueDate, input.dueDate)
  const stale = await h.call('update_task', {
    id: latest.id,
    expectedVersion: latest.version,
    note: 'Stale overwrite',
  })
  assert.equal(
    (stale.result.structuredContent.error as { code: string }).code,
    'CONFLICT',
  )
  const done = entity(
    (
      await h.call('complete_task', {
        id: updated.id,
        expectedVersion: updated.version,
      })
    ).result,
    'task',
  )
  assert.equal(done.status, 'done')
  assert.ok(done.completedAt)
  assert.equal(
    entity((await h.call('get_task', { id: done.id })).result, 'task').note,
    input.note,
  )
  const duplicate = await h.call('create_task', {
    ...input,
    title: 'Different creation',
  })
  assert.equal(
    (duplicate.result.structuredContent.error as { code: string }).code,
    'CONFLICT',
  )
  for (const name of ['get_task', 'update_task', 'complete_task']) {
    const args =
      name === 'get_task'
        ? { id: created.id }
        : name === 'complete_task'
          ? { id: created.id, expectedVersion: done.version }
          : {
              id: created.id,
              expectedVersion: done.version,
              title: 'Other user',
            }
    const foreign = await h.call(name, args, 'other')
    assert.equal(
      (foreign.result.structuredContent.error as { code: string }).code,
      'NOT_FOUND',
    )
  }
  assert.equal(
    (h.audit.logs[0]?.input as { title: string }).title,
    '[redacted]',
  )
  assert.equal((h.audit.logs[0]?.input as { note: string }).note, '[redacted]')
})

void test('shopping writes preserve other fields, do not duplicate purchases and reject foreign or non-shopping records', async (t) => {
  const h = await harness()
  t.after(() => h.app.close())
  const input = {
    id: generateUuidV7(),
    text: 'MCP test shopping',
    priority: 'high',
    shoppingCategory: 'groceries',
  }
  const created = entity(
    (await h.call('create_shopping_item', input)).result,
    'item',
  )
  assert.equal(
    entity((await h.call('create_shopping_item', input)).result, 'item').id,
    created.id,
  )
  const listed = (
    await h.call('list_shopping', { search: 'MCP test', limit: 1 })
  ).result.structuredContent
  assert.equal((listed.items as Array<{ id: string }>)[0]?.id, created.id)
  const updated = entity(
    (
      await h.call('update_shopping_item', {
        id: created.id,
        text: 'Two cartons',
        dueDate: '2026-11-14',
      })
    ).result,
    'item',
  )
  assert.equal(updated.text, 'Two cartons')
  assert.equal(
    entity(
      (await h.call('get_shopping_item', { id: created.id })).result,
      'item',
    ).dueDate,
    '2026-11-14',
  )
  const done = entity(
    (await h.call('complete_shopping_item', { id: created.id })).result,
    'item',
  )
  assert.equal(done.status, 'archived')
  assert.ok(done.completedAt)
  const repeated = entity(
    (await h.call('complete_shopping_item', { id: created.id })).result,
    'item',
  )
  assert.equal(repeated.version, done.version)
  assert.equal(repeated.completedAt, done.completedAt)
  const foreign = await h.call(
    'update_shopping_item',
    { id: created.id, text: 'Other user' },
    'other',
  )
  assert.equal(
    (foreign.result.structuredContent.error as { code: string }).code,
    'NOT_FOUND',
  )
  const context = {
    auth: null,
    actorUserId: USER,
    actorDisplayName: 'Test',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    role: 'owner' as const,
    workspaceKind: 'personal' as const,
  }
  const [note] = await h.shopping.createItems(
    context,
    createChaosInboxItemsInputSchema.parse({
      items: [{ text: 'Private inbox note', kind: 'note' }],
    }),
  )
  const wrongKind = await h.call('update_shopping_item', {
    id: note?.id,
    text: 'Must not change',
  })
  assert.equal(
    (wrongKind.result.structuredContent.error as { code: string }).code,
    'NOT_FOUND',
  )
})

void test('strict inputs reject identity injection, missing creation IDs and empty patches', async (t) => {
  const h = await harness()
  t.after(() => h.app.close())
  for (const [name, args] of [
    ['create_task', { title: 'Missing id' }],
    [
      'create_task',
      { id: generateUuidV7(), title: 'Invalid date', dueDate: '2026-02-30' },
    ],
    [
      'create_task',
      { id: generateUuidV7(), title: 'Bad identity', userId: OTHER },
    ],
    [
      'create_shopping_item',
      { id: generateUuidV7(), text: 'Bad workspace', workspaceId: OTHER },
    ],
    ['update_task', { id: generateUuidV7(), expectedVersion: 1 }],
    ['update_shopping_item', { id: generateUuidV7() }],
    ['complete_task', { id: generateUuidV7() }],
  ] as const) {
    const { result } = await h.call(name, args)
    assert.equal(
      (result.structuredContent.error as { code: string }).code,
      'VALIDATION_ERROR',
      name,
    )
  }
})

void test('successful changes remain successful if the audit store fails', async (t) => {
  const h = await harness()
  t.after(() => h.app.close())
  h.audit.createLog = () => Promise.reject(new Error('Audit unavailable'))
  const task = entity(
    (
      await h.call('create_task', {
        id: generateUuidV7(),
        title: 'Committed despite audit failure',
      })
    ).result,
    'task',
  )
  assert.equal(
    entity((await h.call('get_task', { id: task.id })).result, 'task').title,
    task.title,
  )
})

void test('OAuth consent shows exactly the requested read and write permissions', async (t) => {
  const h = await harness()
  t.after(() => h.app.close())
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'chatgpt',
    redirect_uri: CONFIG.allowedRedirectUris[0]!,
    code_challenge: 'challenge',
    code_challenge_method: 'S256',
    scope: 'haotika:tasks.read haotika:tasks.write',
  })
  const page = await h.app.inject({
    url: `/oauth/authorize?${query.toString()}`,
  })
  assert.match(page.body, /создание, изменение и завершение задач/)
  assert.doesNotMatch(
    page.body,
    /доступ только на чтение|чтение привычек|чтение списка покупок/,
  )
  query.set('scope', 'haotika:shopping.read')
  const readPage = await h.app.inject({
    url: `/oauth/authorize?${query.toString()}`,
  })
  assert.match(readPage.body, /доступ только на чтение/)
  assert.doesNotMatch(readPage.body, /создание, изменение|чтение задач/)
})

void test('task detail updates preserve fixed time zones and recurrence', async (t) => {
  const h = await harness()
  t.after(() => h.app.close())
  const context = {
    auth: null,
    actorUserId: USER,
    actorDisplayName: 'Test',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    role: 'owner' as const,
    workspaceKind: 'personal' as const,
    clientTimeZone: 'Asia/Novosibirsk',
  }
  const task = await h.tasks.createTask(
    context,
    newTaskInputSchema.parse({
      title: 'Timed task',
      note: '',
      project: '',
      plannedDate: '2026-11-13',
      plannedStartTime: '10:00',
      plannedEndTime: '11:00',
      recurrence: { frequency: 'daily', startDate: '2026-11-13' },
    }),
  )
  const updated = (
    await h.call('update_task', {
      id: task.id,
      expectedVersion: task.version,
      note: 'Only the note changes',
    })
  ).result
  entity(updated, 'task')
  const current = await h.tasks.getTask(context, task.id)
  assert.deepEqual(current.schedule, task.schedule)
  assert.deepEqual(current.recurrence, task.recurrence)
  assert.equal(current.plannedStartTime, '10:00')
})
