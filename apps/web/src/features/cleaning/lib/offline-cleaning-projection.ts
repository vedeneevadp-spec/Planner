import {
  addDateDays,
  addDateMonthsClamped,
  type CleaningListResponse,
  type CleaningTaskHistoryAction,
  type CleaningTaskRecord,
  type CleaningTaskStateRecord,
  type CleaningTaskWithState,
  type CleaningTodayResponse,
  type CleaningZoneRecord,
  getDateDistance,
  getIsoWeekday,
} from '@planner/contracts'

import type { CleaningOfflineMutationRecord } from './offline-cleaning-mutation'
import type { CleaningServerConfirmation } from './offline-cleaning-store'

const PROJECTED_MUTATION_STATUSES = new Set(['failed', 'pending', 'syncing'])

export function projectCleaningPlan(
  confirmed: CleaningListResponse,
  mutations: CleaningOfflineMutationRecord[],
): CleaningListResponse {
  let projected = clonePlan(confirmed)
  const unavailableOperations = new Set(
    mutations
      .filter((mutation) => mutation.status === 'conflicted')
      .map((mutation) => mutation.operationId),
  )

  for (const mutation of sortMutations(mutations)) {
    if (!PROJECTED_MUTATION_STATUSES.has(mutation.status)) {
      continue
    }

    if (
      mutation.dependsOnOperationIds.some((operationId) =>
        unavailableOperations.has(operationId),
      )
    ) {
      unavailableOperations.add(mutation.operationId)
      continue
    }

    const next = applyCleaningMutation(projected, mutation)

    if (!next) {
      unavailableOperations.add(mutation.operationId)
      continue
    }

    projected = next
  }

  return sortPlan(projected)
}

export function projectCleaningToday(
  confirmed: CleaningTodayResponse,
  projectedPlan: CleaningListResponse,
): CleaningTodayResponse {
  return buildToday(projectedPlan, confirmed.date)
}

export function applyCleaningServerConfirmation(
  confirmed: CleaningListResponse,
  mutation: CleaningOfflineMutationRecord,
  confirmation: CleaningServerConfirmation,
): CleaningListResponse {
  if (confirmation.kind === 'plan' && mutation.type === 'cleaning.seed') {
    const seededZoneIds = new Set(
      mutation.input.zones.flatMap((entry) =>
        entry.zone.id ? [entry.zone.id] : [],
      ),
    )
    const seededTaskIds = new Set(
      mutation.input.zones.flatMap((entry) =>
        entry.tasks.flatMap((task) => (task.id ? [task.id] : [])),
      ),
    )

    return sortPlan({
      ...confirmed,
      states: mergeVersionedRecords(
        confirmed.states,
        confirmation.value.states.filter((state) =>
          seededTaskIds.has(state.taskId),
        ),
        (state) => state.taskId,
      ),
      tasks: mergeVersionedRecords(
        confirmed.tasks,
        confirmation.value.tasks.filter((task) => seededTaskIds.has(task.id)),
        (task) => task.id,
      ),
      zones: mergeVersionedRecords(
        confirmed.zones,
        confirmation.value.zones.filter((zone) => seededZoneIds.has(zone.id)),
        (zone) => zone.id,
      ),
    })
  }

  if (
    confirmation.kind === 'zone' &&
    (mutation.type === 'zone.create' || mutation.type === 'zone.update')
  ) {
    return sortPlan({
      ...confirmed,
      zones: replaceByVersion(
        confirmed.zones,
        confirmation.value,
        mutation.type === 'zone.create',
        (zone) => zone.id,
      ),
    })
  }

  if (
    confirmation.kind === 'task' &&
    (mutation.type === 'task.create' || mutation.type === 'task.update')
  ) {
    const hasState = confirmed.states.some(
      (state) => state.taskId === confirmation.value.id,
    )

    return sortPlan({
      ...confirmed,
      states:
        mutation.type === 'task.create' && !hasState
          ? [
              ...confirmed.states,
              createInitialState(
                confirmation.value.id,
                confirmation.value.workspaceId,
                confirmation.value.createdAt,
              ),
            ]
          : confirmed.states,
      tasks: replaceByVersion(
        confirmed.tasks,
        confirmation.value,
        mutation.type === 'task.create' && !hasState,
        (task) => task.id,
      ),
    })
  }

  if (confirmation.kind === 'action' && mutation.type === 'task.action') {
    return sortPlan({
      ...confirmed,
      history: [
        confirmation.value.historyItem,
        ...confirmed.history.filter(
          (item) =>
            item.id !== confirmation.value.historyItem.id &&
            (item.taskId !== mutation.taskId ||
              item.date !== mutation.input.date ||
              item.action !== mutation.action),
        ),
      ],
      states:
        confirmed.tasks.some((task) => task.id === mutation.taskId) ||
        confirmed.states.some((state) => state.taskId === mutation.taskId)
          ? replaceByVersion(
              confirmed.states,
              confirmation.value.state,
              true,
              (state) => state.taskId,
            )
          : confirmed.states,
    })
  }

  if (mutation.type === 'zone.delete') {
    return sortPlan({
      ...confirmed,
      tasks: confirmed.tasks.filter((task) => task.zoneId !== mutation.zoneId),
      zones: confirmed.zones.filter((zone) => zone.id !== mutation.zoneId),
    })
  }

  if (mutation.type === 'task.delete') {
    return sortPlan({
      ...confirmed,
      tasks: confirmed.tasks.filter((task) => task.id !== mutation.taskId),
    })
  }

  return confirmed
}

