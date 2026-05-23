import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  dailyPlanAutoBuildInputSchema,
  dailyPlanUpsertInputSchema,
  generateUuidV7,
} from '@planner/contracts'

import type { DailyPlanWriteContext } from './daily-plan.model.js'
import type { DailyPlanRepository } from './daily-plan.repository.js'

export interface DailyPlanRepositoryContractHarness {
  cleanup: () => Promise<void>
  context: DailyPlanWriteContext
  otherContext: DailyPlanWriteContext
  repository: DailyPlanRepository
}

export function defineDailyPlanRepositoryContractSuite(input: {
  createHarness: () => Promise<DailyPlanRepositoryContractHarness>
  name: string
}): void {
  void describe(input.name, () => {
    void test('keeps daily plan get, upsert, auto-build, unload, and workspace isolation consistent', async () => {
      const harness = await input.createHarness()

      try {
        const virtualPlan = await harness.repository.getByDate({
          context: harness.context,
          date: '2026-05-23',
        })

        assert.equal(virtualPlan.date, '2026-05-23')
        assert.equal(virtualPlan.energyMode, 'normal')
        assert.deepEqual(virtualPlan.focusTaskIds, [])
        assert.equal(virtualPlan.userId, harness.context.actorUserId)
        assert.equal(virtualPlan.workspaceId, harness.context.workspaceId)

        const focusTaskId = generateUuidV7()
        const supportTaskId = generateUuidV7()
        const upserted = await harness.repository.upsert({
          context: harness.context,
          date: '2026-05-23',
          input: dailyPlanUpsertInputSchema.parse({
            energyMode: 'minimum',
            focusTaskIds: [focusTaskId],
            routineTaskIds: [],
            supportTaskIds: [supportTaskId],
          }),
        })

        assert.equal(upserted.date, '2026-05-23')
        assert.equal(upserted.energyMode, 'minimum')
        assert.deepEqual(upserted.focusTaskIds, [focusTaskId])
        assert.deepEqual(upserted.supportTaskIds, [supportTaskId])
        assert.equal(upserted.overloadScore, 0)
        assert.equal(upserted.version, 1)

        const loaded = await harness.repository.getByDate({
          context: harness.context,
          date: '2026-05-23',
        })

        assert.equal(loaded.id, upserted.id)
        assert.deepEqual(loaded.focusTaskIds, [focusTaskId])

        const updated = await harness.repository.upsert({
          context: harness.context,
          date: '2026-05-23',
          input: dailyPlanUpsertInputSchema.parse({
            energyMode: 'maximum',
            focusTaskIds: [],
            routineTaskIds: [focusTaskId],
            supportTaskIds: [],
          }),
        })

        assert.equal(updated.id, upserted.id)
        assert.equal(updated.energyMode, 'maximum')
        assert.deepEqual(updated.routineTaskIds, [focusTaskId])
        assert.equal(updated.version, upserted.version + 1)

        const otherWorkspacePlan = await harness.repository.getByDate({
          context: harness.otherContext,
          date: '2026-05-23',
        })

        assert.notEqual(otherWorkspacePlan.id, updated.id)
        assert.deepEqual(otherWorkspacePlan.focusTaskIds, [])
        assert.equal(
          otherWorkspacePlan.workspaceId,
          harness.otherContext.workspaceId,
        )

        const autoBuilt = await harness.repository.autoBuild({
          context: harness.context,
          input: dailyPlanAutoBuildInputSchema.parse({
            date: '2026-05-24',
            energyMode: 'normal',
          }),
        })

        assert.equal(autoBuilt.date, '2026-05-24')
        assert.equal(autoBuilt.energyMode, 'normal')
        assert.deepEqual(autoBuilt.focusTaskIds, [])
        assert.deepEqual(autoBuilt.routineTaskIds, [])
        assert.deepEqual(autoBuilt.supportTaskIds, [])

        assert.deepEqual(
          await harness.repository.unload({
            context: harness.context,
            date: '2026-05-24',
          }),
          { suggestions: [] },
        )
      } finally {
        await harness.cleanup()
      }
    })
  })
}
