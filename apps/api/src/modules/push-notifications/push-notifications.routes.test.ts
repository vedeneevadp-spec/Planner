import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  apiErrorSchema,
  pushDeviceRecordSchema,
  pushTestNotificationResponseSchema,
} from '@planner/contracts'

import { buildApiApp } from '../../bootstrap/build-app.js'
import { createApiConfig } from '../../bootstrap/config.js'
import { MemoryProjectRepository, ProjectService } from '../projects/index.js'
import { MemorySessionRepository, SessionService } from '../session/index.js'
import { MemoryTaskRepository, TaskService } from '../tasks/index.js'
import {
  MemoryPushNotificationsRepository,
  NoopPushNotificationSender,
  PushNotificationsService,
} from './index.js'
import type {
  PushNotificationMessage,
  PushNotificationSender,
  PushNotificationSendResult,
} from './push-notifications.model.js'

const DEFAULT_ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const DEFAULT_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

class StubPushNotificationSender implements PushNotificationSender {
  readonly calls: Array<{
    message: PushNotificationMessage
    tokens: readonly string[]
  }> = []

  isAvailable(): boolean {
    return true
  }

  sendToTokens(
    tokens: readonly string[],
    message: PushNotificationMessage,
  ): Promise<PushNotificationSendResult> {
    this.calls.push({
      message,
      tokens,
    })

    return Promise.resolve({
      deliveredCount: tokens.length,
      failedCount: 0,
      invalidTokens: [],
    })
  }
}

function createTestConfig() {
  return createApiConfig({
    API_STORAGE_DRIVER: 'memory',
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv)
}

void describe('push notifications routes', () => {
  let app: ReturnType<typeof buildApiApp> | null = null

  void afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  void it('registers Android devices and sends a test push to active tokens', async () => {
    const sender = new StubPushNotificationSender()

    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      pushNotificationsService: new PushNotificationsService(
        new MemoryPushNotificationsRepository(),
        sender,
      ),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const registerResponse = await app.inject({
      headers: {
        'x-actor-user-id': DEFAULT_ACTOR_ID,
        'x-workspace-id': DEFAULT_WORKSPACE_ID,
      },
      method: 'PUT',
      payload: {
        installationId: 'android-installation-1',
        platform: 'android',
        token: 'token-1',
      },
      url: '/api/v1/push/devices',
    })

    assert.equal(registerResponse.statusCode, 200)
    assert.equal(
      pushDeviceRecordSchema.parse(registerResponse.json()).installationId,
      'android-installation-1',
    )

    const testResponse = await app.inject({
      headers: {
        'x-actor-user-id': DEFAULT_ACTOR_ID,
        'x-workspace-id': DEFAULT_WORKSPACE_ID,
      },
      method: 'POST',
      payload: {
        body: 'Пуши работают.',
        title: 'Chaotika',
      },
      url: '/api/v1/push/test',
    })

    assert.equal(testResponse.statusCode, 200)
    assert.deepEqual(
      pushTestNotificationResponseSchema.parse(testResponse.json()),
      {
        deliveredCount: 1,
        failedCount: 0,
        invalidTokenCount: 0,
      },
    )
    assert.deepEqual(sender.calls, [
      {
        message: {
          body: 'Пуши работают.',
          data: undefined,
          title: 'Chaotika',
        },
        tokens: ['token-1'],
      },
    ])

    const unregisterResponse = await app.inject({
      headers: {
        'x-actor-user-id': DEFAULT_ACTOR_ID,
        'x-workspace-id': DEFAULT_WORKSPACE_ID,
      },
      method: 'DELETE',
      url: '/api/v1/push/devices/android-installation-1',
    })

    assert.equal(unregisterResponse.statusCode, 204)

    const testAfterDeleteResponse = await app.inject({
      headers: {
        'x-actor-user-id': DEFAULT_ACTOR_ID,
        'x-workspace-id': DEFAULT_WORKSPACE_ID,
      },
      method: 'POST',
      payload: {
        body: 'Пуши работают.',
        title: 'Chaotika',
      },
      url: '/api/v1/push/test',
    })

    assert.equal(testAfterDeleteResponse.statusCode, 200)
    assert.deepEqual(
      pushTestNotificationResponseSchema.parse(testAfterDeleteResponse.json()),
      {
        deliveredCount: 0,
        failedCount: 0,
        invalidTokenCount: 0,
      },
    )
  })

  void it('returns 503 when Firebase sender is not configured', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      pushNotificationsService: new PushNotificationsService(
        new MemoryPushNotificationsRepository(),
        new NoopPushNotificationSender(),
      ),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'x-actor-user-id': DEFAULT_ACTOR_ID,
        'x-workspace-id': DEFAULT_WORKSPACE_ID,
      },
      method: 'POST',
      payload: {
        body: 'Проверка канала',
        title: 'Chaotika',
      },
      url: '/api/v1/push/test',
    })

    assert.equal(response.statusCode, 503)
    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'push_notifications_not_configured')
    assert.equal(
      body.error.message,
      'Firebase push notifications are not configured on the server.',
    )
    assert.equal(typeof body.error.details, 'object')
  })
})
