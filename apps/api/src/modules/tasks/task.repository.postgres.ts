import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable, sql } from 'kysely'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import {
  type DatabaseExecutor,
  resolveRlsStrategyForEnvironment,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type {
  DatabaseSchema,
  JsonObject,
} from '../../infrastructure/db/schema.js'
import { TaskNotFoundError, TaskVersionConflictError } from './task.errors.js'
import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  StoredTaskRecord,
  TaskEventFilters,
  TaskEventListResult,
  TaskListFilters,
  TaskReadContext,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'
import type { TaskRepository } from './task.repository.js'
import {
  buildDefaultEndTime,
  buildTimestampFromDateAndTime,
  extractTimeFromTimestamp,
  normalizeTaskInput,
  normalizeTaskSchedule,
  sortStoredTasks,
} from './task.shared.js'

type TaskRow = Selectable<DatabaseSchema['app.tasks']>
type TaskEventRow = Selectable<DatabaseSchema['app.task_events']>
type TaskTimeBlockRow = Selectable<DatabaseSchema['app.task_time_blocks']>
type TaskListRow = TaskRow & {
  time_block_ends_at: TaskTimeBlockRow['ends_at'] | null
  time_block_starts_at: TaskTimeBlockRow['starts_at'] | null
}

const LEGACY_PROJECT_NAME_KEY = 'legacyProjectName'
const MANUAL_TIME_BLOCK_SOURCE = 'manual'

export class PostgresTaskRepository implements TaskRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listByWorkspace(
    context: TaskReadContext,
    filters?: TaskListFilters,
  ): Promise<StoredTaskRecord[]> {
    const taskRows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        this.loadTaskRowsWithPrimaryTimeBlock(
          executor,
          context.workspaceId,
          filters,
        ),
      context.actorUserId,
    )
    const taskRecords = taskRows.map((taskRow) =>
      this.mapTaskRecordFromListRow(taskRow),
    )

    return sortStoredTasks(
      filters?.project
        ? taskRecords.filter((task) => task.project === filters.project)
        : taskRecords,
    )
  }

  async listEventsByWorkspace(
    context: TaskReadContext,
    filters: TaskEventFilters = {},
  ): Promise<TaskEventListResult> {
    const limit = filters.limit ?? 100
    const afterEventId = filters.afterEventId ?? 0
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        executor
          .selectFrom('app.task_events')
          .selectAll()
          .where('workspace_id', '=', context.workspaceId)
          .where('id', '>', afterEventId)
          .orderBy('id', 'asc')
          .limit(limit)
          .execute(),
      context.actorUserId,
    )
    const events = rows.map((row) => this.mapTaskEventRecord(row))

    return {
      events,
      nextEventId: events.at(-1)?.id ?? afterEventId,
    }
  }

  async create(command: CreateTaskCommand): Promise<StoredTaskRecord> {
    const normalizedInput = normalizeTaskInput(command.input)
    const normalizedSchedule = normalizeTaskSchedule(command.input)
    const metadata = this.buildTaskMetadata(normalizedInput.project)
    const taskId = normalizedInput.id ?? generateUuidV7()
    const startsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedStartTime,
          )
        : null
    const endsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedEndTime ??
              buildDefaultEndTime(normalizedSchedule.plannedStartTime),
          )
        : null

    if (this.shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.createWithPoolerWriteFallback(command, {
        endsAt,
        metadata,
        normalizedInput,
        normalizedSchedule,
        startsAt,
        taskId,
      })
    }

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const insertedTask = await trx
          .insertInto('app.tasks')
          .values({
            created_by: command.context.actorUserId,
            deleted_at: null,
            description: normalizedInput.note,
            due_at: null,
            due_on: normalizedInput.dueDate,
            id: taskId,
            metadata,
            planned_on: normalizedSchedule.plannedDate,
            priority: 2,
            project_id: null,
            sort_key: '',
            status: 'todo',
            title: normalizedInput.title,
            updated_by: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .returningAll()
          .executeTakeFirst()

        const task = insertedTask
          ? insertedTask
          : await trx
              .selectFrom('app.tasks')
              .selectAll()
              .where('id', '=', taskId)
              .where('workspace_id', '=', command.context.workspaceId)
              .executeTakeFirst()

        if (!task) {
          throw new Error('Failed to create task record.')
        }

        const timeBlock = insertedTask
          ? await this.insertPrimaryTimeBlock(trx, {
              actorUserId: command.context.actorUserId,
              endsAt,
              startsAt,
              taskId: task.id,
              workspaceId: command.context.workspaceId,
            })
          : await this.loadPrimaryTimeBlock(
              trx,
              command.context.workspaceId,
              task.id,
            )
        const record = this.mapTaskRecord(task, timeBlock)

        if (insertedTask) {
          await this.writeTaskMutationArtifacts(trx, {
            actorUserId: command.context.actorUserId,
            eventType: 'task.created',
            payload: {
              task: record,
            },
            taskId: task.id,
            workspaceId: command.context.workspaceId,
          })
        }

        return record
      },
      command.context.actorUserId,
    )
  }

  async updateStatus(
    command: UpdateTaskStatusCommand,
  ): Promise<StoredTaskRecord> {
    const completedAt =
      command.status === 'done' ? new Date().toISOString() : null

    if (this.shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.updateStatusWithPoolerWriteFallback(command, completedAt)
    }

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.tasks')
          .set({
            completed_at: completedAt,
            status: command.status,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.taskId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)

        if (command.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            command.expectedVersion,
          )
        }

        const updatedTask = await updateQuery.returningAll().executeTakeFirst()

        if (!updatedTask) {
          const currentTask = await this.loadCurrentTask(trx, command)

          if (!currentTask) {
            throw new TaskNotFoundError(command.taskId)
          }

          if (
            command.expectedVersion !== undefined &&
            Number(currentTask.version) !== command.expectedVersion
          ) {
            throw new TaskVersionConflictError(
              command.taskId,
              command.expectedVersion,
              Number(currentTask.version),
            )
          }

          throw new Error(`Task "${command.taskId}" was not updated.`)
        }

        const timeBlock = await this.loadPrimaryTimeBlock(
          trx,
          command.context.workspaceId,
          command.taskId,
        )
        const record = this.mapTaskRecord(updatedTask, timeBlock)

        await this.writeTaskMutationArtifacts(trx, {
          actorUserId: command.context.actorUserId,
          eventType: 'task.status_changed',
          payload: {
            status: record.status,
            version: record.version,
          },
          taskId: command.taskId,
          workspaceId: command.context.workspaceId,
        })

        return record
      },
      command.context.actorUserId,
    )
  }

  async updateSchedule(
    command: UpdateTaskScheduleCommand,
  ): Promise<StoredTaskRecord> {
    const normalizedSchedule = normalizeTaskSchedule(command.schedule)
    const deletedAt = new Date().toISOString()
    const startsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedStartTime,
          )
        : null
    const endsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedEndTime ??
              buildDefaultEndTime(normalizedSchedule.plannedStartTime),
          )
        : null

    if (this.shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.updateScheduleWithPoolerWriteFallback(command, {
        deletedAt,
        endsAt,
        normalizedSchedule,
        startsAt,
      })
    }

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.tasks')
          .set({
            planned_on: normalizedSchedule.plannedDate,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.taskId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)

        if (command.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            command.expectedVersion,
          )
        }

        const updatedTask = await updateQuery.returningAll().executeTakeFirst()

        if (!updatedTask) {
          const currentTask = await this.loadCurrentTask(trx, command)

          if (!currentTask) {
            throw new TaskNotFoundError(command.taskId)
          }

          if (
            command.expectedVersion !== undefined &&
            Number(currentTask.version) !== command.expectedVersion
          ) {
            throw new TaskVersionConflictError(
              command.taskId,
              command.expectedVersion,
              Number(currentTask.version),
            )
          }

          throw new Error(`Task "${command.taskId}" was not updated.`)
        }

        await trx
          .updateTable('app.task_time_blocks')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('task_id', '=', command.taskId)
          .where('deleted_at', 'is', null)
          .execute()

        const timeBlock = await this.insertPrimaryTimeBlock(trx, {
          actorUserId: command.context.actorUserId,
          endsAt,
          startsAt,
          taskId: command.taskId,
          workspaceId: command.context.workspaceId,
        })
        const record = this.mapTaskRecord(updatedTask, timeBlock)

        await this.writeTaskMutationArtifacts(trx, {
          actorUserId: command.context.actorUserId,
          eventType: 'task.updated',
          payload: {
            plannedDate: record.plannedDate,
            plannedEndTime: record.plannedEndTime,
            plannedStartTime: record.plannedStartTime,
            version: record.version,
          },
          taskId: command.taskId,
          workspaceId: command.context.workspaceId,
        })

        return record
      },
      command.context.actorUserId,
    )
  }

  async remove(command: DeleteTaskCommand): Promise<void> {
    const deletedAt = new Date().toISOString()

    if (this.shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.removeWithPoolerWriteFallback(command, deletedAt)
    }

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.tasks')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.taskId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)

        if (command.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            command.expectedVersion,
          )
        }

        const updatedTask = await updateQuery
          .returning(['id', 'version'])
          .executeTakeFirst()

        if (!updatedTask) {
          const currentTask = await this.loadCurrentTask(trx, command)

          if (!currentTask) {
            throw new TaskNotFoundError(command.taskId)
          }

          if (
            command.expectedVersion !== undefined &&
            Number(currentTask.version) !== command.expectedVersion
          ) {
            throw new TaskVersionConflictError(
              command.taskId,
              command.expectedVersion,
              Number(currentTask.version),
            )
          }

          throw new Error(`Task "${command.taskId}" was not deleted.`)
        }

        await trx
          .updateTable('app.task_time_blocks')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('task_id', '=', command.taskId)
          .where('deleted_at', 'is', null)
          .execute()

        await trx
          .insertInto('app.task_events')
          .values({
            actor_user_id: command.context.actorUserId,
            event_type: 'task.deleted',
            payload: {
              deletedAt,
              version: Number(updatedTask.version),
            },
            task_id: command.taskId,
            workspace_id: command.context.workspaceId,
          })
          .executeTakeFirst()
      },
      command.context.actorUserId,
    )
  }

  private shouldUsePoolerWriteFallback(
    authContext: AuthenticatedRequestContext | null,
  ): authContext is AuthenticatedRequestContext {
    return (
      authContext !== null &&
      resolveRlsStrategyForEnvironment(process.env) === 'session_connection'
    )
  }

  private executePoolerWriteStatement<T>(
    authContext: AuthenticatedRequestContext,
    actorUserId: string,
    callback: (executor: Kysely<DatabaseSchema>) => Promise<T>,
  ): Promise<T> {
    return withOptionalRls(
      this.db,
      authContext,
      (executor) => callback(executor as Kysely<DatabaseSchema>),
      actorUserId,
    )
  }

  private async createWithPoolerWriteFallback(
    command: CreateTaskCommand,
    params: {
      endsAt: string | null
      metadata: JsonObject
      normalizedInput: ReturnType<typeof normalizeTaskInput>
      normalizedSchedule: ReturnType<typeof normalizeTaskSchedule>
      startsAt: string | null
      taskId: string
    },
  ): Promise<StoredTaskRecord> {
    const authContext = command.context.auth

    if (!authContext) {
      throw new Error(
        'Pooler write fallback requires an authenticated context.',
      )
    }

    const insertedTimeBlockCte =
      params.startsAt && params.endsAt
        ? sql`
            inserted_time_block as (
              insert into app.task_time_blocks (
                created_by,
                ends_at,
                metadata,
                position,
                source,
                starts_at,
                task_id,
                timezone,
                updated_by,
                workspace_id
              )
              select
                ${command.context.actorUserId},
                cast(${params.endsAt} as timestamptz),
                '{}'::jsonb,
                0,
                ${MANUAL_TIME_BLOCK_SOURCE},
                cast(${params.startsAt} as timestamptz),
                inserted_task.id,
                'UTC',
                ${command.context.actorUserId},
                inserted_task.workspace_id
              from inserted_task
            ),
          `
        : sql`
            inserted_time_block as (
              select null::uuid as id
              from inserted_task
              where false
            ),
          `
    const createdTask = await this.executePoolerWriteStatement(
      authContext,
      command.context.actorUserId,
      async (executor) => {
        const result = await sql<TaskListRow>`
          with inserted_task as (
            insert into app.tasks (
              created_by,
              deleted_at,
              description,
              due_at,
              due_on,
              id,
              metadata,
              planned_on,
              priority,
              project_id,
              sort_key,
              status,
              title,
              updated_by,
              workspace_id
            )
            values (
              ${command.context.actorUserId},
              null,
              ${params.normalizedInput.note},
              null,
              cast(${params.normalizedInput.dueDate} as date),
              ${params.taskId},
              cast(${JSON.stringify(params.metadata)} as jsonb),
              cast(${params.normalizedSchedule.plannedDate} as date),
              2,
              null,
              '',
              'todo',
              ${params.normalizedInput.title},
              ${command.context.actorUserId},
              ${command.context.workspaceId}
            )
            on conflict (id) do nothing
            returning *
          ),
          selected_task as (
            select * from inserted_task
            union all
            select task.*
            from app.tasks as task
            where task.id = ${params.taskId}
              and task.workspace_id = ${command.context.workspaceId}
              and not exists (select 1 from inserted_task)
          ),
          ${insertedTimeBlockCte}
          task_with_time_block as (
            select
              selected_task.*,
              time_block.starts_at as time_block_starts_at,
              time_block.ends_at as time_block_ends_at
            from selected_task
            left join lateral (
              select starts_at, ends_at
              from app.task_time_blocks
              where workspace_id = selected_task.workspace_id
                and task_id = selected_task.id
                and deleted_at is null
              order by position asc, starts_at asc
              limit 1
            ) as time_block on true
          ),
          event_insert as (
            insert into app.task_events (
              actor_user_id,
              event_type,
              payload,
              task_id,
              workspace_id
            )
            select
              ${command.context.actorUserId},
              'task.created'::app.task_event_type,
              jsonb_build_object(
                'task',
                jsonb_build_object(
                  'completedAt',
                  case
                    when task_with_time_block.completed_at is null then null
                    else to_char(
                      task_with_time_block.completed_at at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    )
                  end,
                  'createdAt',
                  to_char(
                    task_with_time_block.created_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                  ),
                  'deletedAt',
                  case
                    when task_with_time_block.deleted_at is null then null
                    else to_char(
                      task_with_time_block.deleted_at at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    )
                  end,
                  'dueDate',
                  cast(task_with_time_block.due_on as text),
                  'id',
                  task_with_time_block.id,
                  'note',
                  task_with_time_block.description,
                  'plannedDate',
                  cast(task_with_time_block.planned_on as text),
                  'plannedEndTime',
                  case
                    when task_with_time_block.time_block_ends_at is null then null
                    else to_char(
                      task_with_time_block.time_block_ends_at at time zone 'UTC',
                      'HH24:MI'
                    )
                  end,
                  'plannedStartTime',
                  case
                    when task_with_time_block.time_block_starts_at is null then null
                    else to_char(
                      task_with_time_block.time_block_starts_at at time zone 'UTC',
                      'HH24:MI'
                    )
                  end,
                  'project',
                  coalesce(
                    task_with_time_block.metadata ->> 'legacyProjectName',
                    ''
                  ),
                  'status',
                  cast(task_with_time_block.status as text),
                  'title',
                  task_with_time_block.title,
                  'updatedAt',
                  to_char(
                    task_with_time_block.updated_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                  ),
                  'version',
                  task_with_time_block.version,
                  'workspaceId',
                  task_with_time_block.workspace_id
                )
              ),
              task_with_time_block.id,
              task_with_time_block.workspace_id
            from task_with_time_block
            where exists (select 1 from inserted_task)
          )
          select *
          from task_with_time_block
        `.execute(executor)

        return result.rows[0]
      },
    )

    if (!createdTask) {
      throw new Error('Failed to create task record.')
    }

    return this.mapTaskRecordFromListRow(createdTask)
  }

  private async updateStatusWithPoolerWriteFallback(
    command: UpdateTaskStatusCommand,
    completedAt: string | null,
  ): Promise<StoredTaskRecord> {
    const authContext = command.context.auth

    if (!authContext) {
      throw new Error(
        'Pooler write fallback requires an authenticated context.',
      )
    }

    const expectedVersionFilter =
      command.expectedVersion !== undefined
        ? sql`and version = ${command.expectedVersion}`
        : sql``
    const updatedTask = await this.executePoolerWriteStatement(
      authContext,
      command.context.actorUserId,
      async (executor) => {
        const result = await sql<TaskListRow>`
          with updated_task as (
            update app.tasks
            set
              completed_at = cast(${completedAt} as timestamptz),
              status = ${command.status},
              updated_by = ${command.context.actorUserId}
            where id = ${command.taskId}
              and workspace_id = ${command.context.workspaceId}
              and deleted_at is null
              ${expectedVersionFilter}
            returning *
          ),
          event_insert as (
            insert into app.task_events (
              actor_user_id,
              event_type,
              payload,
              task_id,
              workspace_id
            )
            select
              ${command.context.actorUserId},
              'task.status_changed'::app.task_event_type,
              jsonb_build_object(
                'status',
                cast(${command.status} as text),
                'version',
                updated_task.version
              ),
              updated_task.id,
              updated_task.workspace_id
            from updated_task
          )
          select
            updated_task.*,
            time_block.starts_at as time_block_starts_at,
            time_block.ends_at as time_block_ends_at
          from updated_task
          left join lateral (
            select starts_at, ends_at
            from app.task_time_blocks
            where workspace_id = updated_task.workspace_id
              and task_id = updated_task.id
              and deleted_at is null
            order by position asc, starts_at asc
            limit 1
          ) as time_block on true
        `.execute(executor)

        return result.rows[0]
      },
    )

    if (!updatedTask) {
      return this.resolvePoolerWriteConflict(
        authContext,
        command.context.actorUserId,
        command,
        `Task "${command.taskId}" was not updated.`,
      )
    }

    return this.mapTaskRecordFromListRow(updatedTask)
  }

  private async updateScheduleWithPoolerWriteFallback(
    command: UpdateTaskScheduleCommand,
    params: {
      deletedAt: string
      endsAt: string | null
      normalizedSchedule: ReturnType<typeof normalizeTaskSchedule>
      startsAt: string | null
    },
  ): Promise<StoredTaskRecord> {
    const authContext = command.context.auth

    if (!authContext) {
      throw new Error(
        'Pooler write fallback requires an authenticated context.',
      )
    }

    const expectedVersionFilter =
      command.expectedVersion !== undefined
        ? sql`and version = ${command.expectedVersion}`
        : sql``
    const insertedTimeBlockCte =
      params.startsAt && params.endsAt
        ? sql`
            inserted_time_block as (
              insert into app.task_time_blocks (
                created_by,
                ends_at,
                metadata,
                position,
                source,
                starts_at,
                task_id,
                timezone,
                updated_by,
                workspace_id
              )
              select
                ${command.context.actorUserId},
                cast(${params.endsAt} as timestamptz),
                '{}'::jsonb,
                0,
                ${MANUAL_TIME_BLOCK_SOURCE},
                cast(${params.startsAt} as timestamptz),
                updated_task.id,
                'UTC',
                ${command.context.actorUserId},
                updated_task.workspace_id
              from updated_task
              returning starts_at, ends_at
            ),
          `
        : sql`
            inserted_time_block as (
              select
                null::timestamptz as starts_at,
                null::timestamptz as ends_at
              from updated_task
            ),
          `
    const updatedTask = await this.executePoolerWriteStatement(
      authContext,
      command.context.actorUserId,
      async (executor) => {
        const result = await sql<TaskListRow>`
          with updated_task as (
            update app.tasks
            set
              planned_on = cast(${params.normalizedSchedule.plannedDate} as date),
              updated_by = ${command.context.actorUserId}
            where id = ${command.taskId}
              and workspace_id = ${command.context.workspaceId}
              and deleted_at is null
              ${expectedVersionFilter}
            returning *
          ),
          retired_time_blocks as (
            update app.task_time_blocks
            set
              deleted_at = ${params.deletedAt},
              updated_by = ${command.context.actorUserId}
            where workspace_id = ${command.context.workspaceId}
              and task_id = ${command.taskId}
              and deleted_at is null
              and exists (select 1 from updated_task)
            returning id
          ),
          ${insertedTimeBlockCte}
          event_insert as (
            insert into app.task_events (
              actor_user_id,
              event_type,
              payload,
              task_id,
              workspace_id
            )
            select
              ${command.context.actorUserId},
              'task.updated'::app.task_event_type,
              jsonb_build_object(
                'plannedDate',
                cast(${params.normalizedSchedule.plannedDate} as text),
                'plannedEndTime',
                cast(${params.normalizedSchedule.plannedEndTime} as text),
                'plannedStartTime',
                cast(${params.normalizedSchedule.plannedStartTime} as text),
                'version',
                updated_task.version
              ),
              updated_task.id,
              updated_task.workspace_id
            from updated_task
          )
          select
            updated_task.*,
            inserted_time_block.starts_at as time_block_starts_at,
            inserted_time_block.ends_at as time_block_ends_at
          from updated_task
          left join inserted_time_block on true
        `.execute(executor)

        return result.rows[0]
      },
    )

    if (!updatedTask) {
      return this.resolvePoolerWriteConflict(
        authContext,
        command.context.actorUserId,
        command,
        `Task "${command.taskId}" was not updated.`,
      )
    }

    return this.mapTaskRecordFromListRow(updatedTask)
  }

  private async removeWithPoolerWriteFallback(
    command: DeleteTaskCommand,
    deletedAt: string,
  ): Promise<void> {
    const authContext = command.context.auth

    if (!authContext) {
      throw new Error(
        'Pooler write fallback requires an authenticated context.',
      )
    }

    const updatedTask = await this.executePoolerWriteStatement(
      authContext,
      command.context.actorUserId,
      async (executor) => {
        const expectedVersionFilter =
          command.expectedVersion !== undefined
            ? sql`and version = ${command.expectedVersion}`
            : sql``
        const result = await sql<Pick<TaskRow, 'id' | 'version'>>`
          with updated_task as (
            update app.tasks
            set
              deleted_at = ${deletedAt},
              updated_by = ${command.context.actorUserId}
            where id = ${command.taskId}
              and workspace_id = ${command.context.workspaceId}
              and deleted_at is null
              ${expectedVersionFilter}
            returning id, version, workspace_id
          ),
          retired_time_blocks as (
            update app.task_time_blocks
            set
              deleted_at = ${deletedAt},
              updated_by = ${command.context.actorUserId}
            where task_id = ${command.taskId}
              and workspace_id = ${command.context.workspaceId}
              and deleted_at is null
              and exists (select 1 from updated_task)
            returning id
          ),
          event_insert as (
            insert into app.task_events (
              actor_user_id,
              event_type,
              payload,
              task_id,
              workspace_id
            )
            select
              ${command.context.actorUserId},
              'task.deleted'::app.task_event_type,
              jsonb_build_object(
                'deletedAt',
                cast(${deletedAt} as text),
                'version',
                updated_task.version
              ),
              updated_task.id,
              updated_task.workspace_id
            from updated_task
          )
          select id, version
          from updated_task
        `.execute(executor)

        return result.rows[0]
      },
    )

    if (!updatedTask) {
      return this.resolvePoolerWriteConflict(
        authContext,
        command.context.actorUserId,
        command,
        `Task "${command.taskId}" was not deleted.`,
      )
    }
  }

  private async resolvePoolerWriteConflict(
    authContext: AuthenticatedRequestContext,
    actorUserId: string,
    command: {
      context: {
        workspaceId: string
      }
      expectedVersion?: number
      taskId: string
    },
    message: string,
  ): Promise<never> {
    const currentTask = await this.executePoolerWriteStatement(
      authContext,
      actorUserId,
      (executor) => this.loadCurrentTask(executor, command),
    )

    if (!currentTask) {
      throw new TaskNotFoundError(command.taskId)
    }

    if (
      command.expectedVersion !== undefined &&
      Number(currentTask.version) !== command.expectedVersion
    ) {
      throw new TaskVersionConflictError(
        command.taskId,
        command.expectedVersion,
        Number(currentTask.version),
      )
    }

    throw new Error(message)
  }

  private async loadTaskRowsWithPrimaryTimeBlock(
    executor: DatabaseExecutor,
    workspaceId: string,
    filters?: TaskListFilters,
  ): Promise<TaskListRow[]> {
    const statusFilter = filters?.status
      ? sql`and task.status = ${filters.status}`
      : sql``
    const plannedDateFilter = filters?.plannedDate
      ? sql`and task.planned_on = ${filters.plannedDate}`
      : sql``
    const result = await sql<TaskListRow>`
      select
        task.*,
        time_block.starts_at as time_block_starts_at,
        time_block.ends_at as time_block_ends_at
      from app.tasks as task
      left join lateral (
        select starts_at, ends_at
        from app.task_time_blocks
        where workspace_id = task.workspace_id
          and task_id = task.id
          and deleted_at is null
        order by position asc, starts_at asc
        limit 1
      ) as time_block on true
      where task.workspace_id = ${workspaceId}
        and task.deleted_at is null
        ${statusFilter}
        ${plannedDateFilter}
      order by task.created_at asc
    `.execute(executor)

    return result.rows
  }

  private loadPrimaryTimeBlock(
    executor: DatabaseExecutor,
    workspaceId: string,
    taskId: string,
  ): Promise<TaskTimeBlockRow | undefined> {
    return executor
      .selectFrom('app.task_time_blocks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('task_id', '=', taskId)
      .where('deleted_at', 'is', null)
      .orderBy('position', 'asc')
      .orderBy('starts_at', 'asc')
      .executeTakeFirst()
  }

  private mapTaskRecord(
    task: TaskRow,
    timeBlock: TaskTimeBlockRow | undefined,
  ): StoredTaskRecord {
    return {
      completedAt: serializeNullableTimestamp(task.completed_at),
      createdAt: serializeTimestamp(task.created_at),
      deletedAt: serializeNullableTimestamp(task.deleted_at),
      dueDate: serializeNullableDate(task.due_on),
      id: task.id,
      note: task.description,
      plannedDate: serializeNullableDate(task.planned_on),
      plannedEndTime: timeBlock
        ? extractTimeFromTimestamp(serializeTimestamp(timeBlock.ends_at))
        : null,
      plannedStartTime: timeBlock
        ? extractTimeFromTimestamp(serializeTimestamp(timeBlock.starts_at))
        : null,
      project: this.readLegacyProjectName(task.metadata),
      status: task.status,
      title: task.title,
      updatedAt: serializeTimestamp(task.updated_at),
      version: Number(task.version),
      workspaceId: task.workspace_id,
    }
  }

  private mapTaskRecordFromListRow(task: TaskListRow): StoredTaskRecord {
    return {
      completedAt: serializeNullableTimestamp(task.completed_at),
      createdAt: serializeTimestamp(task.created_at),
      deletedAt: serializeNullableTimestamp(task.deleted_at),
      dueDate: serializeNullableDate(task.due_on),
      id: task.id,
      note: task.description,
      plannedDate: serializeNullableDate(task.planned_on),
      plannedEndTime: task.time_block_ends_at
        ? extractTimeFromTimestamp(serializeTimestamp(task.time_block_ends_at))
        : null,
      plannedStartTime: task.time_block_starts_at
        ? extractTimeFromTimestamp(
            serializeTimestamp(task.time_block_starts_at),
          )
        : null,
      project: this.readLegacyProjectName(task.metadata),
      status: task.status,
      title: task.title,
      updatedAt: serializeTimestamp(task.updated_at),
      version: Number(task.version),
      workspaceId: task.workspace_id,
    }
  }

  private mapTaskEventRecord(taskEvent: TaskEventRow) {
    return {
      actorUserId: taskEvent.actor_user_id,
      eventId: taskEvent.event_id,
      eventType: taskEvent.event_type,
      id: Number(taskEvent.id),
      occurredAt: serializeTimestamp(taskEvent.occurred_at),
      payload: taskEvent.payload,
      taskId: taskEvent.task_id,
      workspaceId: taskEvent.workspace_id,
    }
  }

  private buildTaskMetadata(projectName: string): JsonObject {
    return projectName
      ? {
          [LEGACY_PROJECT_NAME_KEY]: projectName,
        }
      : {}
  }

  private readLegacyProjectName(metadata: JsonObject): string {
    const value = metadata[LEGACY_PROJECT_NAME_KEY]

    return typeof value === 'string' ? value : ''
  }

  private insertPrimaryTimeBlock(
    executor: DatabaseExecutor,
    params: {
      actorUserId: string
      endsAt: string | null
      startsAt: string | null
      taskId: string
      workspaceId: string
    },
  ): Promise<TaskTimeBlockRow | undefined> {
    if (!params.startsAt || !params.endsAt) {
      return Promise.resolve(undefined)
    }

    return executor
      .insertInto('app.task_time_blocks')
      .values({
        created_by: params.actorUserId,
        ends_at: params.endsAt,
        metadata: {},
        position: 0,
        source: MANUAL_TIME_BLOCK_SOURCE,
        starts_at: params.startsAt,
        task_id: params.taskId,
        timezone: 'UTC',
        updated_by: params.actorUserId,
        workspace_id: params.workspaceId,
      })
      .returningAll()
      .executeTakeFirst()
  }

  private async writeTaskMutationArtifacts(
    executor: DatabaseExecutor,
    params: {
      actorUserId: string
      eventType: string
      payload: JsonObject
      taskId: string
      workspaceId: string
    },
  ): Promise<void> {
    await executor
      .insertInto('app.task_events')
      .values({
        actor_user_id: params.actorUserId,
        event_type: params.eventType,
        payload: params.payload,
        task_id: params.taskId,
        workspace_id: params.workspaceId,
      })
      .executeTakeFirst()
  }

  private loadCurrentTask(
    executor: DatabaseExecutor,
    command: {
      context: {
        workspaceId: string
      }
      taskId: string
    },
  ): Promise<Pick<TaskRow, 'id' | 'version'> | undefined> {
    return executor
      .selectFrom('app.tasks')
      .select(['id', 'version'])
      .where('id', '=', command.taskId)
      .where('workspace_id', '=', command.context.workspaceId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function serializeNullableDate(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
  }

  throw new TypeError(`Unexpected date value: ${typeof value}`)
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
