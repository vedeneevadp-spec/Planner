import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  CleaningReadContext,
  CreateCleaningTaskCommand,
  CreateCleaningZoneCommand,
  DeleteCleaningTaskCommand,
  DeleteCleaningZoneCommand,
  GetCleaningTodayCommand,
  RecordCleaningTaskActionCommand,
  StoredCleaningTaskHistoryItemRecord,
  StoredCleaningTaskRecord,
  StoredCleaningTaskStateRecord,
  StoredCleaningZoneRecord,
  UpdateCleaningTaskCommand,
  UpdateCleaningZoneCommand,
} from './cleaning.model.js'
import type { CleaningRepository } from './cleaning.repository.js'
import {
  buildCleaningTodayResponse,
  calculateNextCleaningDueDate,
  calculateNextCleaningZoneCycleDate,
  createStoredCleaningTaskStateRecord,
  getDateKey,
  normalizeSeasonMonths,
  normalizeTags,
  serializeDate,
  serializeNullableDate,
  serializeNullableTimestamp,
  serializeTimestamp,
  sortCleaningHistory,
  sortCleaningTasks,
  sortCleaningZones,
} from './cleaning.shared.js'

type CleaningZoneRow = Selectable<DatabaseSchema['app.cleaning_zones']>
type CleaningTaskRow = Selectable<DatabaseSchema['app.cleaning_tasks']>
type CleaningTaskStateRow = Selectable<
  DatabaseSchema['app.cleaning_task_states']
>
type CleaningTaskHistoryRow = Selectable<
  DatabaseSchema['app.cleaning_task_history']
>

export class PostgresCleaningRepository implements CleaningRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listByWorkspace(context: CleaningReadContext) {
    const [zoneRows, taskRows, stateRows, historyRows] = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const zones = await this.loadZoneRows(executor, context.workspaceId)
        const tasks = await this.loadTaskRows(executor, context.workspaceId)
        const states = await this.loadStateRows(executor, context.workspaceId)
        const history = await this.loadHistoryRows(
          executor,
          context.workspaceId,
        )

