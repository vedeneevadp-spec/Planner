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
  createRepositoryContractAuthContext,
  seedRepositoryContractProject,
  seedRepositoryContractWorkspace,
} from '../../testing/repository-contract-fixtures.js'
import { defineTaskRepositoryContractSuite } from './task.repository.contract.js'
import { PostgresTaskRepository } from './task.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

defineTaskRepositoryContractSuite({
  async createHarness() {
    const actorUserId = randomUUID()
    const trackedUserIds = new Set([actorUserId])

    await cleanupRepositoryContractUsers(connection, [...trackedUserIds])

    const personal = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Task User',
      email: `contract-task-${actorUserId}@example.test`,
      groupRole: null,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Contract Personal',
    })
    const shared = await seedRepositoryContractWorkspace(connection, {
      displayName: personal.displayName,
      email: personal.email,
      groupRole: 'group_admin',
      kind: 'shared',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Contract Shared',
    })
    const personalWorkspace = {
      id: personal.workspaceId,
      name: personal.workspaceName,
    }
    const authContext = shouldRunPoolerWriteFallbackContracts()
      ? createRepositoryContractAuthContext({
          email: personal.email,
          userId: actorUserId,
        })
      : null
    const personalContext = {
      actorDisplayName: personal.displayName,
      actorUserId,
      auth: authContext,
      groupRole: null,
      personalWorkspace,
      role: 'owner' as const,
      workspaceId: personal.workspaceId,
      workspaceKind: 'personal' as const,
      workspaceName: personal.workspaceName,
    }
    const sharedContext = {
      ...personalContext,
      groupRole: 'group_admin' as const,
      role: 'owner' as const,
      workspaceId: shared.workspaceId,
      workspaceKind: 'shared' as const,
      workspaceName: shared.workspaceName,
    }
    const projectId = await seedRepositoryContractProject(connection, {
      actorUserId,
      title: 'Contract Project',
      workspaceId: personal.workspaceId,
    })

    return {
      cleanup: () =>
        cleanupRepositoryContractUsers(connection, [...trackedUserIds]),
      personalContext,
      personalWorkspace,
      projectId,
      repository: new PostgresTaskRepository(connection.db),
      sharedContext,
      transferPersonalContext: personalContext,
    }
  },
  name: 'PostgresTaskRepository contract',
})

function shouldRunPoolerWriteFallbackContracts(): boolean {
  return process.env.API_DB_WRITE_FALLBACK === 'pooler'
}
