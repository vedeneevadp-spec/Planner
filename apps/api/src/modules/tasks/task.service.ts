import {
  addDateDays,
  addDateMonthsClamped,
  generateUuidV7,
  getDateDistance,
  getDateKeyInTimeZone,
  getIsoWeekday as getIsoWeekdayForDateOnly,
  getIsoWeekStartDate,
  type TaskReadModelFilters,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import { decodeTaskCursor, encodeTaskCursor } from './task.cursor.js'
import type {
  CloseTaskChainCommand,
  CompleteRecurringTaskCommand,
  CreateTaskCommand,
  CreateTaskNextStageCommand,
  DeleteTaskCommand,
  DetachTaskChainCommand,
  StoredTaskRecord,
  TaskCursorFilters,
  TaskCursorListResult,
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
  getClosedTaskCursorPriority,
  isActiveTaskStatus,
  normalizeTaskReminderOffsets,
  normalizeTaskSchedule,
  sortStoredTasks,
} from './task.shared.js'

function toTaskReadModelSource(result: {
  items: StoredTaskRecord[]
  totalCount: number
}) {
  return {
    returnedCount: result.items.length,
    totalCount: result.totalCount,
    truncated: result.items.length < result.totalCount,
  }
}

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listTasks(context: TaskReadContext, filters?: TaskListFilters) {
    return this.repository.listByWorkspace(context, filters)
  }

  listTaskPage(context: TaskReadContext, filters?: TaskListFilters) {
    return this.repository.listPageByWorkspace(context, filters)
  }

  async listTasksCursor(
    context: TaskReadContext,
    filters: TaskCursorFilters,
  ): Promise<TaskCursorListResult> {
    const anchor = decodeTaskCursor(filters.cursor, filters)
    const result = await this.repository.listCursorPageByWorkspace(context, {
      ...(anchor ? { anchor } : {}),
      ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
      dateMode: filters.dateMode,
      ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
      direction: filters.direction,
      limit: filters.limit,
      scope: filters.scope,
    })
    const lastTask = result.items.at(-1)
    const nextCursor =
      result.hasMore && lastTask
        ? encodeTaskCursor(
            {
              closedPriority:
                filters.scope === 'closed'
                  ? getClosedTaskCursorPriority(lastTask.status)
                  : null,
              createdAt: lastTask.createdAt,
              id: lastTask.id,
            },
            filters,
          )
        : null

    return {
      ...result,
      limit: filters.limit,
      nextCursor,
      returnedCount: result.items.length,
      truncated: result.hasMore,
    }
  }

  async getTaskReadModel(
    context: TaskReadContext,
    filters: TaskReadModelFilters,
  ) {
    // Read the event watermark first. Any mutation committed after this point
    // keeps a larger event id and will be replayed by incremental sync even if
    // it races one of the bounded snapshot queries below.
    const eventCursor =
      await this.repository.getLatestEventIdByWorkspace(context)
    const oldestActiveLimit = Math.ceil(filters.activeLimit / 2)
    const newestActiveLimit = filters.activeLimit - oldestActiveLimit
    const historyCursorFilters = {
      dateMode: 'relevant' as const,
      direction: 'desc' as const,
      limit: filters.historyLimit,
      scope: 'closed' as const,
    }
    const [oldestActive, newestActive, range, history] = await Promise.all([
      this.repository.listCursorPageByWorkspace(context, {
        dateMode: 'relevant',
        direction: 'asc',
        limit: oldestActiveLimit,
        scope: 'active',
      }),
      this.repository.listCursorPageByWorkspace(context, {
        dateMode: 'relevant',
        direction: 'desc',
        limit: newestActiveLimit,
        scope: 'active',
      }),
      this.repository.listCursorPageByWorkspace(context, {
        dateFrom: filters.dateFrom,
        dateMode: 'relevant',
        dateTo: filters.dateTo,
        direction: 'asc',
        limit: filters.rangeLimit,
        scope: 'all',
      }),
      this.repository.listCursorPageByWorkspace(context, {
        ...historyCursorFilters,
      }),
    ])
    const activeItemsById = new Map<string, StoredTaskRecord>()

    for (const task of [...oldestActive.items, ...newestActive.items]) {
      activeItemsById.set(task.id, task)
    }

    const active = {
      items: [...activeItemsById.values()],
      totalCount: Math.max(oldestActive.totalCount, newestActive.totalCount),
    }
    const itemsById = new Map<string, StoredTaskRecord>()

    for (const task of [...active.items, ...range.items, ...history.items]) {
      itemsById.set(task.id, task)
    }

    const sources = {
      active: toTaskReadModelSource(active),
      history: toTaskReadModelSource(history),
      range: toTaskReadModelSource(range),
    }
    const items = sortStoredTasks([...itemsById.values()])
    const lastHistoryTask = history.items.at(-1)
    const historyNextCursor =
      history.hasMore && lastHistoryTask
        ? encodeTaskCursor(
            {
              closedPriority: getClosedTaskCursorPriority(
                lastHistoryTask.status,
              ),
              createdAt: lastHistoryTask.createdAt,
              id: lastHistoryTask.id,
            },
            historyCursorFilters,
          )
        : null

    return {
      eventCursor,
      historyNextCursor,
      items,
      returnedCount: items.length,
      sources,
      totalCount: active.totalCount + history.totalCount,
      truncated:
        sources.active.truncated ||
        sources.history.truncated ||
        sources.range.truncated,
    }
  }

  async getTask(context: TaskReadContext, taskId: string) {
    const task = await this.repository.findById(context, taskId)

    if (!task) {
      throw new HttpError(
        404,
        'task_not_found',
        `Task "${taskId}" was not found.`,
      )
    }

    return task
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
        status === 'done' &&
        (isActiveTaskStatus(task.status) || task.status === 'done')
      ) {
        const nextOccurrence = buildNextRecurringOccurrence(
          context,
          task,
          this.now(),
        )

        if (nextOccurrence) {
          const recurringCommand: CompleteRecurringTaskCommand = {
            context,
            nextPlannedDate: nextOccurrence.plannedDate,
            nextTaskInput: nextOccurrence.input,
            recurrenceSeriesId: nextOccurrence.seriesId,
            taskId,
          }

          if (expectedVersion !== undefined) {
            recurringCommand.expectedVersion = expectedVersion
          }

          return this.repository.completeRecurring(recurringCommand)
        }
      }

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

      return Promise.resolve()
        .then(() => this.repository.updateStatus(command))
        .catch(async (error: unknown) => {
          if (expectedVersion !== undefined && isTaskVersionConflict(error)) {
            const currentTask = await this.repository.findById(context, taskId)

            if (currentTask?.status === status) {
              return currentTask
            }
          }

          throw error
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
}

function buildNextRecurringOccurrence(
  context: TaskWriteContext,
  task: StoredTaskRecord,
  now: Date,
): {
  input: CompleteRecurringTaskCommand['nextTaskInput']
  plannedDate: string
  seriesId: string
} | null {
  const recurrence = getTaskRecurrencePattern(task, context.clientTimeZone, now)

  if (!recurrence) {
    return null
  }

  const plannedDate = getNextRecurringDate(
    getRecurringReferenceDate(task, context.clientTimeZone, now),
    recurrence,
  )

  if (!plannedDate) {
    return null
  }

  return {
    input: {
      assigneeUserId: task.assigneeUserId,
      dueDate: task.dueDate === task.plannedDate ? plannedDate : null,
      icon: task.icon,
      id: generateUuidV7(),
      importance: task.importance,
      necessity: task.necessity,
      note: task.note,
      plannedDate,
      plannedEndTime: task.plannedEndTime,
      plannedStartTime: task.plannedStartTime,
      project: task.project,
      projectId: task.projectId,
      recurrence: task.recurrence,
      remindBeforeStart: task.remindBeforeStart === true,
      reminderOffsets: task.reminderOffsets,
      reminderTimeZone: context.clientTimeZone,
      resource: task.resource,
      requiresConfirmation: task.requiresConfirmation,
      routine: task.routine,
      sphereId: task.sphereId,
      title: task.title,
      urgency: task.urgency,
    },
    plannedDate,
    seriesId: recurrence.seriesId,
  }
}

function getTaskRecurrencePattern(
  task: StoredTaskRecord,
  timeZone?: string,
  now = new Date(),
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
    startDate:
      task.plannedDate ?? getRecurringReferenceDate(task, timeZone, now),
  }
}

function getRecurringReferenceDate(
  task: StoredTaskRecord,
  timeZone?: string,
  now = new Date(),
): string {
  const completedDate = task.completedAt
    ? getDateKeyInTimeZone(task.completedAt, timeZone ?? 'UTC')
    : getDateKeyInTimeZone(now, timeZone ?? 'UTC')

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
