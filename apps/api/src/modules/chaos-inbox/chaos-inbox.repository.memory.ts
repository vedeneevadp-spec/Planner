import { HttpError } from '../../bootstrap/http-error.js'
import { MemoryTaskRepository, type TaskRepository } from '../tasks/index.js'
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
import type { ChaosInboxRepository } from './chaos-inbox.repository.js'
import {
  buildChaosInboxTaskInput,
  createStoredChaosInboxItemRecord,
  resolveShoppingCreateReplay,
} from './chaos-inbox.shared.js'

export class MemoryChaosInboxRepository implements ChaosInboxRepository {
  private readonly items = new Map<string, StoredChaosInboxItemRecord>()

  constructor(
    private readonly taskRepository: TaskRepository = new MemoryTaskRepository(),
  ) {}

  list(command: ListChaosInboxItemsCommand): Promise<ChaosInboxListResult> {
    const page = command.filters?.page ?? 1
    const limit = command.filters?.limit ?? 50
    const filtered = [...this.items.values()]
      .filter((item) => this.matchesContext(item, command.context))
      .filter((item) => item.deletedAt === null)
      .filter(
        (item) =>
          !command.filters?.search ||
          item.text
            .toLowerCase()
            .includes(command.filters.search.toLowerCase()),
      )
      .filter(
        (item) =>
          command.filters?.includeCompleted !== false ||
          item.status !== 'archived',
      )
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

    const single =
      command.input.items.length === 1 ? command.input.items[0] : undefined
    if (single?.id && this.items.has(single.id)) {
      return Promise.resolve([
        resolveShoppingCreateReplay(
          this.items.get(single.id),
          single,
          command.context.actorUserId,
          command.context.workspaceId,
        ),
      ])
    }
    if (
      items.some((item) => this.items.has(item.id)) ||
      new Set(items.map((item) => item.id)).size !== items.length
    ) {
      throw new HttpError(
        409,
        'chaos_inbox_id_conflict',
        'Inbox item id is already in use.',
      )
    }
    for (const item of items) {
      this.items.set(item.id, item)
    }

    return Promise.resolve(items)
  }

  update(
    command: UpdateChaosInboxItemCommand,
  ): Promise<StoredChaosInboxItemRecord> {
    const item = this.getItemOrThrow(command.context, command.id)
    if (command.requiredKind && item.kind !== command.requiredKind) {
      throw new HttpError(404, 'shopping_item_not_found', 'Покупка не найдена.')
    }
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

  async convertToTasks(
    command: ConvertChaosInboxItemsCommand,
  ): Promise<ChaosInboxTaskConversionResult[]> {
    for (const id of new Set(command.ids)) {
      this.getItemOrThrow(command.context, id)
    }

    const conversions: ChaosInboxTaskConversionResult[] = []

    for (const id of command.ids) {
      const item = this.getItemOrThrow(command.context, id)
      if (item.convertedTaskId) {
        conversions.push({ inboxItem: item, taskId: item.convertedTaskId })
        continue
      }

      const task = await this.taskRepository.create({
        context: command.context,
        input: buildChaosInboxTaskInput(item),
      })
      const now = new Date().toISOString()
      const inboxItem: StoredChaosInboxItemRecord = {
        ...item,
        completedAt: now,
        convertedTaskId: task.id,
        kind: 'task',
        status: 'converted',
        updatedAt: now,
        version: item.version + 1,
      }

      this.items.set(inboxItem.id, inboxItem)
      conversions.push({ inboxItem, taskId: task.id })
    }

    return conversions
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
  const now = new Date().toISOString()
  const statusDates = buildStatusDates(patch.status, now)

  return {
    ...item,
    ...statusDates,
    ...(patch.text !== undefined ? { text: patch.text.trim() } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.isFavorite !== undefined ? { isFavorite: patch.isFavorite } : {}),
    ...(patch.productUrl !== undefined ? { productUrl: patch.productUrl } : {}),
    ...(patch.shoppingCategory !== undefined
      ? { shoppingCategory: patch.shoppingCategory }
      : {}),
    ...(patch.sphereId !== undefined ? { sphereId: patch.sphereId } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: now,
    version: item.version + 1,
  }
}

function buildStatusDates(
  status: UpdateChaosInboxItemCommand['input']['status'],
  now: string,
): Partial<StoredChaosInboxItemRecord> {
  if (status === undefined) {
    return {}
  }

  if (status === 'archived' || status === 'converted') {
    return {
      completedAt: now,
    }
  }

  return {
    activatedAt: now,
    completedAt: null,
  }
}
