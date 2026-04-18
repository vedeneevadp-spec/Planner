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
import { HttpError } from './http-error.js'
import type { RequestAuthenticator } from './request-auth.js'

const AUTH_TOKEN = 'planner-test-token'
const AUTH_CONTEXT = {
  accessToken: AUTH_TOKEN,
  claims: {
    email: 'planner-auth@planner.local',
    payload: {
      email: 'planner-auth@planner.local',
      role: 'authenticated',
      sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    role: 'authenticated' as const,
    sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
}

const authRequestAuthenticator: RequestAuthenticator = {
  authenticate(request) {
    if (request.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
      throw new HttpError(
        401,
        'authentication_required',
        'A valid bearer token is required for this request.',
      )
    }

    return Promise.resolve(AUTH_CONTEXT)
  },
}

function createTestConfig(
  env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv,
) {
  return createApiConfig({
    API_STORAGE_DRIVER: 'memory',
    NODE_ENV: 'test',
    ...env,
  } as NodeJS.ProcessEnv)
}

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

  void it('creates, updates and lists tasks via the HTTP API', async () => {
    app = buildApiApp({
      config: createTestConfig(),
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
      config: createTestConfig(),
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
      config: createTestConfig(),
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

  void it('requires a bearer token when request authentication is enabled', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(response.statusCode, 401)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'authentication_required')
  })

  void it('resolves session and task writes from authenticated requests', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const sessionResponse = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-auth',
      },
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(sessionResponse.statusCode, 200)

    const session = sessionResponseSchema.parse(sessionResponse.json())

    assert.equal(session.actor.id, AUTH_CONTEXT.claims.sub)
    assert.equal(session.source, 'access_token')
    assert.equal(session.workspace.id, 'workspace-auth')

    const createResponse = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-auth',
      },
      method: 'POST',
      payload: {
        dueDate: null,
        note: 'created under bearer auth',
        plannedDate: null,
        plannedEndTime: null,
        plannedStartTime: null,
        project: '',
        title: 'Authenticated task write',
      },
      url: '/api/v1/tasks',
    })

    assert.equal(createResponse.statusCode, 201)

    const createdTask = taskRecordSchema.parse(createResponse.json())

    assert.equal(createdTask.workspaceId, 'workspace-auth')
  })
})
