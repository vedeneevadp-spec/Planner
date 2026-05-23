import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  addEmojiSetItemsInputSchema,
  generateUuidV7,
  newEmojiSetInputSchema,
} from '@planner/contracts'

import { hasHttpErrorCode } from '../../testing/repository-contract-assertions.js'
import type { EmojiSetWriteContext } from './emoji-set.model.js'
import type { EmojiSetRepository } from './emoji-set.repository.js'

export interface EmojiSetRepositoryContractHarness {
  cleanup: () => Promise<void>
  context: EmojiSetWriteContext
  otherContext: EmojiSetWriteContext
  repository: EmojiSetRepository
}

export function defineEmojiSetRepositoryContractSuite(input: {
  createHarness: () => Promise<EmojiSetRepositoryContractHarness>
  name: string
}): void {
  void describe(input.name, () => {
    void test('keeps global icon set lifecycle consistent across workspaces', async () => {
      const harness = await input.createHarness()

      try {
        const emojiSetId = generateUuidV7()
        const emojiSet = await harness.repository.create({
          context: harness.context,
          input: newEmojiSetInputSchema.parse({
            description: '  Useful icons  ',
            id: emojiSetId,
            items: [
              {
                keywords: ['  Home ', 'home', 'main'],
                label: '  House  ',
                shortcode: ' :HOME: ',
                value: 'icon://house',
              },
            ],
            title: '  Home Set  ',
          }),
        })
        const duplicate = await harness.repository.create({
          context: harness.context,
          input: newEmojiSetInputSchema.parse({
            description: 'Duplicate should not overwrite',
            id: emojiSetId,
            items: [
              {
                label: 'Duplicate',
                value: 'icon://duplicate',
              },
            ],
            title: 'Duplicate',
          }),
        })
        const otherWorkspaceSet = await harness.repository.create({
          context: harness.otherContext,
          input: newEmojiSetInputSchema.parse({
            description: 'Other workspace',
            items: [
              {
                label: 'Other',
                value: 'icon://other',
              },
            ],
            title: 'Other Set',
          }),
        })

        assert.equal(duplicate.id, emojiSet.id)
        assert.equal(duplicate.title, 'Home Set')
        assert.equal(emojiSet.description, 'Useful icons')
        assert.equal(emojiSet.items.length, 1)
        assert.deepEqual(emojiSet.items[0]?.keywords, ['home', 'main'])
        assert.equal(emojiSet.items[0]?.label, 'House')
        assert.equal(emojiSet.items[0]?.shortcode, 'home')
        assert.equal(emojiSet.items[0]?.sortOrder, 0)
        assert.equal(
          emojiSet.items[0]?.workspaceId,
          harness.context.workspaceId,
        )
        assert.equal(emojiSet.title, 'Home Set')
        assert.equal(emojiSet.version, 1)
        assert.equal(emojiSet.workspaceId, harness.context.workspaceId)

        assert.deepEqual(
          (await harness.repository.listByWorkspace(harness.context))
            .map((candidate) => candidate.id)
            .sort(),
          [emojiSet.id, otherWorkspaceSet.id].sort(),
        )
        assert.deepEqual(
          (await harness.repository.listByWorkspace(harness.otherContext))
            .map((candidate) => candidate.id)
            .sort(),
          [emojiSet.id, otherWorkspaceSet.id].sort(),
        )
        assert.equal(
          (await harness.repository.getById(harness.otherContext, emojiSet.id))
            .id,
          emojiSet.id,
        )

        const withAddedItems = await harness.repository.addItems({
          context: harness.context,
          emojiSetId: emojiSet.id,
          input: addEmojiSetItemsInputSchema.parse({
            items: [
              {
                keywords: ['kitchen'],
                label: 'Kitchen',
                value: 'icon://kitchen',
              },
            ],
          }),
        })

        assert.equal(withAddedItems.items.length, 2)
        assert.equal(withAddedItems.items[1]?.label, 'Kitchen')
        assert.equal(withAddedItems.items[1]?.shortcode, 'icon-2')
        assert.equal(withAddedItems.version, emojiSet.version + 1)

        const deletedItem = await harness.repository.deleteItem({
          context: harness.context,
          emojiSetId: emojiSet.id,
          iconAssetId: withAddedItems.items[0]!.id,
        })
        const afterItemDelete = await harness.repository.getById(
          harness.context,
          emojiSet.id,
        )

        assert.equal(deletedItem.deletedAt !== null, true)
        assert.deepEqual(
          afterItemDelete.items.map((item) => item.id),
          [withAddedItems.items[1].id],
        )

        const deletedSet = await harness.repository.deleteSet({
          context: harness.context,
          emojiSetId: emojiSet.id,
        })

        assert.equal(deletedSet.deletedAt !== null, true)
        assert.deepEqual(
          (await harness.repository.listByWorkspace(harness.context)).map(
            (candidate) => candidate.id,
          ),
          [otherWorkspaceSet.id],
        )
        await assert.rejects(
          async () => {
            await harness.repository.getById(harness.context, emojiSet.id)
          },
          (error: unknown) => hasHttpErrorCode(error, 'emoji_set_not_found'),
        )
      } finally {
        await harness.cleanup()
      }
    })
  })
}