function applyCleaningMutation(
  plan: CleaningListResponse,
  mutation: CleaningOfflineMutationRecord,
): CleaningListResponse | null {
  if (mutation.type === 'cleaning.seed') {
    let projected = clonePlan(plan)

    for (const entry of mutation.input.zones) {
      const zoneMutation: CleaningOfflineMutationRecord = {
        ...mutation,
        entityKeys: [`zone:${entry.zone.id}`],
        input: entry.zone as typeof entry.zone & { id: string },
        type: 'zone.create',
        zoneId: entry.zone.id!,
      }
      const withZone = applyCleaningMutation(projected, zoneMutation)

      if (!withZone) {
        return null
      }

      projected = withZone

      for (const task of entry.tasks) {
        const taskMutation: CleaningOfflineMutationRecord = {
          ...mutation,
          entityKeys: [`task:${task.id}`],
          input: task as typeof task & { id: string },
          taskId: task.id!,
          type: 'task.create',
        }
        const withTask = applyCleaningMutation(projected, taskMutation)

        if (!withTask) {
          return null
        }

        projected = withTask
      }
    }

    return projected
  }

  if (mutation.type === 'zone.create') {
    const existing = plan.zones.find((zone) => zone.id === mutation.zoneId)

    if (existing) {
      return zoneMatchesCreate(existing, mutation.input) ? plan : null
    }

    return {
      ...plan,
      zones: [
        ...plan.zones,
        {
          createdAt: mutation.createdAt,
          dayOfWeek: mutation.input.dayOfWeek,
          deletedAt: null,
          description: mutation.input.description,
          id: mutation.zoneId,
          isActive: mutation.input.isActive,
          sortOrder:
            mutation.input.sortOrder ??
            Math.max(-1, ...plan.zones.map((zone) => zone.sortOrder)) + 1,
          title: mutation.input.title,
          updatedAt: mutation.createdAt,
          userId: mutation.actorUserId,
          version: 1,
          workspaceId: mutation.workspaceId,
        },
      ],
    }
  }

  if (mutation.type === 'zone.update') {
    const zone = plan.zones.find((item) => item.id === mutation.zoneId)

    if (!zone) {
      return null
    }

    if (zone.version !== mutation.expectedVersion) {
      return zone.version === mutation.expectedVersion + 1 &&
        zoneMatchesUpdate(zone, mutation.input)
        ? plan
        : null
    }

    const { expectedVersion: _expectedVersion, ...input } = mutation.input
    const updates = definedEntries(input) as Partial<CleaningZoneRecord>

    return {
      ...plan,
      zones: plan.zones.map((item) =>
        item.id === mutation.zoneId
          ? {
              ...item,
              ...updates,
              updatedAt: mutation.createdAt,
              version: item.version + 1,
            }
          : item,
      ),
    }
  }

  if (mutation.type === 'zone.delete') {
    const zone = plan.zones.find((item) => item.id === mutation.zoneId)

    if (!zone) {
      return plan
    }

    if (zone.version !== mutation.expectedVersion) {
      return null
    }

    return {
      ...plan,
      tasks: plan.tasks.filter((task) => task.zoneId !== mutation.zoneId),
      zones: plan.zones.filter((item) => item.id !== mutation.zoneId),
    }
  }

  if (mutation.type === 'task.create') {
    const existing = plan.tasks.find((task) => task.id === mutation.taskId)

    if (existing) {
      return taskMatchesCreate(existing, mutation.input) ? plan : null
    }

    if (
      mutation.input.scope === 'zone' &&
      !plan.zones.some((zone) => zone.id === mutation.input.zoneId)
    ) {
      return null
    }

    const task: CleaningTaskRecord = {
      ...mutation.input,
      createdAt: mutation.createdAt,
      deletedAt: null,
      id: mutation.taskId,
      sortOrder:
        mutation.input.sortOrder ??
        Math.max(
          -1,
          ...plan.tasks
            .filter((item) => item.zoneId === mutation.input.zoneId)
            .map((item) => item.sortOrder),
        ) + 1,
      updatedAt: mutation.createdAt,
      userId: mutation.actorUserId,
      version: 1,
      workspaceId: mutation.workspaceId,
    }

    return {
      ...plan,
      states: [
        ...plan.states,
        createInitialState(
          mutation.taskId,
          mutation.workspaceId,
          mutation.createdAt,
        ),
      ],
      tasks: [...plan.tasks, task],
    }
  }

  if (mutation.type === 'task.update') {
    const task = plan.tasks.find((item) => item.id === mutation.taskId)

    if (!task) {
      return null
    }

    if (task.version !== mutation.expectedVersion) {
      return task.version === mutation.expectedVersion + 1 &&
        taskMatchesUpdate(task, mutation.input)
        ? plan
        : null
    }

    const { expectedVersion: _expectedVersion, ...input } = mutation.input
    const updates = definedEntries(input) as Partial<CleaningTaskRecord>
    const nextScope =
      input.scope ?? (typeof input.zoneId === 'string' ? 'zone' : task.scope)
    const nextZoneId =
      nextScope === 'general' ? null : (input.zoneId ?? task.zoneId)

    if (
      nextScope === 'zone' &&
      (!nextZoneId || !plan.zones.some((zone) => zone.id === nextZoneId))
    ) {
      return null
    }

    return {
      ...plan,
      tasks: plan.tasks.map((item) =>
        item.id === mutation.taskId
          ? normalizeUpdatedTask(
              {
                ...item,
                ...updates,
                scope: nextScope,
                updatedAt: mutation.createdAt,
                version: item.version + 1,
                zoneId: nextZoneId,
              },
              input,
            )
          : item,
      ),
    }
  }

  if (mutation.type === 'task.delete') {
    const task = plan.tasks.find((item) => item.id === mutation.taskId)

    if (!task) {
      return plan
    }

    if (task.version !== mutation.expectedVersion) {
      return null
    }

    return {
      ...plan,
      tasks: plan.tasks.filter((item) => item.id !== mutation.taskId),
    }
  }

  const task = plan.tasks.find((item) => item.id === mutation.taskId)
  const state =
    plan.states.find((item) => item.taskId === mutation.taskId) ??
    createInitialState(
      mutation.taskId,
      mutation.workspaceId,
      mutation.createdAt,
    )

  if (!task || task.version !== mutation.expectedTaskVersion) {
    return null
  }

  if (state.version !== mutation.expectedStateVersion) {
    const existingHistory = plan.history.some(
      (item) =>
        item.taskId === mutation.taskId &&
        item.date === mutation.input.date &&
        item.action === mutation.action,
    )

    return state.version === mutation.expectedStateVersion + 1 &&
      existingHistory
      ? plan
      : null
  }

  if (
    plan.history.some(
      (item) =>
        item.taskId === mutation.taskId &&
        item.date === mutation.input.date &&
        item.action === mutation.action,
    )
  ) {
    return null
  }

  const zone = task.zoneId
    ? (plan.zones.find((item) => item.id === task.zoneId) ?? null)
    : null
  const targetDate = getActionTargetDate(
    mutation.action,
    mutation.input,
    task,
    zone,
  )
  const nextState: CleaningTaskStateRecord = {
    ...state,
    ...(mutation.action === 'completed'
      ? {
          lastCompletedAt: mutation.input.occurredAt,
          nextDueAt: calculateNextDueDate(task, zone, mutation.input.date),
          postponeCount: 0,
        }
      : {}),
    ...(mutation.action === 'postponed'
      ? {
          lastPostponedAt: mutation.input.occurredAt,
          nextDueAt: targetDate,
          postponeCount: state.postponeCount + 1,
        }
      : {}),
    ...(mutation.action === 'skipped'
      ? {
          lastSkippedAt: mutation.input.occurredAt,
          nextDueAt: calculateNextDueDate(task, zone, mutation.input.date),
        }
      : {}),
    updatedAt: mutation.input.occurredAt,
    version: state.version + 1,
  }

  return {
    ...plan,
    history: [
      {
        action: mutation.action,
        createdAt: mutation.input.occurredAt,
        date: mutation.input.date,
        id: mutation.operationId,
        note: mutation.input.note,
        targetDate: mutation.action === 'postponed' ? targetDate : null,
        taskId: mutation.taskId,
        userId: mutation.actorUserId,
        workspaceId: mutation.workspaceId,
        zoneId: zone?.id ?? null,
      },
      ...plan.history,
    ],
    states: replaceState(plan.states, nextState),
  }
}

