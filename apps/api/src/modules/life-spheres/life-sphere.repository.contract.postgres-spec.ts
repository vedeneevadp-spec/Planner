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
import { defineLifeSphereRepositoryContractSuite } from './life-sphere.repository.contract.js'
import { PostgresLifeSphereRepository } from './life-sphere.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

defineLifeSphereRepositoryContractSuite({
  async createHarness() {
    const actorUserId = randomUUID()
    const otherActorUserId = randomUUID()
    const trackedUserIds = new Set([actorUserId, otherActorUserId])

    await cleanupRepositoryContractUsers(connection, [...trackedUserIds])

    const workspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Sphere User',
      email: `contract-sphere-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Contract Spheres',
    })
    const otherWorkspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Sphere Other User',
      email: `contract-sphere-${otherActorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: otherActorUserId,
      workspaceName: 'Contract Other Spheres',
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
      otherContext: {
        actorUserId: otherActorUserId,
        auth: null,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: otherWorkspace.workspaceId,
        workspaceKind: 'personal' as const,
      },
      repository: new PostgresLifeSphereRepository(connection.db),
    }
  },
  name: 'PostgresLifeSphereRepository contract',
})
