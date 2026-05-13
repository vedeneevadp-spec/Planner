import { type CleaningTaskWithState, generateUuidV7 } from '@planner/contracts'

import type {
  StoredCleaningTaskHistoryItemRecord,
  StoredCleaningTaskRecord,
  StoredCleaningTaskStateRecord,
  StoredCleaningZoneRecord,
} from './cleaning.model.js'

export function createStoredCleaningZoneRecord(
  input: {
    dayOfWeek: number
    description: string
    id?: string | undefined
    isActive: boolean
    sortOrder?: number | undefined
    title: string
  },
  context: {
    actorUserId: string
    sortOrder: number
    workspaceId: string
  },
): StoredCleaningZoneRecord {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    dayOfWeek: input.dayOfWeek,
    deletedAt: null,
    description: input.description.trim(),
    id: input.id ?? generateUuidV7(),
    isActive: input.isActive,
    sortOrder: input.sortOrder ?? context.sortOrder,
    title: input.title.trim(),
    updatedAt: now,
    userId: context.actorUserId,
    version: 1,
    workspaceId: context.workspaceId,
  }
}

export function createStoredCleaningTaskRecord(
  input: {
    assignee: StoredCleaningTaskRecord['assignee']
    customIntervalDays: number | null
    depth: StoredCleaningTaskRecord['depth']
    description: string
    energy: StoredCleaningTaskRecord['energy']
    estimatedMinutes: number | null
    frequencyInterval: number
    frequencyType: StoredCleaningTaskRecord['frequencyType']
    id?: string | undefined
    impactScore: number
    isActive: boolean
    isSeasonal: boolean
    priority: StoredCleaningTaskRecord['priority']
    seasonMonths: number[]
    sortOrder?: number | undefined
    tags: string[]
    title: string
    zoneId: string
  },
  context: {
    actorUserId: string
    sortOrder: number
    workspaceId: string
  },
): StoredCleaningTaskRecord {
  const now = new Date().toISOString()

  return {
    assignee: input.assignee,
    createdAt: now,
    customIntervalDays: normalizeCustomIntervalDays(input),
    deletedAt: null,
    depth: input.depth,
    description: input.description.trim(),
    energy: input.energy,
    estimatedMinutes: input.estimatedMinutes,
    frequencyInterval: input.frequencyInterval,
    frequencyType: input.frequencyType,
    id: input.id ?? generateUuidV7(),
    impactScore: input.impactScore,
    isActive: input.isActive,
    isSeasonal: input.isSeasonal,
    priority: input.priority,
    seasonMonths: normalizeSeasonMonths(input.seasonMonths),
    sortOrder: input.sortOrder ?? context.sortOrder,
    tags: normalizeTags(input.tags),
    title: input.title.trim(),
    updatedAt: now,
    userId: context.actorUserId,
    version: 1,
    workspaceId: context.workspaceId,
    zoneId: input.zoneId,
  }
}

export function createStoredCleaningTaskStateRecord(
  input: {
    nextDueAt?: string | null | undefined
    taskId: string
  },
  context: {
    workspaceId: string
  },
): StoredCleaningTaskStateRecord {
  return {
    lastCompletedAt: null,
    lastPostponedAt: null,
    lastSkippedAt: null,
    nextDueAt: input.nextDueAt ?? null,
    postponeCount: 0,
    taskId: input.taskId,
    updatedAt: new Date().toISOString(),
    version: 1,
    workspaceId: context.workspaceId,
  }
}

export function createStoredCleaningHistoryItemRecord(
  input: {
    action: StoredCleaningTaskHistoryItemRecord['action']
    date: string
    note: string
    targetDate: string | null
    taskId: string
    zoneId: string
  },
  context: {
    actorUserId: string
    workspaceId: string
  },
): StoredCleaningTaskHistoryItemRecord {
  return {
    action: input.action,
    createdAt: new Date().toISOString(),
    date: input.date,
    id: generateUuidV7(),
    note: input.note.trim(),
    targetDate: input.targetDate,
    taskId: input.taskId,
    userId: context.actorUserId,
    workspaceId: context.workspaceId,
    zoneId: input.zoneId,
  }
}