function buildToday(
  plan: CleaningListResponse,
  date: string,
): CleaningTodayResponse {
  const dayOfWeek = getIsoWeekday(date)
  const activeZones = sortZones(plan.zones.filter((zone) => zone.isActive))
  const zones = activeZones.filter((zone) => zone.dayOfWeek === dayOfWeek)
  const zoneIds = new Set(zones.map((zone) => zone.id))
  const allItems = buildTaskItems(plan, date)
  const items = allItems.filter(
    (item) =>
      item.task.scope === 'zone' &&
      item.task.zoneId !== null &&
      zoneIds.has(item.task.zoneId) &&
      item.isDue,
  )
  const generalItems = allItems.filter(
    (item) => item.task.scope === 'general' && item.isDue,
  )
  const dueItems = [...items, ...generalItems]
  const accumulatedItems = allItems.filter(
    (item) => item.isDue && isAccumulated(item, date),
  )
  const quickItems = dueItems.filter(
    (item) =>
      (item.task.estimatedMinutes ?? 999) <= 15 ||
      item.task.energy === 'low' ||
      item.task.depth === 'minimum',
  )
  const seasonalItems = allItems.filter(
    (item) =>
      item.isDue && item.task.isSeasonal && isSeasonActive(item.task, date),
  )
  const urgentItems = dueItems.filter(
    (item) =>
      item.state.postponeCount >= 2 ||
      item.task.priority === 'high' ||
      item.isOverdue,
  )
  const completedTaskIds = new Set(
    plan.history
      .filter((item) => item.date === date && item.action === 'completed')
      .map((item) => item.taskId),
  )

  return {
    accumulatedItems,
    date,
    dayOfWeek,
    generalItems,
    history: sortHistory(plan.history).slice(0, 60),
    items,
    quickItems,
    seasonalItems,
    summary: {
      accumulatedCount: accumulatedItems.length,
      activeZoneCount: activeZones.length,
      completedTodayCount: completedTaskIds.size,
      dueCount: dueItems.length,
      generalCount: generalItems.length,
      quickCount: quickItems.length,
      seasonalCount: seasonalItems.length,
      urgentCount: urgentItems.length,
    },
    urgentItems,
    zones,
  }
}

