import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  TaskEventFilters,
  TaskListFilters,
  TaskReadContext,
  TaskWriteContext,
  UpdateTaskCommand,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'
import type { TaskRepository } from './task.repository.js'

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  listTasks(context: TaskReadContext, filters?: TaskListFilters) {
    return this.repository.listByWorkspace(context, filters)
  }

  listTaskEvents(context: TaskReadContext, filters?: TaskEventFilters) {
    return this.repository.listEventsByWorkspace(context, filters)
  }

  createTask(context: TaskWriteContext, input: CreateTaskCommand['input']) {
    assertCanWriteTasks(context)

    return this.repository.create({ context, input })
  }

  updateTask(
    context: TaskWriteContext,
    taskId: string,
    input: UpdateTaskCommand['input'],
  ) {
    assertCanWriteTasks(context)

    const command: UpdateTaskCommand = {
      context,
      input,
      taskId,
    }

    if (input.expectedVersion !== undefined) {
      command.expectedVersion = input.expectedVersion
    }

    return this.repository.update(command)
  }

  setTaskStatus(
    context: TaskWriteContext,
    taskId: string,
    status: UpdateTaskStatusCommand['status'],
    expectedVersion?: number,
  ) {
    assertCanWriteTasks(context)

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
    assertCanWriteTasks(context)

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
    assertCanWriteTasks(context)

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

function assertCanWriteTasks(context: TaskWriteContext): void {
  if (context.role === 'guest') {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace role cannot write tasks.',
    )
  }
}
