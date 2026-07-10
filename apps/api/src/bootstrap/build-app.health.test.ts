import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { healthResponseSchema } from '@planner/contracts'

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

void describe('buildApiApp health routes', () => {
  let app: ReturnType<typeof buildApiApp> | null = null

  void afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  void it('returns health information for the configured runtime', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    })

    assert.equal(response.statusCode, 200)

    const body = healthResponseSchema.parse(response.json())

    assert.equal(body.appEnv, 'test')
    assert.equal(body.databaseStatus, 'disabled')
    assert.equal(body.storageDriver, 'memory')
  })

  void it('returns request diagnostics and runtime metrics', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const healthResponse = await app.inject({
      headers: {
        'x-request-id': 'test-request-id',
      },
      method: 'GET',
      url: '/api/health',
    })

    assert.equal(healthResponse.headers['x-request-id'], 'test-request-id')

    const metricsResponse = await app.inject({
      method: 'GET',
      url: '/api/metrics',
    })

    assert.equal(metricsResponse.statusCode, 200)
    assert.match(metricsResponse.body, /planner_api_requests_total/)
    assert.match(metricsResponse.body, /planner_api_responses_total/)
  })

  void it('returns 503 readiness when the database is unavailable', async () => {
    app = buildApiApp({
      config: createTestConfig({ API_STORAGE_DRIVER: 'postgres' }),
      database: null,
      databaseStatusResolver: () => Promise.resolve('down'),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/ready',
    })

    assert.equal(response.statusCode, 503)
    assert.deepEqual(healthResponseSchema.parse(response.json()), {
      appEnv: 'test',
      databaseStatus: 'down',
      status: 'unavailable',
      storageDriver: 'postgres',
      timestamp: response.json<{ timestamp: string }>().timestamp,
    })
  })
})
