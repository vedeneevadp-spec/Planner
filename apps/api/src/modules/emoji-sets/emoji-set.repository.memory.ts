import { EmojiSetNotFoundError } from './emoji-set.errors.js'
import type {
  CreateEmojiSetCommand,
  EmojiSetReadContext,
  StoredEmojiSetRecord,
} from './emoji-set.model.js'
import type { EmojiSetRepository } from './emoji-set.repository.js'
import {
  createStoredEmojiSetRecord,
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
