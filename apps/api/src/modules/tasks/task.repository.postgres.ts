import { generateUuidV7 } from '@planner/contracts'
import type { Kysely, Transaction } from 'kysely'

import {
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import { TaskNotFoundError, TaskVersionConflictError } from './task.errors.js'
import type {
  CopyTaskToPersonalCommand,
  CreateTaskCommand,
  DeleteTaskCommand,
  MoveTaskToPersonalCommand,
  StoredTaskRecord,
  TaskEventFilters,
  TaskEventListResult,
  TaskListFilters,
  TaskListPageResult,
  TaskReadContext,
  UpdateTaskCommand,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'
import type { TaskRepository } from './task.repository.js'
import {
  syncTaskReminder,
  writeTaskMutationArtifacts,
} from './task.repository.postgres.artifacts.js'
import {
  buildTaskMetadata,
  mapTaskEventRecord,
  mapTaskRecord,
  mapTaskRecordFromListRow,
} from './task.repository.postgres.mapper.js'
import {
  buildScheduleUpdateMetadataValue,
  insertPrimaryTimeBlock,
  shouldUsePoolerWriteFallback,
} from './task.repository.postgres.mutations.js'
import { PostgresTaskPoolerWriteFallback } from './task.repository.postgres.pooler.js'
import {
  loadAssigneeDisplayName,
  loadCurrentTask,
  loadPrimaryTimeBlock,
  loadProjectTitle,
  loadTaskRowsPageWithPrimaryTimeBlock,
  loadTaskRowsWithPrimaryTimeBlock,
  loadUserDisplayName,
  resolveTaskAssignee,
  resolveTaskProject,
} from './task.repository.postgres.queries.js'
import type { TaskRow } from './task.repository.postgres.types.js'
import {
  buildDefaultEndTime,
  buildTaskTimeFields,
  buildTimestampFromDateAndTime,
  isActiveTaskStatus,
  normalizeTaskInput,
  normalizeTaskSchedule,
  sortStoredTasks,
} from './task.shared.js'

export class PostgresTaskRepository implements TaskRepository {
  private readonly poolerWriteFallback: PostgresTaskPoolerWriteFallback

  constructor(private readonly db: Kysely<DatabaseSchema>) {
    this.poolerWriteFallback = new PostgresTaskPoolerWriteFallback(db)
  }

  async listByWorkspace(
    context: TaskReadContext,
    filters?: TaskListFilters,
  ): Promise<StoredTaskRecord[]> {
    const taskRows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        loadTaskRowsWithPrimaryTimeBlock(
          executor,
          context.workspaceId,
          filters,
        ),
      context.actorUserId,
    )
    const taskRecords = taskRows.map((taskRow) =>
      mapTaskRecordFromListRow(taskRow),
    )

    return sortStoredTasks(
      filters?.project
        ? taskRecords.filter((task) => task.project === filters.project)
        : taskRecords,
    )
  }

  async listPageByWorkspace(
    context: TaskReadContext,
    filters: TaskListFilters = {},
  ): Promise<TaskListPageResult> {
    const offset = filters.offset ?? 0
    const limit = filters.limit ?? 100

    const taskRows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        loadTaskRowsPageWithPrimaryTimeBlock(executor, context.workspaceId, {
          ...filters,
          limit: limit + 1,
          offset,
        }),
      context.actorUserId,
    )
    const hasMore = taskRows.length > limit
    const items = taskRows
      .slice(0, limit)
      .map((taskRow) => mapTaskRecordFromListRow(taskRow))

    return {
      hasMore,
      items: sortStoredTasks(items),
      limit,
      nextOffset: hasMore ? offset + items.length : null,
      offset,
    }
  }

  async findById(
    context: TaskReadContext,
    taskId: string,
  ): Promise<StoredTaskRecord | null> {
    const taskRows = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const taskRow = await executor
          .selectFrom('app.tasks')
          .selectAll()
          .where('id', '=', taskId)
          .where('workspace_id', '=', context.workspaceId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()

        if (!taskRow) {
          return null
        }

        const [
          timeBlock,
          projectTitle,
          assigneeDisplayName,
          authorDisplayName,
        ] = await Promise.all([
          loadPrimaryTimeBlock(executor, context.workspaceId, taskId),
          loadProjectTitle(executor, context.workspaceId, taskRow.project_id),
          loadAssigneeDisplayName(executor, taskRow.assignee_user_id),
          loadUserDisplayName(executor, taskRow.created_by),
        ])

        return mapTaskRecord(
          taskRow,
          timeBlock,
          projectTitle,
          assigneeDisplayName,
          authorDisplayName,
        )
      },
      context.actorUserId,
    )

    return taskRows
  }

  async listEventsByWorkspace(
    context: TaskReadContext,
    filters: TaskEventFilters = {},
  ): Promise<TaskEventListResult> {
    const afterEventId = filters.afterEventId ?? 0
    const limit = filters.limit ?? 500
    const eventRows = await withOptionalRls(
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
    const events = eventRows.map((eventRow) => mapTaskEventRecord(eventRow))
    const nextEventId = events.at(-1)?.id ?? afterEventId

    return {
      events,
      nextEventId,
    }
  }

  async create(command: CreateTaskCommand): Promise<StoredTaskRecord> {
    const normalizedInput = normalizeTaskInput(command.input)
    const normalizedSchedule = normalizeTaskSchedule(command.input)
    const sphereProjectId =
      normalizedInput.projectId ?? normalizedInput.sphereId
    const project = await resolveTaskProject(
      this.db,
      command.context,
      sphereProjectId,
    )
    const assignee = await resolveTaskAssignee(
      this.db,
      command.context,
      normalizedInput.assigneeUserId,
    )
    const metadata = buildTaskMetadata(
      project ? '' : normalizedInput.project,
      normalizedInput,
    )
    const taskId = normalizedInput.id ?? generateUuidV7()
    const timeFields = buildTaskTimeFields({
      plannerTimeZone:
        normalizedInput.reminderTimeZone ?? command.context.clientTimeZone,
      recurrence: normalizedInput.recurrence,
      schedule: normalizedSchedule,
    })
    const startsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedStartTime,
            timeFields.timeZone ?? undefined,
          )
        : null
    const endsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedEndTime ??
              buildDefaultEndTime(normalizedSchedule.plannedStartTime),
            timeFields.timeZone ?? undefined,
          )
        : null

    if (shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.poolerWriteFallback.create(command, {
        endsAt,
        metadata,
        assigneeUserId: assignee?.id ?? null,
        normalizedInput,
        normalizedSchedule,
        projectId: project?.id ?? null,
        reminderTimeZone: normalizedInput.reminderTimeZone,
        startsAt,
        timeFields,
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
            assignee_user_id: assignee?.id ?? null,
            id: taskId,
            local_date: timeFields.localDate,
            local_time: timeFields.localTime,
            metadata,
            planned_on: normalizedSchedule.plannedDate,
            priority: 2,
            project_id: project?.id ?? null,
            resource: normalizedInput.resource,
            sphere_id: project?.id ?? null,
            sort_key: '',
            starts_at_utc: timeFields.startsAtUtc,
            status: 'todo',
            time_kind: timeFields.timeKind,
            time_zone: timeFields.timeZone,
            time_zone_inferred: timeFields.timeZoneInferred,
            recurrence_rule: timeFields.recurrenceRule,
            recurrence_start_date: timeFields.recurrenceStartDate,
            recurrence_time_zone: timeFields.recurrenceTimeZone,
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
          ? await insertPrimaryTimeBlock(trx, {
              actorUserId: command.context.actorUserId,
              endsAt,
              startsAt,
              taskId: task.id,
              timeZone: timeFields.timeZone,
              workspaceId: command.context.workspaceId,
            })
          : await loadPrimaryTimeBlock(
              trx,
              command.context.workspaceId,
              task.id,
            )
        const projectTitle = await loadProjectTitle(
          trx,
          command.context.workspaceId,
          task.project_id,
        )
        const assigneeDisplayName = await loadAssigneeDisplayName(
          trx,
          task.assignee_user_id,
        )
        const authorDisplayName =
          task.created_by === command.context.actorUserId
            ? command.context.actorDisplayName
            : await loadUserDisplayName(trx, task.created_by)
        const record = mapTaskRecord(
          task,
          timeBlock,
          projectTitle,
          assigneeDisplayName,
          authorDisplayName,
        )

        if (insertedTask) {
          await syncTaskReminder(trx, {
            isActive: true,
            plannedDate: record.plannedDate,
            plannedStartTime: record.plannedStartTime,
            remindBeforeStart: record.remindBeforeStart === true,
            reminderOffsets: record.reminderOffsets ?? [],
            reminderTimeZone: normalizedInput.reminderTimeZone,
            taskId: task.id,
            userId: task.created_by ?? command.context.actorUserId,
            workspaceId: command.context.workspaceId,
          })
          await writeTaskMutationArtifacts(trx, {
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

  async copyToPersonal(
    command: CopyTaskToPersonalCommand,
  ): Promise<StoredTaskRecord> {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        await this.assertTransferSourceVersion(trx, command)
        const record = await this.insertPersonalTaskFromSource(trx, command, {
          isLinkedCopy: true,
        })

        await writeTaskMutationArtifacts(trx, {
          actorUserId: command.context.actorUserId,
          eventType: 'task.created',
          payload: {
            task: record,
          },
          taskId: record.id,
          workspaceId: command.targetWorkspace.id,
        })

        return record
      },
      command.context.actorUserId,
    )
  }

  async moveToPersonal(
    command: MoveTaskToPersonalCommand,
  ): Promise<StoredTaskRecord> {
    const deletedAt = new Date().toISOString()

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        await this.assertTransferSourceVersion(trx, command)
        const record = await this.insertPersonalTaskFromSource(trx, command, {
          isLinkedCopy: false,
        })
        const deletedTask = await this.softDeleteTransferSource(
          trx,
          command,
          deletedAt,
        )

        await syncTaskReminder(trx, {
          isActive: false,
          plannedDate: null,
          plannedStartTime: null,
          remindBeforeStart: false,
          reminderOffsets: [],
          reminderTimeZone: undefined,
          taskId: command.task.id,
          userId: deletedTask.created_by ?? command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        await writeTaskMutationArtifacts(trx, {
          actorUserId: command.context.actorUserId,
          eventType: 'task.created',
          payload: {
            task: record,
          },
          taskId: record.id,
          workspaceId: command.targetWorkspace.id,
        })
        await writeTaskMutationArtifacts(trx, {
          actorUserId: command.context.actorUserId,
          eventType: 'task.deleted',
          payload: {
            deletedAt,
            version: Number(deletedTask.version),
          },
          taskId: command.task.id,
          workspaceId: command.context.workspaceId,
        })

        return record
      },
      command.context.actorUserId,
    )
  }

  async update(command: UpdateTaskCommand): Promise<StoredTaskRecord> {
    const normalizedInput = normalizeTaskInput({
      ...command.input,
      id: command.taskId,
    })
    const normalizedSchedule = normalizeTaskSchedule(normalizedInput)
    const sphereProjectId =
      normalizedInput.projectId ?? normalizedInput.sphereId
    const project = await resolveTaskProject(
      this.db,
      command.context,
      sphereProjectId,
    )
    const assignee = await resolveTaskAssignee(
      this.db,
      command.context,
      normalizedInput.assigneeUserId,
    )
    const metadata = buildTaskMetadata(
      project ? '' : normalizedInput.project,
      normalizedInput,
    )
    const deletedAt = new Date().toISOString()
    const timeFields = buildTaskTimeFields({
      plannerTimeZone:
        normalizedInput.reminderTimeZone ?? command.context.clientTimeZone,
      recurrence: normalizedInput.recurrence,
      schedule: normalizedSchedule,
    })
    const startsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedStartTime,
            timeFields.timeZone ?? undefined,
          )
        : null
    const endsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedEndTime ??
              buildDefaultEndTime(normalizedSchedule.plannedStartTime),
            timeFields.timeZone ?? undefined,
          )
        : null

    if (shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.poolerWriteFallback.update(command, {
        deletedAt,
        endsAt,
        metadata,
        assigneeUserId: assignee?.id ?? null,
        normalizedInput,
        normalizedSchedule,
        projectId: project?.id ?? null,
        reminderTimeZone: normalizedInput.reminderTimeZone,
        startsAt,
        timeFields,
      })
    }

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.tasks')
          .set({
            assignee_user_id: assignee?.id ?? null,
            description: normalizedInput.note,
            due_on: normalizedInput.dueDate,
            local_date: timeFields.localDate,
            local_time: timeFields.localTime,
            metadata,
            planned_on: normalizedSchedule.plannedDate,
            project_id: project?.id ?? null,
            recurrence_rule: timeFields.recurrenceRule,
            recurrence_start_date: timeFields.recurrenceStartDate,
            recurrence_time_zone: timeFields.recurrenceTimeZone,
            resource: normalizedInput.resource,
            sphere_id: project?.id ?? null,
            starts_at_utc: timeFields.startsAtUtc,
            time_kind: timeFields.timeKind,
            time_zone: timeFields.timeZone,
            time_zone_inferred: timeFields.timeZoneInferred,
            title: normalizedInput.title,
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
          const currentTask = await loadCurrentTask(trx, command)

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

        const timeBlock = await insertPrimaryTimeBlock(trx, {
          actorUserId: command.context.actorUserId,
          endsAt,
          startsAt,
          taskId: command.taskId,
          timeZone: timeFields.timeZone,
          workspaceId: command.context.workspaceId,
        })
        const projectTitle = await loadProjectTitle(
          trx,
          command.context.workspaceId,
          updatedTask.project_id,
        )
        const assigneeDisplayName = await loadAssigneeDisplayName(
          trx,
          updatedTask.assignee_user_id,
        )
        const authorDisplayName = await loadUserDisplayName(
          trx,
          updatedTask.created_by,
        )
        const record = mapTaskRecord(
          updatedTask,
          timeBlock,
          projectTitle,
          assigneeDisplayName,
          authorDisplayName,
        )

        await syncTaskReminder(trx, {
          isActive: true,
          plannedDate: record.plannedDate,
          plannedStartTime: record.plannedStartTime,
          remindBeforeStart: record.remindBeforeStart === true,
          reminderOffsets: record.reminderOffsets ?? [],
          reminderTimeZone: normalizedInput.reminderTimeZone,
          taskId: command.taskId,
          userId: updatedTask.created_by ?? command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        await writeTaskMutationArtifacts(trx, {
          actorUserId: command.context.actorUserId,
          eventType: 'task.updated',
          payload: {
            task: record,
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

  async updateStatus(
    command: UpdateTaskStatusCommand,
  ): Promise<StoredTaskRecord> {
    const completedAt =
      command.status === 'done' ? new Date().toISOString() : null

    if (shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.poolerWriteFallback.updateStatus(command, completedAt)
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
          const currentTask = await loadCurrentTask(trx, command)

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

        const timeBlock = await loadPrimaryTimeBlock(
          trx,
          command.context.workspaceId,
          command.taskId,
        )
        const projectTitle = await loadProjectTitle(
          trx,
          command.context.workspaceId,
          updatedTask.project_id,
        )
        const assigneeDisplayName = await loadAssigneeDisplayName(
          trx,
          updatedTask.assignee_user_id,
        )
        const authorDisplayName = await loadUserDisplayName(
          trx,
          updatedTask.created_by,
        )
        const record = mapTaskRecord(
          updatedTask,
          timeBlock,
          projectTitle,
          assigneeDisplayName,
          authorDisplayName,
        )

        await syncTaskReminder(trx, {
          isActive: isActiveTaskStatus(record.status),
          plannedDate: record.plannedDate,
          plannedStartTime: record.plannedStartTime,
          remindBeforeStart: record.remindBeforeStart === true,
          reminderOffsets: record.reminderOffsets ?? [],
          reminderTimeZone: undefined,
          taskId: command.taskId,
          userId: updatedTask.created_by ?? command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        await writeTaskMutationArtifacts(trx, {
          actorUserId: command.context.actorUserId,
          eventType: 'task.status_changed',
          payload: {
            status: record.status,
            version: record.version,
          },
          taskId: command.taskId,
          workspaceId: command.context.workspaceId,
        })
        await this.propagateLinkedTaskStatus(trx, command, updatedTask)

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
    const timeFields = buildTaskTimeFields({
      plannerTimeZone: command.context.clientTimeZone,
      schedule: normalizedSchedule,
    })
    const startsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedStartTime,
            timeFields.timeZone ?? undefined,
          )
        : null
    const endsAt =
      normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
        ? buildTimestampFromDateAndTime(
            normalizedSchedule.plannedDate,
            normalizedSchedule.plannedEndTime ??
              buildDefaultEndTime(normalizedSchedule.plannedStartTime),
            timeFields.timeZone ?? undefined,
          )
        : null

    if (shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.poolerWriteFallback.updateSchedule(command, {
        deletedAt,
        endsAt,
        normalizedSchedule,
        startsAt,
        timeFields,
      })
    }

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.tasks')
          .set({
            local_date: timeFields.localDate,
            local_time: timeFields.localTime,
            metadata: buildScheduleUpdateMetadataValue(normalizedSchedule),
            planned_on: normalizedSchedule.plannedDate,
            recurrence_start_date: timeFields.recurrenceStartDate,
            recurrence_time_zone: timeFields.recurrenceTimeZone,
            starts_at_utc: timeFields.startsAtUtc,
            time_kind: timeFields.timeKind,
            time_zone: timeFields.timeZone,
            time_zone_inferred: timeFields.timeZoneInferred,
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
          const currentTask = await loadCurrentTask(trx, command)

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

        const timeBlock = await insertPrimaryTimeBlock(trx, {
          actorUserId: command.context.actorUserId,
          endsAt,
          startsAt,
          taskId: command.taskId,
          timeZone: timeFields.timeZone,
          workspaceId: command.context.workspaceId,
        })
        const projectTitle = await loadProjectTitle(
          trx,
          command.context.workspaceId,
          updatedTask.project_id,
        )
        const assigneeDisplayName = await loadAssigneeDisplayName(
          trx,
          updatedTask.assignee_user_id,
        )
        const authorDisplayName = await loadUserDisplayName(
          trx,
          updatedTask.created_by,
        )
        const record = mapTaskRecord(
          updatedTask,
          timeBlock,
          projectTitle,
          assigneeDisplayName,
          authorDisplayName,
        )

        await syncTaskReminder(trx, {
          isActive: true,
          plannedDate: record.plannedDate,
          plannedStartTime: record.plannedStartTime,
          remindBeforeStart: record.remindBeforeStart === true,
          reminderOffsets: record.reminderOffsets ?? [],
          reminderTimeZone: command.context.clientTimeZone,
          taskId: command.taskId,
          userId: updatedTask.created_by ?? command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        await writeTaskMutationArtifacts(trx, {
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

    if (shouldUsePoolerWriteFallback(command.context.auth)) {
      return this.poolerWriteFallback.remove(command, deletedAt)
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

        const updatedTask = await updateQuery.returningAll().executeTakeFirst()

        if (!updatedTask) {
          const currentTask = await loadCurrentTask(trx, command)

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

        await syncTaskReminder(trx, {
          isActive: false,
          plannedDate: null,
          plannedStartTime: null,
          remindBeforeStart: false,
          reminderOffsets: [],
          reminderTimeZone: undefined,
          taskId: command.taskId,
          userId: updatedTask.created_by ?? command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
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

  private async assertTransferSourceVersion(
    trx: Transaction<DatabaseSchema>,
    command: CopyTaskToPersonalCommand | MoveTaskToPersonalCommand,
  ): Promise<void> {
    const currentTask = await trx
      .selectFrom('app.tasks')
      .select(['id', 'version'])
      .where('id', '=', command.task.id)
      .where('workspace_id', '=', command.context.workspaceId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    if (!currentTask) {
      throw new TaskNotFoundError(command.task.id)
    }

    if (
      command.expectedVersion !== undefined &&
      Number(currentTask.version) !== command.expectedVersion
    ) {
      throw new TaskVersionConflictError(
        command.task.id,
        command.expectedVersion,
        Number(currentTask.version),
      )
    }
  }

  private async insertPersonalTaskFromSource(
    trx: Transaction<DatabaseSchema>,
    command: CopyTaskToPersonalCommand | MoveTaskToPersonalCommand,
    options: {
      isLinkedCopy: boolean
    },
  ): Promise<StoredTaskRecord> {
    const sourceTask = command.task
    const taskId = generateUuidV7()
    const sourceTimeZone =
      sourceTask.schedule?.kind === 'fixed_zone_datetime'
        ? sourceTask.schedule.timeZone
        : command.context.clientTimeZone
    const timeFields = buildTaskTimeFields({
      plannerTimeZone: sourceTimeZone,
      recurrence: sourceTask.recurrence,
      schedule: {
        plannedDate: sourceTask.plannedDate,
        plannedEndTime: sourceTask.plannedEndTime,
        plannedStartTime: sourceTask.plannedStartTime,
      },
    })
    const startsAt =
      sourceTask.plannedDate && sourceTask.plannedStartTime
        ? buildTimestampFromDateAndTime(
            sourceTask.plannedDate,
            sourceTask.plannedStartTime,
            timeFields.timeZone ?? undefined,
          )
        : null
    const endsAt =
      sourceTask.plannedDate && sourceTask.plannedStartTime
        ? buildTimestampFromDateAndTime(
            sourceTask.plannedDate,
            sourceTask.plannedEndTime ??
              buildDefaultEndTime(sourceTask.plannedStartTime),
            timeFields.timeZone ?? undefined,
          )
        : null
    const metadata = buildTaskMetadata('', {
      icon: sourceTask.icon,
      importance: sourceTask.importance,
      linkedTask: options.isLinkedCopy
        ? {
            id: sourceTask.id,
            workspaceId: sourceTask.workspaceId,
          }
        : null,
      recurrence: sourceTask.recurrence ?? null,
      remindBeforeStart: undefined,
      reminderOffsets: undefined,
      requiresConfirmation: false,
      routine: sourceTask.routine ?? null,
      sourceWorkspace: options.isLinkedCopy
        ? {
            id: sourceTask.workspaceId,
            name: command.context.workspaceName ?? 'Shared workspace',
          }
        : null,
      urgency: sourceTask.urgency,
    })

    const insertedTask = await trx
      .insertInto('app.tasks')
      .values({
        assignee_user_id: null,
        completed_at: sourceTask.completedAt,
        created_by: command.context.actorUserId,
        deleted_at: null,
        description: sourceTask.note,
        due_at: null,
        due_on: sourceTask.dueDate,
        id: taskId,
        local_date: timeFields.localDate,
        local_time: timeFields.localTime,
        metadata,
        parent_task_id: options.isLinkedCopy ? sourceTask.id : null,
        planned_on: sourceTask.plannedDate,
        priority: 2,
        project_id: null,
        recurrence_rule: timeFields.recurrenceRule,
        recurrence_start_date: timeFields.recurrenceStartDate,
        recurrence_time_zone: timeFields.recurrenceTimeZone,
        resource: sourceTask.resource,
        sphere_id: null,
        sort_key: '',
        starts_at_utc: timeFields.startsAtUtc,
        status: sourceTask.status,
        time_kind: timeFields.timeKind,
        time_zone: timeFields.timeZone,
        time_zone_inferred: timeFields.timeZoneInferred,
        title: sourceTask.title,
        updated_by: command.context.actorUserId,
        workspace_id: command.targetWorkspace.id,
      })
      .returningAll()
      .executeTakeFirst()

    if (!insertedTask) {
      throw new Error('Failed to create personal task record.')
    }

    const timeBlock = await insertPrimaryTimeBlock(trx, {
      actorUserId: command.context.actorUserId,
      endsAt,
      startsAt,
      taskId: insertedTask.id,
      timeZone: timeFields.timeZone,
      workspaceId: command.targetWorkspace.id,
    })

    return mapTaskRecord(
      insertedTask,
      timeBlock,
      null,
      null,
      command.context.actorDisplayName,
    )
  }

  private async softDeleteTransferSource(
    trx: Transaction<DatabaseSchema>,
    command: MoveTaskToPersonalCommand,
    deletedAt: string,
  ): Promise<TaskRow> {
    let updateQuery = trx
      .updateTable('app.tasks')
      .set({
        deleted_at: deletedAt,
        updated_by: command.context.actorUserId,
      })
      .where('id', '=', command.task.id)
      .where('workspace_id', '=', command.context.workspaceId)
      .where('deleted_at', 'is', null)

    if (command.expectedVersion !== undefined) {
      updateQuery = updateQuery.where('version', '=', command.expectedVersion)
    }

    const updatedTask = await updateQuery.returningAll().executeTakeFirst()

    if (!updatedTask) {
      const currentTask = await loadCurrentTask(trx, {
        context: command.context,
        taskId: command.task.id,
      })

      if (!currentTask) {
        throw new TaskNotFoundError(command.task.id)
      }

      if (
        command.expectedVersion !== undefined &&
        Number(currentTask.version) !== command.expectedVersion
      ) {
        throw new TaskVersionConflictError(
          command.task.id,
          command.expectedVersion,
          Number(currentTask.version),
        )
      }

      throw new Error(`Task "${command.task.id}" was not moved.`)
    }

    await trx
      .updateTable('app.task_time_blocks')
      .set({
        deleted_at: deletedAt,
        updated_by: command.context.actorUserId,
      })
      .where('task_id', '=', command.task.id)
      .where('deleted_at', 'is', null)
      .execute()

    return updatedTask
  }

  private async propagateLinkedTaskStatus(
    trx: Transaction<DatabaseSchema>,
    command: UpdateTaskStatusCommand,
    updatedTask: TaskRow,
  ): Promise<void> {
    const rootTaskId = updatedTask.parent_task_id ?? updatedTask.id
    const relatedTasks = await trx
      .selectFrom('app.tasks')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('id', '!=', updatedTask.id)
      .where((expressionBuilder) =>
        expressionBuilder.or([
          expressionBuilder('id', '=', rootTaskId),
          expressionBuilder('parent_task_id', '=', rootTaskId),
        ]),
      )
      .execute()

    for (const relatedTask of relatedTasks) {
      if (relatedTask.status === command.status) {
        continue
      }

      const completedAt =
        command.status === 'done' ? new Date().toISOString() : null
      const nextRelatedTask = await trx
        .updateTable('app.tasks')
        .set({
          completed_at: completedAt,
          status: command.status,
          updated_by: command.context.actorUserId,
        })
        .where('id', '=', relatedTask.id)
        .where('workspace_id', '=', relatedTask.workspace_id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst()

      if (!nextRelatedTask) {
        continue
      }

      const timeBlock = await loadPrimaryTimeBlock(
        trx,
        nextRelatedTask.workspace_id,
        nextRelatedTask.id,
      )
      const record = mapTaskRecord(nextRelatedTask, timeBlock, null, null, null)

      await syncTaskReminder(trx, {
        isActive: isActiveTaskStatus(record.status),
        plannedDate: record.plannedDate,
        plannedStartTime: record.plannedStartTime,
        remindBeforeStart: record.remindBeforeStart === true,
        reminderOffsets: record.reminderOffsets ?? [],
        reminderTimeZone: undefined,
        taskId: record.id,
        userId: nextRelatedTask.created_by ?? command.context.actorUserId,
        workspaceId: record.workspaceId,
      })
      await writeTaskMutationArtifacts(trx, {
        actorUserId: command.context.actorUserId,
        eventType: 'task.status_changed',
        payload: {
          status: record.status,
          version: record.version,
        },
        taskId: record.id,
        workspaceId: record.workspaceId,
      })
    }
  }
}
