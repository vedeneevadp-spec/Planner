import { generateUuidV7 } from '@planner/contracts'

import { TaskNotFoundError, TaskVersionConflictError } from './task.errors.js'
import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  StoredTaskEventRecord,
  StoredTaskRecord,
  TaskEventFilters,
  TaskEventListResult,
  TaskListFilters,
  TaskReadContext,
  UpdateTaskCommand,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'
import type { TaskRepository } from './task.repository.js'
import {
  applyTaskSchedule,
  applyTaskStatus,
  applyTaskUpdate,
  createStoredTaskRecord,
  markTaskDeleted,
  matchesTaskFilters,
  sortStoredTasks,
} from './task.shared.js'

export class MemoryTaskRepository implements TaskRepository {
  private readonly events: StoredTaskEventRecord[] = []
  private nextEventId = 1
  private readonly tasks = new Map<string, StoredTaskRecord>()

  listByWorkspace(
    context: TaskReadContext,
    filters?: TaskListFilters,
  ): Promise<StoredTaskRecord[]> {
    const tasks = [...this.tasks.values()].filter(
      (task) =>
        task.workspaceId === context.workspaceId &&
        matchesTaskFilters(task, filters),
    )

    return Promise.resolve(sortStoredTasks(tasks))
  }

  findById(
    context: TaskReadContext,
    taskId: string,
  ): Promise<StoredTaskRecord | null> {
    const task = this.tasks.get(taskId)

    if (!task || task.workspaceId !== context.workspaceId || task.deletedAt !== null) {
      return Promise.resolve(null)
    }

    return Promise.resolve(task)
  }

  listEventsByWorkspace(
    context: TaskReadContext,
    filters: TaskEventFilters = {},
  ): Promise<TaskEventListResult> {
    const afterEventId = filters.afterEventId ?? 0
    const limit = filters.limit ?? 500
    const events = this.events
      .filter(
        (event) =>
          event.workspaceId === context.workspaceId && event.id > afterEventId,
      )
      .sort((left, right) => left.id - right.id)
      .slice(0, limit)

    return Promise.resolve({
      events,
      nextEventId: events.at(-1)?.id ?? afterEventId,
    })
  }

  create(command: CreateTaskCommand): Promise<StoredTaskRecord> {
    const existingTask = command.input.id
      ? this.tasks.get(command.input.id)
      : undefined

    if (
      existingTask &&
      existingTask.workspaceId === command.context.workspaceId &&
      existingTask.deletedAt === null
    ) {
      return Promise.resolve(existingTask)
    }

    const task = createStoredTaskRecord(command.input, {
      authorDisplayName: command.context.actorDisplayName,
      authorUserId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })

    this.tasks.set(task.id, task)
    this.appendTaskEvent(command, {
      eventType: 'task.created',
      payload: {
        task,
      },
      taskId: task.id,
    })

    return Promise.resolve(task)
  }

  update(command: UpdateTaskCommand): Promise<StoredTaskRecord> {
    const task = this.getTaskOrThrow(
      command.taskId,
      command.context.workspaceId,
    )
    this.assertVersion(task, command.expectedVersion)

    const nextTask = applyTaskUpdate(task, command.input)
    this.tasks.set(nextTask.id, nextTask)
    this.appendTaskEvent(command, {
      eventType: 'task.updated',
      payload: {
        task: nextTask,
        version: nextTask.version,
      },
      taskId: nextTask.id,
    })

    return Promise.resolve(nextTask)
  }

  updateStatus(command: UpdateTaskStatusCommand): Promise<StoredTaskRecord> {
    const task = this.getTaskOrThrow(
      command.taskId,
      command.context.workspaceId,
    )
    this.assertVersion(task, command.expectedVersion)

    const nextTask = applyTaskStatus(task, command.status)
    this.tasks.set(nextTask.id, nextTask)
    this.appendTaskEvent(command, {
      eventType: 'task.status_changed',
      payload: {
        status: nextTask.status,
        version: nextTask.version,
      },
      taskId: nextTask.id,
    })

    return Promise.resolve(nextTask)
  }

  updateSchedule(
    command: UpdateTaskScheduleCommand,
  ): Promise<StoredTaskRecord> {
    const task = this.getTaskOrThrow(
      command.taskId,
      command.context.workspaceId,
    )
    this.assertVersion(task, command.expectedVersion)

    const nextTask = applyTaskSchedule(task, command.schedule)
    this.tasks.set(nextTask.id, nextTask)
    this.appendTaskEvent(command, {
      eventType: 'task.updated',
      payload: {
        plannedDate: nextTask.plannedDate,
        plannedEndTime: nextTask.plannedEndTime,
        plannedStartTime: nextTask.plannedStartTime,
        version: nextTask.version,
      },
      taskId: nextTask.id,
    })

    return Promise.resolve(nextTask)
  }

  remove(command: DeleteTaskCommand): Promise<void> {
    const task = this.getTaskOrThrow(
      command.taskId,
      command.context.workspaceId,
    )
    this.assertVersion(task, command.expectedVersion)

    const deletedTask = markTaskDeleted(task)
    this.tasks.set(task.id, deletedTask)
    this.appendTaskEvent(command, {
      eventType: 'task.deleted',
      payload: {
        deletedAt: deletedTask.deletedAt,
        version: deletedTask.version,
      },
      taskId: task.id,
    })

    return Promise.resolve()
  }

  private getTaskOrThrow(
    taskId: string,
    workspaceId: string,
  ): StoredTaskRecord {
    const task = this.tasks.get(taskId)

    if (!task || task.workspaceId !== workspaceId || task.deletedAt !== null) {
      throw new TaskNotFoundError(taskId)
    }

    return task
  }

  private assertVersion(
    task: StoredTaskRecord,
    expectedVersion: number | undefined,
  ): void {
    if (expectedVersion === undefined) {
      return
    }

    if (task.version !== expectedVersion) {
      throw new TaskVersionConflictError(task.id, expectedVersion, task.version)
    }
  }

  private appendTaskEvent(
    command:
      | CreateTaskCommand
      | DeleteTaskCommand
      | UpdateTaskCommand
      | UpdateTaskScheduleCommand
      | UpdateTaskStatusCommand,
    event: {
      eventType: string
      payload: Record<string, unknown>
      taskId: string
    },
  ): void {
    this.events.push({
      actorUserId: command.context.actorUserId,
      eventId: generateUuidV7(),
      eventType: event.eventType,
      id: this.nextEventId,
      occurredAt: new Date().toISOString(),
      payload: event.payload,
      taskId: event.taskId,
      workspaceId: command.context.workspaceId,
    })
    this.nextEventId += 1
  }
}
