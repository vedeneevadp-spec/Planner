import { HttpError } from '../../bootstrap/http-error.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import type {
  CreateTaskCommand,
  DeleteTaskCommand,
  StoredTaskRecord,
  TaskEventFilters,
  TaskListFilters,
  TaskReadContext,
  TaskWriteContext,
  UpdateTaskCommand,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'
import type { TaskRepository } from './task.repository.js'
import { normalizeTaskSchedule } from './task.shared.js'

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
    assertCanUseSharedReviewWorkflow(context, input.requiresConfirmation)
    assertCanAssignTask(context, input.assigneeUserId)
    assertCanUseTaskReminder(context, input.remindBeforeStart, input)

    return this.repository.create({ context, input })
  }

  updateTask(
    context: TaskWriteContext,
    taskId: string,
    input: UpdateTaskCommand['input'],
  ) {
    assertCanWriteTasks(context)
    assertCanUseSharedReviewWorkflow(context, input.requiresConfirmation)
    assertCanAssignTask(context, input.assigneeUserId)
    assertCanUseTaskReminder(context, input.remindBeforeStart, input)

    return this.repository.findById(context, taskId).then((task) => {
      if (!task) {
        throw new HttpError(
          404,
          'task_not_found',
          `Task "${taskId}" was not found.`,
        )
      }

      assertCanManageSharedTask(context, task)
      assertCanManageTaskConfirmation(context, task, input.requiresConfirmation)

      const command: UpdateTaskCommand = {
        context,
        input,
        taskId,
      }

      if (input.expectedVersion !== undefined) {
        command.expectedVersion = input.expectedVersion
      }

      return this.repository.update(command)
    })
  }

  setTaskStatus(
    context: TaskWriteContext,
    taskId: string,
    status: UpdateTaskStatusCommand['status'],
    expectedVersion?: number,
  ) {
    assertCanWriteTasks(context)
    assertCanUseSharedReviewStatus(context, status)

    return this.repository.findById(context, taskId).then((task) => {
      if (!task) {
        throw new HttpError(
          404,
          'task_not_found',
          `Task "${taskId}" was not found.`,
        )
      }

      assertCanManageSharedTaskStatus(context, task, status)
      assertCanCompleteConfirmedSharedTask(context, task, status)

      const command: UpdateTaskStatusCommand = {
        context,
        taskId,
        status,
      }

      if (expectedVersion !== undefined) {
        command.expectedVersion = expectedVersion
      }

      return this.repository.updateStatus(command)
    })
  }

  setTaskSchedule(
    context: TaskWriteContext,
    taskId: string,
    schedule: UpdateTaskScheduleCommand['schedule'],
    expectedVersion?: number,
  ) {
    assertCanWriteTasks(context)

    return this.repository.findById(context, taskId).then((task) => {
      if (!task) {
        throw new HttpError(
          404,
          'task_not_found',
          `Task "${taskId}" was not found.`,
        )
      }

      assertCanManageSharedTask(context, task)

      const command: UpdateTaskScheduleCommand = {
        context,
        taskId,
        schedule,
      }

      if (expectedVersion !== undefined) {
        command.expectedVersion = expectedVersion
      }

      return this.repository.updateSchedule(command)
    })
  }

  removeTask(
    context: TaskWriteContext,
    taskId: string,
    expectedVersion?: number,
  ) {
    assertCanWriteTasks(context)

    return Promise.resolve().then(async () => {
      const task = await this.repository.findById(context, taskId)

      if (!task) {
        throw new HttpError(
          404,
          'task_not_found',
          `Task "${taskId}" was not found.`,
        )
      }

      assertCanDeleteSharedWorkspaceTask(context, task)

      const command: DeleteTaskCommand = {
        context,
        taskId,
      }

      if (expectedVersion !== undefined) {
        command.expectedVersion = expectedVersion
      }

      return this.repository.remove(command)
    })
  }
}

function assertCanWriteTasks(context: TaskWriteContext): void {
  if (!canWriteWorkspaceContent(context)) {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace access cannot write tasks.',
    )
  }
}

function assertCanAssignTask(
  context: TaskWriteContext,
  assigneeUserId: string | null,
): void {
  if (!assigneeUserId) {
    return
  }

  if (context.workspaceKind !== 'shared') {
    throw new HttpError(
      400,
      'task_assignee_shared_workspace_required',
      'Tasks can only be assigned inside shared workspaces.',
    )
  }
}

