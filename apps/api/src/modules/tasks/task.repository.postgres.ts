import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import {
  type DatabaseExecutor,
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
type TaskTimeBlockRow = Selectable<DatabaseSchema['app.task_time_blocks']>

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
      async (executor) => {
        let query = executor
          .selectFrom('app.tasks')
          .selectAll()
          .where('workspace_id', '=', context.workspaceId)
          .where('deleted_at', 'is', null)

        if (filters?.status) {
          query = query.where('status', '=', filters.status)
        }

        if (filters?.plannedDate) {
          query = query.where('planned_on', '=', filters.plannedDate)
        }

        return query.orderBy('created_at', 'asc').execute()
      },
      context.actorUserId,
    )
    const timeBlockMap = await this.loadPrimaryTimeBlocks(
      this.db,
      context.workspaceId,
      taskRows,
    )
    const taskRecords = taskRows.map((taskRow) =>
      this.mapTaskRecord(taskRow, timeBlockMap.get(taskRow.id)),
    )

    return sortStoredTasks(
      filters?.project
        ? taskRecords.filter((task) => task.project === filters.project)
        : taskRecords,
    )
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
              this.db,
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
          updateQuery = updateQuery.where('version', '=', command.expectedVersion)
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
          this.db,
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
          updateQuery = updateQuery.where('version', '=', command.expectedVersion)
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
          updateQuery = updateQuery.where('version', '=', command.expectedVersion)
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

  private async loadPrimaryTimeBlocks(
    executor: DatabaseExecutor,
    workspaceId: string,
    taskRows: TaskRow[],
  ): Promise<Map<string, TaskTimeBlockRow>> {
    if (taskRows.length === 0) {
      return new Map()
    }

    const taskIds = taskRows.map((taskRow) => taskRow.id)
    const timeBlocks = await executor
      .selectFrom('app.task_time_blocks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .where('task_id', 'in', taskIds)
      .orderBy('position', 'asc')
      .orderBy('starts_at', 'asc')
      .execute()

    const timeBlockMap = new Map<string, TaskTimeBlockRow>()

    for (const timeBlock of timeBlocks) {
      if (!timeBlockMap.has(timeBlock.task_id)) {
        timeBlockMap.set(timeBlock.task_id, timeBlock)
      }
    }

    return timeBlockMap
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
