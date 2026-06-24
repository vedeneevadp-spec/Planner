import {
  addDateDays,
  addDateMonthsClamped,
  getDateDistance,
  getDateKeyInTimeZone,
  getIsoWeekday as getIsoWeekdayForDateOnly,
  getIsoWeekStartDate,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import type {
  CloseTaskChainCommand,
  CreateTaskCommand,
  CreateTaskNextStageCommand,
  DeleteTaskCommand,
  DetachTaskChainCommand,
  StoredTaskRecord,
  TaskEventFilters,
  TaskListFilters,
  TaskReadContext,
  TaskWriteContext,
  UndoTaskNextStageCommand,
  UpdateTaskCommand,
  UpdateTaskScheduleCommand,
  UpdateTaskStatusCommand,
} from './task.model.js'
import type { TaskRepository } from './task.repository.js'
import {
  isActiveTaskStatus,
  normalizeTaskReminderOffsets,
  normalizeTaskSchedule,
} from './task.shared.js'

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  listTasks(context: TaskReadContext, filters?: TaskListFilters) {
    return this.repository.listByWorkspace(context, filters)
  }

  listTaskPage(context: TaskReadContext, filters?: TaskListFilters) {
    return this.repository.listPageByWorkspace(context, filters)
  }

  listTaskEvents(context: TaskReadContext, filters?: TaskEventFilters) {
    return this.repository.listEventsByWorkspace(context, filters)
  }

  createTask(context: TaskWriteContext, input: CreateTaskCommand['input']) {
    assertCanWriteTasks(context)
    assertCanUseSharedReviewWorkflow(context, input.requiresConfirmation)
    assertCanAssignTask(context, input.assigneeUserId)
    const reminderOffsets = normalizeTaskReminderOffsets(input)
    const resolvedInput = withClientReminderTimeZone(
      context,
      input,
      reminderOffsets,
    )

    assertCanUseTaskReminder(context, reminderOffsets, resolvedInput)

    return this.repository.create({ context, input: resolvedInput })
  }

  copyTaskToPersonal(
    context: TaskWriteContext,
    taskId: string,
    expectedVersion?: number,
  ) {
    assertCanWriteTasks(context)
    assertSharedWorkspaceTransferContext(context)

    return this.repository.findById(context, taskId).then((task) => {
      if (!task) {
        throw new HttpError(
          404,
          'task_not_found',
          `Task "${taskId}" was not found.`,
        )
      }

      assertCanCopySharedTaskToPersonal(context, task)

      const command = {
        context,
        task,
        targetWorkspace: requirePersonalWorkspaceTarget(context),
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      }

      return this.repository.copyToPersonal(command)
    })
  }

  moveTaskToPersonal(
    context: TaskWriteContext,
    taskId: string,
    expectedVersion?: number,
  ) {
    assertCanWriteTasks(context)
    assertSharedWorkspaceTransferContext(context)

    return this.repository.findById(context, taskId).then((task) => {
      if (!task) {
        throw new HttpError(
          404,
          'task_not_found',
          `Task "${taskId}" was not found.`,
        )
      }

      assertCanMoveSharedTaskToPersonal(context, task)

      const command = {
        context,
        task,
        targetWorkspace: requirePersonalWorkspaceTarget(context),
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      }

      return this.repository.moveToPersonal(command)
    })
  }

  updateTask(
    context: TaskWriteContext,
    taskId: string,
    input: UpdateTaskCommand['input'],
  ) {
    assertCanWriteTasks(context)
    assertCanUseSharedReviewWorkflow(context, input.requiresConfirmation)
    assertCanAssignTask(context, input.assigneeUserId)
    const reminderOffsets = normalizeTaskReminderOffsets(input)
    const resolvedInput = withClientReminderTimeZone(
      context,
      input,
      reminderOffsets,
    )

    assertCanUseTaskReminder(context, reminderOffsets, resolvedInput)

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
        input: resolvedInput,
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

      if (
        expectedVersion !== undefined &&
        task.version !== expectedVersion &&
        task.status === status
      ) {
        return task
      }

      const command: UpdateTaskStatusCommand = {
        context,
        taskId,
        status,
      }

      if (expectedVersion !== undefined) {
        command.expectedVersion = expectedVersion
      }

      let shouldCreateNextRecurringOccurrence =
        isActiveTaskStatus(task.status) && status === 'done'

      return Promise.resolve()
        .then(() => this.repository.updateStatus(command))
        .catch(async (error: unknown) => {
          if (expectedVersion !== undefined && isTaskVersionConflict(error)) {
            const currentTask = await this.repository.findById(context, taskId)

            if (currentTask?.status === status) {
              shouldCreateNextRecurringOccurrence = false

              return currentTask
            }
          }

          throw error
        })
        .then(async (updatedTask) => {
          if (shouldCreateNextRecurringOccurrence) {
            await this.createNextRecurringOccurrence(context, updatedTask)
          }

          return updatedTask
        })
    })
  }

  createNextTaskStage(
    context: TaskWriteContext,
    taskId: string,
    input: CreateTaskNextStageCommand['input'],
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

      if (input.completeCurrent) {
        assertCanManageSharedTaskStatus(context, task, 'done')
        assertCanCompleteConfirmedSharedTask(context, task, 'done')
      }

      const command: CreateTaskNextStageCommand = {
        context,
        input,
        taskId,
      }

      return this.repository.createNextStage(command)
    })
  }

  undoCreateNextTaskStage(
    context: TaskWriteContext,
    taskId: string,
    input: UndoTaskNextStageCommand['input'],
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

      const command: UndoTaskNextStageCommand = {
        context,
        input,
        taskId,
      }

      return this.repository.undoCreateNextStage(command)
    })
  }

  detachTaskFromChain(
    context: TaskWriteContext,
    taskId: string,
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

      const command: DetachTaskChainCommand = {
        context,
        taskId,
      }

      if (expectedVersion !== undefined) {
        command.expectedVersion = expectedVersion
      }

      return this.repository.detachFromChain(command)
    })
  }

  closeTaskChain(
    context: TaskWriteContext,
    taskId: string,
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

      const command: CloseTaskChainCommand = {
        context,
        taskId,
      }

      if (expectedVersion !== undefined) {
        command.expectedVersion = expectedVersion
      }

      return this.repository.closeChain(command)
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

  private async createNextRecurringOccurrence(
    context: TaskWriteContext,
    completedTask: StoredTaskRecord,
  ): Promise<void> {
    const recurrence = getTaskRecurrencePattern(
      completedTask,
      context.clientTimeZone,
    )

    if (!recurrence) {
      return
    }

    const nextPlannedDate = getNextRecurringDate(
      getRecurringReferenceDate(completedTask, context.clientTimeZone),
      recurrence,
    )

    if (!nextPlannedDate) {
      return
    }

    const workspaceTasks = await this.repository.listByWorkspace(context)
    const hasExistingNextOccurrence = workspaceTasks.some(
      (task) =>
        task.id !== completedTask.id &&
        isActiveTaskStatus(task.status) &&
        task.plannedDate === nextPlannedDate &&
        hasRecurringSeries(task, recurrence.seriesId),
    )

    if (hasExistingNextOccurrence) {
      return
    }

    await this.repository.create({
      context,
      input: {
        assigneeUserId: completedTask.assigneeUserId,
        dueDate:
          completedTask.dueDate === completedTask.plannedDate
            ? nextPlannedDate
            : null,
        icon: completedTask.icon,
        importance: completedTask.importance,
        note: completedTask.note,
        plannedDate: nextPlannedDate,
        plannedEndTime: completedTask.plannedEndTime,
        plannedStartTime: completedTask.plannedStartTime,
        project: completedTask.project,
        projectId: completedTask.projectId,
        recurrence: completedTask.recurrence,
        remindBeforeStart: completedTask.remindBeforeStart === true,
        reminderOffsets: completedTask.reminderOffsets,
        reminderTimeZone: context.clientTimeZone,
        resource: completedTask.resource,
        requiresConfirmation: completedTask.requiresConfirmation,
        routine: completedTask.routine,
        sphereId: completedTask.sphereId,
        title: completedTask.title,
        urgency: completedTask.urgency,
      },
    })
  }
}

