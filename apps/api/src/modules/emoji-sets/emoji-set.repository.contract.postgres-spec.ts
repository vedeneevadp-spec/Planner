import { randomUUID } from 'node:crypto'
import { after, before } from 'node:test'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import {
  cleanupRepositoryContractUsers,
  seedRepositoryContractWorkspace,
} from '../../testing/repository-contract-fixtures.js'
import { defineEmojiSetRepositoryContractSuite } from './emoji-set.repository.contract.js'
import { PostgresEmojiSetRepository } from './emoji-set.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

defineEmojiSetRepositoryContractSuite({
  async createHarness() {
    const actorUserId = randomUUID()
    const otherActorUserId = randomUUID()
    const trackedUserIds = new Set([actorUserId, otherActorUserId])

    await cleanupRepositoryContractUsers(connection, [...trackedUserIds])

    const workspace = await seedRepositoryContractWorkspace(connection, {
      appRole: 'admin',
      displayName: 'Contract Icon User',
      email: `contract-icons-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Contract Icons',
    })
    const otherWorkspace = await seedRepositoryContractWorkspace(connection, {
      appRole: 'admin',
      displayName: 'Contract Icon Other User',
      email: `contract-icons-${otherActorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: otherActorUserId,
      workspaceName: 'Contract Other Icons',
    })

    return {
      cleanup: () =>
        cleanupRepositoryContractUsers(connection, [...trackedUserIds]),
      context: {
        actorUserId,
        appRole: 'admin' as const,
        auth: null,
        workspaceId: workspace.workspaceId,
      },
      otherContext: {
        actorUserId: otherActorUserId,
        appRole: 'admin' as const,
        auth: null,
        workspaceId: otherWorkspace.workspaceId,
      },
      repository: new PostgresEmojiSetRepository(connection.db),
    }
  },
  name: 'PostgresEmojiSetRepository contract',
})
