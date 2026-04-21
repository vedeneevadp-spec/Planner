import type {
  AddEmojiSetItemsInput,
  EmojiAssetRecord,
  EmojiSetRecord,
  NewEmojiSetInput,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredEmojiAssetRecord = EmojiAssetRecord
export type StoredEmojiSetRecord = EmojiSetRecord

export interface EmojiSetReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
  workspaceId: string
}

export interface EmojiSetWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
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