function getTaskRecurrencePattern(
  task: StoredTaskRecord,
  timeZone?: string,
): NonNullable<StoredTaskRecord['recurrence']> | null {
  if (task.recurrence) {
    return task.recurrence.isActive ? task.recurrence : null
  }

  if (!task.routine) {
    return null
  }

  return {
    daysOfWeek: task.routine.daysOfWeek,
    endDate: null,
    frequency: task.routine.frequency,
    interval: 1,
    isActive: true,
    seriesId: task.routine.seriesId,
    startDate: task.plannedDate ?? getRecurringReferenceDate(task, timeZone),
  }
}

function hasRecurringSeries(task: StoredTaskRecord, seriesId: string): boolean {
  return (
    task.recurrence?.seriesId === seriesId ||
    task.routine?.seriesId === seriesId
  )
}

function getRecurringReferenceDate(
  task: StoredTaskRecord,
  timeZone?: string,
): string {
  const completedDate = task.completedAt
    ? getDateKeyInTimeZone(task.completedAt, timeZone ?? 'UTC')
    : getDateKeyInTimeZone(new Date(), timeZone ?? 'UTC')

  if (!task.plannedDate) {
    return completedDate
  }

  return task.plannedDate > completedDate ? task.plannedDate : completedDate
}

function getNextRecurringDate(
  referenceDate: string,
  recurrence: NonNullable<StoredTaskRecord['recurrence']>,
): string | null {
  if (recurrence.frequency === 'daily') {
    const dateKey = addDateDays(referenceDate, recurrence.interval)

    return isWithinRecurringEndDate(dateKey, recurrence.endDate)
      ? dateKey
      : null
  }

  if (recurrence.frequency === 'monthly') {
    return getNextMonthlyRecurringDate(referenceDate, recurrence)
  }

  const scheduledDays = new Set(recurrence.daysOfWeek)
  const startWeek = getIsoWeekStartDate(recurrence.startDate)
  const maxLookaheadDays = Math.max(366, recurrence.interval * 371)

  for (let offset = 1; offset <= maxLookaheadDays; offset += 1) {
    const dateKey = addDateDays(referenceDate, offset)
    const weekDistance =
      getDateDistance(startWeek, getIsoWeekStartDate(dateKey)) / 7

    if (
      dateKey >= recurrence.startDate &&
      scheduledDays.has(getIsoWeekdayForDateOnly(dateKey)) &&
      weekDistance % recurrence.interval === 0
    ) {
      return isWithinRecurringEndDate(dateKey, recurrence.endDate)
        ? dateKey
        : null
    }
  }

  return null
}