function buildTaskItems(
  plan: CleaningListResponse,
  date: string,
): CleaningTaskWithState[] {
  const zones = new Map(plan.zones.map((zone) => [zone.id, zone]))
  const states = new Map(plan.states.map((state) => [state.taskId, state]))

  return plan.tasks
    .flatMap((task): CleaningTaskWithState[] => {
      if (!task.isActive) {
        return []
      }

      const zone = task.zoneId ? (zones.get(task.zoneId) ?? null) : null

      if (task.scope === 'zone' && (!zone || !zone.isActive)) {
        return []
      }

      const state =
        states.get(task.id) ??
        createInitialState(task.id, task.workspaceId, task.updatedAt)
      const isDue = isTaskDue(task, state, date)
      const isOverdue = isTaskOverdue(task, state, date)

      return [
        {
          isDue,
          isOverdue,
          score: getScore(task, state, date, { isDue, isOverdue }),
          state,
          task,
          zone: task.scope === 'general' ? null : zone,
        },
      ]
    })
    .sort(compareItems)
}

function createInitialState(
  taskId: string,
  workspaceId: string,
  updatedAt: string,
): CleaningTaskStateRecord {
  return {
    lastCompletedAt: null,
    lastPostponedAt: null,
    lastSkippedAt: null,
    nextDueAt: null,
    postponeCount: 0,
    taskId,
    updatedAt,
    version: 1,
    workspaceId,
  }
}

