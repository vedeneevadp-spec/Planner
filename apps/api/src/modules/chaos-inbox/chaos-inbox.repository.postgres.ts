import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
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

type ChaosInboxRow = Selectable<DatabaseSchema['app.chaos_inbox_items']>
type TaskRow = Pick<
  Selectable<DatabaseSchema['app.tasks']>,
  'deleted_at' | 'id'
>

export class PostgresChaosInboxRepository implements ChaosInboxRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async list(
    command: ListChaosInboxItemsCommand,
  ): Promise<ChaosInboxListResult> {
    const page = command.filters?.page ?? 1
    const limit = command.filters?.limit ?? 50
    const offset = (page - 1) * limit
    const [rows, totalResult] = await withOptionalRls(
      this.db,
      command.context.auth,
      async (executor) => {
        let query = this.baseListQuery(
          executor,
          command.context,
          command.filters,
        )
        const countQuery = this.baseCountQuery(
          executor,
          command.context,
          command.filters,
        )

        query = query.orderBy('created_at', 'desc').limit(limit).offset(offset)
        const [itemRows, countRow] = await Promise.all([
          query.execute(),
          countQuery.executeTakeFirst(),
        ])

        return [itemRows, countRow] as const
      },
      command.context.actorUserId,
    )
    const deletedTaskIds = await this.loadDeletedConvertedTaskIds(
      command.context,
      rows,
    )

    return {
      items: rows.map((row) => this.mapItemRecord(row, deletedTaskIds)),
      limit,
      page,
      total: Number(totalResult?.total ?? 0),
    }
  }

  async getById(
    context: ChaosInboxReadContext,
    id: string,
  ): Promise<StoredChaosInboxItemRecord> {
    const row = await withOptionalRls(
      this.db,
      context.auth,
      (executor) => this.loadItemRow(executor, context, id),
      context.actorUserId,
    )

    if (!row) {
      throw new HttpError(
        404,
        'chaos_inbox_item_not_found',
        'Chaos inbox item not found.',
      )
    }

    const deletedTaskIds = await this.loadDeletedConvertedTaskIds(context, [
      row,
    ])

    return this.mapItemRecord(row, deletedTaskIds)
  }

  async create(
    command: CreateChaosInboxItemsCommand,
  ): Promise<StoredChaosInboxItemRecord[]> {
    const rows = await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) =>
        trx
          .insertInto('app.chaos_inbox_items')
          .values(
            command.input.items.map((item) => ({
              created_by: command.context.actorUserId,
              deleted_at: null,
              id: item.id ?? generateUuidV7(),
              kind: item.kind,
              source: item.source,
              status: 'new' as const,
              text: normalizeText(item.text),
              updated_by: command.context.actorUserId,
              user_id: command.context.actorUserId,
              workspace_id: command.context.workspaceId,
            })),
          )
          .returningAll()
          .execute(),
      command.context.actorUserId,
    )

    return rows.map((row) => this.mapItemRecord(row, new Set()))
  }

  async update(
    command: UpdateChaosInboxItemCommand,
  ): Promise<StoredChaosInboxItemRecord> {
    const row = await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const updated = await this.applyUpdateQuery(
          trx,
          command.context,
          [command.id],
          command.input,
        )
          .returningAll()
          .executeTakeFirst()

        if (!updated) {
          throw new HttpError(
            404,
            'chaos_inbox_item_not_found',
            'Chaos inbox item not found.',
          )
        }

        return updated
      },
      command.context.actorUserId,
    )

    return this.mapItemRecord(row, new Set())
  }

  async bulkUpdate(
    command: BulkUpdateChaosInboxItemsCommand,
  ): Promise<StoredChaosInboxItemRecord[]> {
    const rows = await withWriteTransaction(
      this.db,
      command.context.auth,
      (trx) =>
        this.applyUpdateQuery(
          trx,
          command.context,
          command.input.ids,
          command.input.patch,
        )
          .returningAll()
          .execute(),
      command.context.actorUserId,
    )

    return rows.map((row) => this.mapItemRecord(row, new Set()))
  }

  async markConverted(
    command: MarkChaosInboxItemConvertedCommand,
  ): Promise<StoredChaosInboxItemRecord> {
    const row = await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const updated = await trx
          .updateTable('app.chaos_inbox_items')
          .set({
            converted_task_id: command.convertedTaskId,
            kind: 'task',
            status: 'converted',
            updated_by: command.context.actorUserId,
          })
          .where('workspace_id', '=', command.context.workspaceId)
          .where('user_id', '=', command.context.actorUserId)
          .where('id', '=', command.id)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst()

        if (!updated) {
          throw new HttpError(
            404,
            'chaos_inbox_item_not_found',
            'Chaos inbox item not found.',
          )
        }

        return updated
      },
      command.context.actorUserId,
    )

    return this.mapItemRecord(row, new Set())
  }

  async remove(command: DeleteChaosInboxItemCommand): Promise<void> {
    await this.softDelete(command.context, [command.id])
  }

  async bulkRemove(command: BulkDeleteChaosInboxItemsCommand): Promise<void> {
    await this.softDelete(command.context, command.ids)
  }

  private baseListQuery(
    executor: DatabaseExecutor,
    context: ChaosInboxReadContext,
    filters: ListChaosInboxItemsCommand['filters'],
  ) {
    let query = executor
      .selectFrom('app.chaos_inbox_items')
      .selectAll()
      .where('workspace_id', '=', context.workspaceId)
      .where('deleted_at', 'is', null)

    if (context.actorUserId) {
      query = query.where('user_id', '=', context.actorUserId)
    }

    if (filters?.status) {
      query = query.where('status', '=', filters.status)
    }

    if (filters?.kind) {
      query = query.where('kind', '=', filters.kind)
    }

    if (filters?.sphereId) {
      query = query.where('sphere_id', '=', filters.sphereId)
    }

    return query
  }

  private baseCountQuery(
    executor: DatabaseExecutor,
    context: ChaosInboxReadContext,
    filters: ListChaosInboxItemsCommand['filters'],
  ) {
    let query = executor
      .selectFrom('app.chaos_inbox_items')
      .select(({ fn }) => fn.countAll<number>().as('total'))
      .where('workspace_id', '=', context.workspaceId)
      .where('deleted_at', 'is', null)

    if (context.actorUserId) {
      query = query.where('user_id', '=', context.actorUserId)
    }

    if (filters?.status) {
      query = query.where('status', '=', filters.status)
    }

    if (filters?.kind) {
      query = query.where('kind', '=', filters.kind)
    }

    if (filters?.sphereId) {
      query = query.where('sphere_id', '=', filters.sphereId)
    }

    return query
  }

  private loadItemRow(
    executor: DatabaseExecutor,
    context: ChaosInboxReadContext,
    id: string,
  ): Promise<ChaosInboxRow | undefined> {
    let query = executor
      .selectFrom('app.chaos_inbox_items')
      .selectAll()
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)

    if (context.actorUserId) {
      query = query.where('user_id', '=', context.actorUserId)
    }

    return query.executeTakeFirst()
  }

  private applyUpdateQuery(
    executor: DatabaseExecutor,
    context: UpdateChaosInboxItemCommand['context'],
    ids: string[],
    patch: UpdateChaosInboxItemCommand['input'],
  ) {
    return executor
      .updateTable('app.chaos_inbox_items')
      .set({
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.sphereId !== undefined ? { sphere_id: patch.sphereId } : {}),
        ...(patch.dueDate !== undefined ? { due_on: patch.dueDate } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updated_by: context.actorUserId,
      })
      .where('workspace_id', '=', context.workspaceId)
      .where('user_id', '=', context.actorUserId)
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)
  }

  private async softDelete(
    context: DeleteChaosInboxItemCommand['context'],
    ids: string[],
  ): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      context.auth,
      (trx) =>
        trx
          .updateTable('app.chaos_inbox_items')
          .set({
            deleted_at: deletedAt,
            updated_by: context.actorUserId,
          })
          .where('workspace_id', '=', context.workspaceId)
          .where('user_id', '=', context.actorUserId)
          .where('id', 'in', ids)
          .where('deleted_at', 'is', null)
          .execute(),
      context.actorUserId,
    )
  }

  private async loadDeletedConvertedTaskIds(
    context: ChaosInboxReadContext,
    rows: ChaosInboxRow[],
  ): Promise<Set<string>> {
    const taskIds = [
      ...new Set(
        rows
          .map((row) => row.converted_task_id)
          .filter((id): id is string => id !== null),
      ),
    ]

    if (taskIds.length === 0) {
      return new Set()
    }

    const taskRows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        executor
          .selectFrom('app.tasks')
          .select(['deleted_at', 'id'])
          .where('workspace_id', '=', context.workspaceId)
          .where('id', 'in', taskIds)
          .execute(),
      context.actorUserId,
    )

    return new Set(
      taskRows
        .filter(
          (
            task,
          ): task is TaskRow & {
            deleted_at: NonNullable<TaskRow['deleted_at']>
          } => task.deleted_at !== null,
        )
        .map((task) => task.id),
    )
  }

  private mapItemRecord(
    row: ChaosInboxRow,
    deletedTaskIds: Set<string>,
  ): StoredChaosInboxItemRecord {
    return {
      convertedNoteId: row.converted_note_id,
      convertedTaskId: row.converted_task_id,
      createdAt: serializeTimestamp(row.created_at),
      deletedAt: serializeNullableTimestamp(row.deleted_at),
      dueDate: serializeNullableDate(row.due_on),
      id: row.id,
      kind: row.kind,
      linkedTaskDeleted:
        row.converted_task_id !== null &&
        deletedTaskIds.has(row.converted_task_id),
      priority: row.priority,
      source: row.source,
      sphereId: row.sphere_id,
      status: row.status,
      text: row.text,
      updatedAt: serializeTimestamp(row.updated_at),
      userId: row.user_id,
      version: Number(row.version),
      workspaceId: row.workspace_id,
    }
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+$/gm, '')
    .trim()
    .replace(/\n{3,}/g, '\n\n')
}

function serializeNullableDate(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  throw new TypeError(`Unexpected date value: ${typeof value}`)
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
