import type {
  AddEmojiSetItemsCommand,
  CreateEmojiSetCommand,
  DeleteEmojiSetCommand,
  DeleteEmojiSetItemCommand,
  EmojiSetReadContext,
  StoredEmojiAssetRecord,
  StoredEmojiSetRecord,
} from './emoji-set.model.js'

export interface EmojiSetRepository {
  listByWorkspace(context: EmojiSetReadContext): Promise<StoredEmojiSetRecord[]>
  getById(
    context: EmojiSetReadContext,
    emojiSetId: string,
  ): Promise<StoredEmojiSetRecord>
  create(command: CreateEmojiSetCommand): Promise<StoredEmojiSetRecord>
  addItems(command: AddEmojiSetItemsCommand): Promise<StoredEmojiSetRecord>
  deleteSet(command: DeleteEmojiSetCommand): Promise<StoredEmojiSetRecord>
  deleteItem(
    command: DeleteEmojiSetItemCommand,
  ): Promise<StoredEmojiAssetRecord>
}
