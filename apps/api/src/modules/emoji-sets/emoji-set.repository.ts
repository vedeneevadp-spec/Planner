import type {
  CreateEmojiSetCommand,
  EmojiSetReadContext,
  StoredEmojiSetRecord,
} from './emoji-set.model.js'

export interface EmojiSetRepository {
  listByWorkspace(context: EmojiSetReadContext): Promise<StoredEmojiSetRecord[]>
  getById(
    context: EmojiSetReadContext,
    emojiSetId: string,
  ): Promise<StoredEmojiSetRecord>
  create(command: CreateEmojiSetCommand): Promise<StoredEmojiSetRecord>
}
