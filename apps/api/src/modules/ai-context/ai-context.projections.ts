import {
  addDateDays,
  type CleaningListResponse,
  type CleaningTodayResponse,
  getDateKeyInTimeZone,
  getDisplayedTaskSchedule,
  getIsoWeekStartDate,
  getTodayDate,
  type SelfCareHistoryResponse,
  type SelfCareTodayItem,
  type Task,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import { sortImportantFirst } from './ai-context.compact.js'
import type { LoadedContext } from './ai-context.service.js'
import type {
  AiCalendarEvent,
  AiCleaningOverdueZoneGroup,
  AiCleaningTask,
  AiFlexibleGoalContext,
  AiFlexibleGoalSummary,
  AiHabitItem,
  AiLoadLevel,
  AiLoadReason,
  AiOverdueItemsByDomain,
  AiOverdueSummary,
  AiSelfCareDuplicate,
  AiSelfCareItem,
  AiShoppingItem,
  AiSuggestedMode,
  AiTaskGroup,
  AiTaskItem,
  OverloadContext,
  SearchPlannerParams,
  TodayContext,
} from './ai-context.types.js'
import { AiContextValidationError } from './ai-context.validation.js'
import { getAiDateRangeError } from './ai-context.validation.js'
const DEFAULT_TIMEZONE = 'Europe/Astrakhan'

export function taskInDisplayTimeZone(task: Task, timezone: string) {
  return { ...task, ...getDisplayedTaskSchedule(task, timezone) }
}

export function mapTaskItem(
  task: ReturnType<typeof taskInDisplayTimeZone>,
  today: string,
): AiTaskItem {
  return {
    area: task.project || task.sphereId || null,
    completedAt: task.completedAt,
    dueDate: task.dueDate,
    plannedDate: task.plannedDate,
    ...(task.plannedDate && task.plannedStartTime
      ? {
          plannedStartTime: task.plannedStartTime,
          plannedEndTime: task.plannedEndTime,
          ...(task.plannedEndDate && task.plannedEndDate !== task.plannedDate
            ? { plannedEndDate: task.plannedEndDate }
            : {}),
        }
      : {}),
    importance: task.importance,
    isFlexible: isFlexibleTask(task),
    obligation: task.necessity,
    priority:
      task.importance === 'important' || task.urgency === 'urgent'
        ? 'high'
        : isLowEnergyTask(task)
          ? 'low'
          : 'normal',
    resource: task.resource,
    resourceImpact: readTaskResourceImpact(task.resource),
    resourceMagnitude:
      typeof task.resource === 'number' ? Math.abs(task.resource) : null,
    snippet: buildTaskSnippet(task),
    source: 'tasks',
    status: isTaskOverdue(task, today)
      ? 'overdue'
      : task.status === 'archived'
        ? 'cancelled'
        : task.status,
    tags: task.project ? [task.project] : [],
    title: task.title,
    urgency: task.urgency,
  }
}

function readTaskResourceImpact(
  resource: Task['resource'],
): NonNullable<AiTaskItem['resourceImpact']> {
  if (typeof resource !== 'number') {
    return 'unknown'
  }

  if (resource < 0) {
    return 'drain'
  }

  if (resource > 0) {
    return 'restore'
  }

  return 'neutral'
}

export function mapTaskCalendarEvent(
  task: Task,
  timezone: string,
): AiCalendarEvent {
  const { plannedDate, plannedStartTime, plannedEndDate, plannedEndTime } =
    getDisplayedTaskSchedule(task, timezone)
  return {
    end:
      plannedEndDate && plannedEndTime
        ? `${plannedEndDate}T${plannedEndTime}:00`
        : null,
    location: null,
    source: 'calendar',
    start:
      plannedDate && plannedStartTime
        ? `${plannedDate}T${plannedStartTime}:00`
        : (plannedDate ?? task.dueDate ?? task.createdAt),
    timezone,
    title: task.title,
  }
}

function mapCleaningTask(
  item: CleaningTodayResponse['items'][number],
): AiCleaningTask {
  return {
    date: item.state.nextDueAt,
    source: 'cleaning',
    status: item.isOverdue ? 'overdue' : item.isDue ? 'todo' : 'done',
    title: item.task.title,
    zone: item.zone?.title ?? null,
  }
}

export function mapCleaningContext(
  result: CleaningTodayResponse,
  snapshot: CleaningListResponse | null,
  from: string,
  to: string,
): LoadedContext['cleaning'] {
  return {
    completed: snapshot ? mapCompletedCleaningTasks(snapshot, from, to) : [],
    overdue: result.accumulatedItems.map(mapCleaningTask),
    tasks: [...result.items, ...(result.generalItems ?? [])].map(
      mapCleaningTask,
    ),
    todayZone:
      result.zones.find((zone) => zone.dayOfWeek === result.dayOfWeek)?.title ??
      null,
  }
}

export function mapCompletedCleaningTasks(
  snapshot: CleaningListResponse,
  from: string,
  to: string,
): AiCleaningTask[] {
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const zoneById = new Map(snapshot.zones.map((zone) => [zone.id, zone]))

  return dedupeCleaningItems(
    snapshot.history.flatMap((historyItem): AiCleaningTask[] => {
      if (
        historyItem.action !== 'completed' ||
        !matchesDateRange(historyItem.date, from, to)
      ) {
        return []
      }

      const task = taskById.get(historyItem.taskId)

      if (!task) {
        return []
      }

      const zoneId = historyItem.zoneId ?? task.zoneId
      const zone = zoneId ? zoneById.get(zoneId) : undefined

      return [
        {
          completedAt: historyItem.createdAt,
          date: historyItem.date,
          source: 'cleaning',
          status: 'done',
          title: task.title,
          zone: zone?.title ?? null,
        },
      ]
    }),
  )
}

export function mapCompletedSelfCareHistory(
  history: SelfCareHistoryResponse,
  timezone: string,
): AiSelfCareItem[] {
  const itemsById = new Map(history.items.map((item) => [item.id, item]))

  return filterSelfCareItemsForAi(
    history.completions
      .filter((completion) => completion.status === 'done')
      .map((completion) => {
        const item = itemsById.get(completion.itemId)

        return {
          category: item?.category ?? null,
          date: getDateKeyInTimeZone(completion.completedAt, timezone),
          plannedDate: completion.scheduledFor,
          source: 'selfcare' as const,
          status: 'done',
          title: item?.title ?? 'Self-care item',
          type: item?.type ?? null,
        }
      }),
  )
}

export function mapSelfCareTodayItem(
  item: SelfCareTodayItem,
  status: AiSelfCareItem['status'],
): AiSelfCareItem {
  return {
    category: item.item.category,
    date:
      item.occurrence?.scheduledFor ?? item.completion?.scheduledFor ?? null,
    source: 'selfcare',
    status,
    title: item.item.title,
    type: item.item.type,
  }
}

export function isSelfCareTodayItemVisibleForAi(
  item: SelfCareTodayItem,
): boolean {
  return (
    item.item.type !== 'habit' &&
    !item.item.migratedFromHabitId &&
    item.item.isActive &&
    !item.item.isArchived &&
    item.item.deletedAt === null
  )
}

export function isRegularSelfCareTodayItemVisibleForAi(
  item: SelfCareTodayItem,
): boolean {
  return (
    isSelfCareTodayItemVisibleForAi(item) && item.item.type !== 'flexible_goal'
  )
}

function isAiSelfCareItemVisibleForAi(item: AiSelfCareItem): boolean {
  return item.type !== 'habit' && item.type !== 'flexible_goal'
}

export function normalizeSelfCareItemsForAi(
  items: AiSelfCareItem[],
): AiSelfCareItem[] {
  return dedupeAiItems(filterSelfCareItemsForAi(items))
}

export function filterSelfCareItemsForAi(
  items: AiSelfCareItem[],
): AiSelfCareItem[] {
  return items.filter(isAiSelfCareItemVisibleForAi)
}

export function mapFlexibleGoalContexts(
  entries: SelfCareTodayItem[],
  date: string,
): AiFlexibleGoalContext[] {
  const goals = entries
    .filter(isSelfCareTodayItemVisibleForAi)
    .filter((entry) => entry.item.type === 'flexible_goal')
    .map((entry) => mapFlexibleGoalContext(entry, date))
    .filter((item): item is AiFlexibleGoalContext => item !== null)

  return dedupeFlexibleGoalContexts(goals)
}

function mapFlexibleGoalContext(
  entry: SelfCareTodayItem,
  date: string,
): AiFlexibleGoalContext | null {
  const progress = entry.flexibleProgress

  if (!progress) {
    return null
  }

  const targetCount = progress.targetCount
  const doneCount = progress.completedCount
  const remainingCount = progress.remainingCount

  return {
    category: entry.item.category,
    date,
    doneCount,
    expectedRepeats: true,
    id: `flexible-goal:${entry.item.id}:${progress.periodStart}:${progress.periodEnd}`,
    remainingCount,
    source: 'selfcare',
    status:
      doneCount >= targetCount
        ? 'done'
        : doneCount > 0
          ? 'in_progress'
          : 'planned',
    targetCount,
    title: entry.item.title,
    type: 'flexible_goal',
    unit: readFlexibleGoalUnit(entry),
  }
}

function dedupeFlexibleGoalContexts(
  goals: AiFlexibleGoalContext[],
): AiFlexibleGoalContext[] {
  const byId = new Map<string, AiFlexibleGoalContext>()

  for (const goal of goals) {
    const existing = byId.get(goal.id)

    if (!existing || goal.doneCount > existing.doneCount) {
      byId.set(goal.id, goal)
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      readFlexibleGoalStatusScore(right.status) -
        readFlexibleGoalStatusScore(left.status) ||
      left.title.localeCompare(right.title),
  )
}

export function buildFlexibleGoalSummary(
  goals: AiFlexibleGoalContext[],
): AiFlexibleGoalSummary {
  return {
    completedGoals: goals.filter((goal) => goal.status === 'done').length,
    inProgressGoals: goals.filter((goal) => goal.status === 'in_progress')
      .length,
    items: prepareItems(goals),
    totalGoals: goals.length,
  }
}

function readFlexibleGoalStatusScore(
  status: AiFlexibleGoalContext['status'],
): number {
  if (status === 'in_progress') {
    return 2
  }

  if (status === 'planned') {
    return 1
  }

  return 0
}

function readFlexibleGoalUnit(entry: SelfCareTodayItem): string | null {
  return (
    entry.lastMeasurement?.measurementUnit ?? entry.measurement?.unit ?? null
  )
}

function isSelfCareTodayItemCompleted(item: SelfCareTodayItem): boolean {
  return (
    item.completion?.status === 'done' ||
    item.occurrence?.status === 'done' ||
    Boolean(item.occurrence?.completedAt)
  )
}

export function isSelfCareTodayItemOverdue(
  item: SelfCareTodayItem,
  asOfDate: string,
): boolean {
  if (isSelfCareTodayItemCompleted(item) || isSelfCareTodayItemMissed(item)) {
    return false
  }

  const status = item.occurrence?.status ?? item.completion?.status ?? null

  return Boolean(
    (status === 'scheduled' || status === 'partial') &&
    item.occurrence?.scheduledFor &&
    item.occurrence.scheduledFor < asOfDate,
  )
}

export function isSelfCareTodayItemMissed(item: SelfCareTodayItem): boolean {
  const status = item.occurrence?.status ?? item.completion?.status ?? null

  return status === 'missed' || status === 'skipped'
}

export function isSelfCareTodayItemActivelyPlanned(
  item: SelfCareTodayItem,
): boolean {
  if (isSelfCareTodayItemCompleted(item)) {
    return false
  }

  const status = item.occurrence?.status ?? item.completion?.status ?? null

  return (
    status !== 'cancelled' &&
    status !== 'missed' &&
    status !== 'moved' &&
    status !== 'skipped'
  )
}

export function isSelfCareTodayItemRemaining(
  item: SelfCareTodayItem,
  asOfDate: string,
): boolean {
  if (!isSelfCareTodayItemActivelyPlanned(item)) {
    return false
  }

  return !isSelfCareTodayItemOverdue(item, asOfDate)
}

function buildTaskSnippet(task: Task): string | null {
  const parts = [
    task.note ? task.note : null,
    task.recurrence?.isActive ? 'recurring' : null,
    task.routine ? 'routine' : null,
  ].filter(Boolean)

  return parts.length ? parts.join(' ') : null
}

export function isActiveTask(task: Task): boolean {
  return task.status !== 'done' && task.status !== 'archived'
}

export function isTaskCompleted(task: Task): boolean {
  return task.status === 'done'
}

export function isActiveShoppingItem(item: AiShoppingItem): boolean {
  return !isCompletedShoppingItem(item)
}

export function isCompletedShoppingItem(item: AiShoppingItem): boolean {
  return item.status === 'done'
}

export function readShoppingDate(
  item: AiShoppingItem,
  timezone: string,
): string | null {
  if (isCompletedShoppingItem(item)) {
    return item.completedAt
      ? getDateKeyInTimeZone(item.completedAt, timezone)
      : null
  }

  return item.dueDate ?? null
}

export function markShoppingOverdue(
  items: AiShoppingItem[],
  asOfDate: string,
): AiShoppingItem[] {
  return items.map((item) =>
    isActiveShoppingItem(item) && item.dueDate && item.dueDate < asOfDate
      ? { ...item, status: 'overdue' }
      : item,
  )
}

function isActiveCleaningTask(item: AiCleaningTask): boolean {
  return item.status !== 'done'
}

export function countActiveCleaningTasks(
  cleaning: Pick<LoadedContext['cleaning'], 'overdue' | 'tasks'>,
): number {
  return dedupeCleaningItems([
    ...cleaning.tasks.filter(isActiveCleaningTask),
    ...cleaning.overdue,
  ]).length
}

export function isRoutineOrRecurringTask(task: Task): boolean {
  return Boolean(task.routine || task.recurrence?.isActive)
}

export function groupTaskOccurrences(tasks: Task[]): AiTaskGroup[] {
  const groups = new Map<
    string,
    { dates: Set<string>; title: string; count: number }
  >()

  for (const task of tasks) {
    const key = readTaskGroupKey(task)
    const group = groups.get(key) ?? {
      count: 0,
      dates: new Set<string>(),
      title: task.title,
    }
    const date = readTaskDate(task)

    group.count += 1

    if (date) {
      group.dates.add(date)
    }

    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({
      count: group.count,
      dates: [...group.dates].sort(),
      source: 'tasks' as const,
      title: group.title,
    }))
    .sort((left, right) => right.count - left.count)
}

function readTaskGroupKey(task: Task): string {
  if (task.routine?.seriesId) {
    return `routine:${task.routine.seriesId}`
  }

  if (task.recurrence?.seriesId) {
    return `recurrence:${task.recurrence.seriesId}`
  }

  return `task:${task.id}`
}

export function mapTaskGroupToTaskItem(group: AiTaskGroup): AiTaskItem {
  return {
    area: null,
    dueDate: null,
    plannedDate: group.dates[0] ?? null,
    completedAt: null,
    importance: 'not_important',
    obligation: 'desired',
    priority: 'normal',
    resource: null,
    resourceImpact: 'unknown',
    resourceMagnitude: null,
    snippet: `${group.count} grouped occurrence${group.count === 1 ? '' : 's'}`,
    source: 'tasks',
    status: 'todo',
    tags: ['grouped-routine'],
    title: group.title,
    urgency: 'not_urgent',
  }
}

export function dedupeTaskItems<T extends Task>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const item of items) {
    if (seen.has(item.id)) {
      continue
    }

    seen.add(item.id)
    result.push(item)
  }

  return result
}

