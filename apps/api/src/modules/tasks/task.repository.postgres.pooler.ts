import { type Kysely, sql } from 'kysely'

import type {
  DatabaseSchema,
  JsonObject,
} from '../../infrastructure/db/schema.js'
import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  StoredTaskRecord,
  UpdateTaskCommand,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'
import { syncTaskReminder } from './task.repository.postgres.artifacts.js'
import { mapTaskRecordFromListRow } from './task.repository.postgres.mapper.js'
import {
  executePoolerWriteStatement,
  resolveTaskWriteConflict,
} from './task.repository.postgres.mutations.js'
import {
  MANUAL_TIME_BLOCK_SOURCE,
  TASK_REMIND_BEFORE_START_KEY,
  type TaskListRow,
  type TaskRow,
} from './task.repository.postgres.types.js'
import type {
  normalizeTaskInput,
  normalizeTaskSchedule,
} from './task.shared.js'

export class PostgresTaskPoolerWriteFallback {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async create(
    command: CreateTaskCommand,
    params: {
      assigneeUserId: string | null
      endsAt: string | null
      metadata: JsonObject
      normalizedInput: ReturnType<typeof normalizeTaskInput>
      normalizedSchedule: ReturnType<typeof normalizeTaskSchedule>
      projectId: string | null
      reminderTimeZone: string | undefined
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
    const createdTask = await executePoolerWriteStatement(
      this.db,
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
              assignee_user_id,
              id,
              metadata,
              planned_on,
              priority,
              project_id,
              resource,
              sphere_id,
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
              cast(${params.assigneeUserId} as uuid),
              ${params.taskId},
              cast(${JSON.stringify(params.metadata)} as jsonb),
              cast(${params.normalizedSchedule.plannedDate} as date),
              2,
              cast(${params.projectId} as uuid),
              ${params.normalizedInput.resource},
              cast(${params.projectId} as uuid),
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
              assignee_user.display_name as assignee_display_name,
              author_user.display_name as author_display_name,
              project.title as project_title,
              time_block.starts_at as time_block_starts_at,
              time_block.ends_at as time_block_ends_at
            from selected_task
            left join app.users as assignee_user
              on assignee_user.id = selected_task.assignee_user_id
              and assignee_user.deleted_at is null
            left join app.users as author_user
              on author_user.id = selected_task.created_by
              and author_user.deleted_at is null
            left join app.projects as project
              on project.id = selected_task.project_id
              and project.workspace_id = selected_task.workspace_id
              and project.deleted_at is null
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
                  'assigneeDisplayName',
                  task_with_time_block.assignee_display_name,
                  'assigneeUserId',
                  task_with_time_block.assignee_user_id,
                  'authorDisplayName',
                  task_with_time_block.author_display_name,
                  'authorUserId',
                  task_with_time_block.created_by,
                  'id',
                  task_with_time_block.id,
                  'icon',
                  coalesce(task_with_time_block.metadata ->> 'taskIcon', ''),
                  'importance',
                  coalesce(
                    task_with_time_block.metadata ->> 'taskImportance',
                    'not_important'
                  ),
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
                  'projectId',
                  task_with_time_block.project_id,
                  'project',
                  coalesce(
                    task_with_time_block.project_title,
                    task_with_time_block.metadata ->> 'legacyProjectName',
                    ''
                  ),
                  'requiresConfirmation',
                  coalesce(
                    (task_with_time_block.metadata ->> 'taskRequiresConfirmation')::boolean,
                    false
                  ),
                  'status',
                  cast(task_with_time_block.status as text),
                  'title',
                  task_with_time_block.title,
                  'urgency',
                  coalesce(
                    task_with_time_block.metadata ->> 'taskUrgency',
                    'not_urgent'
                  ),
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

        const createdTask = result.rows[0]

        if (createdTask) {
          const record = mapTaskRecordFromListRow(createdTask)

          await syncTaskReminder(executor, {
            isActive: record.status !== 'done',
            plannedDate: record.plannedDate,
            plannedStartTime: record.plannedStartTime,
            remindBeforeStart: record.remindBeforeStart === true,
            reminderTimeZone: params.reminderTimeZone,
            taskId: createdTask.id,
            userId: createdTask.created_by ?? command.context.actorUserId,
            workspaceId: createdTask.workspace_id,
          })
        }

        return createdTask
      },
    )

    if (!createdTask) {
      throw new Error('Failed to create task record.')
    }

    return mapTaskRecordFromListRow(createdTask)
  }

