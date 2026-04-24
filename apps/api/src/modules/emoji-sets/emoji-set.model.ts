import type {
  AddEmojiSetItemsInput,
  AppRole,
  EmojiAssetRecord,
  EmojiSetRecord,
  NewEmojiSetInput,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredEmojiAssetRecord = EmojiAssetRecord
export type StoredEmojiSetRecord = EmojiSetRecord

export interface EmojiSetReadContext {
  actorUserId?: string | undefined
  appRole?: AppRole | undefined
  auth: AuthenticatedRequestContext | null
  workspaceId: string
}

export interface EmojiSetWriteContext {
  actorUserId: string
  appRole?: AppRole | undefined
  auth: AuthenticatedRequestContext | null
  workspaceId: string
}

export interface CreateEmojiSetCommand {
  context: EmojiSetWriteContext
  input: NewEmojiSetInput
}

export interface AddEmojiSetItemsCommand {
  context: EmojiSetWriteContext
  emojiSetId: string
  input: AddEmojiSetItemsInput
}

export interface DeleteEmojiSetCommand {
  context: EmojiSetWriteContext
  emojiSetId: string
}

export interface DeleteEmojiSetItemCommand {
  context: EmojiSetWriteContext
  emojiSetId: string
  iconAssetId: string
}
