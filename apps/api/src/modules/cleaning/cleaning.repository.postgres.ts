import { generateUuidV7, getTodayDate } from '@planner/contracts'
import { type Kysely, type Selectable, sql, type Transaction } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  CleaningOperationMetadata,
  CleaningReadContext,
  CleaningWriteContext,
  CreateCleaningTaskCommand,
  CreateCleaningZoneCommand,
  DeleteCleaningTaskCommand,
  DeleteCleaningZoneCommand,
  GetCleaningTodayCommand,
  RecordCleaningTaskActionCommand,
  SeedCleaningCommand,
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
  calculateNextGeneralCleaningDueDate,
  calculateNextGeneralCleaningPostponeDate,
  createStoredCleaningTaskStateRecord,
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

interface CleaningOperationStartRow {
  inserted: boolean
  stored_operation_type: string
  stored_request_fingerprint: string
  stored_response: unknown
}

interface CleaningOperationCommand {
  context: CleaningWriteContext
  operation: CleaningOperationMetadata
}

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
    return this.withOperation(command, (trx) =>
      this.createZoneWithExecutor(trx, command),
    )
  }

  async updateZone(
    command: UpdateCleaningZoneCommand,
  ): Promise<StoredCleaningZoneRecord> {
    return this.withOperation(command, async (trx) => {
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
    })
  }

  async removeZone(command: DeleteCleaningZoneCommand): Promise<void> {
    return this.withOperation(command, async (trx) => {
      const current = await trx
        .selectFrom('app.cleaning_zones')
        .select(['id', 'version'])
        .where('id', '=', command.zoneId)
        .where('workspace_id', '=', command.context.workspaceId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst()

      if (!current) {
        throw new HttpError(
          404,
          'cleaning_zone_not_found',
          'Cleaning zone not found.',
        )
      }

      assertExpectedVersion(
        Number(current.version),
        command.expectedVersion,
        'cleaning_zone_version_conflict',
        'Cleaning zone was changed on the server.',
      )
      const childRows = await trx
        .selectFrom('app.cleaning_tasks')
        .select(['id', 'version'])
        .where('workspace_id', '=', command.context.workspaceId)
        .where('zone_id', '=', command.zoneId)
        .where('deleted_at', 'is', null)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute()

      assertExpectedZoneTaskVersions(
        childRows.map((row) => ({
          taskId: row.id,
          version: Number(row.version),
        })),
        command.expectedTaskVersions,
      )

      if (command.context.auth) {
        const result = await sql<{ deleted: boolean }>`
          select app.soft_delete_cleaning_zone(
            ${command.zoneId},
            ${command.context.workspaceId},
            ${command.context.actorUserId}
          ) as deleted
        `.execute(trx)

        if (result.rows[0]?.deleted !== true) {
          throw new HttpError(
            404,
            'cleaning_zone_not_found',
            'Cleaning zone not found.',
          )
        }

        return
      }

      const deletedAt = new Date().toISOString()
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
    })
  }

  async createTask(
    command: CreateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    return this.withOperation(command, (trx) =>
      this.createTaskWithExecutor(trx, command),
    )
  }

  async updateTask(
    command: UpdateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    return this.withOperation(command, async (trx) => {
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

      const nextScope =
        command.input.scope ??
        (typeof command.input.zoneId === 'string' ? 'zone' : current.scope)
      const nextZoneId =
        nextScope === 'general'
          ? null
          : (command.input.zoneId ?? current.zone_id)

      if (nextScope === 'zone') {
        if (!nextZoneId) {
          throw new HttpError(
            400,
            'cleaning_zone_required',
            'Cleaning zone is required for zone-scoped cleaning tasks.',
          )
        }

        await this.assertActiveZone(
          trx,
          command.context.workspaceId,
          nextZoneId,
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
          scope: nextScope,
          ...(command.input.tags !== undefined
            ? { tags: normalizeTags(command.input.tags) }
            : {}),
          ...(command.input.title !== undefined
            ? { title: command.input.title.trim() }
            : {}),
          updated_by: command.context.actorUserId,
          zone_id: nextZoneId,
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
    })
  }

  async removeTask(command: DeleteCleaningTaskCommand): Promise<void> {
    return this.withOperation(command, async (trx) => {
      const current = await trx
        .selectFrom('app.cleaning_tasks')
        .select(['id', 'version'])
        .where('id', '=', command.taskId)
        .where('workspace_id', '=', command.context.workspaceId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst()

      if (!current) {
        throw new HttpError(
          404,
          'cleaning_task_not_found',
          'Cleaning task not found.',
        )
      }

      assertExpectedVersion(
        Number(current.version),
        command.expectedVersion,
        'cleaning_task_version_conflict',
        'Cleaning task was changed on the server.',
      )

      if (command.context.auth) {
        const result = await sql<{ deleted: boolean }>`
          select app.soft_delete_cleaning_task(
            ${command.taskId},
            ${command.context.workspaceId},
            ${command.context.actorUserId}
          ) as deleted
        `.execute(trx)

        if (result.rows[0]?.deleted !== true) {
          throw new HttpError(
            404,
            'cleaning_task_not_found',
            'Cleaning task not found.',
          )
        }

        return
      }

      const deletedAt = new Date().toISOString()
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
    })
  }

  async recordTaskAction(command: RecordCleaningTaskActionCommand) {
    return this.withOperation(command, async (trx) => {
      const taskRow = await this.loadActiveTaskRowForUpdate(
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

      const zoneRow =
        taskRow.scope === 'zone' && taskRow.zone_id
          ? await this.loadActiveZoneRow(
              trx,
              command.context.workspaceId,
              taskRow.zone_id,
            )
          : null

      if (taskRow.scope === 'zone' && !zoneRow) {
        throw new HttpError(
          404,
          'cleaning_zone_not_found',
          'Cleaning zone not found.',
        )
      }

      const task = this.mapTaskRecord(taskRow)
      const zone = zoneRow ? this.mapZoneRecord(zoneRow) : null
      const currentStateRow = await this.loadStateRowForUpdate(
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
      const date =
        command.input.date ??
        getTodayDate(command.context.clientTimeZone ?? 'UTC')
      const now = command.input.occurredAt ?? new Date().toISOString()

      assertExpectedVersion(
        task.version,
        command.input.expectedTaskVersion,
        'cleaning_task_version_conflict',
        'Cleaning task was changed on the server.',
      )
      assertExpectedVersion(
        currentState.version,
        command.input.expectedStateVersion,
        'cleaning_task_state_version_conflict',
        'Cleaning task state was changed on the server.',
      )
      const existingHistoryRow = await this.loadActionHistoryRow(trx, {
        action: command.action,
        date,
        taskId: task.id,
        workspaceId: command.context.workspaceId,
      })

      if (existingHistoryRow) {
        if (
          command.input.expectedStateVersion !== undefined ||
          command.input.expectedTaskVersion !== undefined
        ) {
          throw new HttpError(
            409,
            'cleaning_task_action_conflict',
            'This cleaning action was already recorded for the selected day.',
            {
              actualVersion: currentState.version,
              expectedVersion: command.input.expectedStateVersion,
            },
          )
        }

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
              next_due_at:
                task.scope === 'general'
                  ? calculateNextGeneralCleaningDueDate(task, date)
                  : calculateNextCleaningDueDate(task, zone!, date),
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
                next_due_at:
                  task.scope === 'general'
                    ? calculateNextGeneralCleaningDueDate(task, date)
                    : calculateNextCleaningDueDate(task, zone!, date),
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
      const historyResult = await sql<CleaningTaskHistoryRow>`
        insert into app.cleaning_task_history (
          action,
          created_at,
          created_by,
          date,
          id,
          note,
          target_date,
          task_id,
          user_id,
          workspace_id,
          zone_id
        ) values (
          ${command.action},
          ${now},
          ${command.context.actorUserId},
          ${date},
          ${generateUuidV7()},
          ${command.input.note.trim()},
          ${command.action === 'postponed' ? targetDate : null},
          ${task.id},
          ${command.context.actorUserId},
          ${command.context.workspaceId},
          ${zone?.id ?? null}
        )
        on conflict (workspace_id, task_id, action, date) do nothing
        returning *
      `.execute(trx)
      const historyRow = historyResult.rows[0]
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
    })
  }

  async seed(command: SeedCleaningCommand) {
    return this.withOperation(command, async (trx) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`cleaning-seed:${command.context.workspaceId}`}, 0)
        )
      `.execute(trx)
      const existingZones = await this.loadZoneRows(
        trx,
        command.context.workspaceId,
      )
      const occupiedDayById = new Map(
        existingZones.map((zone) => [zone.day_of_week, zone.id]),
      )

      for (const entry of command.input.zones) {
        if (!entry.zone.id) {
          throw new HttpError(
            400,
            'cleaning_seed_id_required',
            'Cleaning seed zones require stable client ids.',
          )
        }

        const occupiedZoneId = occupiedDayById.get(entry.zone.dayOfWeek)

        if (occupiedZoneId && occupiedZoneId !== entry.zone.id) {
          throw new HttpError(
            409,
            'cleaning_seed_day_conflict',
            'A cleaning zone already uses one of the seed weekdays.',
          )
        }

        await this.createZoneWithExecutor(trx, {
          context: command.context,
          input: entry.zone,
        })
        occupiedDayById.set(entry.zone.dayOfWeek, entry.zone.id)

        for (const input of entry.tasks) {
          if (!input.id) {
            throw new HttpError(
              400,
              'cleaning_seed_id_required',
              'Cleaning seed tasks require stable client ids.',
            )
          }

          if (input.zoneId !== entry.zone.id) {
            throw new HttpError(
              400,
              'cleaning_seed_zone_mismatch',
              'Cleaning seed task zone does not match its parent zone.',
            )
          }

          await this.createTaskWithExecutor(trx, {
            context: command.context,
            input,
          })
        }
      }

      const [zones, tasks, states, history] = await Promise.all([
        this.loadZoneRows(trx, command.context.workspaceId),
        this.loadTaskRows(trx, command.context.workspaceId),
        this.loadStateRows(trx, command.context.workspaceId),
        this.loadHistoryRows(trx, command.context.workspaceId),
      ])

      return {
        history: sortCleaningHistory(
          history.map((row) => this.mapHistoryRecord(row)),
        ),
        states: states.map((row) => this.mapStateRecord(row)),
        tasks: sortCleaningTasks(tasks.map((row) => this.mapTaskRecord(row))),
        zones: sortCleaningZones(zones.map((row) => this.mapZoneRecord(row))),
      }
    })
  }

  private async createZoneWithExecutor(
    trx: Transaction<DatabaseSchema>,
    command: CreateCleaningZoneCommand,
  ): Promise<StoredCleaningZoneRecord> {
    const zoneId = command.input.id ?? generateUuidV7()
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
    const zone =
      inserted ??
      (await this.loadActiveZoneRow(trx, command.context.workspaceId, zoneId))

    if (!zone) {
      throwCreateIdConflict('zone')
    }

    if (!inserted) {
      assertZoneCreateMatches(this.mapZoneRecord(zone), command.input)
    }

    return this.mapZoneRecord(zone)
  }

  private async createTaskWithExecutor(
    trx: Transaction<DatabaseSchema>,
    command: CreateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    const taskId = command.input.id ?? generateUuidV7()

    if (command.input.scope === 'zone') {
      if (!command.input.zoneId) {
        throw new HttpError(
          400,
          'cleaning_zone_required',
          'Cleaning zone is required for zone-scoped cleaning tasks.',
        )
      }

      await this.assertActiveZone(
        trx,
        command.context.workspaceId,
        command.input.zoneId,
      )
    }

    const sortOrder =
      command.input.sortOrder ??
      (await this.loadNextTaskSortOrder(
        trx,
        command.context.workspaceId,
        command.input.scope,
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
        scope: command.input.scope,
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
    const task =
      inserted ??
      (await this.loadActiveTaskRow(trx, command.context.workspaceId, taskId))

    if (!task) {
      throwCreateIdConflict('task')
    }

    if (!inserted) {
      assertTaskCreateMatches(this.mapTaskRecord(task), command.input)
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
  }

  private withOperation<T>(
    command: Pick<CreateCleaningZoneCommand, 'context' | 'operation'>,
    action: (trx: Transaction<DatabaseSchema>) => Promise<T>,
  ): Promise<T> {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        if (!command.operation) {
          return action(trx)
        }

        const operationCommand: CleaningOperationCommand = {
          context: command.context,
          operation: command.operation,
        }
        const operation = await this.beginOperation(trx, operationCommand)

        if (!operation.inserted) {
          if (
            operation.stored_operation_type !== command.operation.type ||
            operation.stored_request_fingerprint !==
              command.operation.fingerprint
          ) {
            throw new HttpError(
              409,
              'cleaning_operation_conflict',
              'The cleaning operation id was already used for another command.',
            )
          }

          return operation.stored_response as T
        }

        const response = await action(trx)
        const completed = await this.completeOperation(
          trx,
          operationCommand,
          response,
        )

        if (!completed) {
          throw new Error('Failed to persist cleaning operation receipt.')
        }

        return response
      },
      command.context.actorUserId,
    )
  }

  private async beginOperation(
    trx: Transaction<DatabaseSchema>,
    command: CleaningOperationCommand,
  ): Promise<CleaningOperationStartRow> {
    const operation = command.operation

    if (command.context.auth) {
      const result = await sql<CleaningOperationStartRow>`
        select *
        from app.begin_cleaning_operation(
          ${command.context.workspaceId},
          ${command.context.actorUserId},
          ${operation.id},
          ${operation.type},
          ${operation.fingerprint}
        )
      `.execute(trx)
      const row = result.rows[0]

      if (!row) {
        throw new Error('Failed to begin cleaning operation.')
      }

      return row
    }

    const inserted = await sql<{ operation_id: string }>`
      insert into app.cleaning_operations (
        workspace_id,
        actor_user_id,
        operation_id,
        operation_type,
        request_fingerprint
      ) values (
        ${command.context.workspaceId},
        ${command.context.actorUserId},
        ${operation.id},
        ${operation.type},
        ${operation.fingerprint}
      )
      on conflict (workspace_id, actor_user_id, operation_id) do nothing
      returning operation_id
    `.execute(trx)

    if (inserted.rows[0]) {
      return {
        inserted: true,
        stored_operation_type: operation.type,
        stored_request_fingerprint: operation.fingerprint,
        stored_response: null,
      }
    }

    const existing = await sql<CleaningOperationStartRow>`
      select
        false as inserted,
        operation_type as stored_operation_type,
        request_fingerprint as stored_request_fingerprint,
        response as stored_response
      from app.cleaning_operations
      where workspace_id = ${command.context.workspaceId}
        and actor_user_id = ${command.context.actorUserId}
        and operation_id = ${operation.id}
    `.execute(trx)
    const row = existing.rows[0]

    if (!row) {
      throw new Error('Failed to load cleaning operation receipt.')
    }

    return row
  }

  private async completeOperation<T>(
    trx: Transaction<DatabaseSchema>,
    command: CleaningOperationCommand,
    response: T,
  ): Promise<boolean> {
    const operation = command.operation
    const serializedResponse = JSON.stringify(response ?? null)

    if (command.context.auth) {
      const result = await sql<{ completed: boolean }>`
        select app.complete_cleaning_operation(
          ${command.context.workspaceId},
          ${command.context.actorUserId},
          ${operation.id},
          ${operation.type},
          ${operation.fingerprint},
          ${serializedResponse}::jsonb
        ) as completed
      `.execute(trx)

      return result.rows[0]?.completed === true
    }

    const result = await sql<{ operation_id: string }>`
      update app.cleaning_operations
      set response = ${serializedResponse}::jsonb,
          completed_at = now()
      where workspace_id = ${command.context.workspaceId}
        and actor_user_id = ${command.context.actorUserId}
        and operation_id = ${operation.id}
        and operation_type = ${operation.type}
        and request_fingerprint = ${operation.fingerprint}
        and response is null
      returning operation_id
    `.execute(trx)

    return Boolean(result.rows[0])
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
      .where('date', '=', input.date)
      .where('action', '=', input.action)
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

  private loadActiveTaskRowForUpdate(
    executor: Transaction<DatabaseSchema>,
    workspaceId: string,
    taskId: string,
  ): Promise<CleaningTaskRow | undefined> {
    return executor
      .selectFrom('app.cleaning_tasks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', taskId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst()
  }

  private loadStateRowForUpdate(
    executor: Transaction<DatabaseSchema>,
    workspaceId: string,
    taskId: string,
  ): Promise<CleaningTaskStateRow | undefined> {
    return executor
      .selectFrom('app.cleaning_task_states')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('task_id', '=', taskId)
      .forUpdate()
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
    scope: StoredCleaningTaskRecord['scope'],
    zoneId: string | null,
  ): Promise<number> {
    let query = executor
      .selectFrom('app.cleaning_tasks')
      .select(sql<number>`coalesce(max(sort_order), -1)`.as('max_sort_order'))
      .where('workspace_id', '=', workspaceId)
      .where('scope', '=', scope)
      .where('deleted_at', 'is', null)

    query =
      scope === 'general'
        ? query.where('zone_id', 'is', null)
        : query.where('zone_id', '=', zoneId)

    const row = await query.executeTakeFirst()

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
      scope: row.scope,
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
  zone: StoredCleaningZoneRecord | null,
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

  if (task.scope === 'general') {
    return calculateNextGeneralCleaningPostponeDate(date)
  }

  if (!zone) {
    throw new HttpError(
      404,
      'cleaning_zone_not_found',
      'Cleaning zone not found.',
    )
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

function assertExpectedVersion(
  actualVersion: number,
  expectedVersion: number | undefined,
  code: string,
  message: string,
): void {
  if (expectedVersion !== undefined && actualVersion !== expectedVersion) {
    throw new HttpError(409, code, message, {
      actualVersion,
      expectedVersion,
    })
  }
}

function throwCreateIdConflict(entity: 'task' | 'zone'): never {
  throw new HttpError(
    409,
    `cleaning_${entity}_create_conflict`,
    `A different cleaning ${entity} already uses this id.`,
  )
}

function assertExpectedZoneTaskVersions(
  actualTaskVersions: Array<{ taskId: string; version: number }>,
  expectedTaskVersions: Array<{ taskId: string; version: number }> | undefined,
): void {
  if (expectedTaskVersions === undefined) {
    return
  }

  const actual = [...actualTaskVersions].sort((left, right) =>
    left.taskId.localeCompare(right.taskId),
  )
  const expected = [...expectedTaskVersions].sort((left, right) =>
    left.taskId.localeCompare(right.taskId),
  )

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new HttpError(
      409,
      'cleaning_zone_children_conflict',
      'Cleaning tasks in this zone were changed on the server.',
      { actualTaskVersions: actual, expectedTaskVersions: expected },
    )
  }
}

function assertZoneCreateMatches(
  existing: StoredCleaningZoneRecord,
  input: CreateCleaningZoneCommand['input'],
): void {
  const matches =
    existing.dayOfWeek === input.dayOfWeek &&
    existing.description === input.description.trim() &&
    existing.isActive === input.isActive &&
    (input.sortOrder === undefined || existing.sortOrder === input.sortOrder) &&
    existing.title === input.title.trim()

  if (!matches) {
    throw new HttpError(
      409,
      'cleaning_zone_create_conflict',
      'A different cleaning zone already uses this id.',
      { actualVersion: existing.version },
    )
  }
}

function assertTaskCreateMatches(
  existing: StoredCleaningTaskRecord,
  input: CreateCleaningTaskCommand['input'],
): void {
  const matches =
    existing.assignee === input.assignee &&
    existing.customIntervalDays ===
      (input.frequencyType === 'custom'
        ? (input.customIntervalDays ?? input.frequencyInterval)
        : null) &&
    existing.depth === input.depth &&
    existing.description === input.description.trim() &&
    existing.energy === input.energy &&
    existing.estimatedMinutes === input.estimatedMinutes &&
    existing.frequencyInterval === input.frequencyInterval &&
    existing.frequencyType === input.frequencyType &&
    existing.impactScore === input.impactScore &&
    existing.isActive === input.isActive &&
    existing.isSeasonal === input.isSeasonal &&
    existing.priority === input.priority &&
    JSON.stringify(existing.seasonMonths) ===
      JSON.stringify(normalizeSeasonMonths(input.seasonMonths)) &&
    (input.sortOrder === undefined || existing.sortOrder === input.sortOrder) &&
    existing.scope === input.scope &&
    JSON.stringify(existing.tags) ===
      JSON.stringify(normalizeTags(input.tags)) &&
    existing.title === input.title.trim() &&
    existing.zoneId === input.zoneId

  if (!matches) {
    throw new HttpError(
      409,
      'cleaning_task_create_conflict',
      'A different cleaning task already uses this id.',
      { actualVersion: existing.version },
    )
  }
}
