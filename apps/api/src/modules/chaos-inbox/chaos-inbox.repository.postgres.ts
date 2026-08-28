import { generateUuidV7, serializeDateOnly } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import { writeTaskMutationArtifacts } from '../tasks/task.repository.postgres.artifacts.js'
import {
  buildTaskMetadata,
  mapTaskRecord,
} from '../tasks/task.repository.postgres.mapper.js'
import {
  buildTaskTimeFields,
  normalizeTaskInput,
  normalizeTaskSchedule,
} from '../tasks/task.shared.js'
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
import { buildChaosInboxTaskInput } from './chaos-inbox.shared.js'

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
              activated_at: new Date().toISOString(),
              completed_at: null,
              created_by: command.context.actorUserId,
              deleted_at: null,
              id: item.id ?? generateUuidV7(),
              is_favorite: item.isFavorite ?? false,
              kind: item.kind,
              priority: item.priority ?? null,
              shopping_category: item.shoppingCategory ?? null,
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

  async convertToTasks(
    command: ConvertChaosInboxItemsCommand,
  ): Promise<ChaosInboxTaskConversionResult[]> {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const uniqueIds = [...new Set(command.ids)]
        let itemQuery = trx
          .selectFrom('app.chaos_inbox_items')
          .selectAll()
          .where('workspace_id', '=', command.context.workspaceId)
          .where('id', 'in', uniqueIds)
          .where('deleted_at', 'is', null)

        if (command.context.workspaceKind !== 'shared') {
          itemQuery = itemQuery.where(
            'user_id',
            '=',
            command.context.actorUserId,
          )
        }

        const rows = await itemQuery.orderBy('id').forUpdate().execute()

        if (rows.length !== uniqueIds.length) {
          throw new HttpError(
            404,
            'chaos_inbox_item_not_found',
            'Chaos inbox item not found.',
          )
        }

        const rowsById = new Map(rows.map((row) => [row.id, row]))
        const conversions: ChaosInboxTaskConversionResult[] = []

        for (const id of command.ids) {
          const itemRow = rowsById.get(id)!

          if (itemRow.converted_task_id) {
            conversions.push({
              inboxItem: this.mapItemRecord(itemRow, new Set()),
              taskId: itemRow.converted_task_id,
            })
            continue
          }

          const item = this.mapItemRecord(itemRow, new Set())
          const normalizedInput = normalizeTaskInput(
            buildChaosInboxTaskInput(item),
          )
          const normalizedSchedule = normalizeTaskSchedule(normalizedInput)
          const project = itemRow.sphere_id
            ? await trx
                .selectFrom('app.projects')
                .select(['id', 'title'])
                .where('id', '=', itemRow.sphere_id)
                .where('workspace_id', '=', command.context.workspaceId)
                .where('deleted_at', 'is', null)
                .where('status', '=', 'active')
                .executeTakeFirst()
            : null

          if (itemRow.sphere_id && !project) {
            throw new HttpError(
              404,
              'life_sphere_not_found',
              `Life sphere "${itemRow.sphere_id}" was not found.`,
            )
          }

          const metadata = buildTaskMetadata('', normalizedInput)
          const timeFields = buildTaskTimeFields({
            plannerTimeZone: command.context.clientTimeZone,
            schedule: normalizedSchedule,
          })
          const task = await trx
            .insertInto('app.tasks')
            .values({
              assignee_user_id: null,
              created_by: command.context.actorUserId,
              deleted_at: null,
              description: normalizedInput.note,
              due_at: null,
              due_on: normalizedInput.dueDate,
              id: normalizedInput.id ?? generateUuidV7(),
              local_date: timeFields.localDate,
              local_time: timeFields.localTime,
              metadata,
              planned_on: normalizedSchedule.plannedDate,
              priority: 2,
              project_id: project?.id ?? null,
              recurrence_rule: timeFields.recurrenceRule,
              recurrence_start_date: timeFields.recurrenceStartDate,
              recurrence_time_zone: timeFields.recurrenceTimeZone,
              resource: normalizedInput.resource,
              sort_key: '',
              sphere_id: project?.id ?? null,
              starts_at_utc: timeFields.startsAtUtc,
              status: 'todo',
              time_kind: timeFields.timeKind,
              time_zone: timeFields.timeZone,
              time_zone_inferred: timeFields.timeZoneInferred,
              title: normalizedInput.title,
              updated_by: command.context.actorUserId,
              workspace_id: command.context.workspaceId,
            })
            .returningAll()
            .executeTakeFirstOrThrow()
          const taskRecord = mapTaskRecord(
            task,
            undefined,
            project?.title ?? null,
            null,
            command.context.actorDisplayName,
          )

          await writeTaskMutationArtifacts(trx, {
            actorUserId: command.context.actorUserId,
            eventType: 'task.created',
            payload: { origin: 'chaos_conversion', task: taskRecord },
            taskId: task.id,
            workspaceId: command.context.workspaceId,
          })

          const now = new Date().toISOString()
          const convertedItem = await trx
            .updateTable('app.chaos_inbox_items')
            .set({
              completed_at: now,
              converted_task_id: task.id,
              kind: 'task',
              status: 'converted',
              updated_by: command.context.actorUserId,
            })
            .where('id', '=', id)
            .where('workspace_id', '=', command.context.workspaceId)
            .where('converted_task_id', 'is', null)
            .returningAll()
            .executeTakeFirstOrThrow()

          rowsById.set(id, convertedItem)
          conversions.push({
            inboxItem: this.mapItemRecord(convertedItem, new Set()),
            taskId: task.id,
          })
        }

        return conversions
      },
      command.context.actorUserId,
    )
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

    if (context.actorUserId && context.workspaceKind !== 'shared') {
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

    if (context.actorUserId && context.workspaceKind !== 'shared') {
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

    if (context.actorUserId && context.workspaceKind !== 'shared') {
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
    const statusTimestamps = buildStatusTimestampPatch(patch.status)
    let query = executor
      .updateTable('app.chaos_inbox_items')
      .set({
        ...statusTimestamps,
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.isFavorite !== undefined
          ? { is_favorite: patch.isFavorite }
          : {}),
        ...(patch.shoppingCategory !== undefined
          ? { shopping_category: patch.shoppingCategory }
          : {}),
        ...(patch.sphereId !== undefined ? { sphere_id: patch.sphereId } : {}),
        ...(patch.dueDate !== undefined ? { due_on: patch.dueDate } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updated_by: context.actorUserId,
      })
      .where('workspace_id', '=', context.workspaceId)
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)

    if (context.workspaceKind !== 'shared') {
      query = query.where('user_id', '=', context.actorUserId)
    }

    return query
  }

  private async softDelete(
    context: DeleteChaosInboxItemCommand['context'],
    ids: string[],
  ): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      context.auth,
      async (trx) => {
        let query = trx
          .updateTable('app.chaos_inbox_items')
          .set({
            deleted_at: deletedAt,
            updated_by: context.actorUserId,
          })
          .where('workspace_id', '=', context.workspaceId)
          .where('id', 'in', ids)
          .where('deleted_at', 'is', null)
        if (context.workspaceKind !== 'shared') {
          query = query.where('user_id', '=', context.actorUserId)
        }

        await query.execute()
      },
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
      activatedAt: serializeNullableTimestamp(row.activated_at),
      completedAt: serializeNullableTimestamp(row.completed_at),
      createdAt: serializeTimestamp(row.created_at),
      deletedAt: serializeNullableTimestamp(row.deleted_at),
      dueDate: serializeNullableDate(row.due_on),
      id: row.id,
      isFavorite: row.is_favorite,
      kind: row.kind,
      linkedTaskDeleted:
        row.converted_task_id !== null &&
        deletedTaskIds.has(row.converted_task_id),
      priority: row.priority,
      shoppingCategory: row.shopping_category,
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
  if (value === null || typeof value === 'string' || value instanceof Date) {
    return serializeDateOnly(value)
  }

  throw new TypeError(`Unexpected date value: ${typeof value}`)
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function buildStatusTimestampPatch(
  status: UpdateChaosInboxItemCommand['input']['status'],
) {
  if (status === undefined) {
    return {}
  }

  const now = new Date().toISOString()

  if (status === 'archived' || status === 'converted') {
    return {
      completed_at: now,
    }
  }

  return {
    activated_at: now,
    completed_at: null,
  }
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
