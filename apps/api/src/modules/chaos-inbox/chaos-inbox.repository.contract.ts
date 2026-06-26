import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  chaosInboxBulkUpdateInputSchema,
  chaosInboxItemUpdateInputSchema,
  createChaosInboxItemsInputSchema,
  generateUuidV7,
} from '@planner/contracts'

import { hasHttpErrorCode } from '../../testing/repository-contract-assertions.js'
import type { ChaosInboxWriteContext } from './chaos-inbox.model.js'
import type { ChaosInboxRepository } from './chaos-inbox.repository.js'

export interface ChaosInboxRepositoryContractHarness {
  cleanup: () => Promise<void>
  context: ChaosInboxWriteContext
  convertedTaskId: string
  otherContext: ChaosInboxWriteContext
  repository: ChaosInboxRepository
}

export function defineChaosInboxRepositoryContractSuite(input: {
  createHarness: () => Promise<ChaosInboxRepositoryContractHarness>
  name: string
}): void {
  void describe(input.name, () => {
    void test('keeps chaos inbox create, list, update, convert, delete, and workspace isolation consistent', async () => {
      const harness = await input.createHarness()

      try {
        const shoppingItemId = generateUuidV7()
        const ideaItemId = generateUuidV7()
        const [shoppingItem] = await harness.repository.create({
          context: harness.context,
          input: createChaosInboxItemsInputSchema.parse({
            items: [
              {
                id: shoppingItemId,
                isFavorite: true,
                kind: 'shopping',
                priority: 'medium',
                shoppingCategory: 'groceries',
                source: 'quick_add',
                text: '  Milk  ',
              },
              {
                id: ideaItemId,
                kind: 'idea',
                source: 'manual',
                text: '  Write proposal  ',
              },
            ],
          }),
        })
        const [otherWorkspaceItem] = await harness.repository.create({
          context: harness.otherContext,
          input: createChaosInboxItemsInputSchema.parse({
            items: [
              {
                kind: 'note',
                text: 'Other workspace note',
              },
            ],
          }),
        })

        assert.ok(shoppingItem)
        assert.equal(shoppingItem.activatedAt !== null, true)
        assert.equal(shoppingItem.completedAt, null)
        assert.equal(shoppingItem.id, shoppingItemId)
        assert.equal(shoppingItem.isFavorite, true)
        assert.equal(shoppingItem.kind, 'shopping')
        assert.equal(shoppingItem.priority, 'medium')
        assert.equal(shoppingItem.shoppingCategory, 'groceries')
        assert.equal(shoppingItem.source, 'quick_add')
        assert.equal(shoppingItem.status, 'new')
        assert.equal(shoppingItem.text, 'Milk')
        assert.equal(shoppingItem.userId, harness.context.actorUserId)
        assert.equal(shoppingItem.version, 1)
        assert.equal(shoppingItem.workspaceId, harness.context.workspaceId)

        const list = await harness.repository.list({
          context: harness.context,
          filters: {
            limit: 50,
            page: 1,
          },
        })

        assert.equal(list.limit, 50)
        assert.equal(list.page, 1)
        assert.equal(list.total, 2)
        assert.deepEqual(
          list.items.map((candidate) => candidate.id).sort(),
          [shoppingItemId, ideaItemId].sort(),
        )
        assert.deepEqual(
          (
            await harness.repository.list({
              context: harness.otherContext,
            })
          ).items.map((candidate) => candidate.id),
          [otherWorkspaceItem!.id],
        )
        await assert.rejects(
          async () => {
            await harness.repository.getById(
              harness.otherContext,
              shoppingItemId,
            )
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'chaos_inbox_item_not_found'),
        )

        const shoppingOnly = await harness.repository.list({
          context: harness.context,
          filters: {
            kind: 'shopping',
          },
        })

        assert.deepEqual(
          shoppingOnly.items.map((candidate) => candidate.id),
          [shoppingItemId],
        )

        const firstPage = await harness.repository.list({
          context: harness.context,
          filters: {
            limit: 1,
            page: 1,
          },
        })

        assert.equal(firstPage.items.length, 1)
        assert.equal(firstPage.total, 2)

        const updatedShoppingItem = await harness.repository.update({
          context: harness.context,
          id: shoppingItemId,
          input: chaosInboxItemUpdateInputSchema.parse({
            dueDate: '2026-05-30',
            isFavorite: false,
            priority: 'high',
            shoppingCategory: 'household',
            status: 'in_review',
          }),
        })

        assert.equal(updatedShoppingItem.dueDate, '2026-05-30')
        assert.equal(updatedShoppingItem.isFavorite, false)
        assert.equal(updatedShoppingItem.priority, 'high')
        assert.equal(updatedShoppingItem.shoppingCategory, 'household')
        assert.equal(updatedShoppingItem.status, 'in_review')
        assert.equal(updatedShoppingItem.activatedAt !== null, true)
        assert.equal(updatedShoppingItem.completedAt, null)
        assert.equal(updatedShoppingItem.version, shoppingItem.version + 1)

        const [bulkUpdatedIdea] = await harness.repository.bulkUpdate({
          context: harness.context,
          input: chaosInboxBulkUpdateInputSchema.parse({
            ids: [ideaItemId],
            patch: {
              kind: 'note',
              status: 'archived',
            },
          }),
        })

        assert.equal(bulkUpdatedIdea?.kind, 'note')
        assert.equal(bulkUpdatedIdea?.status, 'archived')
        assert.equal(bulkUpdatedIdea?.completedAt !== null, true)

        const converted = await harness.repository.markConverted({
          context: harness.context,
          convertedTaskId: harness.convertedTaskId,
          id: ideaItemId,
        })

        assert.equal(converted.kind, 'task')
        assert.equal(converted.status, 'converted')
        assert.equal(converted.completedAt !== null, true)
        assert.equal(converted.convertedTaskId !== null, true)

        await harness.repository.remove({
          context: harness.context,
          id: shoppingItemId,
        })
        await assert.rejects(
          async () => {
            await harness.repository.getById(harness.context, shoppingItemId)
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'chaos_inbox_item_not_found'),
        )

        await harness.repository.bulkRemove({
          context: harness.context,
          ids: [ideaItemId],
        })
        assert.equal(
          (
            await harness.repository.list({
              context: harness.context,
            })
          ).total,
          0,
        )
      } finally {
        await harness.cleanup()
      }
    })
  })
}
