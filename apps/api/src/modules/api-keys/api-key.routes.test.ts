import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import {
  type ApiKeyListResponse,
  type ApiKeyScope,
  type ChaosInboxCreatedRecordResponse,
  type ChaosInboxItemRecord,
  type ChaosInboxListRecordResponse,
  generateUuidV7,
  type SessionResponse,
  type TaskListPageResponse,
  type TaskRecord,
} from '@planner/contracts'

import { buildApiApp } from '../../bootstrap/build-app.js'
import { createApiConfig } from '../../bootstrap/config.js'
import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import {
  ChaosInboxService,
  MemoryChaosInboxRepository,
} from '../chaos-inbox/index.js'
import { MemorySessionRepository, SessionService } from '../session/index.js'
import { MemoryTaskRepository, TaskService } from '../tasks/index.js'
import { hashApiKey, MemoryApiKeyRepository } from './api-key.repository.js'
import { ApiKeyService } from './api-key.service.js'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '44444444-4444-4444-8444-444444444444'
const WORKSPACE = '22222222-2222-4222-8222-222222222222'
const sessionHeaders = {
  authorization: 'Bearer owner-session',
  'x-workspace-id': WORKSPACE,
}
const authFor = (userId: string): AuthenticatedRequestContext => ({
  accessToken: 'session',
  claims: {
    sub: userId,
    role: 'authenticated',
    payload: { sub: userId, role: 'authenticated' },
  },
})

function harness() {
  const repository = new MemoryApiKeyRepository()
  const keys = new ApiKeyService(repository)
  const sessions = new MemorySessionRepository()
  const originalResolve = sessions.resolve.bind(sessions)
  let access: 'owner' | 'guest' | 'denied' = 'owner'
  sessions.resolve = async (ctx) => {
    if (ctx.auth?.claims.payload.api_key_id && access === 'denied')
      throw new HttpError(403, 'workspace_access_denied', 'Access denied')
    const result = await originalResolve(ctx)
    return ctx.auth?.claims.payload.api_key_id && access === 'guest'
      ? { ...result, role: 'guest', groupRole: null }
      : result
  }
  const tasks = new MemoryTaskRepository()
  const app = buildApiApp({
    config: createApiConfig({
      NODE_ENV: 'test',
      API_STORAGE_DRIVER: 'memory',
      API_AUTH_MODE: 'disabled',
    }),
    database: null,
    apiKeyService: keys,
    sessionService: new SessionService(sessions),
    taskService: new TaskService(tasks),
    chaosInboxService: new ChaosInboxService(
      new MemoryChaosInboxRepository(tasks),
    ),
    requestAuthenticator: {
      authenticate(request) {
        const header = request.headers.authorization
        if (
          header !== 'Bearer owner-session' &&
          header !== 'Bearer other-session'
        )
          throw new HttpError(
            401,
            'authentication_required',
            'Session required',
          )
        return Promise.resolve(
          authFor(header === 'Bearer owner-session' ? USER : OTHER),
        )
      },
    },
  })
  async function create(scopes: ApiKeyScope[]) {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: sessionHeaders,
      payload: { name: 'Test bot', scopes, expiresInDays: 30 },
    })
    assert.equal(result.statusCode, 201, result.body)
    return result.json<{ key: { id: string }; secret: string }>()
  }
  return {
    app,
    create,
    keys,
    repository,
    setAccess: (value: typeof access) => {
      access = value
    },
  }
}

