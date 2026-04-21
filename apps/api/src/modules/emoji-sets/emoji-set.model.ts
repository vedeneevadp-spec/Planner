import type {
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
