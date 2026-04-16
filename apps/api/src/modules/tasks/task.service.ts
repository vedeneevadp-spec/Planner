import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  TaskListFilters,
  TaskWriteContext,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'
import type { TaskRepository } from './task.repository.js'

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  listTasks(workspaceId: string, filters?: TaskListFilters) {
    return this.repository.listByWorkspace(workspaceId, filters)
  }

  createTask(context: TaskWriteContext, input: CreateTaskCommand['input']) {
    return this.repository.create({ context, input })
  }

  setTaskStatus(
    context: TaskWriteContext,
    taskId: string,
    status: UpdateTaskStatusCommand['status'],
    expectedVersion?: number,
  ) {
    const command: UpdateTaskStatusCommand = {
      context,
      taskId,
      status,
    }

    if (expectedVersion !== undefined) {
      command.expectedVersion = expectedVersion
    }

    return this.repository.updateStatus(command)
  }

  setTaskSchedule(
    context: TaskWriteContext,
    taskId: string,
    schedule: UpdateTaskScheduleCommand['schedule'],
    expectedVersion?: number,
  ) {
    const command: UpdateTaskScheduleCommand = {
      context,
      taskId,
      schedule,
    }

    if (expectedVersion !== undefined) {
      command.expectedVersion = expectedVersion
    }

    return this.repository.updateSchedule(command)
  }

  removeTask(
    context: TaskWriteContext,
    taskId: string,
    expectedVersion?: number,
  ) {
    const command: DeleteTaskCommand = {
      context,
      taskId,
    }

    if (expectedVersion !== undefined) {
      command.expectedVersion = expectedVersion
    }

    return this.repository.remove(command)
  }
}