void test('keys are shown once, isolated by owner, immediately revoked and cannot manage accounts', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  const created = await h.create(['tasks:read'])
  assert.match(created.secret, /^hkt_[A-Za-z0-9_-]{43}$/)
  const headers = { authorization: `Bearer ${created.secret}` }
  const list = await h.app.inject({
    url: '/api/v1/api-keys',
    headers: sessionHeaders,
  })
  assert.equal(list.statusCode, 200)
  assert.equal(list.headers['cache-control'], 'no-store')
  assert.equal(list.body.includes(created.secret), false)
  assert.equal(list.body.includes(hashApiKey(created.secret)), false)
  const otherList = await h.app.inject({
    url: '/api/v1/api-keys',
    headers: { authorization: 'Bearer other-session' },
  })
  assert.deepEqual(otherList.json<ApiKeyListResponse>().keys, [])
  assert.equal(
    (
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${created.key.id}`,
        headers: { authorization: 'Bearer other-session' },
      })
    ).statusCode,
    404,
  )
  for (const url of [
    '/api/v1/api-keys',
    '/api/v1/tasks',
    '/api/v1/session',
    '/api/v1/admin/users',
  ]) {
    assert.equal((await h.app.inject({ url, headers })).statusCode, 401)
  }
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers,
        payload: {
          name: 'Escalation',
          scopes: ['tasks:write'],
          expiresInDays: 30,
        },
      })
    ).statusCode,
    401,
  )
  assert.equal(
    (await h.app.inject({ url: '/api/public/v1/tasks', headers })).statusCode,
    200,
  )
  assert.equal(
    (
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${created.key.id}`,
        headers: sessionHeaders,
      })
    ).statusCode,
    204,
  )
  assert.equal(
    (await h.app.inject({ url: '/api/public/v1/tasks', headers })).statusCode,
    401,
  )
})

void test('scope and workspace checks reject unintended operations and live permission changes', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  const read = await h.create(['tasks:read'])
  const readHeaders = { authorization: `Bearer ${read.secret}` }
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/public/v1/tasks',
        headers: readHeaders,
        payload: { title: 'Forbidden' },
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await h.app.inject({
        url: '/api/public/v1/shopping',
        headers: readHeaders,
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await h.app.inject({
        url: '/api/public/v1/tasks',
        headers: { ...readHeaders, 'x-workspace-id': randomUUID() },
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await h.app.inject({
        url: '/api/public/v1/tasks',
        headers: sessionHeaders,
      })
    ).statusCode,
    401,
  )
  const write = await h.create(['tasks:write'])
  const headers = { authorization: `Bearer ${write.secret}` }
  assert.equal(
    (await h.app.inject({ url: '/api/public/v1/tasks', headers })).statusCode,
    403,
  )
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/public/v1/tasks',
        headers,
        payload: { title: 'Allowed' },
      })
    ).statusCode,
    201,
  )
  h.setAccess('guest')
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/public/v1/tasks',
        headers,
        payload: { title: 'Denied after role change' },
      })
    ).statusCode,
    403,
  )
  h.setAccess('denied')
  assert.equal(
    (await h.app.inject({ url: '/api/public/v1/tasks', headers: readHeaders }))
      .statusCode,
    403,
  )
})

