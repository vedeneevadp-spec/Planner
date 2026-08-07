import { getTodayDate } from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CleaningReadContext,
  CreateCleaningTaskCommand,
  CreateCleaningZoneCommand,
  DeleteCleaningTaskCommand,
  DeleteCleaningZoneCommand,
  GetCleaningTodayCommand,
  RecordCleaningTaskActionCommand,
  SeedCleaningCommand,
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
  calculateNextGeneralCleaningDueDate,
  calculateNextGeneralCleaningPostponeDate,
  createStoredCleaningHistoryItemRecord,
  createStoredCleaningTaskRecord,
  createStoredCleaningTaskStateRecord,
  createStoredCleaningZoneRecord,
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
  private readonly operations = new Map<
    string,
    { fingerprint: string; response: unknown; type: string }
  >()
  private readonly operationLocks = new Map<string, Promise<unknown>>()

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
    return this.runOperation(command, () => this.createZoneRecord(command))
  }

  updateZone(
    command: UpdateCleaningZoneCommand,
  ): Promise<StoredCleaningZoneRecord> {
    return this.runOperation(command, () => {
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

      return nextZone
    })
  }

  removeZone(command: DeleteCleaningZoneCommand): Promise<void> {
    return this.runOperation(command, () => {
      const zone = this.getZoneOrThrow(
        command.context.workspaceId,
        command.zoneId,
      )

      assertExpectedVersion(
        zone.version,
        command.expectedVersion,
        'cleaning_zone_version_conflict',
        'Cleaning zone was changed on the server.',
      )
      assertExpectedZoneTaskVersions(
        this.listWorkspaceTasks(command.context.workspaceId).filter(
          (task) => task.zoneId === zone.id,
        ),
        command.expectedTaskVersions,
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
    })
  }

  createTask(
    command: CreateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    return this.runOperation(command, () => this.createTaskRecord(command))
  }

  updateTask(
    command: UpdateCleaningTaskCommand,
  ): Promise<StoredCleaningTaskRecord> {
    return this.runOperation(command, () => {
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

      const nextScope =
        command.input.scope ??
        (typeof command.input.zoneId === 'string' ? 'zone' : task.scope)
      const nextZoneId =
        nextScope === 'general' ? null : (command.input.zoneId ?? task.zoneId)

      if (nextScope === 'zone') {
        if (!nextZoneId) {
          throw new HttpError(
            400,
            'cleaning_zone_required',
            'Cleaning zone is required for zone-scoped cleaning tasks.',
          )
        }

        this.getZoneOrThrow(command.context.workspaceId, nextZoneId)
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
        scope: nextScope,
        ...(command.input.tags !== undefined
          ? { tags: normalizeTags(command.input.tags) }
          : {}),
        ...(command.input.title !== undefined
          ? { title: command.input.title.trim() }
          : {}),
        zoneId: nextZoneId,
        updatedAt: new Date().toISOString(),
        version: task.version + 1,
      }

      this.tasks.set(nextTask.id, nextTask)

      return nextTask
    })
  }

  removeTask(command: DeleteCleaningTaskCommand): Promise<void> {
    return this.runOperation(command, () => {
      const task = this.getTaskOrThrow(
        command.context.workspaceId,
        command.taskId,
      )

      assertExpectedVersion(
        task.version,
        command.expectedVersion,
        'cleaning_task_version_conflict',
        'Cleaning task was changed on the server.',
      )
      const deletedAt = new Date().toISOString()

      this.tasks.set(task.id, {
        ...task,
        deletedAt,
        isActive: false,
        updatedAt: deletedAt,
        version: task.version + 1,
      })
    })
  }

  recordTaskAction(command: RecordCleaningTaskActionCommand) {
    return this.runOperation(command, () => {
      const task = this.getTaskOrThrow(
        command.context.workspaceId,
        command.taskId,
      )
      const zone =
        task.scope === 'zone' && task.zoneId
          ? this.getZoneOrThrow(command.context.workspaceId, task.zoneId)
          : null
      const currentState =
        this.states.get(task.id) ??
        createStoredCleaningTaskStateRecord(
          { taskId: task.id },
          { workspaceId: command.context.workspaceId },
        )
      const date =
        command.input.date ??
        getTodayDate(command.context.clientTimeZone ?? 'UTC')
      const now = command.input.occurredAt ?? new Date().toISOString()

      assertExpectedVersion(
        task.version,
        command.input.expectedTaskVersion,
        'cleaning_task_version_conflict',
        'Cleaning task was changed on the server.',
      )
      assertExpectedVersion(
        currentState.version,
        command.input.expectedStateVersion,
        'cleaning_task_state_version_conflict',
        'Cleaning task state was changed on the server.',
      )
      const existingHistoryItem = this.findExistingActionHistoryItem({
        action: command.action,
        date,
        taskId: task.id,
        workspaceId: command.context.workspaceId,
      })

      if (existingHistoryItem) {
        if (
          command.input.expectedStateVersion !== undefined ||
          command.input.expectedTaskVersion !== undefined
        ) {
          throw new HttpError(
            409,
            'cleaning_task_action_conflict',
            'This cleaning action was already recorded for the selected day.',
            {
              actualVersion: currentState.version,
              expectedVersion: command.input.expectedStateVersion,
            },
          )
        }

        return { historyItem: existingHistoryItem, state: currentState }
      }

      const targetDate = getActionTargetDate(command, task, zone, date)
      const nextState: StoredCleaningTaskStateRecord = {
        ...currentState,
        ...(command.action === 'completed'
          ? {
              lastCompletedAt: now,
              nextDueAt:
                task.scope === 'general'
                  ? calculateNextGeneralCleaningDueDate(task, date)
                  : calculateNextCleaningDueDate(task, zone!, date),
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
              nextDueAt:
                task.scope === 'general'
                  ? calculateNextGeneralCleaningDueDate(task, date)
                  : calculateNextCleaningDueDate(task, zone!, date),
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
          zoneId: zone?.id ?? null,
        },
        {
          actorUserId: command.context.actorUserId,
          createdAt: now,
          workspaceId: command.context.workspaceId,
        },
      )

      this.states.set(task.id, nextState)
      this.history.set(historyItem.id, historyItem)

      return {
        historyItem,
        state: nextState,
      }
    })
  }

  seed(command: SeedCleaningCommand) {
    return this.runOperation(command, async () => {
      const workspaceId = command.context.workspaceId
      const snapshots = {
        history: snapshotWorkspaceMap(this.history, workspaceId),
        states: snapshotWorkspaceMap(this.states, workspaceId),
        tasks: snapshotWorkspaceMap(this.tasks, workspaceId),
        zones: snapshotWorkspaceMap(this.zones, workspaceId),
      }

      try {
        const occupiedDayById = new Map(
          this.listWorkspaceZones(command.context.workspaceId).map((zone) => [
            zone.dayOfWeek,
            zone.id,
          ]),
        )

        for (const entry of command.input.zones) {
          const occupiedZoneId = occupiedDayById.get(entry.zone.dayOfWeek)

          if (occupiedZoneId && occupiedZoneId !== entry.zone.id) {
            throw new HttpError(
              409,
              'cleaning_seed_day_conflict',
              'A cleaning zone already uses one of the seed weekdays.',
            )
          }

          const zone = this.createZoneRecord({
            context: command.context,
            input: entry.zone,
          })
          occupiedDayById.set(zone.dayOfWeek, zone.id)

          for (const input of entry.tasks) {
            if (input.zoneId !== zone.id) {
              throw new HttpError(
                400,
                'cleaning_seed_zone_mismatch',
                'Cleaning seed task zone does not match its parent zone.',
              )
            }

            this.createTaskRecord({ context: command.context, input })
          }
        }

        return this.listByWorkspace(command.context)
      } catch (error) {
        restoreWorkspaceMap(this.history, workspaceId, snapshots.history)
        restoreWorkspaceMap(this.states, workspaceId, snapshots.states)
        restoreWorkspaceMap(this.tasks, workspaceId, snapshots.tasks)
        restoreWorkspaceMap(this.zones, workspaceId, snapshots.zones)
        throw error
      }
    })
  }

  private createZoneRecord(
    command: CreateCleaningZoneCommand,
  ): StoredCleaningZoneRecord {
    const existingZone = command.input.id
      ? this.zones.get(command.input.id)
      : undefined

    if (existingZone) {
      if (
        existingZone.workspaceId === command.context.workspaceId &&
        existingZone.deletedAt === null
      ) {
        assertZoneCreateMatches(existingZone, command.input)
        return existingZone
      }

      throwCreateIdConflict('zone')
    }

    const zone = createStoredCleaningZoneRecord(command.input, {
      actorUserId: command.context.actorUserId,
      sortOrder:
        command.input.sortOrder ??
        this.listWorkspaceZones(command.context.workspaceId).length,
      workspaceId: command.context.workspaceId,
    })

    this.zones.set(zone.id, zone)

    return zone
  }

  private createTaskRecord(
    command: CreateCleaningTaskCommand,
  ): StoredCleaningTaskRecord {
    if (command.input.scope === 'zone') {
      if (!command.input.zoneId) {
        throw new HttpError(
          400,
          'cleaning_zone_required',
          'Cleaning zone is required for zone-scoped cleaning tasks.',
        )
      }

      this.getZoneOrThrow(command.context.workspaceId, command.input.zoneId)
    }

    const existingTask = command.input.id
      ? this.tasks.get(command.input.id)
      : undefined

    if (existingTask) {
      if (
        existingTask.workspaceId === command.context.workspaceId &&
        existingTask.deletedAt === null
      ) {
        assertTaskCreateMatches(existingTask, command.input)
        return existingTask
      }

      throwCreateIdConflict('task')
    }

    const task = createStoredCleaningTaskRecord(command.input, {
      actorUserId: command.context.actorUserId,
      sortOrder:
        command.input.sortOrder ??
        this.listWorkspaceTasks(command.context.workspaceId).filter((item) =>
          command.input.scope === 'general'
            ? item.scope === 'general'
            : item.zoneId === command.input.zoneId,
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

    return task
  }

  private async runOperation<T>(
    command: Pick<CreateCleaningZoneCommand, 'context' | 'operation'>,
    action: () => Promise<T> | T,
  ): Promise<T> {
    const operationScopeKey = [
      command.context.workspaceId,
      command.context.actorUserId,
    ].join(':')
    const lockKey = command.context.workspaceId
    const previous = this.operationLocks.get(lockKey) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const operation = command.operation

        if (!operation) {
          return action()
        }

        const key = `${operationScopeKey}:${operation.id}`
        const existing = this.operations.get(key)

        if (existing) {
          if (
            existing.fingerprint !== operation.fingerprint ||
            existing.type !== operation.type
          ) {
            throw new HttpError(
              409,
              'cleaning_operation_conflict',
              'The cleaning operation id was already used for another command.',
            )
          }

          return existing.response as T
        }

        const response = await action()

        this.operations.set(key, {
          fingerprint: operation.fingerprint,
          response,
          type: operation.type,
        })

        return response
      })
    this.operationLocks.set(lockKey, current)

    try {
      return await current
    } finally {
      if (this.operationLocks.get(lockKey) === current) {
        this.operationLocks.delete(lockKey)
      }
    }
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
    return (
      sortCleaningHistory(
        [...this.history.values()].filter(
          (item) =>
            item.workspaceId === input.workspaceId &&
            item.taskId === input.taskId &&
            item.date === input.date &&
            item.action === input.action,
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

function assertExpectedZoneTaskVersions(
  actualTasks: StoredCleaningTaskRecord[],
  expectedTaskVersions: Array<{ taskId: string; version: number }> | undefined,
): void {
  if (expectedTaskVersions === undefined) {
    return
  }

  const actual = actualTasks
    .map((task) => ({ taskId: task.id, version: task.version }))
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
  const expected = [...expectedTaskVersions].sort((left, right) =>
    left.taskId.localeCompare(right.taskId),
  )

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new HttpError(
      409,
      'cleaning_zone_children_conflict',
      'Cleaning tasks in this zone were changed on the server.',
      { actualTaskVersions: actual, expectedTaskVersions: expected },
    )
  }
}

function assertZoneCreateMatches(
  existing: StoredCleaningZoneRecord,
  input: CreateCleaningZoneCommand['input'],
): void {
  const matches =
    existing.dayOfWeek === input.dayOfWeek &&
    existing.description === input.description.trim() &&
    existing.isActive === input.isActive &&
    (input.sortOrder === undefined || existing.sortOrder === input.sortOrder) &&
    existing.title === input.title.trim()

  if (!matches) {
    throw new HttpError(
      409,
      'cleaning_zone_create_conflict',
      'A different cleaning zone already uses this id.',
      { actualVersion: existing.version },
    )
  }
}

function assertTaskCreateMatches(
  existing: StoredCleaningTaskRecord,
  input: CreateCleaningTaskCommand['input'],
): void {
  const matches =
    existing.assignee === input.assignee &&
    existing.customIntervalDays ===
      (input.frequencyType === 'custom'
        ? (input.customIntervalDays ?? input.frequencyInterval)
        : null) &&
    existing.depth === input.depth &&
    existing.description === input.description.trim() &&
    existing.energy === input.energy &&
    existing.estimatedMinutes === input.estimatedMinutes &&
    existing.frequencyInterval === input.frequencyInterval &&
    existing.frequencyType === input.frequencyType &&
    existing.impactScore === input.impactScore &&
    existing.isActive === input.isActive &&
    existing.isSeasonal === input.isSeasonal &&
    existing.priority === input.priority &&
    JSON.stringify(existing.seasonMonths) ===
      JSON.stringify(normalizeSeasonMonths(input.seasonMonths)) &&
    (input.sortOrder === undefined || existing.sortOrder === input.sortOrder) &&
    existing.scope === input.scope &&
    JSON.stringify(existing.tags) ===
      JSON.stringify(normalizeTags(input.tags)) &&
    existing.title === input.title.trim() &&
    existing.zoneId === input.zoneId

  if (!matches) {
    throw new HttpError(
      409,
      'cleaning_task_create_conflict',
      'A different cleaning task already uses this id.',
      { actualVersion: existing.version },
    )
  }
}

function throwCreateIdConflict(entity: 'task' | 'zone'): never {
  throw new HttpError(
    409,
    `cleaning_${entity}_create_conflict`,
    `A different cleaning ${entity} already uses this id.`,
  )
}

function assertExpectedVersion(
  actualVersion: number,
  expectedVersion: number | undefined,
  code: string,
  message: string,
): void {
  if (expectedVersion !== undefined && expectedVersion !== actualVersion) {
    throw new HttpError(409, code, message, {
      actualVersion,
      expectedVersion,
    })
  }
}

function snapshotWorkspaceMap<TKey, TValue extends { workspaceId: string }>(
  source: Map<TKey, TValue>,
  workspaceId: string,
): Map<TKey, TValue> {
  return new Map(
    [...source].filter(([, value]) => value.workspaceId === workspaceId),
  )
}

function restoreWorkspaceMap<TKey, TValue extends { workspaceId: string }>(
  target: Map<TKey, TValue>,
  workspaceId: string,
  snapshot: Map<TKey, TValue>,
): void {
  for (const [key, value] of target) {
    if (value.workspaceId === workspaceId) {
      target.delete(key)
    }
  }

  for (const [key, value] of snapshot) {
    target.set(key, value)
  }
}

function getActionTargetDate(
  command: RecordCleaningTaskActionCommand,
  task: StoredCleaningTaskRecord,
  zone: StoredCleaningZoneRecord | null,
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

  if (task.scope === 'general') {
    return calculateNextGeneralCleaningPostponeDate(date)
  }

  if (!zone) {
    throw new HttpError(
      404,
      'cleaning_zone_not_found',
      'Cleaning zone not found.',
    )
  }

  return command.input.mode === 'next_cycle'
    ? calculateNextCleaningZoneCycleDate(zone, date)
    : calculateNextCleaningDueDate(task, zone, date)
}
