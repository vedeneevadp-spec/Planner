import type {
  BulkDeleteChaosInboxItemsCommand,
  BulkUpdateChaosInboxItemsCommand,
  ChaosInboxListResult,
  ChaosInboxReadContext,
  CreateChaosInboxItemsCommand,
  DeleteChaosInboxItemCommand,
  ListChaosInboxItemsCommand,
  MarkChaosInboxItemConvertedCommand,
  StoredChaosInboxItemRecord,
  UpdateChaosInboxItemCommand,
} from './chaos-inbox.model.js'

export interface ChaosInboxRepository {
  list(command: ListChaosInboxItemsCommand): Promise<ChaosInboxListResult>
  getById(
    context: ChaosInboxReadContext,
    id: string,
  ): Promise<StoredChaosInboxItemRecord>
  create(
    command: CreateChaosInboxItemsCommand,
  ): Promise<StoredChaosInboxItemRecord[]>
  update(
    command: UpdateChaosInboxItemCommand,
  ): Promise<StoredChaosInboxItemRecord>
  bulkUpdate(
    command: BulkUpdateChaosInboxItemsCommand,
  ): Promise<StoredChaosInboxItemRecord[]>
  markConverted(
    command: MarkChaosInboxItemConvertedCommand,
  ): Promise<StoredChaosInboxItemRecord>
  remove(command: DeleteChaosInboxItemCommand): Promise<void>
  bulkRemove(command: BulkDeleteChaosInboxItemsCommand): Promise<void>
}
