import type {
  BulkDeleteChaosInboxItemsCommand,
  BulkUpdateChaosInboxItemsCommand,
  ChaosInboxListResult,
  ChaosInboxReadContext,
  ChaosInboxTaskConversionResult,
  ConvertChaosInboxItemsCommand,
  CreateChaosInboxItemsCommand,
  DeleteChaosInboxItemCommand,
  ListChaosInboxItemsCommand,
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
  convertToTasks(
    command: ConvertChaosInboxItemsCommand,
  ): Promise<ChaosInboxTaskConversionResult[]>
  remove(command: DeleteChaosInboxItemCommand): Promise<void>
  bulkRemove(command: BulkDeleteChaosInboxItemsCommand): Promise<void>
}