export function buildCleaningTodayResponse(input: {
  date: string
  history: StoredCleaningTaskHistoryItemRecord[]
  states: StoredCleaningTaskStateRecord[]
  tasks: StoredCleaningTaskRecord[]
  zones: StoredCleaningZoneRecord[]
}) {
  const dayOfWeek = getIsoWeekday(input.date)
  const activeZones = sortCleaningZones(
    input.zones.filter((zone) => zone.isActive && zone.deletedAt === null),
  )
  const todayZones = activeZones.filter((zone) => zone.dayOfWeek === dayOfWeek)
  const todayZoneIds = new Set(todayZones.map((zone) => zone.id))
  const allItems = buildCleaningTaskItems(input)
  const items = allItems.filter(
    (item) => todayZoneIds.has(item.task.zoneId) && item.isDue,
  )
  const accumulatedItems = allItems.filter(
    (item) =>
      item.isDue &&
      (item.state.postponeCount >= 2 ||
        item.isOverdue ||
        item.reasons.includes('давно не выполнялась')),
  )
  const quickItems = items.filter(
    (item) =>
      (item.task.estimatedMinutes ?? 999) <= 15 ||
      item.task.energy === 'low' ||
      item.task.depth === 'minimum',
  )
  const urgentItems = items.filter(
    (item) =>
      item.state.postponeCount >= 2 ||
      item.task.priority === 'high' ||
      item.isOverdue,
  )
  const seasonalItems = allItems.filter(
    (item) =>
      item.isDue &&
      item.task.isSeasonal &&
      isTaskSeasonActive(item.task, input.date),
  )
  const completedTodayTaskIds = new Set(
    input.history
      .filter((item) => item.date === input.date && item.action === 'completed')
      .map((item) => item.taskId),
  )

  return {
    accumulatedItems,
    date: input.date,
    dayOfWeek,
    history: sortCleaningHistory(input.history).slice(0, 60),
    items,
    quickItems,
    seasonalItems,
    summary: {
      accumulatedCount: accumulatedItems.length,
      activeZoneCount: activeZones.length,
      completedTodayCount: completedTodayTaskIds.size,
      dueCount: items.length,
      quickCount: quickItems.length,
      seasonalCount: seasonalItems.length,
      urgentCount: urgentItems.length,
    },
    urgentItems,
    zones: todayZones,
  }
}

export function buildCleaningTaskItems(input: {
  date: string
  states: StoredCleaningTaskStateRecord[]
  tasks: StoredCleaningTaskRecord[]
  zones: StoredCleaningZoneRecord[]
}): CleaningTaskWithState[] {
  const zoneById = new Map(
    input.zones
      .filter((zone) => zone.deletedAt === null)
      .map((zone) => [zone.id, zone]),
  )
  const stateByTaskId = new Map(
    input.states.map((state) => [state.taskId, state]),
  )
  const items = input.tasks.flatMap((task): CleaningTaskWithState[] => {
    if (!task.isActive || task.deletedAt !== null) {
      return []
    }

    const zone = zoneById.get(task.zoneId)

    if (!zone || !zone.isActive) {
      return []
    }

    const state =
      stateByTaskId.get(task.id) ??
      createStoredCleaningTaskStateRecord(
        { taskId: task.id },
        { workspaceId: task.workspaceId },
      )
    const isDue = isCleaningTaskDueOnDate(task, state, input.date)
    const isOverdue = isCleaningTaskOverdueOnDate(task, state, input.date)
    const reasons = getCleaningTaskReasons(task, state, input.date, {
      isDue,
      isOverdue,
    })

    return [
      {
        isDue,
        isOverdue,
        reasons,
        score: getCleaningTaskScore(task, state, input.date, {
          isDue,
          isOverdue,
        }),
        state,
        task,
        zone,
      },
    ]
  })

  return items.sort(compareCleaningTaskItems)
}

