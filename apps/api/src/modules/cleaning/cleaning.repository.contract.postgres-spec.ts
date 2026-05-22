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
import { defineCleaningRepositoryContractSuite } from './cleaning.repository.contract.js'
import { PostgresCleaningRepository } from './cleaning.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

defineCleaningRepositoryContractSuite({
  async createHarness() {
    const actorUserId = randomUUID()
    const trackedUserIds = new Set([actorUserId])

    await cleanupRepositoryContractUsers(connection, [...trackedUserIds])

    const workspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Cleaning User',
      email: `contract-cleaning-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Contract Cleaning',
    })

    return {
      cleanup: () =>
        cleanupRepositoryContractUsers(connection, [...trackedUserIds]),
      context: {
        actorUserId,
        auth: null,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: workspace.workspaceId,
        workspaceKind: 'personal' as const,
      },
      repository: new PostgresCleaningRepository(connection.db),
    }
  },
  name: 'PostgresCleaningRepository contract',
})
