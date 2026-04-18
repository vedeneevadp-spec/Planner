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
  applyTaskSchedule,
  applyTaskStatus,
  createStoredTaskRecord,
  markTaskDeleted,
  matchesTaskFilters,
  sortStoredTasks,
} from './task.shared.js'

export class MemoryTaskRepository implements TaskRepository {
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
      workspaceId: command.context.workspaceId,
    })

    this.tasks.set(task.id, task)

    return Promise.resolve(task)
  }

  updateStatus(command: UpdateTaskStatusCommand): Promise<StoredTaskRecord> {
    const task = this.getTaskOrThrow(
      command.taskId,
      command.context.workspaceId,
    )
    this.assertVersion(task, command.expectedVersion)

    const nextTask = applyTaskStatus(task, command.status)
    this.tasks.set(nextTask.id, nextTask)

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

    return Promise.resolve(nextTask)
  }

  remove(command: DeleteTaskCommand): Promise<void> {
    const task = this.getTaskOrThrow(
      command.taskId,
      command.context.workspaceId,
    )
    this.assertVersion(task, command.expectedVersion)

    this.tasks.set(task.id, markTaskDeleted(task))

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
}
