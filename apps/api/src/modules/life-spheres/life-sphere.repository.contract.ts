import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  generateUuidV7,
  lifeSphereUpdateInputSchema,
  newLifeSphereInputSchema,
} from '@planner/contracts'

import { hasHttpErrorCode } from '../../testing/repository-contract-assertions.js'
import type { LifeSphereWriteContext } from './life-sphere.model.js'
import type { LifeSphereRepository } from './life-sphere.repository.js'

export interface LifeSphereRepositoryContractHarness {
  cleanup: () => Promise<void>
  context: LifeSphereWriteContext
  otherContext: LifeSphereWriteContext
  repository: LifeSphereRepository
}

export function defineLifeSphereRepositoryContractSuite(input: {
  createHarness: () => Promise<LifeSphereRepositoryContractHarness>
  name: string
}): void {
  void describe(input.name, () => {
    void test('keeps life sphere lifecycle, stats, and workspace isolation consistent', async () => {
      const harness = await input.createHarness()

      try {
        const sphereId = generateUuidV7()
        const sphere = await harness.repository.create({
          context: harness.context,
          input: newLifeSphereInputSchema.parse({
            color: '  #123456  ',
            description: '  Deep work  ',
            icon: '  briefcase  ',
            id: sphereId,
            name: '  Work  ',
          }),
        })
        const duplicate = await harness.repository.create({
          context: harness.context,
          input: newLifeSphereInputSchema.parse({
            id: sphereId,
            name: 'Duplicate should not overwrite',
          }),
        })
        const otherWorkspaceSphere = await harness.repository.create({
          context: harness.otherContext,
          input: newLifeSphereInputSchema.parse({
            name: 'Other workspace sphere',
          }),
        })

        assert.equal(duplicate.id, sphere.id)
        assert.equal(duplicate.name, 'Work')
        assert.equal(sphere.color, '#123456')
        assert.equal(sphere.description, 'Deep work')
        assert.equal(sphere.icon, 'briefcase')
        assert.equal(sphere.isActive, true)
        assert.equal(sphere.isDefault, false)
        assert.equal(sphere.name, 'Work')
        assert.equal(sphere.sortOrder, 0)
        assert.equal(sphere.userId, harness.context.actorUserId)
        assert.equal(sphere.version, 1)
        assert.equal(sphere.workspaceId, harness.context.workspaceId)

        assert.deepEqual(
          (await harness.repository.listByWorkspace(harness.context)).map(
            (candidate) => candidate.id,
          ),
          [sphere.id],
        )
        assert.deepEqual(
          (await harness.repository.listByWorkspace(harness.otherContext)).map(
            (candidate) => candidate.id,
          ),
          [otherWorkspaceSphere.id],
        )
        await assert.rejects(
          async () => {
            await harness.repository.getById(harness.otherContext, sphere.id)
          },
          (error: unknown) => hasHttpErrorCode(error, 'life_sphere_not_found'),
        )

        const updated = await harness.repository.update({
          context: harness.context,
          input: lifeSphereUpdateInputSchema.parse({
            color: '  #abcdef  ',
            description: '  Focused work  ',
            expectedVersion: sphere.version,
            name: '  Focus  ',
            sortOrder: 4,
          }),
          sphereId: sphere.id,
        })

        assert.equal(updated.color, '#abcdef')
        assert.equal(updated.description, 'Focused work')
        assert.equal(updated.name, 'Focus')
        assert.equal(updated.sortOrder, 4)
        assert.equal(updated.version, sphere.version + 1)

        await assert.rejects(
          async () => {
            await harness.repository.update({
              context: harness.context,
              input: lifeSphereUpdateInputSchema.parse({
                expectedVersion: sphere.version,
                name: 'Stale update',
              }),
              sphereId: sphere.id,
            })
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'life_sphere_version_conflict'),
        )

        const stats = await harness.repository.getWeeklyStats({
          context: harness.context,
          from: '2026-05-18',
          to: '2026-05-24',
        })

        assert.equal(stats.from, '2026-05-18')
        assert.equal(stats.to, '2026-05-24')
        assert.deepEqual(
          stats.spheres.map((candidate) => candidate.id),
          [updated.id],
        )
        assert.equal(stats.stats[0]?.sphereId, updated.id)

        await harness.repository.remove({
          context: harness.context,
          sphereId: sphere.id,
        })
        assert.deepEqual(
          await harness.repository.listByWorkspace(harness.context),
          [],
        )
        await assert.rejects(
          async () => {
            await harness.repository.getById(harness.context, sphere.id)
          },
          (error: unknown) => hasHttpErrorCode(error, 'life_sphere_not_found'),
        )
      } finally {
        await harness.cleanup()
      }
    })
  })
}