function dedupeAiItems<
  T extends {
    date?: string | null
    source: string
    status?: string
    title: string
  },
>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const item of items) {
    const key = `${item.source}:${item.title}:${item.date ?? ''}:${
      item.status ?? ''
    }`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(item)
  }

  return result
}

export function buildSelfCarePotentialDuplicates(
  items: AiSelfCareItem[],
): AiSelfCareDuplicate[] {
  const groups = new Map<
    string,
    {
      dates: Set<string>
      statuses: Set<string>
      title: string
      type: string | null
      count: number
    }
  >()

  for (const item of items) {
    const key = `${normalizeTitle(item.title)}:${item.type ?? ''}:${
      item.date ?? ''
    }`
    const group = groups.get(key) ?? {
      count: 0,
      dates: new Set<string>(),
      statuses: new Set<string>(),
      title: item.title,
      type: item.type ?? null,
    }

    group.count += 1
    group.statuses.add(item.status)

    if (item.date) {
      group.dates.add(item.date)
    }

    groups.set(key, group)
  }

  return [...groups.values()]
    .filter((group) => group.count > 1)
    .map((group) => ({
      count: group.count,
      dates: [...group.dates].sort(),
      statuses: [...group.statuses].sort(),
      title: group.title,
      type: group.type,
    }))
    .sort((left, right) => right.count - left.count)
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function sumDomainCounts(input: {
  cleaning: number
  habits: number
  selfCare: number
  shopping: number
  tasks: number
}): number {
  return (
    input.cleaning +
    input.habits +
    input.selfCare +
    input.shopping +
    input.tasks
  )
}

export function buildOverdueSummary(input: {
  cleaning: number
  habits: number
  selfCare: number
  shopping: number
  tasks: number
}): AiOverdueSummary {
  return {
    cleaning: input.cleaning,
    habits: input.habits,
    selfcare: input.selfCare,
    shopping: input.shopping,
    tasks: input.tasks,
    total: sumDomainCounts(input),
  }
}

export function buildOverdueItemsByDomain(input: {
  cleaning: AiCleaningTask[]
  habits: AiHabitItem[]
  selfCare: AiSelfCareItem[]
  shopping: AiShoppingItem[]
  tasks: AiTaskItem[]
  todayDate: string
}): AiOverdueItemsByDomain {
  return {
    cleaning: prepareItems(input.cleaning),
    habits: prepareItems(input.habits),
    selfcare: prepareItems(input.selfCare),
    shopping: prepareItems(input.shopping),
    tasks: prepareItems(input.tasks, input.todayDate),
  }
}

export function groupCleaningOverdueByZone(
  items: AiCleaningTask[],
): AiCleaningOverdueZoneGroup[] {
  const groups = new Map<string, AiCleaningTask[]>()

  for (const item of items) {
    const zone = item.zone?.trim() || 'Без зоны'
    const groupItems = groups.get(zone) ?? []

    groupItems.push(item)
    groups.set(zone, groupItems)
  }

  return prepareItems(
    [...groups.entries()]
      .map(([zone, groupItems]) => ({
        count: groupItems.length,
        items: prepareItems(groupItems),
        zone,
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.zone.localeCompare(right.zone),
      ),
  )
}

export function buildStats(input: {
  activeCounts: {
    calendar: number
    cleaning: number
    habits: number
    selfCare: number
    shopping: number
    tasks: number
  }
  overdueByDomain: {
    cleaning: number
    habits: number
    selfCare: number
    shopping: number
    tasks: number
  }
}): NonNullable<TodayContext['stats']> {
  const activeCounts = {
    ...input.activeCounts,
    total:
      input.activeCounts.cleaning +
      input.activeCounts.habits +
      input.activeCounts.selfCare +
      input.activeCounts.shopping +
      input.activeCounts.tasks,
  }
  const overdueByDomain = {
    ...input.overdueByDomain,
    total: sumDomainCounts(input.overdueByDomain),
  }
  const totalPlannedItems =
    activeCounts.tasks +
    activeCounts.shopping +
    activeCounts.cleaning +
    activeCounts.selfCare +
    activeCounts.habits
  const reasons: string[] = []

  if (activeCounts.tasks >= 8) {
    reasons.push('Many active tasks')
  }

  if (activeCounts.calendar >= 4) {
    reasons.push('Several timed calendar blocks')
  }

  if (overdueByDomain.total > 0) {
    reasons.push('Overdue items need attention')
  }

  if (overdueByDomain.selfCare > 0 || overdueByDomain.habits > 0) {
    reasons.push('Self-care or habits have overdue items')
  }

  const score =
    activeCounts.tasks * 2 +
    activeCounts.calendar * 3 +
    activeCounts.shopping +
    activeCounts.cleaning * 2 +
    activeCounts.selfCare +
    activeCounts.habits +
    overdueByDomain.total * 4
  const loadLevel: AiLoadLevel =
    score >= 40
      ? 'critical'
      : score >= 28
        ? 'high'
        : score >= 12
          ? 'normal'
          : 'low'
  const suggestedMode: AiSuggestedMode =
    loadLevel === 'critical'
      ? 'minimum'
      : loadLevel === 'high'
        ? 'light'
        : 'normal'

  return {
    activeCounts,
    loadLevel,
    overdueByDomain,
    overdueItems: overdueByDomain.total,
    reasons,
    suggestedMode,
    totalPlannedItems,
  }
}

export function calculateLoadScore(
  stats: NonNullable<TodayContext['stats']>,
): number {
  if (!stats) {
    return 0
  }

  const base =
    (stats.totalPlannedItems + stats.activeCounts.calendar) * 2 +
    stats.overdueItems * 5 +
    stats.reasons.length * 3

  return Math.min(100, base)
}

export function buildStructuredLoadReasons(input: {
  calendarEvents: number
  cleaningOverdue: number
  habitsMissed: number
  selfcareMissed: number
  selfcareOverdue: number
  shoppingActive: number
  tasksActive: number
  tasksHighPriorityActive: number
}): AiLoadReason[] {
  const reasons: AiLoadReason[] = []

  if (input.cleaningOverdue > 0) {
    reasons.push({
      code: 'cleaning_overdue_high',
      count: input.cleaningOverdue,
      domain: 'cleaning',
      severity:
        input.cleaningOverdue >= 20
          ? 'critical'
          : input.cleaningOverdue >= 5
            ? 'high'
            : 'medium',
    })
  }

  if (input.calendarEvents >= 4) {
    reasons.push({
      code: 'calendar_blocks_many',
      count: input.calendarEvents,
      domain: 'calendar',
      severity: input.calendarEvents >= 8 ? 'high' : 'medium',
    })
  }

  if (input.selfcareOverdue > 0) {
    reasons.push({
      code: 'selfcare_overdue',
      count: input.selfcareOverdue,
      domain: 'selfcare',
      severity: input.selfcareOverdue >= 3 ? 'high' : 'medium',
    })
  }

  if (input.selfcareMissed > 0) {
    reasons.push({
      code: 'selfcare_missed',
      count: input.selfcareMissed,
      domain: 'selfcare',
      severity: input.selfcareMissed >= 3 ? 'high' : 'medium',
    })
  }

  if (input.habitsMissed > 0) {
    reasons.push({
      code: 'habits_missed',
      count: input.habitsMissed,
      domain: 'habits',
      severity: input.habitsMissed >= 3 ? 'high' : 'medium',
    })
  }

  if (input.tasksHighPriorityActive > 0) {
    reasons.push({
      code: 'tasks_high_priority_active',
      count: input.tasksHighPriorityActive,
      domain: 'tasks',
      severity: input.tasksHighPriorityActive >= 3 ? 'high' : 'medium',
    })
  }

  if (input.tasksActive >= 5) {
    reasons.push({
      code: 'tasks_active_many',
      count: input.tasksActive,
      domain: 'tasks',
      severity: input.tasksActive >= 10 ? 'high' : 'medium',
    })
  }

  if (input.shoppingActive > 0) {
    reasons.push({
      code: 'shopping_active',
      count: input.shoppingActive,
      domain: 'shopping',
      severity: input.shoppingActive >= 5 ? 'medium' : 'low',
    })
  }

  return reasons
}

export function buildBottlenecks(
  reasons: string[],
  overdueCount: number,
): string[] {
  return [
    ...reasons,
    ...(overdueCount > 0
      ? [`${overdueCount} overdue item${overdueCount === 1 ? '' : 's'}`]
      : []),
  ]
}

export function buildSimplifications(
  stats: NonNullable<TodayContext['stats']>,
): string[] {
  if (stats.loadLevel === 'low') {
    return []
  }

  return [
    'Move non-urgent tasks out of the current period',
    'Keep only one high-priority focus block',
    ...(stats.overdueItems > 0
      ? ['Handle overdue items before adding new work']
      : []),
  ]
}

export function buildOverloadBottlenecks(input: {
  cleaningCount: number
  overdueCount: number
  selfCareMissed: number
  selfCareOverdue: number
  shoppingCount: number
  tasksHighPriority: number
}): OverloadContext['bottlenecks'] {
  return [
    {
      reason: 'High-priority tasks increase planning pressure.',
      relatedItemsCount: input.tasksHighPriority,
      title: 'High-priority tasks',
    },
    {
      reason: 'Overdue items compete with current plans.',
      relatedItemsCount: input.overdueCount,
      title: 'Overdue backlog',
    },
    {
      reason: 'Household routines add fixed load.',
      relatedItemsCount: input.cleaningCount + input.shoppingCount,
      title: 'Household load',
    },
    {
      reason: 'Overdue self-care is an overload signal.',
      relatedItemsCount: input.selfCareOverdue,
      title: 'Self-care overdue',
    },
    {
      reason: 'Missed self-care is an overload signal.',
      relatedItemsCount: input.selfCareMissed,
      title: 'Self-care misses',
    },
  ].filter((item) => item.relatedItemsCount > 0)
}

export function buildSuggestedFocus(
  stats: NonNullable<TodayContext['stats']>,
): string[] {
  if (stats.loadLevel === 'critical') {
    return ['Minimum viable day', 'Overdue essentials', 'Recovery time']
  }

  if (stats.loadLevel === 'high') {
    return ['Top priority tasks', 'Light household maintenance']
  }

  return ['Normal planning']
}

export function buildSelfCareWeakSpots(missed: AiSelfCareItem[]): string[] {
  const grouped = new Map<string, number>()

  for (const item of missed) {
    const key = item.type ?? 'selfcare'
    grouped.set(key, (grouped.get(key) ?? 0) + 1)
  }

  return [...grouped.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `${type}: ${count} missed`)
    .slice(0, 5)
}

export function belongsToUser(
  task: Task & { userId?: string },
  userId: string,
): boolean {
  if (task.userId) {
    return task.userId === userId
  }

  if (task.assigneeUserId && task.assigneeUserId !== userId) {
    return false
  }

  if (task.authorUserId && task.authorUserId !== userId) {
    return false
  }

  return true
}

export function isTaskForDate(task: Task, date: string): boolean {
  return task.plannedDate === date || task.dueDate === date
}

export function isFlexibleTask(task: Task): boolean {
  return !task.plannedDate && !task.dueDate
}

export function isTaskInRange(
  task: Task,
  from: string,
  to: string,
  timezone: string,
): boolean {
  if (isTaskCompleted(task)) {
    return matchesDateRange(readTaskCompletionDate(task, timezone), from, to)
  }

  return (
    matchesDateRange(task.plannedDate, from, to) ||
    matchesDateRange(task.dueDate, from, to)
  )
}

function readTaskDate(task: Task, timezone = DEFAULT_TIMEZONE): string | null {
  return isTaskCompleted(task)
    ? readTaskCompletionDate(task, timezone)
    : (task.plannedDate ?? task.dueDate)
}

export function readTaskCompletionDate(
  task: Task,
  timezone: string,
): string | null {
  return task.completedAt
    ? getDateKeyInTimeZone(task.completedAt, timezone)
    : null
}

export function isTaskOverdue(task: Task, today: string): boolean {
  if (task.status === 'done' || task.status === 'archived') {
    return false
  }

  const date = task.dueDate ?? task.plannedDate

  return Boolean(date && date < today)
}

export function isHighPriorityTask(task: Task): boolean {
  return task.importance === 'important' || task.urgency === 'urgent'
}

export function isLowEnergyTask(task: Task): boolean {
  return task.resource !== null && task.resource >= -1
}

export function matchesSearch(item: unknown, query: string): boolean {
  return JSON.stringify(item).toLowerCase().includes(query)
}

export function matchesSearchStatus(
  status: string,
  filter: SearchPlannerParams['status'],
): boolean {
  if (!filter || filter === 'any') {
    return true
  }

  if (filter === 'todo') {
    return (
      status === 'todo' ||
      status === 'planned' ||
      status === 'in_progress' ||
      status === 'ready_for_review'
    )
  }

  return status === filter
}

export function matchesDateRange(
  date: string | null | undefined,
  from?: string,
  to?: string,
): boolean {
  if (!date) {
    return !from && !to
  }

  if (from && date < from) {
    return false
  }

  if (to && date > to) {
    return false
  }

  return true
}

export function resolveRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): [string, string] {
  validateDateRange(from, to)
  if (from && to) {
    return [from, to]
  }

  const today = getTodayDate(timezone)

  if (from && !to) {
    return [from, addDateDays(from, 6)]
  }

  if (!from && to) {
    return [addDateDays(to, -6), to]
  }

  return getWeekRange(today)
}

export function resolveOverdueAsOfDate(to: string, timezone: string): string {
  const today = getTodayDate(timezone)
  const periodEndExclusive = addDateDays(to, 1)

  return periodEndExclusive < today ? periodEndExclusive : today
}

function getWeekRange(date: string): [string, string] {
  const monday = getIsoWeekStartDate(date)
  const sunday = addDateDays(monday, 6)

  return [monday, sunday]
}

export function validateDateRange(from?: string, to?: string): void {
  const message = getAiDateRangeError(from, to)
  if (message) throw new AiContextValidationError(message)
}

export function prepareItems<T>(items: readonly T[], todayDate?: string): T[] {
  return sortImportantFirst(items, todayDate)
}

export function dedupeItems<
  T extends { date?: string | null; source: string; title: string },
>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const item of items) {
    const key = `${item.source}:${item.title}:${item.date ?? ''}`

    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

export function dedupeCleaningItems(items: AiCleaningTask[]): AiCleaningTask[] {
  const seen = new Set<string>()
  const result: AiCleaningTask[] = []

  for (const item of items) {
    const key = `${item.title}:${item.zone ?? ''}:${item.date ?? ''}:${
      item.status
    }`

    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

export function createSyntheticAuthContext(
  userId: string,
  email?: string | null,
): AuthenticatedRequestContext {
  return {
    accessToken: 'mcp-context',
    claims: {
      payload: {
        ...(email ? { email } : {}),
        role: 'authenticated',
        sub: userId,
      },
      ...(email ? { email } : {}),
      role: 'authenticated',
      sub: userId,
    },
  }
}