void test('task API supports pagination, replay, partial updates and version conflicts', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  const { secret } = await h.create(['tasks:read', 'tasks:write'])
  const headers = { authorization: `Bearer ${secret}` }
  const payload = {
    id: generateUuidV7(),
    title: 'API task',
    note: 'Keep this note',
    plannedDate: '2026-11-10',
  }
  const created = await h.app.inject({
    method: 'POST',
    url: '/api/public/v1/tasks',
    headers,
    payload,
  })
  assert.equal(created.statusCode, 201, created.body)
  const task = created.json<TaskRecord>()
  const replay = await h.app.inject({
    method: 'POST',
    url: '/api/public/v1/tasks',
    headers,
    payload,
  })
  assert.equal(replay.json<TaskRecord>().id, task.id)
  await h.app.inject({
    method: 'POST',
    url: '/api/public/v1/tasks',
    headers,
    payload: { title: 'Another task' },
  })
  const page = await h.app.inject({
    url: '/api/public/v1/tasks?limit=1',
    headers,
  })
  assert.equal(page.json<TaskListPageResponse>().items.length, 1)
  assert.equal(page.json<TaskListPageResponse>().hasMore, true)
  const next = await h.app.inject({
    url: `/api/public/v1/tasks?limit=1&offset=${page.json<TaskListPageResponse>().nextOffset}`,
    headers,
  })
  assert.notEqual(
    next.json<TaskListPageResponse>().items[0]!.id,
    page.json<TaskListPageResponse>().items[0]!.id,
  )
  const update = await h.app.inject({
    method: 'PATCH',
    url: `/api/public/v1/tasks/${task.id}`,
    headers,
    payload: {
      title: 'Edited',
      plannedDate: null,
      expectedVersion: task.version,
    },
  })
  assert.equal(update.statusCode, 200, update.body)
  assert.equal(update.json<TaskRecord>().note, 'Keep this note')
  assert.equal(update.json<TaskRecord>().plannedDate, null)
  const conflict = await h.app.inject({
    method: 'PATCH',
    url: `/api/public/v1/tasks/${task.id}`,
    headers,
    payload: { title: 'Stale', expectedVersion: task.version },
  })
  assert.equal(conflict.statusCode, 409, conflict.body)
  assert.equal(
    (
      await h.app.inject({
        method: 'PATCH',
        url: `/api/public/v1/tasks/${task.id}/status`,
        headers,
        payload: {
          status: 'done',
          expectedVersion: update.json<TaskRecord>().version,
        },
      })
    ).statusCode,
    200,
  )
  assert.equal(
    (
      await h.app.inject({
        url: '/api/public/v1/tasks?search=Edited&status=done',
        headers,
      })
    ).json<TaskListPageResponse>().items.length,
    1,
  )
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/public/v1/tasks',
        headers,
        payload: { title: 'Invalid date', plannedDate: '2026-02-30' },
      })
    ).statusCode,
    400,
  )
  const otherSession = await h.app.inject({
    url: '/api/v1/session',
    headers: { authorization: 'Bearer other-session' },
  })
  const otherKey = await h.app.inject({
    method: 'POST',
    url: '/api/v1/api-keys',
    headers: {
      authorization: 'Bearer other-session',
      'x-workspace-id': otherSession.json<SessionResponse>().workspaceId,
    },
    payload: { name: 'Other user', expiresInDays: 30, scopes: ['tasks:read'] },
  })
  assert.equal(
    (
      await h.app.inject({
        url: `/api/public/v1/tasks/${task.id}`,
        headers: {
          authorization: `Bearer ${otherKey.json<{ secret: string }>().secret}`,
        },
      })
    ).statusCode,
    404,
  )
})

void test('task patches preserve scheduled time and recurrence; clearing the date also clears reminders', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  const { secret } = await h.create(['tasks:write'])
  const created = await h.app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: { ...sessionHeaders, 'x-client-timezone': 'Europe/Berlin' },
    payload: {
      title: 'Scheduled task',
      note: 'Keep me',
      project: '',
      resource: 1,
      plannedDate: '2026-11-10',
      plannedStartTime: '09:00',
      plannedEndTime: '10:30',
      reminderOffsets: [15],
      recurrence: { frequency: 'daily', startDate: '2026-11-10' },
    },
  })
  assert.equal(created.statusCode, 201, created.body)
  const task = created.json<TaskRecord>()
  const headers = { authorization: `Bearer ${secret}` }
  const updated = await h.app.inject({
    method: 'PATCH',
    url: `/api/public/v1/tasks/${task.id}`,
    headers,
    payload: { title: 'Renamed', expectedVersion: task.version },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  const next = updated.json<TaskRecord>()
  assert.deepEqual(next.schedule, task.schedule)
  assert.equal(next.plannedEndTime, task.plannedEndTime)
  assert.deepEqual(next.reminderOffsets, task.reminderOffsets)
  assert.deepEqual(next.recurrence, task.recurrence)
  const cleared = await h.app.inject({
    method: 'PATCH',
    url: `/api/public/v1/tasks/${task.id}`,
    headers,
    payload: { plannedDate: null, expectedVersion: next.version },
  })
  assert.equal(cleared.statusCode, 200, cleared.body)
  const flexible = cleared.json<TaskRecord>()
  assert.equal(flexible.plannedDate, null)
  assert.equal(flexible.plannedStartTime, null)
  assert.equal(flexible.plannedEndTime, null)
  assert.equal(Boolean(flexible.remindBeforeStart), false)
  assert.equal(flexible.reminderOffsets?.length ?? 0, 0)
  assert.deepEqual(flexible.recurrence, task.recurrence)
})

