import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { getDateKeyInTimeZone } from '@planner/contracts'

import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import {
  cleanupRepositoryContractUsers,
  createRepositoryContractAuthContext,
  seedRepositoryContractWorkspace,
} from '../../testing/repository-contract-fixtures.js'
import { PostgresUserBackupRepository } from '../backups/backup.repository.postgres.js'
import { PostgresSelfCareRepository } from './self-care.repository.postgres.js'
import {
  assertAtomicRuleEditPreservesSingleSchedule,
  assertCoursePauseReconcilesGeneratedSlots,
  assertFutureScheduleReconciles,
  assertRitualHistorySurvivesEditing,
} from './self-care.repository.regression-contract.js'

for (const [name, verify] of [
  [
    'course pause reconciles automatic slots and preserves manual schedule',
    assertCoursePauseReconcilesGeneratedSlots,
  ],
  [
    'atomic rule and single schedule edit preserves ritual drafts',
    assertAtomicRuleEditPreservesSingleSchedule,
  ],
  [
    'ritual history survives edits and offline replay',
    assertRitualHistorySurvivesEditing,
  ],
  [
    'future rules preserve completed, skipped, and manually moved occurrences',
    assertFutureScheduleReconciles,
  ],
] as const) {
  void test(`PostgresSelfCareRepository ${name}`, async () => {
    const connection = createDatabaseConnection(createDatabaseConfig())
    const actorUserId = randomUUID()
    try {
      const workspace = await seedRepositoryContractWorkspace(connection, {
        userId: actorUserId,
        kind: 'personal',
      })
      const repository = new PostgresSelfCareRepository(connection.db)
      const context = {
        actorUserId,
        auth: createRepositoryContractAuthContext({
          userId: actorUserId,
          email: workspace.email,
        }),
        clientTimeZone: 'UTC',
        role: 'owner' as const,
        workspaceId: workspace.workspaceId,
        workspaceKind: 'personal' as const,
      }
      await verify(repository, context)

      if (verify === assertRitualHistorySurvivesEditing) {
        const date = getDateKeyInTimeZone(new Date(), 'UTC')
        const history = await repository.getHistory(context, date, date)
        const items = await repository.listItems(context)
        const assets = await mkdtemp(
          path.join(tmpdir(), 'planner-ritual-backup-'),
        )
        try {
          const backupRepository = new PostgresUserBackupRepository(
            connection.db,
            assets,
          )
          const archive = await backupRepository.exportPersonalWorkspace({
            context,
            appVersion: 'test',
          })
          assert.equal(
            archive.tables.self_care_ritual_steps?.filter(
              (row) => row.deleted_at !== null,
            ).length,
            2,
          )
          await connection.pool.query(
            'delete from app.self_care_items where user_id = $1',
            [actorUserId],
          )
          await backupRepository.restorePersonalWorkspace({
            archive,
            archiveDigest: 'c'.repeat(64),
            context,
            idempotencyKey: randomUUID(),
            restoreProfile: false,
            restoreWorkspaceSettings: false,
          })
          assert.deepEqual(
            [
              ...(await repository.getHistory(context, date, date))
                .stepCompletions,
            ].sort((left, right) => left.id.localeCompare(right.id)),
            [...history.stepCompletions].sort((left, right) =>
              left.id.localeCompare(right.id),
            ),
          )
          assert.deepEqual(
            (await repository.listItems(context)).steps,
            items.steps,
          )
        } finally {
          await rm(assets, { recursive: true, force: true })
        }
      }
    } finally {
      await cleanupRepositoryContractUsers(connection, [actorUserId])
      await destroyDatabaseConnection(connection)
    }
  })
}
