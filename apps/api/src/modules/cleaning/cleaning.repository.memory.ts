import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CleaningReadContext,
  CreateCleaningTaskCommand,
  CreateCleaningZoneCommand,
  DeleteCleaningTaskCommand,
  DeleteCleaningZoneCommand,
  GetCleaningTodayCommand,
  RecordCleaningTaskActionCommand,
  StoredCleaningTaskHistoryItemRecord,
  StoredCleaningTaskRecord,
  StoredCleaningTaskStateRecord,
  StoredCleaningZoneRecord,
  UpdateCleaningTaskCommand,
  UpdateCleaningZoneCommand,
} from './cleaning.model.js'
import type { CleaningRepository } from './cleaning.repository.js'
import {
  buildCleaningTodayResponse,
  calculateNextCleaningDueDate,
  calculateNextCleaningZoneCycleDate,
  createStoredCleaningHistoryItemRecord,
  createStoredCleaningTaskRecord,
  createStoredCleaningTaskStateRecord,
  createStoredCleaningZoneRecord,
  getCleaningHistoryActionKey,
  normalizeSeasonMonths,
  normalizeTags,
  sortCleaningHistory,
  sortCleaningTasks,
  sortCleaningZones,
} from './cleaning.shared.js'

export class MemoryCleaningRepository implements CleaningRepository {
  private readonly history = new Map<
    string,
    StoredCleaningTaskHistoryItemRecord
  >()
  private readonly states = new Map<string, StoredCleaningTaskStateRecord>()
  private readonly tasks = new Map<string, StoredCleaningTaskRecord>()
  private readonly zones = new Map<string, StoredCleaningZoneRecord>()

  listByWorkspace(context: CleaningReadContext) {
    const zones = this.listWorkspaceZones(context.workspaceId)
    const tasks = this.listWorkspaceTasks(context.workspaceId)
    const states = this.listWorkspaceStates(context.workspaceId)
    const history = this.listWorkspaceHistory(context.workspaceId)

    return Promise.resolve({
      history,
      states,
      tasks,
      zones,
    })
  }

  getToday(command: GetCleaningTodayCommand) {
    return Promise.resolve(
      buildCleaningTodayResponse({
        date: command.date,
        history: this.listWorkspaceHistory(command.context.workspaceId),
        states: this.listWorkspaceStates(command.context.workspaceId),
        tasks: this.listWorkspaceTasks(command.context.workspaceId),
        zones: this.listWorkspaceZones(command.context.workspaceId),
      }),
    )
  }

  createZone(
    command: CreateCleaningZoneCommand,
  ): Promise<StoredCleaningZoneRecord> {
    const existingZone = command.input.id
      ? this.zones.get(command.input.id)
      : undefined

    if (
      existingZone &&
      existingZone.workspaceId === command.context.workspaceId &&
      existingZone.deletedAt === null
    ) {
      return Promise.resolve(existingZone)
    }

    const zone = createStoredCleaningZoneRecord(command.input, {
      actorUserId: command.context.actorUserId,
      sortOrder:
        command.input.sortOrder ??
        this.listWorkspaceZones(command.context.workspaceId).length,
      workspaceId: command.context.workspaceId,
    })

    this.zones.set(zone.id, zone)

    return Promise.resolve(zone)
  }

  updateZone(
    command: UpdateCleaningZoneCommand,
  ): Promise<StoredCleaningZoneRecord> {
    const zone = this.getZoneOrThrow(
      command.context.workspaceId,
      command.zoneId,
    )

    if (
      command.input.expectedVersion !== undefined &&
      command.input.expectedVersion !== zone.version
    ) {
      throw new HttpError(
        409,
        'cleaning_zone_version_conflict',
        'Cleaning zone was changed on the server.',
        {
          actualVersion: zone.version,
          expectedVersion: command.input.expectedVersion,
        },
      )
    }

    const nextZone: StoredCleaningZoneRecord = {
      ...zone,
      ...(command.input.dayOfWeek !== undefined
        ? { dayOfWeek: command.input.dayOfWeek }
        : {}),
      ...(command.input.description !== undefined
        ? { description: command.input.description.trim() }
        : {}),
      ...(command.input.isActive !== undefined
        ? { isActive: command.input.isActive }
        : {}),
      ...(command.input.sortOrder !== undefined
        ? { sortOrder: command.input.sortOrder }
        : {}),
      ...(command.input.title !== undefined
        ? { title: command.input.title.trim() }
        : {}),
      updatedAt: new Date().toISOString(),
      version: zone.version + 1,
    }

    this.zones.set(nextZone.id, nextZone)

    return Promise.resolve(nextZone)
  }

