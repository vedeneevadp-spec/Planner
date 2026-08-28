import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
  PushNotificationMessage,
  PushNotificationSender,
  PushNotificationSendResult,
  PushNotificationSession,
} from './push-notifications.model.js'
import { MemoryPushNotificationsRepository } from './push-notifications.repository.memory.js'
import { PushNotificationsService } from './push-notifications.service.js'

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
    this.calls.push({ message, tokens })

    return Promise.resolve({
      deliveredCount: tokens.length,
      failedCount: 0,
      invalidTokens: [],
    })
  }
}

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'
const WORKSPACE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKSPACE_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INSTALLATION_ID = 'android-installation-1'
const TOKEN = 'fcm-token-1'

void describe('MemoryPushNotificationsRepository account-scoped devices', () => {
  void it('delivers across workspaces after re-registration', async () => {
    const repository = new MemoryPushNotificationsRepository()
    const sender = new StubPushNotificationSender()
    const service = new PushNotificationsService(repository, sender)
    const workspaceASession = createSession(USER_ID, WORKSPACE_A_ID)
    const workspaceBSession = createSession(USER_ID, WORKSPACE_B_ID)

    await repository.upsertDevice(workspaceASession, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      token: TOKEN,
    })
    const device = await repository.upsertDevice(workspaceBSession, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      token: TOKEN,
    })

    assert.equal(device.workspaceId, WORKSPACE_B_ID)

    await service.sendNotification(
      {
        userId: USER_ID,
        workspaceId: WORKSPACE_A_ID,
      },
      {
        body: 'Новая задача',
        title: 'Общий workspace',
      },
    )

    assert.deepEqual(sender.calls, [
      {
        message: {
          body: 'Новая задача',
          title: 'Общий workspace',
        },
        tokens: [TOKEN],
      },
    ])
  })

  void it('removes an installation by owning user regardless of workspace', async () => {
    const repository = new MemoryPushNotificationsRepository()
    const workspaceASession = createSession(USER_ID, WORKSPACE_A_ID)
    const workspaceBSession = createSession(USER_ID, WORKSPACE_B_ID)

    await repository.upsertDevice(workspaceBSession, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      token: TOKEN,
    })

    await repository.removeDevice(
      createSession(OTHER_USER_ID, WORKSPACE_B_ID),
      INSTALLATION_ID,
    )
    assert.deepEqual(await repository.listActiveTokens(workspaceBSession), [
      TOKEN,
    ])

    await repository.removeDevice(workspaceASession, INSTALLATION_ID)
    assert.deepEqual(await repository.listActiveTokens(workspaceBSession), [])
  })

  void it('atomically reassigns an installation to the latest account', async () => {
    const repository = new MemoryPushNotificationsRepository()
    const firstUserSession = createSession(USER_ID, WORKSPACE_A_ID)
    const nextUserSession = createSession(OTHER_USER_ID, WORKSPACE_B_ID)

    await repository.upsertDevice(firstUserSession, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      token: TOKEN,
    })
    const reassignedDevice = await repository.upsertDevice(nextUserSession, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      token: `${TOKEN}-next-account`,
    })

    assert.equal(reassignedDevice.userId, OTHER_USER_ID)
    assert.equal(reassignedDevice.workspaceId, WORKSPACE_B_ID)
    assert.deepEqual(await repository.listActiveTokens(firstUserSession), [])
    assert.deepEqual(await repository.listActiveTokens(nextUserSession), [
      `${TOKEN}-next-account`,
    ])
  })
})

function createSession(
  actorUserId: string,
  workspaceId: string,
): PushNotificationSession {
  return {
    actorUserId,
    auth: null,
    workspaceId,
  }
}
