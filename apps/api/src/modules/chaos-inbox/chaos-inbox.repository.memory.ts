import { HttpError } from '../../bootstrap/http-error.js'
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
import type { ChaosInboxRepository } from './chaos-inbox.repository.js'
import { createStoredChaosInboxItemRecord } from './chaos-inbox.shared.js'

export class MemoryChaosInboxRepository implements ChaosInboxRepository {
  private readonly items = new Map<string, StoredChaosInboxItemRecord>()

  list(command: ListChaosInboxItemsCommand): Promise<ChaosInboxListResult> {
    const page = command.filters?.page ?? 1
    const limit = command.filters?.limit ?? 50
    const filtered = [...this.items.values()]
      .filter((item) => this.matchesContext(item, command.context))
      .filter((item) => item.deletedAt === null)
      .filter((item) =>
        command.filters?.status ? item.status === command.filters.status : true,
      )
      .filter((item) =>
        command.filters?.kind ? item.kind === command.filters.kind : true,
      )
      .filter((item) =>
        command.filters?.sphereId
          ? item.sphereId === command.filters.sphereId
          : true,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const offset = (page - 1) * limit

    return Promise.resolve({
      items: filtered.slice(offset, offset + limit),
      limit,
      page,
      total: filtered.length,
    })
  }

  getById(
    context: ChaosInboxReadContext,
    id: string,
  ): Promise<StoredChaosInboxItemRecord> {
    return Promise.resolve(this.getItemOrThrow(context, id))
  }

  create(
    command: CreateChaosInboxItemsCommand,
  ): Promise<StoredChaosInboxItemRecord[]> {
    const items = command.input.items.map((input) =>
      createStoredChaosInboxItemRecord(input, {
        userId: command.context.actorUserId,
        workspaceId: command.context.workspaceId,
      }),
    )

    for (const item of items) {
      this.items.set(item.id, item)
    }

    return Promise.resolve(items)
  }

  update(
    command: UpdateChaosInboxItemCommand,
  ): Promise<StoredChaosInboxItemRecord> {
    const item = this.getItemOrThrow(command.context, command.id)
    const nextItem = applyUpdate(item, command.input)

    this.items.set(nextItem.id, nextItem)

    return Promise.resolve(nextItem)
  }

  bulkUpdate(
    command: BulkUpdateChaosInboxItemsCommand,
  ): Promise<StoredChaosInboxItemRecord[]> {
    const updated = command.input.ids.map((id) => {
      const item = this.getItemOrThrow(command.context, id)
      const nextItem = applyUpdate(item, command.input.patch)

      this.items.set(nextItem.id, nextItem)

      return nextItem
    })

    return Promise.resolve(updated)
  }

  markConverted(
    command: MarkChaosInboxItemConvertedCommand,
  ): Promise<StoredChaosInboxItemRecord> {
    const item = this.getItemOrThrow(command.context, command.id)
    const nextItem: StoredChaosInboxItemRecord = {
      ...item,
      convertedTaskId: command.convertedTaskId,
      kind: 'task',
      status: 'converted',
      updatedAt: new Date().toISOString(),
      version: item.version + 1,
    }

    this.items.set(nextItem.id, nextItem)

    return Promise.resolve(nextItem)
  }

  remove(command: DeleteChaosInboxItemCommand): Promise<void> {
    const item = this.getItemOrThrow(command.context, command.id)

    this.items.set(item.id, {
      ...item,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: item.version + 1,
    })

    return Promise.resolve()
  }

  bulkRemove(command: BulkDeleteChaosInboxItemsCommand): Promise<void> {
    for (const id of command.ids) {
      const item = this.getItemOrThrow(command.context, id)

      this.items.set(item.id, {
        ...item,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: item.version + 1,
      })
    }

    return Promise.resolve()
  }

  private getItemOrThrow(
    context: ChaosInboxReadContext,
    id: string,
  ): StoredChaosInboxItemRecord {
    const item = this.items.get(id)

    if (
      !item ||
      !this.matchesContext(item, context) ||
      item.deletedAt !== null
    ) {
      throw new HttpError(
        404,
        'chaos_inbox_item_not_found',
        'Chaos inbox item not found.',
      )
    }

    return item
  }

  private matchesContext(
    item: StoredChaosInboxItemRecord,
    context: ChaosInboxReadContext,
  ): boolean {
    return (
      item.workspaceId === context.workspaceId &&
      (!context.actorUserId ||
        context.workspaceKind === 'shared' ||
        item.userId === context.actorUserId)
    )
  }
}

function applyUpdate(
  item: StoredChaosInboxItemRecord,
  patch: UpdateChaosInboxItemCommand['input'],
): StoredChaosInboxItemRecord {
  return {
    ...item,
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.sphereId !== undefined ? { sphereId: patch.sphereId } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: new Date().toISOString(),
    version: item.version + 1,
  }
}
