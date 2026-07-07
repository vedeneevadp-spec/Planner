import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  MemorySessionRepository,
  SessionService,
} from '../modules/session/index.js'
import { MemoryTaskRepository, TaskService } from '../modules/tasks/index.js'
import { buildApiApp } from './build-app.js'
import { createApiConfig } from './config.js'

function createTestConfig(env: NodeJS.ProcessEnv = {}) {
  return createApiConfig({
    API_STORAGE_DRIVER: 'memory',
    NODE_ENV: 'test',
    ...env,
  })
}

void describe('buildApiApp CORS routes', () => {
  let app: ReturnType<typeof buildApiApp> | null = null

  void afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  void it('allows PATCH and DELETE in CORS preflight responses', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_CORS_ORIGIN: 'http://127.0.0.1:5173',
      }),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const patchResponse = await app.inject({
      headers: {
        'access-control-request-headers':
          'content-type,x-actor-user-id,x-client-timezone,x-workspace-id',
        'access-control-request-method': 'PATCH',
        origin: 'http://127.0.0.1:5173',
      },
      method: 'OPTIONS',
      url: '/api/v1/tasks/task-1/status',
    })

    assert.equal(patchResponse.statusCode, 204)
    assert.equal(
      patchResponse.headers['access-control-allow-methods'],
      'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    )
    assert.equal(
      patchResponse.headers['access-control-allow-headers'],
      'content-type,x-actor-user-id,x-client-timezone,x-workspace-id',
    )

    const deleteResponse = await app.inject({
      headers: {
        'access-control-request-method': 'DELETE',
        origin: 'http://127.0.0.1:5173',
      },
      method: 'OPTIONS',
      url: '/api/v1/tasks/task-1',
    })

    assert.equal(deleteResponse.statusCode, 204)
    assert.equal(
      deleteResponse.headers['access-control-allow-methods'],
      'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    )
  })

  void it('allows Capacitor app origins in CORS preflight responses', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_CORS_ORIGIN: 'https://chaotika.ru',
      }),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const androidResponse = await app.inject({
      headers: {
        'access-control-request-headers': 'authorization,x-workspace-id',
        'access-control-request-method': 'GET',
        origin: 'https://localhost',
      },
      method: 'OPTIONS',
      url: '/api/v1/session',
    })

    assert.equal(androidResponse.statusCode, 204)
    assert.equal(
      androidResponse.headers['access-control-allow-origin'],
      'https://localhost',
    )

    const iosResponse = await app.inject({
      headers: {
        'access-control-request-headers': 'authorization,x-workspace-id',
        'access-control-request-method': 'GET',
        origin: 'capacitor://localhost',
      },
      method: 'OPTIONS',
      url: '/api/v1/session',
    })

    assert.equal(iosResponse.statusCode, 204)
    assert.equal(
      iosResponse.headers['access-control-allow-origin'],
      'capacitor://localhost',
    )
  })

  void it('supports multiple configured CORS origins', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_CORS_ORIGIN: 'https://chaotika.ru, https://staging.chaotika.ru',
      }),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'access-control-request-method': 'GET',
        origin: 'https://staging.chaotika.ru',
      },
      method: 'OPTIONS',
      url: '/api/v1/session',
    })

    assert.equal(response.statusCode, 204)
    assert.equal(
      response.headers['access-control-allow-origin'],
      'https://staging.chaotika.ru',
    )
    assert.equal(response.headers['access-control-allow-credentials'], 'true')
  })
})