void test('shopping key cannot read or modify notes; shopping edits and completion use existing records', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  const { secret } = await h.create(['shopping:read', 'shopping:write'])
  const headers = { authorization: `Bearer ${secret}` }
  const note = await h.app.inject({
    method: 'POST',
    url: '/api/v1/chaos-inbox',
    headers: sessionHeaders,
    payload: { items: [{ kind: 'note', text: 'Private note' }] },
  })
  const noteId = note.json<ChaosInboxCreatedRecordResponse>().items[0]!.id
  assert.equal(
    (await h.app.inject({ url: `/api/public/v1/shopping/${noteId}`, headers }))
      .statusCode,
    404,
  )
  assert.equal(
    (
      await h.app.inject({
        method: 'PATCH',
        url: `/api/public/v1/shopping/${noteId}`,
        headers,
        payload: { text: 'Overwrite note' },
      })
    ).statusCode,
    404,
  )
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/public/v1/shopping',
        headers,
        payload: { id: noteId, text: 'Private note' },
      })
    ).statusCode,
    409,
  )
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/public/v1/shopping',
        headers,
        payload: { text: 'Smuggled note', kind: 'note' },
      })
    ).statusCode,
    400,
  )
  const payload = {
    id: generateUuidV7(),
    text: 'Milk',
    shoppingCategory: 'groceries',
  }
  const created = await h.app.inject({
    method: 'POST',
    url: '/api/public/v1/shopping',
    headers,
    payload,
  })
  assert.equal(created.statusCode, 201, created.body)
  const replay = await h.app.inject({
    method: 'POST',
    url: '/api/public/v1/shopping',
    headers,
    payload,
  })
  assert.equal(
    replay.json<ChaosInboxItemRecord>().id,
    created.json<ChaosInboxItemRecord>().id,
  )
  assert.equal(
    (
      await h.app.inject({ url: '/api/public/v1/shopping', headers })
    ).json<ChaosInboxListRecordResponse>().total,
    1,
  )
  const updated = await h.app.inject({
    method: 'PATCH',
    url: `/api/public/v1/shopping/${created.json<ChaosInboxItemRecord>().id}`,
    headers,
    payload: { text: 'Oat milk', status: 'archived' },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.equal(updated.json<ChaosInboxItemRecord>().text, 'Oat milk')
  assert.ok(updated.json<ChaosInboxItemRecord>().completedAt)
  assert.equal(
    (
      await h.app.inject({
        url: '/api/public/v1/shopping?search=Oat&status=archived',
        headers,
      })
    ).json<ChaosInboxListRecordResponse>().items.length,
    1,
  )
})

void test('public API returns client errors for malformed JSON and unsupported content types', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  const { secret } = await h.create(['tasks:write'])
  for (const payload of ['', '{"title":']) {
    const result = await h.app.inject({
      method: 'POST',
      url: '/api/public/v1/tasks',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      payload,
    })
    assert.equal(result.statusCode, 400, result.body)
  }
  const unsupported = await h.app.inject({
    method: 'POST',
    url: '/api/public/v1/tasks',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/xml',
    },
    payload: '<task/>',
  })
  assert.equal(unsupported.statusCode, 415, unsupported.body)
})

