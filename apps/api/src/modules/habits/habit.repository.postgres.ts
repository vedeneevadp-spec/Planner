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
  CreateHabitCommand,
  DeleteHabitCommand,
  DeleteHabitEntryCommand,
  GetHabitStatsCommand,
  GetHabitTodayCommand,
  HabitReadContext,
  HabitStatsResult,
  HabitTodayResult,
  StoredHabitEntryRecord,
  StoredHabitRecord,
  UpdateHabitCommand,
  UpsertHabitEntryCommand,
} from './habit.model.js'
import type { HabitRepository } from './habit.repository.js'
import {
  buildHabitStats,
  getDateKey,
  getDefaultEntryValue,
  getEntryProgressPercent,
  isHabitScheduledOnDate,
  normalizeDaysOfWeek,
  serializeDate,
  serializeNullableDate,
  serializeNullableTime,
  serializeNullableTimestamp,
  serializeTimestamp,
  sortStoredHabits,
} from './habit.shared.js'

type HabitRow = Selectable<DatabaseSchema['app.habits']>
type HabitEntryRow = Selectable<DatabaseSchema['app.habit_entries']>

export class PostgresHabitRepository implements HabitRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listByWorkspace(
    context: HabitReadContext,
  ): Promise<StoredHabitRecord[]> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) => this.loadHabitRows(executor, context.workspaceId),
      context.actorUserId,
    )

    return sortStoredHabits(rows.map((row) => this.mapHabitRecord(row)))
  }

  async create(command: CreateHabitCommand): Promise<StoredHabitRecord> {
    const habitId = command.input.id ?? generateUuidV7()
    const startDate = command.input.startDate ?? getDateKey(new Date())
    const sphereId = await this.resolveSphereId(
      command.context,
      command.input.sphereId,
    )

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const sortOrder =
          command.input.sortOrder ??
          (await this.loadNextSortOrder(trx, command.context.workspaceId))
        const inserted = await trx
          .insertInto('app.habits')
          .values({
            color: command.input.color.trim(),
            created_by: command.context.actorUserId,
            days_of_week: normalizeDaysOfWeek(command.input.daysOfWeek),
            deleted_at: null,
            description: command.input.description.trim(),
            end_date: command.input.endDate,
            frequency: command.input.frequency,
            icon: command.input.icon.trim(),
            id: habitId,
            is_active: true,
            reminder_time: command.input.reminderTime,
            sort_order: sortOrder,
            sphere_id: sphereId,
            start_date: startDate,
            target_type: command.input.targetType,
            target_value: command.input.targetValue,
            title: command.input.title.trim(),
            unit: command.input.unit.trim(),
            updated_by: command.context.actorUserId,
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .returningAll()
          .executeTakeFirst()

        const habit = inserted
          ? inserted
          : await this.loadActiveHabitRow(
              trx,
              command.context.workspaceId,
              habitId,
            )

        if (!habit) {
          throw new Error('Failed to create habit record.')
        }

        return this.mapHabitRecord(habit)
      },
      command.context.actorUserId,
    )
  }

  async update(command: UpdateHabitCommand): Promise<StoredHabitRecord> {
    const sphereId =
      command.input.sphereId === undefined
        ? undefined
        : await this.resolveSphereId(command.context, command.input.sphereId)

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.habits')
          .set({
            ...(command.input.color !== undefined
              ? { color: command.input.color.trim() }
              : {}),
            ...(command.input.daysOfWeek !== undefined
              ? { days_of_week: normalizeDaysOfWeek(command.input.daysOfWeek) }
              : {}),
            ...(command.input.description !== undefined
              ? { description: command.input.description.trim() }
              : {}),
            ...(command.input.endDate !== undefined
              ? { end_date: command.input.endDate }
              : {}),
            ...(command.input.frequency !== undefined
              ? { frequency: command.input.frequency }
              : {}),
            ...(command.input.icon !== undefined
              ? { icon: command.input.icon.trim() }
              : {}),
            ...(command.input.isActive !== undefined
              ? { is_active: command.input.isActive }
              : {}),
            ...(command.input.reminderTime !== undefined
              ? { reminder_time: command.input.reminderTime }
              : {}),
            ...(command.input.sortOrder !== undefined
              ? { sort_order: command.input.sortOrder }
              : {}),
            ...(sphereId !== undefined ? { sphere_id: sphereId } : {}),
            ...(command.input.startDate !== undefined
              ? { start_date: command.input.startDate }
              : {}),
            ...(command.input.targetType !== undefined
              ? { target_type: command.input.targetType }
              : {}),
            ...(command.input.targetValue !== undefined
              ? { target_value: command.input.targetValue }
              : {}),
            ...(command.input.title !== undefined
              ? { title: command.input.title.trim() }
              : {}),
            ...(command.input.unit !== undefined
              ? { unit: command.input.unit.trim() }
              : {}),
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.habitId)
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
          return this.throwHabitUpdateError(
            trx,
            command.context.workspaceId,
            command.habitId,
            command.input.expectedVersion,
          )
        }

        return this.mapHabitRecord(updated)
      },
      command.context.actorUserId,
    )
  }

  async remove(command: DeleteHabitCommand): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const deletedHabit = await trx
          .updateTable('app.habits')
          .set({
            deleted_at: deletedAt,
            is_active: false,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.habitId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .returning(['id'])
          .executeTakeFirst()

        if (!deletedHabit) {
          throw new HttpError(404, 'habit_not_found', 'Habit not found.')
        }

        await trx
          .updateTable('app.habit_entries')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('workspace_id', '=', command.context.workspaceId)
          .where('habit_id', '=', command.habitId)
          .where('deleted_at', 'is', null)
          .execute()
      },
      command.context.actorUserId,
    )
  }

  async upsertEntry(
    command: UpsertHabitEntryCommand,
  ): Promise<StoredHabitEntryRecord> {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const habit = await this.loadActiveHabitRow(
          trx,
          command.context.workspaceId,
          command.habitId,
        )

        if (!habit) {
          throw new HttpError(404, 'habit_not_found', 'Habit not found.')
        }

        const habitRecord = this.mapHabitRecord(habit)

        if (!isHabitScheduledOnDate(habitRecord, command.date)) {
          throw new HttpError(
            400,
            'habit_not_scheduled',
            'Habit is not scheduled for this date.',
          )
        }

        const existingEntry = await this.loadActiveEntryRow(
          trx,
          command.context.workspaceId,
          command.habitId,
          command.date,
        )

        if (
          existingEntry &&
          command.input.expectedVersion !== undefined &&
          Number(existingEntry.version) !== command.input.expectedVersion
        ) {
          throw new HttpError(
            409,
            'habit_entry_version_conflict',
            'Habit entry was changed on the server.',
            {
              actualVersion: Number(existingEntry.version),
              expectedVersion: command.input.expectedVersion,
            },
          )
        }

        if (!existingEntry && command.input.expectedVersion !== undefined) {
          throw new HttpError(
            409,
            'habit_entry_version_conflict',
            'Habit entry was changed on the server.',
            {
              actualVersion: null,
              expectedVersion: command.input.expectedVersion,
            },
          )
        }

        if (existingEntry) {
          const updated = await trx
            .updateTable('app.habit_entries')
            .set({
              note: command.input.note,
              status: command.input.status,
              updated_by: command.context.actorUserId,
              value: getDefaultEntryValue(habitRecord, command.input.value),
            })
            .where('id', '=', existingEntry.id)
            .where('workspace_id', '=', command.context.workspaceId)
            .returningAll()
            .executeTakeFirstOrThrow()

          return this.mapHabitEntryRecord(updated)
        }

        const inserted = await trx
          .insertInto('app.habit_entries')
          .values({
            created_by: command.context.actorUserId,
            date: command.date,
            deleted_at: null,
            habit_id: command.habitId,
            note: command.input.note,
            status: command.input.status,
            updated_by: command.context.actorUserId,
            user_id: command.context.actorUserId,
            value: getDefaultEntryValue(habitRecord, command.input.value),
            workspace_id: command.context.workspaceId,
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        return this.mapHabitEntryRecord(inserted)
      },
      command.context.actorUserId,
    )
  }

  async removeEntry(command: DeleteHabitEntryCommand): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.habit_entries')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('workspace_id', '=', command.context.workspaceId)
          .where('habit_id', '=', command.habitId)
          .where('date', '=', command.date)
          .where('deleted_at', 'is', null)

        if (command.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            command.expectedVersion,
          )
        }

        const deleted = await updateQuery.returning(['id']).executeTakeFirst()

        if (!deleted && command.expectedVersion !== undefined) {
          const current = await this.loadActiveEntryRow(
            trx,
            command.context.workspaceId,
            command.habitId,
            command.date,
          )

          throw new HttpError(
            409,
            'habit_entry_version_conflict',
            'Habit entry was changed on the server.',
            {
              actualVersion: current ? Number(current.version) : null,
              expectedVersion: command.expectedVersion,
            },
          )
        }
      },
      command.context.actorUserId,
    )
  }

  async getToday(command: GetHabitTodayCommand): Promise<HabitTodayResult> {
    const [habitRows, entryRows] = await withOptionalRls(
      this.db,
      command.context.auth,
      async (executor) => {
        const habits = await this.loadHabitRows(
          executor,
          command.context.workspaceId,
        )
        const entries = await this.loadEntryRowsForHabits(
          executor,
          command.context.workspaceId,
          habits.map((habit) => habit.id),
          command.date,
        )

        return [habits, entries] as const
      },
      command.context.actorUserId,
    )
    const entries = entryRows.map((entry) => this.mapHabitEntryRecord(entry))
    const items = sortStoredHabits(
      habitRows.map((habit) => this.mapHabitRecord(habit)),
    )
      .filter((habit) => isHabitScheduledOnDate(habit, command.date))
      .map((habit) => {
        const habitEntries = entries.filter(
          (entry) => entry.habitId === habit.id,
        )
        const entry =
          habitEntries.find((item) => item.date === command.date) ?? null

        return {
          entry,
          habit,
          isDueToday: true,
          progressPercent: getEntryProgressPercent(habit, entry),
          stats: buildHabitStats(habit, habitEntries, {
            from: habit.startDate,
            to: command.date,
          }),
        }
      })

    return {
      date: command.date,
      items,
    }
  }

  async getStats(command: GetHabitStatsCommand): Promise<HabitStatsResult> {
    const [habitRows, entryRows] = await withOptionalRls(
      this.db,
      command.context.auth,
      async (executor) => {
        const habits = await this.loadHabitRows(
          executor,
          command.context.workspaceId,
        )
        const entries = await this.loadEntryRowsForHabits(
          executor,
          command.context.workspaceId,
          habits.map((habit) => habit.id),
          command.to,
        )

        return [habits, entries] as const
      },
      command.context.actorUserId,
    )
    const habits = sortStoredHabits(
      habitRows.map((habit) => this.mapHabitRecord(habit)),
    )
    const entries = entryRows.map((entry) => this.mapHabitEntryRecord(entry))

    return {
      from: command.from,
      habits,
      stats: habits.map((habit) =>
        buildHabitStats(
          habit,
          entries.filter((entry) => entry.habitId === habit.id),
          {
            from: command.from,
            to: command.to,
          },
        ),
      ),
      to: command.to,
    }
  }

  private loadHabitRows(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<HabitRow[]> {
    return executor
      .selectFrom('app.habits')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .orderBy('sort_order', 'asc')
      .orderBy('title', 'asc')
      .execute()
  }

  private loadActiveHabitRow(
    executor: DatabaseExecutor,
    workspaceId: string,
    habitId: string,
  ): Promise<HabitRow | undefined> {
    return executor
      .selectFrom('app.habits')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', habitId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }

  private loadActiveEntryRow(
    executor: DatabaseExecutor,
    workspaceId: string,
    habitId: string,
    date: string,
  ): Promise<HabitEntryRow | undefined> {
    return executor
      .selectFrom('app.habit_entries')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('habit_id', '=', habitId)
      .where('date', '=', date)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }

  private loadEntryRowsForHabits(
    executor: DatabaseExecutor,
    workspaceId: string,
    habitIds: string[],
    to: string,
  ): Promise<HabitEntryRow[]> {
    if (habitIds.length === 0) {
      return Promise.resolve([])
    }

    return executor
      .selectFrom('app.habit_entries')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('habit_id', 'in', habitIds)
      .where('date', '<=', to)
      .where('deleted_at', 'is', null)
      .orderBy('date', 'asc')
      .execute()
  }

  private async loadNextSortOrder(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<number> {
    const row = await executor
      .selectFrom('app.habits')
      .select(sql<number>`coalesce(max(sort_order), -1)`.as('max_sort_order'))
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    return Number(row?.max_sort_order ?? -1) + 1
  }

  private async resolveSphereId(
    context: CreateHabitCommand['context'],
    sphereId: string | null | undefined,
  ): Promise<string | null> {
    if (!sphereId) {
      return null
    }

    const sphere = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        executor
          .selectFrom('app.projects')
          .select('id')
          .where('workspace_id', '=', context.workspaceId)
          .where('id', '=', sphereId)
          .where('deleted_at', 'is', null)
          .where('status', '=', 'active')
          .executeTakeFirst(),
      context.actorUserId,
    )

    if (!sphere) {
      throw new HttpError(
        404,
        'habit_sphere_not_found',
        'Habit sphere not found.',
      )
    }

    return sphere.id
  }

  private async throwHabitUpdateError(
    executor: DatabaseExecutor,
    workspaceId: string,
    habitId: string,
    expectedVersion: number | undefined,
  ): Promise<never> {
    const current = await executor
      .selectFrom('app.habits')
      .select(['id', 'version'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', habitId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    if (!current) {
      throw new HttpError(404, 'habit_not_found', 'Habit not found.')
    }

    if (
      expectedVersion !== undefined &&
      Number(current.version) !== expectedVersion
    ) {
      throw new HttpError(
        409,
        'habit_version_conflict',
        'Habit was changed on the server.',
        {
          actualVersion: Number(current.version),
          expectedVersion,
        },
      )
    }

    throw new Error(`Habit "${habitId}" was not updated.`)
  }

  private mapHabitRecord(habit: HabitRow): StoredHabitRecord {
    return {
      color: habit.color,
      createdAt: serializeTimestamp(habit.created_at),
      daysOfWeek: normalizeDaysOfWeek(normalizeNumberArray(habit.days_of_week)),
      deletedAt: serializeNullableTimestamp(habit.deleted_at),
      description: habit.description,
      endDate: serializeNullableDate(habit.end_date),
      frequency: habit.frequency,
      icon: habit.icon,
      id: habit.id,
      isActive: habit.is_active,
      reminderTime: serializeNullableTime(habit.reminder_time),
      sortOrder: habit.sort_order,
      sphereId: habit.sphere_id,
      startDate: serializeDate(habit.start_date),
      targetType: habit.target_type,
      targetValue: habit.target_value,
      title: habit.title,
      unit: habit.unit,
      updatedAt: serializeTimestamp(habit.updated_at),
      userId: habit.user_id,
      version: Number(habit.version),
      workspaceId: habit.workspace_id,
    }
  }

  private mapHabitEntryRecord(entry: HabitEntryRow): StoredHabitEntryRecord {
    return {
      createdAt: serializeTimestamp(entry.created_at),
      date: serializeDate(entry.date),
      deletedAt: serializeNullableTimestamp(entry.deleted_at),
      habitId: entry.habit_id,
      id: entry.id,
      note: entry.note,
      status: entry.status,
      updatedAt: serializeTimestamp(entry.updated_at),
      userId: entry.user_id,
      value: entry.value,
      version: Number(entry.version),
      workspaceId: entry.workspace_id,
    }
  }
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