export function sortCleaningZones(
  zones: StoredCleaningZoneRecord[],
): StoredCleaningZoneRecord[] {
  return [...zones].sort((left, right) => {
    if (left.dayOfWeek !== right.dayOfWeek) {
      return left.dayOfWeek - right.dayOfWeek
    }

    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }

    return left.title.localeCompare(right.title, 'ru')
  })
}

export function sortCleaningTasks(
  tasks: StoredCleaningTaskRecord[],
): StoredCleaningTaskRecord[] {
  return [...tasks].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }

    return left.title.localeCompare(right.title, 'ru')
  })
}

export function sortCleaningHistory(
  history: StoredCleaningTaskHistoryItemRecord[],
): StoredCleaningTaskHistoryItemRecord[] {
  const seen = new Set<string>()

  return [...history]
    .sort((left, right) => {
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date)
      }

      return right.createdAt.localeCompare(left.createdAt)
    })
    .filter((item) => {
      const key = getCleaningHistoryActionKey(item)

      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

export function getCleaningHistoryActionKey(input: {
  action: StoredCleaningTaskHistoryItemRecord['action']
  date: string
  taskId: string
}): string {
  return `${input.taskId}:${input.action}:${input.date}`
}

export function calculateNextCleaningDueDate(
  task: Pick<
    StoredCleaningTaskRecord,
    | 'customIntervalDays'
    | 'frequencyInterval'
    | 'frequencyType'
    | 'isSeasonal'
    | 'seasonMonths'
  >,
  zone: Pick<StoredCleaningZoneRecord, 'dayOfWeek'>,
  fromDate: string,
): string {
  const baseDate =
    task.frequencyType === 'monthly'
      ? addMonthsToDateKey(fromDate, task.frequencyInterval)
      : task.frequencyType === 'custom'
        ? addDaysToDateKey(
            fromDate,
            task.customIntervalDays ?? task.frequencyInterval,
          )
        : addDaysToDateKey(fromDate, task.frequencyInterval * 7)

  if (!task.isSeasonal || task.seasonMonths.length === 0) {
    return baseDate
  }

  return findNextSeasonalWeekday(baseDate, zone.dayOfWeek, task.seasonMonths)
}

export function calculateNextCleaningZoneCycleDate(
  zone: Pick<StoredCleaningZoneRecord, 'dayOfWeek'>,
  fromDate: string,
): string {
  const weekday = getIsoWeekday(fromDate)
  const rawDiff = zone.dayOfWeek - weekday
  const diff = rawDiff <= 0 ? rawDiff + 7 : rawDiff

  return addDaysToDateKey(fromDate, diff)
}

export function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function getIsoWeekday(dateKey: string): number {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  const day = date.getUTCDay()

  return day === 0 ? 7 : day
}

export function serializeDate(value: unknown): string {
  if (value instanceof Date) {
    return getDateKey(value)
  }

  return String(value)
}

export function serializeNullableDate(value: unknown): string | null {
  return value === null || value === undefined ? null : serializeDate(value)
}

export function serializeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }

  throw new Error('Unsupported timestamp value.')
}

export function serializeNullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : serializeTimestamp(value)
}

export function normalizeSeasonMonths(months: number[]): number[] {
  return [...new Set(months)]
    .filter((month) => month >= 1 && month <= 12)
    .sort((left, right) => left - right)
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}

function normalizeCustomIntervalDays(
  input: Pick<
    StoredCleaningTaskRecord,
    'customIntervalDays' | 'frequencyInterval' | 'frequencyType'
  >,
): number | null {
  if (input.frequencyType !== 'custom') {
    return null
  }

  return input.customIntervalDays ?? input.frequencyInterval
}

function compareCleaningTaskItems(
  left: CleaningTaskWithState,
  right: CleaningTaskWithState,
): number {
  if (left.score !== right.score) {
    return right.score - left.score
  }

  if (left.task.sortOrder !== right.task.sortOrder) {
    return left.task.sortOrder - right.task.sortOrder
  }

  return left.task.title.localeCompare(right.task.title, 'ru')
}

