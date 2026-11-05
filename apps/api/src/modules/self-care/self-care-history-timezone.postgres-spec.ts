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
import { PostgresSelfCareRepository } from './self-care.repository.postgres.js'
import {
  assertSelfCareAfterCompletionUsesLocalDates,
  assertSelfCareFlexibleProgressUsesLocalDates,
  assertSelfCareHistoryUsesLocalDates,
  HISTORY_TIMEZONE_CASES,
} from './self-care-history-timezone.contract.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) await destroyDatabaseConnection(connection)
})

for (const scenario of HISTORY_TIMEZONE_CASES) {
  void test(`postgres self-care history and analytics use local dates in ${scenario.timezone}`, async () => {
    const actorUserId = randomUUID()
    const workspace = await seedRepositoryContractWorkspace(connection, {
      userId: actorUserId,
      kind: 'personal',
    })
    try {
      await assertSelfCareHistoryUsesLocalDates(
        new PostgresSelfCareRepository(connection.db),
        {
          actorUserId,
          auth: createRepositoryContractAuthContext({
            email: workspace.email,
            userId: actorUserId,
          }),
          role: 'owner',
          workspaceId: workspace.workspaceId,
          workspaceKind: 'personal',
        },
        scenario,
      )
    } finally {
      await cleanupRepositoryContractUsers(connection, [actorUserId])
    }
  })
}

void test('postgres flexible progress and after-completion recurrence use local completion dates', async () => {
  const actorUserId = randomUUID()
  const workspace = await seedRepositoryContractWorkspace(connection, {
    userId: actorUserId,
    kind: 'personal',
  })
  try {
    const repository = new PostgresSelfCareRepository(connection.db)
    const context = {
      actorUserId,
      auth: createRepositoryContractAuthContext({
        email: workspace.email,
        userId: actorUserId,
      }),
      role: 'owner' as const,
      workspaceId: workspace.workspaceId,
      workspaceKind: 'personal' as const,
    }
    await assertSelfCareFlexibleProgressUsesLocalDates(repository, context)
    await assertSelfCareAfterCompletionUsesLocalDates(repository, context)
  } finally {
    await cleanupRepositoryContractUsers(connection, [actorUserId])
  }
})