  removeZone(command: DeleteCleaningZoneCommand): Promise<void> {
    const zone = this.getZoneOrThrow(
      command.context.workspaceId,
      command.zoneId,
    )
    const deletedAt = new Date().toISOString()

    this.zones.set(zone.id, {
      ...zone,
      deletedAt,
      isActive: false,
      updatedAt: deletedAt,
      version: zone.version + 1,
    })

    for (const task of this.tasks.values()) {
      if (
        task.workspaceId === command.context.workspaceId &&
        task.zoneId === zone.id &&
        task.deletedAt === null
      ) {
        this.tasks.set(task.id, {
          ...task,
          deletedAt,
          isActive: false,
          updatedAt: deletedAt,
          version: task.version + 1,
        })
      }
    }

    return Promise.resolve()
  }

  createTask(
    command: CreateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    this.getZoneOrThrow(command.context.workspaceId, command.input.zoneId)

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

    const task = createStoredCleaningTaskRecord(command.input, {
      actorUserId: command.context.actorUserId,
      sortOrder:
        command.input.sortOrder ??
        this.listWorkspaceTasks(command.context.workspaceId).filter(
          (item) => item.zoneId === command.input.zoneId,
        ).length,
      workspaceId: command.context.workspaceId,
    })

    this.tasks.set(task.id, task)
    this.states.set(
      task.id,
      createStoredCleaningTaskStateRecord(
        { taskId: task.id },
        { workspaceId: command.context.workspaceId },
      ),
    )

    return Promise.resolve(task)
  }

  updateTask(
    command: UpdateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    const task = this.getTaskOrThrow(
      command.context.workspaceId,
      command.taskId,
    )

    if (
      command.input.expectedVersion !== undefined &&
      command.input.expectedVersion !== task.version
    ) {
      throw new HttpError(
        409,
        'cleaning_task_version_conflict',
        'Cleaning task was changed on the server.',
        {
          actualVersion: task.version,
          expectedVersion: command.input.expectedVersion,
        },
      )
    }

    if (command.input.zoneId !== undefined) {
      this.getZoneOrThrow(command.context.workspaceId, command.input.zoneId)
    }

    const nextTask: StoredCleaningTaskRecord = {
      ...task,
      ...(command.input.assignee !== undefined
        ? { assignee: command.input.assignee }
        : {}),
      ...(command.input.customIntervalDays !== undefined
        ? { customIntervalDays: command.input.customIntervalDays }
        : {}),
      ...(command.input.depth !== undefined
        ? { depth: command.input.depth }
        : {}),
      ...(command.input.description !== undefined
        ? { description: command.input.description.trim() }
        : {}),
      ...(command.input.energy !== undefined
        ? { energy: command.input.energy }
        : {}),
      ...(command.input.estimatedMinutes !== undefined
        ? { estimatedMinutes: command.input.estimatedMinutes }
        : {}),
      ...(command.input.frequencyInterval !== undefined
        ? { frequencyInterval: command.input.frequencyInterval }
        : {}),
      ...(command.input.frequencyType !== undefined
        ? {
            customIntervalDays:
              command.input.frequencyType === 'custom'
                ? (command.input.customIntervalDays ??
                  task.customIntervalDays ??
                  task.frequencyInterval)
                : null,
            frequencyType: command.input.frequencyType,
          }
        : {}),
      ...(command.input.impactScore !== undefined
        ? { impactScore: command.input.impactScore }
        : {}),
      ...(command.input.isActive !== undefined
        ? { isActive: command.input.isActive }
        : {}),
      ...(command.input.isSeasonal !== undefined
        ? { isSeasonal: command.input.isSeasonal }
        : {}),
      ...(command.input.priority !== undefined
        ? { priority: command.input.priority }
        : {}),
      ...(command.input.seasonMonths !== undefined
        ? { seasonMonths: normalizeSeasonMonths(command.input.seasonMonths) }
        : {}),
      ...(command.input.sortOrder !== undefined
        ? { sortOrder: command.input.sortOrder }
        : {}),
      ...(command.input.tags !== undefined
        ? { tags: normalizeTags(command.input.tags) }
        : {}),
      ...(command.input.title !== undefined
        ? { title: command.input.title.trim() }
        : {}),
      ...(command.input.zoneId !== undefined
        ? { zoneId: command.input.zoneId }
        : {}),
      updatedAt: new Date().toISOString(),
      version: task.version + 1,
    }

    this.tasks.set(nextTask.id, nextTask)

    return Promise.resolve(nextTask)
  }

  removeTask(command: DeleteCleaningTaskCommand): Promise<void> {
    const task = this.getTaskOrThrow(
      command.context.workspaceId,
      command.taskId,
    )
    const deletedAt = new Date().toISOString()

    this.tasks.set(task.id, {
      ...task,
      deletedAt,
      isActive: false,
      updatedAt: deletedAt,
      version: task.version + 1,
    })

    return Promise.resolve()
  }

