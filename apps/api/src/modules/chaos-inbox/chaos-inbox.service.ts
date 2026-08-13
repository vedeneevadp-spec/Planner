import { HttpError } from '../../bootstrap/http-error.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import type {
  BulkDeleteChaosInboxItemsCommand,
  BulkUpdateChaosInboxItemsCommand,
  ChaosInboxReadContext,
  ChaosInboxWriteContext,
  CreateChaosInboxItemsCommand,
  ListChaosInboxItemsCommand,
  UpdateChaosInboxItemCommand,
} from './chaos-inbox.model.js'
import type { ChaosInboxRepository } from './chaos-inbox.repository.js'

export class ChaosInboxService {
  constructor(private readonly repository: ChaosInboxRepository) {}

  listItems(
    context: ChaosInboxReadContext,
    filters?: ListChaosInboxItemsCommand['filters'],
  ) {
    return this.repository.list({ context, filters })
  }

  createItems(
    context: ChaosInboxWriteContext,
    input: CreateChaosInboxItemsCommand['input'],
  ) {
    assertCanWriteChaosInbox(context)

    return this.repository.create({ context, input })
  }

  updateItem(
    context: ChaosInboxWriteContext,
    id: string,
    input: UpdateChaosInboxItemCommand['input'],
  ) {
    assertCanWriteChaosInbox(context)

    return this.repository.update({ context, id, input })
  }

  bulkUpdate(
    context: ChaosInboxWriteContext,
    input: BulkUpdateChaosInboxItemsCommand['input'],
  ) {
    assertCanWriteChaosInbox(context)

    return this.repository.bulkUpdate({ context, input })
  }

  removeItem(context: ChaosInboxWriteContext, id: string) {
    assertCanWriteChaosInbox(context)

    return this.repository.remove({ context, id })
  }

  bulkRemove(
    context: ChaosInboxWriteContext,
    ids: BulkDeleteChaosInboxItemsCommand['ids'],
  ) {
    assertCanWriteChaosInbox(context)

    return this.repository.bulkRemove({ context, ids })
  }

  async convertToTask(context: ChaosInboxWriteContext, id: string) {
    assertCanWriteChaosInbox(context)

    const [conversion] = await this.repository.convertToTasks({
      context,
      ids: [id],
    })

    if (!conversion) {
      throw new Error('Chaos inbox conversion did not return a result.')
    }

    return conversion
  }

  async bulkConvertToTasks(context: ChaosInboxWriteContext, ids: string[]) {
    assertCanWriteChaosInbox(context)

    return this.repository.convertToTasks({ context, ids })
  }
}

function assertCanWriteChaosInbox(context: ChaosInboxWriteContext): void {
  if (!canWriteWorkspaceContent(context)) {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace access cannot write chaos inbox.',
    )
  }
}
