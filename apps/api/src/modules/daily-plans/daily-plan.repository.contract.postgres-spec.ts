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
import { defineDailyPlanRepositoryContractSuite } from './daily-plan.repository.contract.js'
import { PostgresDailyPlanRepository } from './daily-plan.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

defineDailyPlanRepositoryContractSuite({
  async createHarness() {
    const actorUserId = randomUUID()
    const otherActorUserId = randomUUID()
    const trackedUserIds = new Set([actorUserId, otherActorUserId])

    await cleanupRepositoryContractUsers(connection, [...trackedUserIds])

    const workspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Daily Plan User',
      email: `contract-daily-plan-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Contract Daily Plans',
    })
    const otherWorkspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Daily Plan Other User',
      email: `contract-daily-plan-${otherActorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: otherActorUserId,
      workspaceName: 'Contract Other Daily Plans',
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
      repository: new PostgresDailyPlanRepository(connection.db),
    }
  },
  name: 'PostgresDailyPlanRepository contract',
})