  recordTaskAction(command: RecordCleaningTaskActionCommand) {
    const task = this.getTaskOrThrow(
      command.context.workspaceId,
      command.taskId,
    )
    const zone = this.getZoneOrThrow(command.context.workspaceId, task.zoneId)
    const currentState =
      this.states.get(task.id) ??
      createStoredCleaningTaskStateRecord(
        { taskId: task.id },
        { workspaceId: command.context.workspaceId },
      )
    const date = command.input.date ?? new Date().toISOString().slice(0, 10)
    const now = new Date().toISOString()
    const existingHistoryItem = this.findExistingActionHistoryItem({
      action: command.action,
      date,
      taskId: task.id,
      workspaceId: command.context.workspaceId,
    })

    if (existingHistoryItem) {
      return Promise.resolve({
        historyItem: existingHistoryItem,
        state: currentState,
      })
    }

    const targetDate = getActionTargetDate(command, task, zone, date)
    const nextState: StoredCleaningTaskStateRecord = {
      ...currentState,
      ...(command.action === 'completed'
        ? {
            lastCompletedAt: now,
            nextDueAt: calculateNextCleaningDueDate(task, zone, date),
            postponeCount: 0,
          }
        : {}),
      ...(command.action === 'postponed'
        ? {
            lastPostponedAt: now,
            nextDueAt: targetDate,
            postponeCount: currentState.postponeCount + 1,
          }
        : {}),
      ...(command.action === 'skipped'
        ? {
            lastSkippedAt: now,
            nextDueAt: calculateNextCleaningDueDate(task, zone, date),
          }
        : {}),
      updatedAt: now,
      version: currentState.version + 1,
    }
    const historyItem = createStoredCleaningHistoryItemRecord(
      {
        action: command.action,
        date,
        note: command.input.note,
        targetDate: command.action === 'postponed' ? targetDate : null,
        taskId: task.id,
        zoneId: zone.id,
      },
      {
        actorUserId: command.context.actorUserId,
        workspaceId: command.context.workspaceId,
      },
    )

    this.states.set(task.id, nextState)
    this.history.set(historyItem.id, historyItem)

    return Promise.resolve({
      historyItem,
      state: nextState,
    })
  }

  private listWorkspaceZones(workspaceId: string): StoredCleaningZoneRecord[] {
    return sortCleaningZones(
      [...this.zones.values()].filter(
        (zone) => zone.workspaceId === workspaceId && zone.deletedAt === null,
      ),
    )
  }

  private listWorkspaceTasks(workspaceId: string): StoredCleaningTaskRecord[] {
    return sortCleaningTasks(
      [...this.tasks.values()].filter(
        (task) => task.workspaceId === workspaceId && task.deletedAt === null,
      ),
    )
  }

  private listWorkspaceStates(
    workspaceId: string,
  ): StoredCleaningTaskStateRecord[] {
    return [...this.states.values()].filter(
      (state) => state.workspaceId === workspaceId,
    )
  }

  private listWorkspaceHistory(
    workspaceId: string,
  ): StoredCleaningTaskHistoryItemRecord[] {
    return sortCleaningHistory(
      [...this.history.values()].filter(
        (item) => item.workspaceId === workspaceId,
      ),
    )
  }

  private findExistingActionHistoryItem(input: {
    action: StoredCleaningTaskHistoryItemRecord['action']
    date: string
    taskId: string
    workspaceId: string
  }): StoredCleaningTaskHistoryItemRecord | null {
    const targetKey = getCleaningHistoryActionKey(input)

    return (
      sortCleaningHistory(
        [...this.history.values()].filter(
          (item) =>
            item.workspaceId === input.workspaceId &&
            getCleaningHistoryActionKey(item) === targetKey,
        ),
      )[0] ?? null
    )
  }

  private getZoneOrThrow(
    workspaceId: string,
    zoneId: string,
  ): StoredCleaningZoneRecord {
    const zone = this.zones.get(zoneId)

    if (!zone || zone.workspaceId !== workspaceId || zone.deletedAt) {
      throw new HttpError(
        404,
        'cleaning_zone_not_found',
        'Cleaning zone not found.',
      )
    }

    return zone
  }

  private getTaskOrThrow(
    workspaceId: string,
    taskId: string,
  ): StoredCleaningTaskRecord {
    const task = this.tasks.get(taskId)

    if (!task || task.workspaceId !== workspaceId || task.deletedAt) {
      throw new HttpError(
        404,
        'cleaning_task_not_found',
        'Cleaning task not found.',
      )
    }

    return task
  }
}

function getActionTargetDate(
  command: RecordCleaningTaskActionCommand,
  task: StoredCleaningTaskRecord,
  zone: StoredCleaningZoneRecord,
  date: string,
): string {
  if (
    (command.input.mode === 'specific_date' ||
      command.input.mode === 'another_day') &&
    command.input.targetDate
  ) {
    return command.input.targetDate
  }

  if (command.input.targetDate) {
    return command.input.targetDate
  }

  return command.input.mode === 'next_cycle'
    ? calculateNextCleaningZoneCycleDate(zone, date)
    : calculateNextCleaningDueDate(task, zone, date)
}
