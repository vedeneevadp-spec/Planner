import { generateUuidV7 } from '@planner/contracts'

import { TaskNotFoundError, TaskVersionConflictError } from './task.errors.js'
import type {
  CopyTaskToPersonalCommand,
  CreateTaskCommand,
  DeleteTaskCommand,
  MoveTaskToPersonalCommand,
  StoredTaskEventRecord,
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

  listPageByWorkspace(
    context: TaskReadContext,
    filters: TaskListFilters = {},
  ): Promise<TaskListPageResult> {
    const offset = filters.offset ?? 0
    const limit = filters.limit ?? 100
    const tasks = [...this.tasks.values()].filter(
      (task) =>
        task.workspaceId === context.workspaceId &&
        matchesTaskFilters(task, filters),
    )
    const sortedTasks = sortStoredTasks(tasks)
    const items = sortedTasks.slice(offset, offset + limit)
    const nextOffset = offset + items.length

    return Promise.resolve({
      hasMore: nextOffset < sortedTasks.length,
      items,
      limit,
      nextOffset: nextOffset < sortedTasks.length ? nextOffset : null,
      offset,
    })
  }

  findById(
    context: TaskReadContext,
    taskId: string,
  ): Promise<StoredTaskRecord | null> {
    const task = this.tasks.get(taskId)

    if (
      !task ||
      task.workspaceId !== context.workspaceId ||
      task.deletedAt !== null
    ) {
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
      clientTimeZone: command.context.clientTimeZone,
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

  copyToPersonal(
    command: CopyTaskToPersonalCommand,
  ): Promise<StoredTaskRecord> {
    const sourceTask = this.getTaskOrThrow(
      command.task.id,
      command.context.workspaceId,
    )
    this.assertVersion(sourceTask, command.expectedVersion)

    const task = this.createPersonalTaskFromSource(command, {
      isLinkedCopy: true,
    })

    this.tasks.set(task.id, task)
    this.appendTaskEvent(
      { context: this.createTargetContext(command) },
      {
        eventType: 'task.created',
        payload: {
          task,
        },
        taskId: task.id,
      },
    )

    return Promise.resolve(task)
  }

  moveToPersonal(
    command: MoveTaskToPersonalCommand,
  ): Promise<StoredTaskRecord> {
    const sourceTask = this.getTaskOrThrow(
      command.task.id,
      command.context.workspaceId,
    )
    this.assertVersion(sourceTask, command.expectedVersion)

    const task = this.createPersonalTaskFromSource(command, {
      isLinkedCopy: false,
    })
    const deletedTask = markTaskDeleted(sourceTask)

    this.tasks.set(task.id, task)
    this.tasks.set(sourceTask.id, deletedTask)
    this.appendTaskEvent(
      { context: this.createTargetContext(command) },
      {
        eventType: 'task.created',
        payload: {
          task,
        },
        taskId: task.id,
      },
    )
    this.appendTaskEvent(command, {
      eventType: 'task.deleted',
      payload: {
        deletedAt: deletedTask.deletedAt,
        version: deletedTask.version,
      },
      taskId: sourceTask.id,
    })

    return Promise.resolve(task)
  }

  update(command: UpdateTaskCommand): Promise<StoredTaskRecord> {
    const task = this.getTaskOrThrow(
      command.taskId,
      command.context.workspaceId,
    )
    this.assertVersion(task, command.expectedVersion)

    const nextTask = applyTaskUpdate(
      task,
      command.input,
      undefined,
      command.context.clientTimeZone,
    )
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
    this.propagateLinkedTaskStatus(command, nextTask)

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

    const nextTask = applyTaskSchedule(
      task,
      command.schedule,
      undefined,
      command.context.clientTimeZone,
    )
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
      | { context: CreateTaskCommand['context'] }
      | CopyTaskToPersonalCommand
      | DeleteTaskCommand
      | MoveTaskToPersonalCommand
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

  private createPersonalTaskFromSource(
    command: CopyTaskToPersonalCommand | MoveTaskToPersonalCommand,
    options: {
      isLinkedCopy: boolean
    },
  ): StoredTaskRecord {
    const now = new Date().toISOString()
    const sourceTask = command.task

    return {
      ...sourceTask,
      assigneeDisplayName: null,
      assigneeUserId: null,
      authorDisplayName: command.context.actorDisplayName,
      authorUserId: command.context.actorUserId,
      createdAt: now,
      deletedAt: null,
      id: generateUuidV7(),
      linkedTask: options.isLinkedCopy
        ? {
            id: sourceTask.id,
            workspaceId: sourceTask.workspaceId,
          }
        : null,
      project: '',
      projectId: null,
      remindBeforeStart: undefined,
      reminderOffsets: undefined,
      requiresConfirmation: false,
      sourceWorkspace: options.isLinkedCopy
        ? {
            id: sourceTask.workspaceId,
            name: command.context.workspaceName ?? 'Shared workspace',
          }
        : null,
      sphereId: null,
      updatedAt: now,
      version: 1,
      workspaceId: command.targetWorkspace.id,
    }
  }

  private createTargetContext(
    command: CopyTaskToPersonalCommand | MoveTaskToPersonalCommand,
  ): CreateTaskCommand['context'] {
    return {
      ...command.context,
      groupRole: null,
      personalWorkspace: command.context.personalWorkspace,
      role: 'owner',
      workspaceId: command.targetWorkspace.id,
      workspaceKind: 'personal',
      workspaceName: command.targetWorkspace.name,
    }
  }

  private propagateLinkedTaskStatus(
    command: UpdateTaskStatusCommand,
    task: StoredTaskRecord,
  ): void {
    const rootTaskId = task.linkedTask?.id ?? task.id
    const relatedTasks = [...this.tasks.values()].filter(
      (candidate) =>
        candidate.deletedAt === null &&
        candidate.id !== task.id &&
        (candidate.id === rootTaskId ||
          candidate.linkedTask?.id === rootTaskId),
    )

    for (const relatedTask of relatedTasks) {
      if (relatedTask.status === task.status) {
        continue
      }

      const nextTask = applyTaskStatus(relatedTask, command.status)
      this.tasks.set(nextTask.id, nextTask)
      this.appendTaskEvent(
        {
          context: {
            ...command.context,
            workspaceId: nextTask.workspaceId,
          },
        },
        {
          eventType: 'task.status_changed',
          payload: {
            status: nextTask.status,
            version: nextTask.version,
          },
          taskId: nextTask.id,
        },
      )
    }
  }
}