        return [zones, tasks, states, history] as const
      },
      context.actorUserId,
    )

    return {
      history: sortCleaningHistory(
        historyRows.map((row) => this.mapHistoryRecord(row)),
      ),
      states: stateRows.map((row) => this.mapStateRecord(row)),
      tasks: sortCleaningTasks(taskRows.map((row) => this.mapTaskRecord(row))),
      zones: sortCleaningZones(zoneRows.map((row) => this.mapZoneRecord(row))),
    }
  }

  async getToday(command: GetCleaningTodayCommand) {
    const list = await this.listByWorkspace(command.context)

    return buildCleaningTodayResponse({
      date: command.date,
      history: list.history,
      states: list.states,
      tasks: list.tasks,
      zones: list.zones,
    })
  }

  async createZone(
    command: CreateCleaningZoneCommand,
  ): Promise<StoredCleaningZoneRecord> {
    const zoneId = command.input.id ?? generateUuidV7()

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const sortOrder =
          command.input.sortOrder ??
          (await this.loadNextZoneSortOrder(trx, command.context.workspaceId))
        const inserted = await trx
          .insertInto('app.cleaning_zones')
          .values({
            created_by: command.context.actorUserId,
            day_of_week: command.input.dayOfWeek,
            deleted_at: null,
            description: command.input.description.trim(),
            id: zoneId,
            is_active: command.input.isActive,
            sort_order: sortOrder,
            title: command.input.title.trim(),
            updated_by: command.context.actorUserId,
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .returningAll()
          .executeTakeFirst()
        const zone = inserted
          ? inserted
          : await this.loadActiveZoneRow(
              trx,
              command.context.workspaceId,
              zoneId,
            )

        if (!zone) {
          throw new Error('Failed to create cleaning zone.')
        }

        return this.mapZoneRecord(zone)
      },
      command.context.actorUserId,
    )
  }

  async updateZone(
    command: UpdateCleaningZoneCommand,
  ): Promise<StoredCleaningZoneRecord> {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.cleaning_zones')
          .set({
            ...(command.input.dayOfWeek !== undefined
              ? { day_of_week: command.input.dayOfWeek }
              : {}),
            ...(command.input.description !== undefined
              ? { description: command.input.description.trim() }
              : {}),
            ...(command.input.isActive !== undefined
              ? { is_active: command.input.isActive }
              : {}),
            ...(command.input.sortOrder !== undefined
              ? { sort_order: command.input.sortOrder }
              : {}),
            ...(command.input.title !== undefined
              ? { title: command.input.title.trim() }
              : {}),
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.zoneId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)

        if (command.input.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            command.input.expectedVersion,
          )
        }

        const updated = await updateQuery.returningAll().executeTakeFirst()

        if (!updated) {
          return this.throwZoneUpdateError(
            trx,
            command.context.workspaceId,
            command.zoneId,
            command.input.expectedVersion,
          )
        }

        return this.mapZoneRecord(updated)
      },
      command.context.actorUserId,
    )
  }

  async removeZone(command: DeleteCleaningZoneCommand): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const deletedZone = await trx
          .updateTable('app.cleaning_zones')
          .set({
            deleted_at: deletedAt,
            is_active: false,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.zoneId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .returning(['id'])
          .executeTakeFirst()

        if (!deletedZone) {
          throw new HttpError(
            404,
            'cleaning_zone_not_found',
            'Cleaning zone not found.',
          )
        }

        await trx
          .updateTable('app.cleaning_tasks')
          .set({
            deleted_at: deletedAt,
            is_active: false,
            updated_by: command.context.actorUserId,
          })
          .where('workspace_id', '=', command.context.workspaceId)
          .where('zone_id', '=', command.zoneId)
          .where('deleted_at', 'is', null)
          .execute()
      },
      command.context.actorUserId,
    )
  }

  async createTask(
    command: CreateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    const taskId = command.input.id ?? generateUuidV7()

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        await this.assertActiveZone(
          trx,
          command.context.workspaceId,
          command.input.zoneId,
        )

        const sortOrder =
          command.input.sortOrder ??
          (await this.loadNextTaskSortOrder(
            trx,
            command.context.workspaceId,
            command.input.zoneId,
          ))
        const inserted = await trx
          .insertInto('app.cleaning_tasks')
          .values({
            assignee: command.input.assignee,
            created_by: command.context.actorUserId,
            custom_interval_days:
              command.input.frequencyType === 'custom'
                ? (command.input.customIntervalDays ??
                  command.input.frequencyInterval)
                : null,
            deleted_at: null,
            depth: command.input.depth,
            description: command.input.description.trim(),
            energy: command.input.energy,
            estimated_minutes: command.input.estimatedMinutes,
            frequency_interval: command.input.frequencyInterval,
            frequency_type: command.input.frequencyType,
            id: taskId,
            impact_score: command.input.impactScore,
            is_active: command.input.isActive,
            is_seasonal: command.input.isSeasonal,
            priority: command.input.priority,
            season_months: normalizeSeasonMonths(command.input.seasonMonths),
            sort_order: sortOrder,
            tags: normalizeTags(command.input.tags),
            title: command.input.title.trim(),
            updated_by: command.context.actorUserId,
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
            zone_id: command.input.zoneId,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .returningAll()
          .executeTakeFirst()
        const task = inserted
          ? inserted
          : await this.loadActiveTaskRow(
              trx,
              command.context.workspaceId,
              taskId,
            )

        if (!task) {
          throw new Error('Failed to create cleaning task.')
        }

        await trx
          .insertInto('app.cleaning_task_states')
          .values({
            created_by: command.context.actorUserId,
            last_completed_at: null,
            last_postponed_at: null,
            last_skipped_at: null,
            next_due_at: null,
            postpone_count: 0,
            task_id: task.id,
            updated_by: command.context.actorUserId,
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) => conflict.column('task_id').doNothing())
          .execute()

        return this.mapTaskRecord(task)
      },
      command.context.actorUserId,
    )
  }

  async updateTask(
    command: UpdateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        if (command.input.zoneId !== undefined) {
          await this.assertActiveZone(
            trx,
            command.context.workspaceId,
            command.input.zoneId,
          )
        }

        const current = await this.loadActiveTaskRow(
          trx,
          command.context.workspaceId,
          command.taskId,
        )

        if (!current) {
          throw new HttpError(
            404,
            'cleaning_task_not_found',
            'Cleaning task not found.',
          )
        }

        const nextFrequencyType =
          command.input.frequencyType ?? current.frequency_type
        const nextFrequencyInterval =
          command.input.frequencyInterval ?? current.frequency_interval
        const nextCustomIntervalDays =
          nextFrequencyType === 'custom'
            ? (command.input.customIntervalDays ??
              current.custom_interval_days ??
              nextFrequencyInterval)
            : null
        let updateQuery = trx
          .updateTable('app.cleaning_tasks')
          .set({
            ...(command.input.assignee !== undefined
              ? { assignee: command.input.assignee }
              : {}),
            custom_interval_days: nextCustomIntervalDays,
            ...(command.input.depth !== undefined
              ? { depth: command.input.depth }
              : {}),
            ...(command.input.description !== undefined
              ? { description: command.input.description.trim() }
              : {}),
            ...(command.input.energy !== undefined
              ? { energy: command.input.energy }
              : {}),
            ...(command.input.estimatedMinutes !== undefined
              ? { estimated_minutes: command.input.estimatedMinutes }
              : {}),
            frequency_interval: nextFrequencyInterval,
            frequency_type: nextFrequencyType,
            ...(command.input.impactScore !== undefined
              ? { impact_score: command.input.impactScore }
              : {}),
            ...(command.input.isActive !== undefined
              ? { is_active: command.input.isActive }
              : {}),
            ...(command.input.isSeasonal !== undefined
              ? { is_seasonal: command.input.isSeasonal }
              : {}),
            ...(command.input.priority !== undefined
              ? { priority: command.input.priority }
              : {}),
            ...(command.input.seasonMonths !== undefined
              ? {
                  season_months: normalizeSeasonMonths(
                    command.input.seasonMonths,
                  ),
                }
              : {}),
            ...(command.input.sortOrder !== undefined
              ? { sort_order: command.input.sortOrder }
              : {}),
            ...(command.input.tags !== undefined
              ? { tags: normalizeTags(command.input.tags) }
              : {}),
            ...(command.input.title !== undefined
              ? { title: command.input.title.trim() }
              : {}),
            updated_by: command.context.actorUserId,
            ...(command.input.zoneId !== undefined
              ? { zone_id: command.input.zoneId }
              : {}),
          })
          .where('id', '=', command.taskId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)

        if (command.input.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            command.input.expectedVersion,
          )
        }

        const updated = await updateQuery.returningAll().executeTakeFirst()

        if (!updated) {
          return this.throwTaskUpdateError(
            trx,
            command.context.workspaceId,
            command.taskId,
            command.input.expectedVersion,
          )
        }

        return this.mapTaskRecord(updated)
      },
      command.context.actorUserId,
    )
  }

  async removeTask(command: DeleteCleaningTaskCommand): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const deleted = await trx
          .updateTable('app.cleaning_tasks')
          .set({
            deleted_at: deletedAt,
            is_active: false,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.taskId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .returning(['id'])
          .executeTakeFirst()

        if (!deleted) {
          throw new HttpError(
            404,
            'cleaning_task_not_found',
            'Cleaning task not found.',
          )
        }
      },
      command.context.actorUserId,
    )
  }

  async recordTaskAction(command: RecordCleaningTaskActionCommand) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const taskRow = await this.loadActiveTaskRow(
          trx,
          command.context.workspaceId,
          command.taskId,
        )

        if (!taskRow) {
          throw new HttpError(
            404,
            'cleaning_task_not_found',
            'Cleaning task not found.',
          )
        }

        const zoneRow = await this.loadActiveZoneRow(
          trx,
          command.context.workspaceId,
          taskRow.zone_id,
        )

        if (!zoneRow) {
          throw new HttpError(
            404,
            'cleaning_zone_not_found',
            'Cleaning zone not found.',
          )
        }

        const task = this.mapTaskRecord(taskRow)
        const zone = this.mapZoneRecord(zoneRow)
        const currentStateRow = await this.loadStateRow(
          trx,
          command.context.workspaceId,
          command.taskId,
        )
        const currentState = currentStateRow
          ? this.mapStateRecord(currentStateRow)
          : createStoredCleaningTaskStateRecord(
              { taskId: task.id },
              { workspaceId: command.context.workspaceId },
            )
        const date = command.input.date ?? getDateKey(new Date())
        const now = new Date().toISOString()
        const existingHistoryRow = await this.loadActionHistoryRow(trx, {
          action: command.action,
          date,
          taskId: task.id,
          workspaceId: command.context.workspaceId,
        })

        if (existingHistoryRow) {
          return {
            historyItem: this.mapHistoryRecord(existingHistoryRow),
            state: currentState,
          }
        }

        const targetDate = getActionTargetDate(command, task, zone, date)
        const nextState =
          command.action === 'completed'
            ? {
                last_completed_at: now,
                last_postponed_at: currentState.lastPostponedAt,
                last_skipped_at: currentState.lastSkippedAt,
                next_due_at: calculateNextCleaningDueDate(task, zone, date),
                postpone_count: 0,
              }
            : command.action === 'postponed'
              ? {
                  last_completed_at: currentState.lastCompletedAt,
                  last_postponed_at: now,
                  last_skipped_at: currentState.lastSkippedAt,
                  next_due_at: targetDate,
                  postpone_count: currentState.postponeCount + 1,
                }
              : {
                  last_completed_at: currentState.lastCompletedAt,
                  last_postponed_at: currentState.lastPostponedAt,
                  last_skipped_at: now,
                  next_due_at: calculateNextCleaningDueDate(task, zone, date),
                  postpone_count: currentState.postponeCount,
                }
        const stateRow = await trx
          .insertInto('app.cleaning_task_states')
          .values({
            created_by: command.context.actorUserId,
            last_completed_at: nextState.last_completed_at,
            last_postponed_at: nextState.last_postponed_at,
            last_skipped_at: nextState.last_skipped_at,
            next_due_at: nextState.next_due_at,
            postpone_count: nextState.postpone_count,
            task_id: task.id,
            updated_by: command.context.actorUserId,
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) =>
            conflict.column('task_id').doUpdateSet({
              last_completed_at: nextState.last_completed_at,
              last_postponed_at: nextState.last_postponed_at,
              last_skipped_at: nextState.last_skipped_at,
              next_due_at: nextState.next_due_at,
              postpone_count: nextState.postpone_count,
              updated_by: command.context.actorUserId,
            }),
          )
          .returningAll()
          .executeTakeFirstOrThrow()
        const historyRow = await trx
          .insertInto('app.cleaning_task_history')
          .values({
            action: command.action,
            created_by: command.context.actorUserId,
            date,
            id: generateUuidV7(),
            note: command.input.note.trim(),
            target_date: command.action === 'postponed' ? targetDate : null,
            task_id: task.id,
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
            zone_id: zone.id,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['workspace_id', 'task_id', 'action', 'date'])
              .doNothing(),
          )
          .returningAll()
          .executeTakeFirst()
        const persistedHistoryRow =
          historyRow ??
          (await this.loadActionHistoryRow(trx, {
            action: command.action,
            date,
            taskId: task.id,
            workspaceId: command.context.workspaceId,
          }))

        if (!persistedHistoryRow) {
          throw new Error('Failed to record cleaning task history.')
        }

        return {
          historyItem: this.mapHistoryRecord(persistedHistoryRow),
          state: this.mapStateRecord(stateRow),
        }
      },
      command.context.actorUserId,
    )
  }

  private loadZoneRows(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<CleaningZoneRow[]> {
    return executor
      .selectFrom('app.cleaning_zones')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .orderBy('day_of_week', 'asc')
      .orderBy('sort_order', 'asc')
      .orderBy('title', 'asc')
      .execute()
  }

  private loadTaskRows(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<CleaningTaskRow[]> {
    return executor
      .selectFrom('app.cleaning_tasks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .orderBy('sort_order', 'asc')
      .orderBy('title', 'asc')
      .execute()
  }

  private loadStateRows(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<CleaningTaskStateRow[]> {
    return executor
      .selectFrom('app.cleaning_task_states')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute()
  }

  private loadHistoryRows(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<CleaningTaskHistoryRow[]> {
    return executor
      .selectFrom('app.cleaning_task_history')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .orderBy('date', 'desc')
      .orderBy('created_at', 'desc')
      .limit(240)
      .execute()
  }

  private loadActionHistoryRow(
    executor: DatabaseExecutor,
    input: {
      action: StoredCleaningTaskHistoryItemRecord['action']
      date: string
      taskId: string
      workspaceId: string
    },
  ): Promise<CleaningTaskHistoryRow | undefined> {
    return executor
      .selectFrom('app.cleaning_task_history')
      .selectAll()
      .where('workspace_id', '=', input.workspaceId)
      .where('task_id', '=', input.taskId)
      .where('action', '=', input.action)
      .where('date', '=', input.date)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst()
  }

  private loadActiveZoneRow(
    executor: DatabaseExecutor,
    workspaceId: string,
    zoneId: string,
  ): Promise<CleaningZoneRow | undefined> {
    return executor
      .selectFrom('app.cleaning_zones')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', zoneId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }

  private loadActiveTaskRow(
    executor: DatabaseExecutor,
    workspaceId: string,
    taskId: string,
  ): Promise<CleaningTaskRow | undefined> {
    return executor
      .selectFrom('app.cleaning_tasks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', taskId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }

  private loadStateRow(
    executor: DatabaseExecutor,
    workspaceId: string,
    taskId: string,
  ): Promise<CleaningTaskStateRow | undefined> {
    return executor
      .selectFrom('app.cleaning_task_states')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('task_id', '=', taskId)
      .executeTakeFirst()
  }

  private async loadNextZoneSortOrder(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<number> {
    const row = await executor
      .selectFrom('app.cleaning_zones')
      .select(sql<number>`coalesce(max(sort_order), -1)`.as('max_sort_order'))
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    return Number(row?.max_sort_order ?? -1) + 1
  }

  private async loadNextTaskSortOrder(
    executor: DatabaseExecutor,
    workspaceId: string,
    zoneId: string,
  ): Promise<number> {
    const row = await executor
      .selectFrom('app.cleaning_tasks')
      .select(sql<number>`coalesce(max(sort_order), -1)`.as('max_sort_order'))
      .where('workspace_id', '=', workspaceId)
      .where('zone_id', '=', zoneId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    return Number(row?.max_sort_order ?? -1) + 1
  }

  private async assertActiveZone(
    executor: DatabaseExecutor,
    workspaceId: string,
    zoneId: string,
  ): Promise<void> {
    const zone = await this.loadActiveZoneRow(executor, workspaceId, zoneId)

    if (!zone) {
      throw new HttpError(
        404,
        'cleaning_zone_not_found',
        'Cleaning zone not found.',
      )
    }
  }

  private async throwZoneUpdateError(
    executor: DatabaseExecutor,
    workspaceId: string,
    zoneId: string,
    expectedVersion: number | undefined,
  ): Promise<never> {
    const current = await executor
      .selectFrom('app.cleaning_zones')
      .select(['id', 'version'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', zoneId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    if (!current) {
      throw new HttpError(
        404,
        'cleaning_zone_not_found',
        'Cleaning zone not found.',
      )
    }

    if (
      expectedVersion !== undefined &&
      Number(current.version) !== expectedVersion
    ) {
      throw new HttpError(
        409,
        'cleaning_zone_version_conflict',
        'Cleaning zone was changed on the server.',
        {
          actualVersion: Number(current.version),
          expectedVersion,
        },
      )
    }

    throw new Error(`Cleaning zone "${zoneId}" was not updated.`)
  }

  private async throwTaskUpdateError(
    executor: DatabaseExecutor,
    workspaceId: string,
    taskId: string,
    expectedVersion: number | undefined,
  ): Promise<never> {
    const current = await executor
      .selectFrom('app.cleaning_tasks')
      .select(['id', 'version'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', taskId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    if (!current) {
      throw new HttpError(
        404,
        'cleaning_task_not_found',
        'Cleaning task not found.',
      )
    }

    if (
      expectedVersion !== undefined &&
      Number(current.version) !== expectedVersion
    ) {
      throw new HttpError(
        409,
        'cleaning_task_version_conflict',
        'Cleaning task was changed on the server.',
        {
          actualVersion: Number(current.version),
          expectedVersion,
        },
      )
    }

    throw new Error(`Cleaning task "${taskId}" was not updated.`)
  }

  private mapZoneRecord(row: CleaningZoneRow): StoredCleaningZoneRecord {
    return {
      createdAt: serializeTimestamp(row.created_at),
      dayOfWeek: row.day_of_week,
      deletedAt: serializeNullableTimestamp(row.deleted_at),
      description: row.description,
      id: row.id,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      title: row.title,
      updatedAt: serializeTimestamp(row.updated_at),
      userId: row.user_id,
      version: Number(row.version),
      workspaceId: row.workspace_id,
    }
  }

  private mapTaskRecord(row: CleaningTaskRow): StoredCleaningTaskRecord {
    return {
      assignee: row.assignee,
      createdAt: serializeTimestamp(row.created_at),
      customIntervalDays: row.custom_interval_days,
      deletedAt: serializeNullableTimestamp(row.deleted_at),
      depth: row.depth,
      description: row.description,
      energy: row.energy,
      estimatedMinutes: row.estimated_minutes,
      frequencyInterval: row.frequency_interval,
      frequencyType: row.frequency_type,
      id: row.id,
      impactScore: row.impact_score,
      isActive: row.is_active,
      isSeasonal: row.is_seasonal,
      priority: row.priority,
      seasonMonths: normalizeSeasonMonths(
        normalizeNumberArray(row.season_months),
      ),
      sortOrder: row.sort_order,
      tags: normalizeTags(normalizeStringArray(row.tags)),
      title: row.title,
      updatedAt: serializeTimestamp(row.updated_at),
      userId: row.user_id,
      version: Number(row.version),
      workspaceId: row.workspace_id,
      zoneId: row.zone_id,
    }
  }

  private mapStateRecord(
    row: CleaningTaskStateRow,
  ): StoredCleaningTaskStateRecord {
    return {
      lastCompletedAt: serializeNullableTimestamp(row.last_completed_at),
      lastPostponedAt: serializeNullableTimestamp(row.last_postponed_at),
      lastSkippedAt: serializeNullableTimestamp(row.last_skipped_at),
      nextDueAt: serializeNullableDate(row.next_due_at),
      postponeCount: row.postpone_count,
      taskId: row.task_id,
      updatedAt: serializeTimestamp(row.updated_at),
      version: Number(row.version),
      workspaceId: row.workspace_id,
    }
  }

  private mapHistoryRecord(
    row: CleaningTaskHistoryRow,
  ): StoredCleaningTaskHistoryItemRecord {
    return {
      action: row.action,
      createdAt: serializeTimestamp(row.created_at),
      date: serializeDate(row.date),
      id: row.id,
      note: row.note,
      targetDate: serializeNullableDate(row.target_date),
      taskId: row.task_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      zoneId: row.zone_id,
    }
  }
}

function getActionTargetDate(
  command: RecordCleaningTaskActionCommand,
  task: StoredCleaningTaskRecord,
  zone: StoredCleaningZoneRecord,
  date: string,
): string {
  if (
    (command.input.mode === 'specific_date' ||
      command.input.mode === 'another_day') &&
    command.input.targetDate
  ) {
    return command.input.targetDate
  }

  if (command.input.targetDate) {
    return command.input.targetDate
  }

  return command.input.mode === 'next_cycle'
    ? calculateNextCleaningZoneCycleDate(zone, date)
    : calculateNextCleaningDueDate(task, zone, date)
}

function normalizeNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item))
  }

  if (typeof value === 'string') {
    return value
      .replaceAll(/[{}]/g, '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item))
  }

  return []
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item))
  }

  if (typeof value === 'string') {
    return value
      .replaceAll(/[{}"]/g, '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}
