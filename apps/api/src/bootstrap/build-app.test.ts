import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  apiErrorSchema,
  healthResponseSchema,
  sessionResponseSchema,
  taskListResponseSchema,
  taskRecordSchema,
} from '@planner/contracts'

import { MemorySessionRepository, SessionService } from '../modules/session/index.js'
import { MemoryTaskRepository, TaskService } from '../modules/tasks/index.js'
import { buildApiApp } from './build-app.js'
import { createApiConfig } from './config.js'

void describe('buildApiApp', () => {
  let app: ReturnType<typeof buildApiApp> | null = null

  void afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  void it('returns health information for the configured runtime', async () => {
    app = buildApiApp({
      config: createApiConfig({
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
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

  void it('creates, updates and lists tasks via the HTTP API', async () => {
    app = buildApiApp({
      config: createApiConfig({
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const createResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: {
        dueDate: '2026-04-15',
        note: 'first note',
        plannedDate: '2026-04-15',
        plannedEndTime: '10:00',
        plannedStartTime: '09:00',
        project: 'Inbox',
        title: 'Prepare planner backend',
      },
      url: '/api/v1/tasks',
    })

    assert.equal(createResponse.statusCode, 201)

    const createdTask = taskRecordSchema.parse(createResponse.json())

    assert.equal(createdTask.version, 1)
    assert.equal(createdTask.workspaceId, 'workspace-1')

    const statusResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'PATCH',
      payload: {
        expectedVersion: createdTask.version,
        status: 'done',
      },
      url: `/api/v1/tasks/${createdTask.id}/status`,
    })

    assert.equal(statusResponse.statusCode, 200)

    const updatedTask = taskRecordSchema.parse(statusResponse.json())

    assert.equal(updatedTask.status, 'done')
    assert.equal(updatedTask.version, 2)

    const listResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/tasks?status=done',
    })

    assert.equal(listResponse.statusCode, 200)

    const tasks = taskListResponseSchema.parse(listResponse.json())

    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]?.id, createdTask.id)

    const deleteResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'DELETE',
      url: `/api/v1/tasks/${createdTask.id}?expectedVersion=${updatedTask.version}`,
    })

    assert.equal(deleteResponse.statusCode, 204)

    const deletedListResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/tasks',
    })

    assert.equal(deletedListResponse.statusCode, 200)

    const deletedTasks = taskListResponseSchema.parse(deletedListResponse.json())

    assert.equal(deletedTasks.length, 0)
  })

  void it('returns a typed validation error for malformed requests', async () => {
    app = buildApiApp({
      config: createApiConfig({
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/tasks?status=invalid',
    })

    assert.equal(response.statusCode, 400)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'invalid_query')
  })

  void it('allows PATCH and DELETE in CORS preflight responses', async () => {
    app = buildApiApp({
      config: createApiConfig({
        API_CORS_ORIGIN: 'http://127.0.0.1:5173',
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const patchResponse = await app.inject({
      headers: {
        'access-control-request-headers':
          'content-type,x-actor-user-id,x-workspace-id',
        'access-control-request-method': 'PATCH',
        origin: 'http://127.0.0.1:5173',
      },
      method: 'OPTIONS',
      url: '/api/v1/tasks/task-1/status',
    })

    assert.equal(patchResponse.statusCode, 204)
    assert.equal(
      patchResponse.headers['access-control-allow-methods'],
      'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
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
      'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
    )
  })

  void it('resolves a session without explicit headers', async () => {
    app = buildApiApp({
      config: createApiConfig({
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
      database: null,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(response.statusCode, 200)

    const body = sessionResponseSchema.parse(response.json())

    assert.equal(body.source, 'default')
    assert.equal(body.actor.email, 'dev@planner.local')
    assert.equal(body.workspace.slug, 'personal')
  })
})