function getNextMonthlyRecurringDate(
  referenceDate: string,
  recurrence: NonNullable<StoredTaskRecord['recurrence']>,
): string | null {
  for (let offset = 0; offset <= 600; offset += recurrence.interval) {
    const dateKey = addDateMonthsClamped(recurrence.startDate, offset)

    if (dateKey > referenceDate) {
      return isWithinRecurringEndDate(dateKey, recurrence.endDate)
        ? dateKey
        : null
    }
  }

  return null
}

function isWithinRecurringEndDate(
  dateKey: string,
  endDate: string | null,
): boolean {
  return endDate === null || dateKey <= endDate
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
  reminderOffsets: number[],
  scheduleInput: {
    plannedDate: string | null
    plannedEndTime: string | null
    plannedStartTime: string | null
    reminderTimeZone?: string | undefined
  },
): void {
  if (reminderOffsets.length === 0) {
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

function withClientReminderTimeZone<
  TInput extends { reminderTimeZone?: string | undefined },
>(context: TaskWriteContext, input: TInput, reminderOffsets: number[]): TInput {
  if (
    reminderOffsets.length === 0 ||
    input.reminderTimeZone?.trim() ||
    !context.clientTimeZone
  ) {
    return input
  }

  return {
    ...input,
    reminderTimeZone: context.clientTimeZone,
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

function assertSharedWorkspaceTransferContext(context: TaskWriteContext): void {
  if (context.workspaceKind === 'shared') {
    return
  }

  throw new HttpError(
    400,
    'task_transfer_shared_workspace_required',
    'Tasks can only be copied or moved to personal workspace from a shared workspace.',
  )
}

function requirePersonalWorkspaceTarget(
  context: TaskWriteContext,
): NonNullable<TaskWriteContext['personalWorkspace']> {
  if (context.personalWorkspace?.id) {
    return context.personalWorkspace
  }

  throw new HttpError(
    400,
    'personal_workspace_not_found',
    'Personal workspace was not found for the current actor.',
  )
}

function assertCanCopySharedTaskToPersonal(
  context: TaskWriteContext,
  task: StoredTaskRecord,
): void {
  if (
    canManageSharedTask(context, task) &&
    (!task.requiresConfirmation || task.authorUserId === context.actorUserId)
  ) {
    return
  }

  throw new HttpError(
    403,
    'task_copy_to_personal_forbidden',
    'Only an actor who can manage this shared task can copy it to personal workspace. Confirmation-required tasks can only be copied by the task author.',
  )
}

function assertCanMoveSharedTaskToPersonal(
  context: TaskWriteContext,
  task: StoredTaskRecord,
): void {
  if (task.authorUserId === context.actorUserId) {
    return
  }

  throw new HttpError(
    403,
    'task_move_to_personal_forbidden',
    'Only the task author can move this task to personal workspace.',
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
    return isActiveTaskStatus(task.status)
  }

  if (status === 'ready_for_review') {
    return task.status === 'todo' || task.status === 'in_progress'
  }

  return false
}

function isTaskVersionConflict(error: unknown): error is HttpError {
  return error instanceof HttpError && error.code === 'task_version_conflict'
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