void test('task creation cannot overwrite another workspace or resurrect a deleted task ID', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  const payload = { id: generateUuidV7(), title: 'Original task' }
  const { secret } = await h.create(['tasks:read', 'tasks:write'])
  const headers = { authorization: `Bearer ${secret}` }
  const created = await h.app.inject({
    method: 'POST',
    url: '/api/public/v1/tasks',
    headers,
    payload,
  })
  assert.equal(created.statusCode, 201)
  const otherSession = await h.app.inject({
    url: '/api/v1/session',
    headers: { authorization: 'Bearer other-session' },
  })
  const otherKey = await h.app.inject({
    method: 'POST',
    url: '/api/v1/api-keys',
    headers: {
      authorization: 'Bearer other-session',
      'x-workspace-id': otherSession.json<SessionResponse>().workspaceId,
    },
    payload: { name: 'Other', expiresInDays: 30, scopes: ['tasks:write'] },
  })
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/public/v1/tasks',
        headers: {
          authorization: `Bearer ${otherKey.json<{ secret: string }>().secret}`,
        },
        payload,
      })
    ).statusCode,
    409,
  )
  assert.equal(
    (
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/tasks/${payload.id}`,
        headers: sessionHeaders,
      })
    ).statusCode,
    204,
  )
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/public/v1/tasks',
        headers,
        payload,
      })
    ).statusCode,
    409,
  )
})

void test('expired keys fail and key creation has a per-user cap', async () => {
  const repository = new MemoryApiKeyRepository()
  const keys = new ApiKeyService(repository)
  const owner = { userId: USER, auth: authFor(USER) }
  const secret = `hkt_${'a'.repeat(43)}`
  await repository.create(owner, {
    id: randomUUID(),
    name: 'Expired',
    expiresInDays: 1,
    scopes: ['tasks:read'],
    workspaceId: WORKSPACE,
    prefix: secret.slice(0, 12),
    tokenHash: hashApiKey(secret),
    expiresAt: new Date(0).toISOString(),
  })
  await assert.rejects(
    keys.authenticate(`Bearer ${secret}`, 'tasks:read'),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401,
  )
  for (let index = 0; index < 20; index++)
    await keys.create(owner, WORKSPACE, {
      name: `Key ${index}`,
      scopes: ['tasks:read'],
      expiresInDays: 1,
    })
  await assert.rejects(
    keys.create(owner, WORKSPACE, {
      name: 'Excess',
      scopes: ['tasks:read'],
      expiresInDays: 1,
    }),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'api_key_limit',
  )
})

void test('public API returns Retry-After when a key exceeds its limit', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  const { secret } = await h.create(['tasks:read'])
  const headers = { authorization: `Bearer ${secret}` }
  for (let index = 0; index < 120; index++)
    assert.equal(
      (await h.app.inject({ url: '/api/public/v1/tasks', headers })).statusCode,
      200,
    )
  const limited = await h.app.inject({ url: '/api/public/v1/tasks', headers })
  assert.equal(limited.statusCode, 429)
  assert.ok(Number(limited.headers['retry-after']) > 0)
})

void test('public API limits unauthenticated requests before key lookup', async (t) => {
  const h = harness()
  t.after(() => h.app.close())
  let lookups = 0
  h.repository.authenticate = () => {
    lookups++
    return Promise.resolve(null)
  }
  const headers = { authorization: `Bearer hkt_${'a'.repeat(43)}` }
  for (let index = 0; index < 300; index++) {
    const response = await h.app.inject({
      url: '/api/public/v1/tasks',
      headers,
    })
    assert.equal(response.statusCode, 401)
  }
  const limited = await h.app.inject({ url: '/api/public/v1/tasks', headers })
  assert.equal(limited.statusCode, 429)
  assert.ok(Number(limited.headers['retry-after']) > 0)
  assert.equal(lookups, 300)
})