  async update(
    command: UpdateTaskCommand,
    params: {
      assigneeUserId: string | null
      deletedAt: string
      endsAt: string | null
      metadata: JsonObject
      normalizedInput: ReturnType<typeof normalizeTaskInput>
      normalizedSchedule: ReturnType<typeof normalizeTaskSchedule>
      projectId: string | null
      reminderTimeZone: string | undefined
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
    const updatedTask = await executePoolerWriteStatement(
      this.db,
      authContext,
      command.context.actorUserId,
      async (executor) => {
        const result = await sql<TaskListRow>`
          with updated_task as (
            update app.tasks
            set
              assignee_user_id = cast(${params.assigneeUserId} as uuid),
              description = ${params.normalizedInput.note},
              due_on = cast(${params.normalizedInput.dueDate} as date),
              metadata = cast(${JSON.stringify(params.metadata)} as jsonb),
              planned_on = cast(${params.normalizedSchedule.plannedDate} as date),
              project_id = cast(${params.projectId} as uuid),
              resource = ${params.normalizedInput.resource},
              sphere_id = cast(${params.projectId} as uuid),
              title = ${params.normalizedInput.title},
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
          task_with_time_block as (
            select
              updated_task.*,
              assignee_user.display_name as assignee_display_name,
              author_user.display_name as author_display_name,
              project.title as project_title,
              inserted_time_block.starts_at as time_block_starts_at,
              inserted_time_block.ends_at as time_block_ends_at
            from updated_task
            left join app.users as assignee_user
              on assignee_user.id = updated_task.assignee_user_id
              and assignee_user.deleted_at is null
            left join app.users as author_user
              on author_user.id = updated_task.created_by
              and author_user.deleted_at is null
            left join app.projects as project
              on project.id = updated_task.project_id
              and project.workspace_id = updated_task.workspace_id
              and project.deleted_at is null
            left join inserted_time_block on true
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
              'task.updated'::app.task_event_type,
              jsonb_build_object('version', updated_task.version),
              updated_task.id,
              updated_task.workspace_id
            from updated_task
          )
          select *
          from task_with_time_block
        `.execute(executor)

        const updatedTask = result.rows[0]

        if (updatedTask) {
          const record = mapTaskRecordFromListRow(updatedTask)

          await syncTaskReminder(executor, {
            isActive: record.status !== 'done',
            plannedDate: record.plannedDate,
            plannedStartTime: record.plannedStartTime,
            remindBeforeStart: record.remindBeforeStart === true,
            reminderTimeZone: params.reminderTimeZone,
            taskId: updatedTask.id,
            userId: updatedTask.created_by ?? command.context.actorUserId,
            workspaceId: updatedTask.workspace_id,
          })
        }

        return updatedTask
      },
    )

    if (!updatedTask) {
      return resolveTaskWriteConflict(
        this.db,
        authContext,
        command.context.actorUserId,
        command,
        `Task "${command.taskId}" was not updated.`,
      )
    }

    return mapTaskRecordFromListRow(updatedTask)
  }

  async updateStatus(
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
    const updatedTask = await executePoolerWriteStatement(
      this.db,
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
          task_with_time_block as (
            select
              updated_task.*,
              assignee_user.display_name as assignee_display_name,
              author_user.display_name as author_display_name,
              project.title as project_title,
              time_block.starts_at as time_block_starts_at,
              time_block.ends_at as time_block_ends_at
            from updated_task
            left join app.users as assignee_user
              on assignee_user.id = updated_task.assignee_user_id
              and assignee_user.deleted_at is null
            left join app.users as author_user
              on author_user.id = updated_task.created_by
              and author_user.deleted_at is null
            left join app.projects as project
              on project.id = updated_task.project_id
              and project.workspace_id = updated_task.workspace_id
              and project.deleted_at is null
            left join lateral (
              select starts_at, ends_at
              from app.task_time_blocks
              where workspace_id = updated_task.workspace_id
                and task_id = updated_task.id
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
          select *
          from task_with_time_block
        `.execute(executor)

        const updatedTask = result.rows[0]

        if (updatedTask) {
          const record = mapTaskRecordFromListRow(updatedTask)

          await syncTaskReminder(executor, {
            isActive: record.status !== 'done',
            plannedDate: record.plannedDate,
            plannedStartTime: record.plannedStartTime,
            remindBeforeStart: record.remindBeforeStart === true,
            reminderTimeZone: undefined,
            taskId: updatedTask.id,
            userId: updatedTask.created_by ?? command.context.actorUserId,
            workspaceId: updatedTask.workspace_id,
          })
        }

        return updatedTask
      },
    )

    if (!updatedTask) {
      return resolveTaskWriteConflict(
        this.db,
        authContext,
        command.context.actorUserId,
        command,
        `Task "${command.taskId}" was not updated.`,
      )
    }

    return mapTaskRecordFromListRow(updatedTask)
  }

  async updateSchedule(
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
        ? sql`and task.version = cast(${command.expectedVersion} as bigint)`
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
                cast(${command.context.actorUserId} as uuid),
                cast(${params.endsAt} as timestamptz),
                '{}'::jsonb,
                0,
                cast(${MANUAL_TIME_BLOCK_SOURCE} as text),
                cast(${params.startsAt} as timestamptz),
                updated_task.id,
                'UTC',
                cast(${command.context.actorUserId} as uuid),
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
    const updatedTask = await executePoolerWriteStatement(
      this.db,
      authContext,
      command.context.actorUserId,
      async (executor) => {
        const result = await sql<TaskListRow>`
          with raw_schedule_input as (
            select
              cast(${params.normalizedSchedule.plannedDate} as text) as planned_date,
              cast(${params.normalizedSchedule.plannedStartTime} as text) as planned_start_time,
              cast(${params.normalizedSchedule.plannedEndTime} as text) as planned_end_time
          ),
          schedule_input as (
            select
              cast(planned_date as date) as planned_date,
              cast(planned_start_time as time) as planned_start_time,
              cast(planned_end_time as time) as planned_end_time,
              planned_date as planned_date_text,
              planned_start_time as planned_start_time_text,
              planned_end_time as planned_end_time_text
            from raw_schedule_input
          ),
          updated_task as (
            update app.tasks as task
            set
              metadata = case
                when schedule_input.planned_date is null
                  or schedule_input.planned_start_time is null
                then coalesce(task.metadata, '{}'::jsonb) - cast(${TASK_REMIND_BEFORE_START_KEY} as text)
                else task.metadata
              end,
              planned_on = schedule_input.planned_date,
              updated_by = cast(${command.context.actorUserId} as uuid)
            from schedule_input
            where task.id = cast(${command.taskId} as uuid)
              and task.workspace_id = cast(${command.context.workspaceId} as uuid)
              and task.deleted_at is null
              ${expectedVersionFilter}
            returning task.*
          ),
          retired_time_blocks as (
            update app.task_time_blocks
            set
              deleted_at = cast(${params.deletedAt} as timestamptz),
              updated_by = cast(${command.context.actorUserId} as uuid)
            where workspace_id = cast(${command.context.workspaceId} as uuid)
              and task_id = cast(${command.taskId} as uuid)
              and deleted_at is null
              and exists (select 1 from updated_task)
            returning id
          ),
          ${insertedTimeBlockCte}
          task_with_time_block as (
            select
              updated_task.*,
              assignee_user.display_name as assignee_display_name,
              author_user.display_name as author_display_name,
              project.title as project_title,
              inserted_time_block.starts_at as time_block_starts_at,
              inserted_time_block.ends_at as time_block_ends_at
            from updated_task
            left join app.users as assignee_user
              on assignee_user.id = updated_task.assignee_user_id
              and assignee_user.deleted_at is null
            left join app.users as author_user
              on author_user.id = updated_task.created_by
              and author_user.deleted_at is null
            left join app.projects as project
              on project.id = updated_task.project_id
              and project.workspace_id = updated_task.workspace_id
              and project.deleted_at is null
            left join inserted_time_block on true
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
              cast(${command.context.actorUserId} as uuid),
              'task.updated'::app.task_event_type,
              jsonb_build_object(
                'plannedDate',
                schedule_input.planned_date_text,
                'plannedEndTime',
                schedule_input.planned_end_time_text,
                'plannedStartTime',
                schedule_input.planned_start_time_text,
                'version',
                updated_task.version
              ),
              updated_task.id,
              updated_task.workspace_id
            from updated_task
            cross join schedule_input
          )
          select *
          from task_with_time_block
        `.execute(executor)

        const updatedTask = result.rows[0]

        if (updatedTask) {
          const record = mapTaskRecordFromListRow(updatedTask)

          await syncTaskReminder(executor, {
            isActive: true,
            plannedDate: record.plannedDate,
            plannedStartTime: record.plannedStartTime,
            remindBeforeStart: record.remindBeforeStart === true,
            reminderTimeZone: undefined,
            taskId: updatedTask.id,
            userId: updatedTask.created_by ?? command.context.actorUserId,
            workspaceId: updatedTask.workspace_id,
          })
        }

        return updatedTask
      },
    )

    if (!updatedTask) {
      return resolveTaskWriteConflict(
        this.db,
        authContext,
        command.context.actorUserId,
        command,
        `Task "${command.taskId}" was not updated.`,
      )
    }

    return mapTaskRecordFromListRow(updatedTask)
  }

  async remove(command: DeleteTaskCommand, deletedAt: string): Promise<void> {
    const authContext = command.context.auth

    if (!authContext) {
      throw new Error(
        'Pooler write fallback requires an authenticated context.',
      )
    }

    const updatedTask = await executePoolerWriteStatement(
      this.db,
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

        const removedTask = result.rows[0]

        if (removedTask) {
          await syncTaskReminder(executor, {
            isActive: false,
            plannedDate: null,
            plannedStartTime: null,
            remindBeforeStart: false,
            reminderTimeZone: undefined,
            taskId: command.taskId,
            userId: command.context.actorUserId,
            workspaceId: command.context.workspaceId,
          })
        }

        return removedTask
      },
    )

    if (!updatedTask) {
      return resolveTaskWriteConflict(
        this.db,
        authContext,
        command.context.actorUserId,
        command,
        `Task "${command.taskId}" was not deleted.`,
      )
    }
  }
}
