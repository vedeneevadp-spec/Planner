import {
  EmojiAssetNotFoundError,
  EmojiSetNotFoundError,
} from './emoji-set.errors.js'
import type {
  AddEmojiSetItemsCommand,
  CreateEmojiSetCommand,
  DeleteEmojiSetCommand,
  DeleteEmojiSetItemCommand,
  EmojiSetReadContext,
  StoredEmojiAssetRecord,
  StoredEmojiSetRecord,
} from './emoji-set.model.js'
import type { EmojiSetRepository } from './emoji-set.repository.js'
import {
  createStoredEmojiAssetRecord,
  createStoredEmojiSetRecord,
  normalizeEmojiAssetInput,
  sortStoredEmojiSets,
} from './emoji-set.shared.js'

export class MemoryEmojiSetRepository implements EmojiSetRepository {
  private readonly emojiSets = new Map<string, StoredEmojiSetRecord>()

  listByWorkspace(
    context: EmojiSetReadContext,
  ): Promise<StoredEmojiSetRecord[]> {
    const emojiSets = [...this.emojiSets.values()].filter(
      (emojiSet) =>
        emojiSet.workspaceId === context.workspaceId &&
        emojiSet.deletedAt === null &&
        emojiSet.status === 'active',
    )

    return Promise.resolve(sortStoredEmojiSets(emojiSets))
  }

  getById(
    context: EmojiSetReadContext,
    emojiSetId: string,
  ): Promise<StoredEmojiSetRecord> {
    return Promise.resolve(
      this.getEmojiSetOrThrow(emojiSetId, context.workspaceId),
    )
  }

  create(command: CreateEmojiSetCommand): Promise<StoredEmojiSetRecord> {
    const existingEmojiSet = command.input.id
      ? this.emojiSets.get(command.input.id)
      : undefined

    if (
      existingEmojiSet &&
      existingEmojiSet.workspaceId === command.context.workspaceId &&
      existingEmojiSet.deletedAt === null
    ) {
      return Promise.resolve(existingEmojiSet)
    }

    const emojiSet = createStoredEmojiSetRecord(command.input, {
      workspaceId: command.context.workspaceId,
    })

    this.emojiSets.set(emojiSet.id, emojiSet)

    return Promise.resolve(emojiSet)
  }

  addItems(command: AddEmojiSetItemsCommand): Promise<StoredEmojiSetRecord> {
    const emojiSet = this.getEmojiSetOrThrow(
      command.emojiSetId,
      command.context.workspaceId,
    )
    const now = new Date().toISOString()
    const addedItems = command.input.items.map((item, index) =>
      createStoredEmojiAssetRecord(
        normalizeEmojiAssetInput(item, emojiSet.items.length + index),
        {
          emojiSetId: emojiSet.id,
          now,
          sortOrder: emojiSet.items.length + index,
          workspaceId: command.context.workspaceId,
        },
      ),
    )
    const updatedEmojiSet: StoredEmojiSetRecord = {
      ...emojiSet,
      items: [...emojiSet.items, ...addedItems],
      updatedAt: now,
      version: emojiSet.version + 1,
    }

    this.emojiSets.set(updatedEmojiSet.id, updatedEmojiSet)

    return Promise.resolve(updatedEmojiSet)
  }

  deleteSet(command: DeleteEmojiSetCommand): Promise<StoredEmojiSetRecord> {
    const emojiSet = this.getEmojiSetOrThrow(
      command.emojiSetId,
      command.context.workspaceId,
    )
    const now = new Date().toISOString()
    const deletedEmojiSet: StoredEmojiSetRecord = {
      ...emojiSet,
      deletedAt: now,
      items: emojiSet.items.map((item) => ({
        ...item,
        deletedAt: now,
        updatedAt: now,
        version: item.version + 1,
      })),
      updatedAt: now,
      version: emojiSet.version + 1,
    }

    this.emojiSets.set(deletedEmojiSet.id, deletedEmojiSet)

    return Promise.resolve(deletedEmojiSet)
  }

  deleteItem(
    command: DeleteEmojiSetItemCommand,
  ): Promise<StoredEmojiAssetRecord> {
    const emojiSet = this.getEmojiSetOrThrow(
      command.emojiSetId,
      command.context.workspaceId,
    )
    const iconAsset = emojiSet.items.find(
      (item) => item.id === command.iconAssetId && item.deletedAt === null,
    )

    if (!iconAsset) {
      throw new EmojiAssetNotFoundError(command.iconAssetId)
    }

    const now = new Date().toISOString()
    const deletedIconAsset: StoredEmojiAssetRecord = {
      ...iconAsset,
      deletedAt: now,
      updatedAt: now,
      version: iconAsset.version + 1,
    }
    const updatedEmojiSet: StoredEmojiSetRecord = {
      ...emojiSet,
      items: emojiSet.items.filter((item) => item.id !== command.iconAssetId),
      updatedAt: now,
      version: emojiSet.version + 1,
    }

    this.emojiSets.set(updatedEmojiSet.id, updatedEmojiSet)

    return Promise.resolve(deletedIconAsset)
  }

  private getEmojiSetOrThrow(
    emojiSetId: string,
    workspaceId: string,
  ): StoredEmojiSetRecord {
    const emojiSet = this.emojiSets.get(emojiSetId)

    if (
      !emojiSet ||
      emojiSet.workspaceId !== workspaceId ||
      emojiSet.deletedAt !== null ||
      emojiSet.status !== 'active'
    ) {
      throw new EmojiSetNotFoundError(emojiSetId)
    }

    return emojiSet
  }
}
