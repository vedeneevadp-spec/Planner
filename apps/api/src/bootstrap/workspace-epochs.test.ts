import assert from 'node:assert/strict'
import test from 'node:test'

import Fastify from 'fastify'

import {
  MemorySessionRepository,
  SessionService,
} from '../modules/session/index.js'
import { registerSessionRoutes } from '../modules/session/session.routes.js'
import { MemoryTaskRepository, TaskService } from '../modules/tasks/index.js'
import { buildApiApp } from './build-app.js'
import { createApiConfig } from './config.js'
import { getRequestAuth } from './request-auth.js'

void test('session publishes epoch headers and database epoch conflicts become actionable HTTP 409', async () => {
  const app = buildApiApp({
    config: createApiConfig({
      API_STORAGE_DRIVER: 'memory',
      NODE_ENV: 'test',
      API_CORS_ORIGIN: 'http://localhost:5173',
    }),
    database: null,
    sessionService: new SessionService(new MemorySessionRepository()),
    taskService: new TaskService(new MemoryTaskRepository()),
  })
  app.post('/test-epoch-conflict', () => {
    throw Object.assign(new Error('workspace_restored'), { code: 'P4009' })
  })
  try {
    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { origin: 'http://localhost:5173' },
    })
    assert.equal(session.statusCode, 200)
    assert.equal(session.headers['x-workspace-epoch'], '0')
    assert.ok(session.headers['x-workspace-id'])
    assert.deepEqual(
      JSON.parse(String(session.headers['x-workspace-epochs'])),
      {
        [String(session.headers['x-workspace-id'])]: '0',
      },
    )
    assert.equal(
      session.headers['x-workspace-actor-id'],
      session.json<{ actorUserId: string }>().actorUserId,
    )
    assert.match(
      String(session.headers['access-control-expose-headers']),
      /x-workspace-epoch/,
    )
    const conflict = await app.inject({
      method: 'POST',
      url: '/test-epoch-conflict',
    })
    assert.equal(conflict.statusCode, 409)
    assert.equal(
      conflict.json<{ error: { code: string } }>().error.code,
      'workspace_restored',
    )
  } finally {
    await app.close()
  }
})

void test('epoch scopes reject malformed headers and keep the primary header authoritative', async () => {
  const app = buildApiApp({
    config: createApiConfig({ API_STORAGE_DRIVER: 'memory', NODE_ENV: 'test' }),
    database: null,
    sessionService: new SessionService(new MemorySessionRepository()),
    taskService: new TaskService(new MemoryTaskRepository()),
  })
  app.get('/test-scoped-epochs', (request) => {
    request.authContext = {
      accessToken: 'test-token',
      claims: { sub: 'actor', role: 'authenticated', payload: {} },
    }
    return getRequestAuth(request)?.writeEpochs
  })
  try {
    for (const invalid of [
      '[]',
      'null',
      '{',
      '{"w":1}',
      '{"w":"-1"}',
      '{"w":"01"}',
      '{"bad id":"0"}',
      JSON.stringify({ a: '0', b: '0', c: '0', d: '0', e: '0' }),
      ' '.repeat(2049),
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { 'x-workspace-epochs': invalid },
      })
      assert.equal(response.statusCode, 400, invalid)
      assert.equal(
        response.json<{ error: { code: string } }>().error.code,
        'invalid_workspace_epoch',
      )
    }
    const response = await app.inject({
      method: 'GET',
      url: '/test-scoped-epochs',
      headers: {
        'x-workspace-id': 'shared',
        'x-workspace-epoch': '0',
        'x-workspace-epochs': JSON.stringify({ shared: '9', personal: '1' }),
      },
    })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { shared: '0', personal: '1' })
  } finally {
    await app.close()
  }
})

void test('session retries a restore racing its fresh read and never labels cached data with the new epoch', async (t) => {
  const service = new SessionService(new MemorySessionRepository())
  const snapshot = await service.resolveSession({
    auth: null,
    actorUserId: undefined,
    workspaceId: undefined,
  })
  let reads = 0
  t.mock.method(
    service,
    'resolveSession',
    (
      _context: Parameters<SessionService['resolveSession']>[0],
      options?: Parameters<SessionService['resolveSession']>[1],
    ) => {
      reads++
      if (reads > 1) assert.equal(options?.fresh, true)
      return Promise.resolve({
        ...snapshot,
        actor: {
          ...snapshot.actor,
          displayName: reads < 3 ? 'Before restore' : 'Restored profile',
        },
      })
    },
  )
  let epochs = 0
  const app = Fastify()
  registerSessionRoutes(app, service, () =>
    Promise.resolve(epochs++ === 0 ? '0' : '1'),
  )
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/session' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['x-workspace-epoch'], '1')
    assert.equal(
      response.json<{ actor: { displayName: string } }>().actor.displayName,
      'Restored profile',
    )
    assert.equal(reads, 3)
  } finally {
    await app.close()
  }
})