function assertCanUseTaskReminder(
  context: TaskWriteContext,
  remindBeforeStart: boolean | undefined,
  scheduleInput: {
    plannedDate: string | null
    plannedEndTime: string | null
    plannedStartTime: string | null
    reminderTimeZone?: string | undefined
  },
): void {
  if (!remindBeforeStart) {
    return
  }

  if (context.workspaceKind !== 'personal') {
    throw new HttpError(
      400,
      'task_reminder_personal_workspace_required',
      'Task reminders are supported only inside personal workspaces.',
    )
  }

  const normalizedSchedule = normalizeTaskSchedule(scheduleInput)

  if (!normalizedSchedule.plannedDate || !normalizedSchedule.plannedStartTime) {
    throw new HttpError(
      400,
      'task_reminder_start_time_required',
      'Task reminders require both a planned date and a planned start time.',
    )
  }

  if (!scheduleInput.reminderTimeZone) {
    return
  }

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: scheduleInput.reminderTimeZone,
    }).format(new Date())
  } catch {
    throw new HttpError(
      400,
      'task_reminder_invalid_timezone',
      'Task reminder timezone is invalid.',
    )
  }
}

function assertCanUseSharedReviewWorkflow(
  context: TaskWriteContext,
  requiresConfirmation: boolean,
): void {
  if (!requiresConfirmation || context.workspaceKind === 'shared') {
    return
  }

  throw new HttpError(
    400,
    'task_confirmation_shared_workspace_required',
    'Confirmation workflow is supported only inside shared workspaces.',
  )
}

function assertCanUseSharedReviewStatus(
  context: TaskWriteContext,
  status: UpdateTaskStatusCommand['status'],
): void {
  if (status !== 'ready_for_review' || context.workspaceKind === 'shared') {
    return
  }

  throw new HttpError(
    400,
    'task_review_status_shared_workspace_required',
    'Review status is supported only inside shared workspaces.',
  )
}

function assertCanCompleteConfirmedSharedTask(
  context: TaskWriteContext,
  task: StoredTaskRecord,
  status: UpdateTaskStatusCommand['status'],
): void {
  if (
    context.workspaceKind !== 'shared' ||
    !task.requiresConfirmation ||
    status !== 'done'
  ) {
    return
  }

  if (task.authorUserId === context.actorUserId) {
    return
  }

  throw new HttpError(
    403,
    'task_confirmation_required',
    'Only the task author can complete this task when confirmation is required.',
  )
}

function assertCanManageSharedTask(
  context: TaskWriteContext,
  task: StoredTaskRecord,
): void {
  if (
    context.workspaceKind !== 'shared' ||
    canManageSharedTask(context, task)
  ) {
    return
  }

  throw new HttpError(
    403,
    'task_manage_forbidden',
    'Only the task author, workspace owner, or group admin can edit or reschedule this shared workspace task.',
  )
}

function assertCanManageSharedTaskStatus(
  context: TaskWriteContext,
  task: StoredTaskRecord,
  status: UpdateTaskStatusCommand['status'],
): void {
  if (context.workspaceKind !== 'shared') {
    return
  }

  if (
    canManageSharedTask(context, task) ||
    canAssigneeChangeSharedTaskStatus(context, task, status)
  ) {
    return
  }

  throw new HttpError(
    403,
    'task_status_forbidden',
    'Only the task author, assignee, workspace owner, or group admin can change this shared workspace task status. The assignee may only switch it to in progress or ready for review.',
  )
}

function assertCanManageTaskConfirmation(
  context: TaskWriteContext,
  task: StoredTaskRecord,
  nextRequiresConfirmation: boolean,
): void {
  if (
    context.workspaceKind !== 'shared' ||
    task.requiresConfirmation === nextRequiresConfirmation
  ) {
    return
  }

  if (task.authorUserId === context.actorUserId) {
    return
  }

  throw new HttpError(
    403,
    'task_confirmation_manage_forbidden',
    'Only the task author can change confirmation requirements.',
  )
}

function canManageSharedTask(
  context: TaskWriteContext,
  task: StoredTaskRecord,
): boolean {
  if (task.authorUserId === context.actorUserId) {
    return true
  }

  if (task.assigneeUserId === context.actorUserId) {
    return false
  }

  return context.role === 'owner' || context.groupRole === 'group_admin'
}

function canAssigneeChangeSharedTaskStatus(
  context: TaskWriteContext,
  task: StoredTaskRecord,
  status: UpdateTaskStatusCommand['status'],
): boolean {
  if (task.assigneeUserId !== context.actorUserId) {
    return false
  }

  if (status === 'in_progress') {
    return task.status !== 'done'
  }

  if (status === 'ready_for_review') {
    return task.status === 'todo' || task.status === 'in_progress'
  }

  return false
}

function assertCanDeleteSharedWorkspaceTask(
  context: TaskWriteContext,
  task: StoredTaskRecord,
): void {
  if (context.workspaceKind !== 'shared') {
    return
  }

  if (
    task.authorUserId === context.actorUserId ||
    (task.assigneeUserId !== context.actorUserId &&
      (context.role === 'owner' || context.groupRole === 'group_admin'))
  ) {
    return
  }

  throw new HttpError(
    403,
    'task_delete_forbidden',
    'Only the task author, workspace owner, or group admin can delete this task.',
  )
}