function replaceState(
  states: CleaningTaskStateRecord[],
  state: CleaningTaskStateRecord,
): CleaningTaskStateRecord[] {
  return states.some((item) => item.taskId === state.taskId)
    ? states.map((item) => (item.taskId === state.taskId ? state : item))
    : [...states, state]
}

function calculateNextDueDate(
  task: CleaningTaskRecord,
  zone: CleaningZoneRecord | null,
  date: string,
): string {
  const base =
    task.frequencyType === 'monthly'
      ? addDateMonthsClamped(date, task.frequencyInterval)
      : addDateDays(
          date,
          task.frequencyType === 'custom'
            ? (task.customIntervalDays ?? task.frequencyInterval)
            : task.frequencyInterval * 7,
        )

  if (!task.isSeasonal || task.seasonMonths.length === 0) {
    return base
  }

  return task.scope === 'zone' && zone
    ? findNextSeasonalWeekday(base, zone.dayOfWeek, task.seasonMonths)
    : findNextSeasonalDate(base, task.seasonMonths)
}

function getActionTargetDate(
  action: CleaningTaskHistoryAction,
  input: Extract<
    CleaningOfflineMutationRecord,
    { type: 'task.action' }
  >['input'],
  task: CleaningTaskRecord,
  zone: CleaningZoneRecord | null,
): string {
  if (action !== 'postponed') {
    return calculateNextDueDate(task, zone, input.date)
  }

  if (input.targetDate) {
    return input.targetDate
  }

  if (task.scope === 'general') {
    return addDateDays(input.date, 1)
  }

  if (!zone) {
    return input.date
  }

  if (input.mode !== 'next_cycle') {
    return calculateNextDueDate(task, zone, input.date)
  }

  const difference = zone.dayOfWeek - getIsoWeekday(input.date)
  return addDateDays(input.date, difference <= 0 ? difference + 7 : difference)
}

function replaceByVersion<T extends { version: number }>(
  items: T[],
  value: T,
  allowInsert: boolean,
  getKey: (item: T) => string,
): T[] {
  const valueKey = getKey(value)
  const current = items.find((item) => getKey(item) === valueKey)

  if (!current) {
    return allowInsert ? [...items, value] : items
  }

  if (current.version > value.version) {
    return items
  }

  return items.map((item) => (getKey(item) === valueKey ? value : item))
}

function mergeVersionedRecords<T extends { version: number }>(
  current: T[],
  incoming: T[],
  getKey: (item: T) => string,
): T[] {
  return incoming.reduce(
    (items, value) => replaceByVersion(items, value, true, getKey),
    current,
  )
}

function definedEntries<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>
}

