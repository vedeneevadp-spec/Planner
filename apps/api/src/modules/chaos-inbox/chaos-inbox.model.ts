import type {
  ChaosInboxBulkUpdateInput,
  ChaosInboxItemRecord,
  ChaosInboxItemUpdateInput,
  ChaosInboxListFilters,
  ChaosInboxListRecordResponse,
  CreateChaosInboxItemsInput,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredChaosInboxItemRecord = ChaosInboxItemRecord

export interface ChaosInboxReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
  workspaceId: string
}

export interface ChaosInboxWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  role?: WorkspaceRole | undefined
  workspaceId: string
}

export interface CreateChaosInboxItemsCommand {
  context: ChaosInboxWriteContext
  input: CreateChaosInboxItemsInput
}

export interface ListChaosInboxItemsCommand {
  context: ChaosInboxReadContext
  filters?: ChaosInboxListFilters | undefined
}

export interface UpdateChaosInboxItemCommand {
  context: ChaosInboxWriteContext
  id: string
  input: ChaosInboxItemUpdateInput
}

export interface BulkUpdateChaosInboxItemsCommand {
  context: ChaosInboxWriteContext
  input: ChaosInboxBulkUpdateInput
}

export interface DeleteChaosInboxItemCommand {
  context: ChaosInboxWriteContext
  id: string
}

export interface BulkDeleteChaosInboxItemsCommand {
  context: ChaosInboxWriteContext
  ids: string[]
}

export interface MarkChaosInboxItemConvertedCommand {
  context: ChaosInboxWriteContext
  convertedTaskId: string
  id: string
}

export type ChaosInboxListResult = ChaosInboxListRecordResponse
