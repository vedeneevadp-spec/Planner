import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import {
  cleanupRepositoryContractUsers,
  createRepositoryContractAuthContext,
  seedRepositoryContractWorkspace,
} from '../../testing/repository-contract-fixtures.js'
import { PostgresPushNotificationsRepository } from './push-notifications.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

void test('PostgresPushNotificationsRepository registers devices under RLS auth context', async () => {
  const actorUserId = randomUUID()
  const otherActorUserId = randomUUID()
  const trackedUserIds = [actorUserId, otherActorUserId]

  await cleanupRepositoryContractUsers(connection, trackedUserIds)

  try {
    const workspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Push User',
      email: `contract-push-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Contract Push',
    })
    const otherWorkspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Push Other User',
      email: `contract-push-${otherActorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: otherActorUserId,
      workspaceName: 'Contract Other Push',
    })
    const repository = new PostgresPushNotificationsRepository(connection.db)
    const session = {
      actorUserId,
      auth: createRepositoryContractAuthContext({
        email: workspace.email,
        userId: actorUserId,
      }),
      workspaceId: workspace.workspaceId,
    }
    const otherSession = {
      actorUserId: otherActorUserId,
      auth: createRepositoryContractAuthContext({
        email: otherWorkspace.email,
        userId: otherActorUserId,
      }),
      workspaceId: otherWorkspace.workspaceId,
    }

    const device = await repository.upsertDevice(session, {
      installationId: `android-${actorUserId}`,
      platform: 'android',
      token: `fcm-token-${actorUserId}`,
    })

    assert.equal(device.userId, actorUserId)
    assert.equal(device.workspaceId, workspace.workspaceId)
    assert.deepEqual(await repository.listActiveTokens(session), [
      `fcm-token-${actorUserId}`,
    ])
    assert.deepEqual(await repository.listActiveTokens(otherSession), [])

    await repository.deactivateTokens([`fcm-token-${actorUserId}`], session)
    assert.deepEqual(await repository.listActiveTokens(session), [])

    await repository.upsertDevice(session, {
      installationId: `android-${actorUserId}`,
      platform: 'android',
      token: `fcm-token-${actorUserId}-next`,
    })
    await repository.removeDevice(session, `android-${actorUserId}`)
    assert.deepEqual(await repository.listActiveTokens(session), [])
  } finally {
    await cleanupRepositoryContractUsers(connection, trackedUserIds)
  }
})