function normalizeUpdatedTask(
  task: CleaningTaskRecord,
  input: Extract<
    CleaningOfflineMutationRecord,
    { type: 'task.update' }
  >['input'],
): CleaningTaskRecord {
  if (input.frequencyType === undefined) {
    return task
  }

  return {
    ...task,
    customIntervalDays:
      input.frequencyType === 'custom'
        ? (input.customIntervalDays ??
          task.customIntervalDays ??
          task.frequencyInterval)
        : null,
  }
}

function zoneMatchesCreate(
  zone: CleaningZoneRecord,
  input: Extract<
    CleaningOfflineMutationRecord,
    { type: 'zone.create' }
  >['input'],
): boolean {
  return (
    zone.dayOfWeek === input.dayOfWeek &&
    zone.description === input.description &&
    zone.isActive === input.isActive &&
    (input.sortOrder === undefined || zone.sortOrder === input.sortOrder) &&
    zone.title === input.title
  )
}

function zoneMatchesUpdate(
  zone: CleaningZoneRecord,
  input: Extract<
    CleaningOfflineMutationRecord,
    { type: 'zone.update' }
  >['input'],
): boolean {
  return Object.entries(input).every(
    ([key, value]) =>
      key === 'expectedVersion' || zone[key as keyof typeof zone] === value,
  )
}

function taskMatchesCreate(
  task: CleaningTaskRecord,
  input: Extract<
    CleaningOfflineMutationRecord,
    { type: 'task.create' }
  >['input'],
): boolean {
  return Object.entries(input).every(([key, value]) =>
    key === 'sortOrder'
      ? value === undefined || task.sortOrder === value
      : Array.isArray(value)
        ? JSON.stringify(task[key as keyof typeof task]) ===
          JSON.stringify(value)
        : task[key as keyof typeof task] === value,
  )
}

function taskMatchesUpdate(
  task: CleaningTaskRecord,
  input: Extract<
    CleaningOfflineMutationRecord,
    { type: 'task.update' }
  >['input'],
): boolean {
  return Object.entries(input).every(
    ([key, value]) =>
      key === 'expectedVersion' ||
      (Array.isArray(value)
        ? JSON.stringify(task[key as keyof typeof task]) ===
          JSON.stringify(value)
        : task[key as keyof typeof task] === value),
  )
}

function sortPlan(plan: CleaningListResponse): CleaningListResponse {
  return {
    ...plan,
    history: sortHistory(plan.history),
    tasks: [...plan.tasks].sort((left, right) =>
      left.sortOrder !== right.sortOrder
        ? left.sortOrder - right.sortOrder
        : left.title.localeCompare(right.title, 'ru'),
    ),
    zones: sortZones(plan.zones),
  }
}

function sortZones(zones: CleaningZoneRecord[]): CleaningZoneRecord[] {
  return [...zones].sort((left, right) =>
    left.dayOfWeek !== right.dayOfWeek
      ? left.dayOfWeek - right.dayOfWeek
      : left.sortOrder !== right.sortOrder
        ? left.sortOrder - right.sortOrder
        : left.title.localeCompare(right.title, 'ru'),
  )
}