function getCleaningTaskScore(
  task: StoredCleaningTaskRecord,
  state: StoredCleaningTaskStateRecord,
  date: string,
  flags: {
    isDue: boolean
    isOverdue: boolean
  },
): number {
  const priorityWeight =
    task.priority === 'high' ? 5 : task.priority === 'normal' ? 2 : 0
  const overdueWeight = flags.isOverdue ? 7 : 0
  const dueWeight = flags.isDue ? 3 : 0
  const staleWeight =
    state.lastCompletedAt &&
    daysBetween(state.lastCompletedAt.slice(0, 10), date) >= 60
      ? 4
      : 0

  return (
    state.postponeCount * 10 +
    priorityWeight +
    overdueWeight +
    dueWeight +
    staleWeight +
    task.impactScore
  )
}

function getCleaningTaskReasons(
  task: StoredCleaningTaskRecord,
  state: StoredCleaningTaskStateRecord,
  date: string,
  flags: {
    isDue: boolean
    isOverdue: boolean
  },
): string[] {
  const reasons: string[] = []

  if (state.postponeCount >= 3) {
    reasons.push('задача давно ждёт внимания')
  } else if (state.postponeCount > 0) {
    reasons.push(`отложено ${state.postponeCount} раз`)
  }

  if (task.priority === 'high') {
    reasons.push('важная задача')
  }

  if (flags.isOverdue) {
    reasons.push('срок уже подошёл')
  }

  if (
    state.lastCompletedAt &&
    daysBetween(state.lastCompletedAt.slice(0, 10), date) >= 60
  ) {
    reasons.push('давно не выполнялась')
  }

  if (task.isSeasonal && isTaskSeasonActive(task, date)) {
    reasons.push('сезонная')
  }

  if (flags.isDue && reasons.length === 0) {
    reasons.push('подходит для текущего цикла')
  }

  return reasons
}

function isCleaningTaskDueOnDate(
  task: StoredCleaningTaskRecord,
  state: StoredCleaningTaskStateRecord,
  date: string,
): boolean {
  if (task.isSeasonal && !isTaskSeasonActive(task, date)) {
    return false
  }

  return state.nextDueAt === null || state.nextDueAt <= date
}

function isCleaningTaskOverdueOnDate(
  task: StoredCleaningTaskRecord,
  state: StoredCleaningTaskStateRecord,
  date: string,
): boolean {
  if (task.isSeasonal && !isTaskSeasonActive(task, date)) {
    return false
  }

  return state.nextDueAt !== null && state.nextDueAt < date
}

function isTaskSeasonActive(
  task: Pick<StoredCleaningTaskRecord, 'isSeasonal' | 'seasonMonths'>,
  date: string,
): boolean {
  if (!task.isSeasonal || task.seasonMonths.length === 0) {
    return true
  }

  return task.seasonMonths.includes(Number(date.slice(5, 7)))
}

function findNextSeasonalWeekday(
  fromDate: string,
  weekday: number,
  seasonMonths: number[],
): string {
  let cursor = fromDate

  for (let index = 0; index < 370; index += 1) {
    if (
      seasonMonths.includes(Number(cursor.slice(5, 7))) &&
      getIsoWeekday(cursor) === weekday
    ) {
      return cursor
    }

    cursor = addDaysToDateKey(cursor, 1)
  }

  return fromDate
}

function addDaysToDateKey(dateKey: string, amount: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)

  return getDateKey(date)
}

function addMonthsToDateKey(dateKey: string, amount: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  const originalDate = date.getUTCDate()

  date.setUTCMonth(date.getUTCMonth() + amount)

  if (date.getUTCDate() < originalDate) {
    date.setUTCDate(0)
  }

  return getDateKey(date)
}

function daysBetween(left: string, right: string): number {
  const leftTime = new Date(`${left}T12:00:00.000Z`).getTime()
  const rightTime = new Date(`${right}T12:00:00.000Z`).getTime()

  return Math.floor((rightTime - leftTime) / 86_400_000)
}
