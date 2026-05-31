import { randomUUID } from 'node:crypto'
import { after, before } from 'node:test'

import { newTaskInputSchema } from '@planner/contracts'

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
import { PostgresTaskRepository } from '../tasks/task.repository.postgres.js'
import { defineChaosInboxRepositoryContractSuite } from './chaos-inbox.repository.contract.js'
import { PostgresChaosInboxRepository } from './chaos-inbox.repository.postgres.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

defineChaosInboxRepositoryContractSuite({
  async createHarness() {
    const actorUserId = randomUUID()
    const otherActorUserId = randomUUID()
    const trackedUserIds = new Set([actorUserId, otherActorUserId])

    await cleanupRepositoryContractUsers(connection, [...trackedUserIds])

    const workspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Inbox User',
      email: `contract-inbox-${actorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: actorUserId,
      workspaceName: 'Contract Inbox',
    })
    const otherWorkspace = await seedRepositoryContractWorkspace(connection, {
      displayName: 'Contract Inbox Other User',
      email: `contract-inbox-${otherActorUserId}@example.test`,
      kind: 'personal',
      role: 'owner',
      userId: otherActorUserId,
      workspaceName: 'Contract Other Inbox',
    })
    const personalWorkspace = {
      id: workspace.workspaceId,
      name: workspace.workspaceName,
    }
    const authContext = createRepositoryContractAuthContext({
      email: workspace.email,
      userId: actorUserId,
    })
    const otherAuthContext = createRepositoryContractAuthContext({
      email: otherWorkspace.email,
      userId: otherActorUserId,
    })
    const convertedTask = await new PostgresTaskRepository(
      connection.db,
    ).create({
      context: {
        actorDisplayName: workspace.displayName,
        actorUserId,
        auth: authContext,
        groupRole: null,
        personalWorkspace,
        role: 'owner' as const,
        workspaceId: workspace.workspaceId,
        workspaceKind: 'personal' as const,
        workspaceName: workspace.workspaceName,
      },
      input: newTaskInputSchema.parse({
        note: '',
        project: '',
        title: 'Converted target',
      }),
    })

    return {
      cleanup: () =>
        cleanupRepositoryContractUsers(connection, [...trackedUserIds]),
      context: {
        actorDisplayName: workspace.displayName,
        actorUserId,
        auth: authContext,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: workspace.workspaceId,
        workspaceKind: 'personal' as const,
      },
      convertedTaskId: convertedTask.id,
      otherContext: {
        actorDisplayName: otherWorkspace.displayName,
        actorUserId: otherActorUserId,
        auth: otherAuthContext,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: otherWorkspace.workspaceId,
        workspaceKind: 'personal' as const,
      },
      repository: new PostgresChaosInboxRepository(connection.db),
    }
  },
  name: 'PostgresChaosInboxRepository contract',
})