function sortHistory(plan: CleaningListResponse['history']) {
  const seen = new Set<string>()

  return [...plan]
    .sort((left, right) =>
      left.date !== right.date
        ? right.date.localeCompare(left.date)
        : right.createdAt.localeCompare(left.createdAt),
    )
    .filter((item) => {
      const key = `${item.taskId}:${item.date}:${item.action}`

      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

function sortMutations(
  mutations: CleaningOfflineMutationRecord[],
): CleaningOfflineMutationRecord[] {
  return [...mutations].sort(
    (left, right) =>
      (left.sequence ?? Number.MAX_SAFE_INTEGER) -
        (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.operationId.localeCompare(right.operationId),
  )
}

function clonePlan(plan: CleaningListResponse): CleaningListResponse {
  return {
    history: plan.history.map((item) => ({ ...item })),
    states: plan.states.map((item) => ({ ...item })),
    tasks: plan.tasks.map((item) => ({
      ...item,
      seasonMonths: [...item.seasonMonths],
      tags: [...item.tags],
    })),
    zones: plan.zones.map((item) => ({ ...item })),
  }
}

function isTaskDue(
  task: CleaningTaskRecord,
  state: CleaningTaskStateRecord,
  date: string,
): boolean {
  return (
    isSeasonActive(task, date) &&
    (state.nextDueAt === null || state.nextDueAt <= date)
  )
}

function isTaskOverdue(
  task: CleaningTaskRecord,
  state: CleaningTaskStateRecord,
  date: string,
): boolean {
  return (
    isSeasonActive(task, date) &&
    state.nextDueAt !== null &&
    state.nextDueAt < date
  )
}

function isSeasonActive(
  task: Pick<CleaningTaskRecord, 'isSeasonal' | 'seasonMonths'>,
  date: string,
): boolean {
  return (
    !task.isSeasonal ||
    task.seasonMonths.length === 0 ||
    task.seasonMonths.includes(Number(date.slice(5, 7)))
  )
}

function getScore(
  task: CleaningTaskRecord,
  state: CleaningTaskStateRecord,
  date: string,
  flags: { isDue: boolean; isOverdue: boolean },
): number {
  const priority =
    task.priority === 'high' ? 5 : task.priority === 'normal' ? 2 : 0
  return (
    state.postponeCount * 10 +
    priority +
    (flags.isOverdue ? 7 : 0) +
    (flags.isDue ? 3 : 0) +
    (isStale(state, date) ? 4 : 0) +
    task.impactScore
  )
}

function isAccumulated(item: CleaningTaskWithState, date: string): boolean {
  if (
    item.state.postponeCount >= 2 ||
    item.isOverdue ||
    isStale(item.state, date)
  ) {
    return true
  }

  if (
    item.state.nextDueAt !== null ||
    item.state.lastCompletedAt !== null ||
    item.state.lastPostponedAt !== null ||
    item.state.lastSkippedAt !== null ||
    item.state.postponeCount > 0
  ) {
    return false
  }

  return calculateInitialDueDate(item.task, item.zone) < date
}

function calculateInitialDueDate(
  task: CleaningTaskRecord,
  zone: CleaningZoneRecord | null,
): string {
  const createdDate = task.createdAt.slice(0, 10)

  if (task.scope === 'general') {
    return task.isSeasonal && task.seasonMonths.length > 0
      ? findNextSeasonalDate(createdDate, task.seasonMonths)
      : createdDate
  }

  if (!zone) {
    return createdDate
  }

  const difference = zone.dayOfWeek - getIsoWeekday(createdDate)
  const zoneDate = addDateDays(
    createdDate,
    difference < 0 ? difference + 7 : difference,
  )
  return task.isSeasonal && task.seasonMonths.length > 0
    ? findNextSeasonalWeekday(zoneDate, zone.dayOfWeek, task.seasonMonths)
    : zoneDate
}

function isStale(state: CleaningTaskStateRecord, date: string): boolean {
  return Boolean(
    state.lastCompletedAt &&
    getDateDistance(state.lastCompletedAt.slice(0, 10), date) >= 60,
  )
}

function compareItems(
  left: CleaningTaskWithState,
  right: CleaningTaskWithState,
): number {
  return (
    right.score - left.score ||
    left.task.sortOrder - right.task.sortOrder ||
    left.task.title.localeCompare(right.task.title, 'ru')
  )
}

function findNextSeasonalWeekday(
  fromDate: string,
  weekday: number,
  months: number[],
): string {
  let cursor = fromDate

  for (let index = 0; index < 370; index += 1) {
    if (
      months.includes(Number(cursor.slice(5, 7))) &&
      getIsoWeekday(cursor) === weekday
    ) {
      return cursor
    }

    cursor = addDateDays(cursor, 1)
  }

  return fromDate
}

function findNextSeasonalDate(fromDate: string, months: number[]): string {
  let cursor = fromDate

  for (let index = 0; index < 370; index += 1) {
    if (months.includes(Number(cursor.slice(5, 7)))) {
      return cursor
    }

    cursor = addDateDays(cursor, 1)
  }

  return fromDate
}
