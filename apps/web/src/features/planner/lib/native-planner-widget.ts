import { App } from '@capacitor/app'
import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import {
  type CleaningTaskWithState,
  type CleaningTodayResponse,
  NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS,
  NATIVE_PLANNER_WIDGET_SNAPSHOT_VERSION,
  type NativePlannerWidgetSnapshot,
  nativePlannerWidgetSnapshotSchema,
  type NativePlannerWidgetTask,
  type NativePlannerWidgetTaskDateBucket,
  type NativePlannerWidgetTaskVisualTone,
  type SelfCareDashboardResponse,
  type SelfCareTodayItem,
} from '@planner/contracts'

import type { Sphere } from '@/entities/sphere'
import {
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
  selectTodoTasks,
  type Task,
} from '@/entities/task'
import {
  formatShortDate,
  formatTimeRange,
  isBeforeDate,
} from '@/shared/lib/date'
import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'
import {
  addDateDays,
  getDateKeyInTimeZone,
  getDeviceTimeZone,
  getTimeInTimeZone,
} from '@/shared/time/time.service'

const PLANNER_WIDGET_SNAPSHOT_KEY = 'planner.widget.today.snapshot'
export const NATIVE_PLANNER_WIDGET_CLEANING_TASK_PREFIX = 'cleaning:'

export interface NativePlannerWidgetSupplementalData {
  cleaning?: CleaningTodayResponse | undefined
  selfCare?: SelfCareDashboardResponse | undefined
}

interface PlannerWidgetPlugin {
  ackPendingCompletedTasks: (input: { taskIds: string[] }) => Promise<void>
  configureBackgroundSync: (input: {
    apiBaseUrl: string
    timeZone: string
    workspaceId: string
  }) => Promise<void>
  consumePendingCompletedTasks: () => Promise<{ taskIds: string[] }>
  consumePendingRoute: () => Promise<{ path: string | null }>
  disableBackgroundSync: () => Promise<void>
  readPendingCompletedTasks: () => Promise<{ taskIds: string[] }>
  refresh: () => Promise<void>
}

export type { NativePlannerWidgetSnapshot, NativePlannerWidgetTask }

const NativePlannerWidget = registerPlugin<PlannerWidgetPlugin>('PlannerWidget')

export function isAndroidPlannerWidgetRuntime(): boolean {
  return isAndroidNativeRuntime()
}

export function buildNativePlannerWidgetSnapshot(
  tasks: Task[],
  spheresOrNow: Sphere[] | Date = [],
  maybeNow?: Date,
  supplementalData: NativePlannerWidgetSupplementalData = {},
): NativePlannerWidgetSnapshot {
  const { now, spheres } = resolveSnapshotContext(spheresOrNow, maybeNow)
  const timeZone = getDeviceTimeZone() ?? 'UTC'
  const dateKey = getDateKeyInTimeZone(now, timeZone)
  const tomorrowKey = addDateDays(dateKey, 1)
  const sphereLookup = createSphereLookup(spheres)
  const todayTasks = selectTodayTasks(tasks, dateKey)
  const overdueTasks = selectOverdueTasks(tasks, dateKey)
  const doneTodayTasks = selectDoneTodayTasks(tasks, dateKey, timeZone)
  const plannerWidgetTasks = selectTodoTasks(tasks)
    .sort((left, right) =>
      compareWidgetTasks(left, right, dateKey, tomorrowKey),
    )
    .map((task) =>
      toNativePlannerWidgetTask(
        task,
        isWidgetTaskOverdue(task, dateKey),
        dateKey,
        tomorrowKey,
        sphereLookup,
      ),
    )
  const selfCareWidgetTasks = buildSelfCareWidgetTasks(
    supplementalData.selfCare,
    dateKey,
    timeZone,
  )
  const cleaningWidgetTasks = buildCleaningWidgetTasks(
    supplementalData.cleaning,
  )
  const widgetTasks = [
    ...plannerWidgetTasks.slice(0, NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS),
    ...selfCareWidgetTasks.slice(0, NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS),
    ...cleaningWidgetTasks.slice(0, NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS),
  ].sort(compareNativeWidgetTasks)
  const snapshot = {
    dateKey,
    doneTodayCount: doneTodayTasks.length,
    generatedAt: now.toISOString(),
    hiddenCleaningTaskCount: Math.max(
      0,
      cleaningWidgetTasks.length - NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS,
    ),
    hiddenSelfCareTaskCount: Math.max(
      0,
      selfCareWidgetTasks.length - NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS,
    ),
    hiddenTaskCount: Math.max(
      0,
      plannerWidgetTasks.length - NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS,
    ),
    overdueCount: overdueTasks.length,
    tasks: widgetTasks,
    todayCount: todayTasks.length,
    version: NATIVE_PLANNER_WIDGET_SNAPSHOT_VERSION,
  }

  return nativePlannerWidgetSnapshotSchema.parse(snapshot)
}

export async function persistNativePlannerWidgetSnapshot(
  snapshot: NativePlannerWidgetSnapshot,
): Promise<void> {
  if (!isAndroidPlannerWidgetRuntime()) {
    return
  }

  const persistedSnapshot = await readPersistedNativePlannerWidgetSnapshot()

  if (
    persistedSnapshot &&
    getNativePlannerWidgetSnapshotSignature(persistedSnapshot) ===
      getNativePlannerWidgetSnapshotSignature(snapshot)
  ) {
    return
  }

  await Preferences.set({
    key: PLANNER_WIDGET_SNAPSHOT_KEY,
    value: JSON.stringify(snapshot),
  })
  await NativePlannerWidget.refresh()
}

export async function configureNativePlannerWidgetBackgroundSync(input: {
  apiBaseUrl: string
  timeZone: string
  workspaceId: string
}): Promise<void> {
  if (!isAndroidPlannerWidgetRuntime()) {
    return
  }

  await NativePlannerWidget.configureBackgroundSync(input)
}

export async function disableNativePlannerWidgetBackgroundSync(): Promise<void> {
  if (!isAndroidPlannerWidgetRuntime()) {
    return
  }

  await NativePlannerWidget.disableBackgroundSync()
}

async function readPersistedNativePlannerWidgetSnapshot(): Promise<NativePlannerWidgetSnapshot | null> {
  try {
    const { value } = await Preferences.get({
      key: PLANNER_WIDGET_SNAPSHOT_KEY,
    })

    if (!value) {
      return null
    }

    const parsedSnapshot = nativePlannerWidgetSnapshotSchema.safeParse(
      JSON.parse(value),
    )

    return parsedSnapshot.success ? parsedSnapshot.data : null
  } catch {
    return null
  }
}

function getNativePlannerWidgetSnapshotSignature(
  snapshot: NativePlannerWidgetSnapshot,
): string {
  return JSON.stringify({
    dateKey: snapshot.dateKey,
    doneTodayCount: snapshot.doneTodayCount,
    hiddenTaskCount: snapshot.hiddenTaskCount,
    hiddenCleaningTaskCount: snapshot.hiddenCleaningTaskCount,
    hiddenSelfCareTaskCount: snapshot.hiddenSelfCareTaskCount,
    overdueCount: snapshot.overdueCount,
    tasks: snapshot.tasks.map((task) => ({
      color: task.color,
      canComplete: task.canComplete,
      dateBucket: task.dateBucket,
      icon: task.icon,
      id: task.id,
      isOverdue: task.isOverdue,
      source: task.source,
      timeLabel: task.timeLabel,
      title: task.title,
      visualTone: task.visualTone,
    })),
    todayCount: snapshot.todayCount,
    version: snapshot.version,
  })
}

export async function consumePendingNativePlannerWidgetRoute(): Promise<
  string | null
> {
  if (!isAndroidPlannerWidgetRuntime()) {
    return null
  }

  const { path } = await NativePlannerWidget.consumePendingRoute()

  if (typeof path !== 'string' || !path.startsWith('/')) {
    return null
  }

  if (path.startsWith('/today?createTask=')) {
    return `/today?createTask=widget-${Date.now()}`
  }

  return path
}

export async function consumePendingNativePlannerWidgetCompletedTasks(): Promise<
  string[]
> {
  if (!isAndroidPlannerWidgetRuntime()) {
    return []
  }

  const { taskIds } = await NativePlannerWidget.consumePendingCompletedTasks()

  return normalizePendingTaskIds(taskIds)
}

export async function readPendingNativePlannerWidgetCompletedTasks(): Promise<
  string[]
> {
  if (!isAndroidPlannerWidgetRuntime()) {
    return []
  }

  const { taskIds } = await NativePlannerWidget.readPendingCompletedTasks()

  return normalizePendingTaskIds(taskIds)
}

export async function ackPendingNativePlannerWidgetCompletedTasks(
  taskIds: string[],
): Promise<void> {
  if (!isAndroidPlannerWidgetRuntime()) {
    return
  }

  const acknowledgedTaskIds = normalizePendingTaskIds(taskIds)

  if (acknowledgedTaskIds.length === 0) {
    return
  }

  await NativePlannerWidget.ackPendingCompletedTasks({
    taskIds: acknowledgedTaskIds,
  })
}

export async function addNativePlannerWidgetResumeListener(
  listener: () => void,
): Promise<PluginListenerHandle> {
  return App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      listener()
    }
  })
}

function toNativePlannerWidgetTask(
  task: Task,
  isOverdue: boolean,
  todayKey: string,
  tomorrowKey: string,
  sphereLookup: WidgetSphereLookup,
): NativePlannerWidgetTask {
  const sphere = findWidgetSphere(task, sphereLookup)

  return {
    canComplete: true,
    color: normalizeWidgetColor(sphere?.color),
    dateBucket: getWidgetTaskDateBucket(task, todayKey, tomorrowKey),
    icon: normalizeWidgetIcon(task.icon) || normalizeWidgetIcon(sphere?.icon),
    id: task.id,
    isOverdue,
    source: 'planner',
    timeLabel:
      task.plannedDate === todayKey && task.plannedStartTime
        ? formatTimeRange(task.plannedStartTime, task.plannedEndTime)
        : null,
    title: getWidgetTaskTitle(task, todayKey, tomorrowKey, isOverdue),
    visualTone: getWidgetTaskVisualTone(task, isOverdue),
  }
}

export function getNativePlannerWidgetCleaningTaskId(
  widgetTaskId: string,
): string | null {
  if (!widgetTaskId.startsWith(NATIVE_PLANNER_WIDGET_CLEANING_TASK_PREFIX)) {
    return null
  }

  const taskId = widgetTaskId.slice(
    NATIVE_PLANNER_WIDGET_CLEANING_TASK_PREFIX.length,
  )

  return taskId.length > 0 ? taskId : null
}

function buildSelfCareWidgetTasks(
  dashboard: SelfCareDashboardResponse | undefined,
  todayKey: string,
  timeZone: string,
): NativePlannerWidgetTask[] {
  if (!dashboard) {
    return []
  }

  const overdueEntryKeys = new Set(
    dashboard.overdueItems.map(getSelfCareWidgetEntryKey),
  )
  const entries = deduplicateSelfCareEntries([
    ...dashboard.overdueItems,
    ...dashboard.todayItems,
    ...dashboard.flexibleGoals.filter(isSelfCareDailyFlexibleGoal),
  ]).filter(isVisibleSelfCareWidgetEntry)

  return entries.map((entry) => {
    const isOverdue =
      overdueEntryKeys.has(getSelfCareWidgetEntryKey(entry)) ||
      Boolean(
        entry.occurrence?.scheduledFor &&
        entry.occurrence.scheduledFor < todayKey,
      )
    const sourceTime = getSelfCareWidgetTime(entry, timeZone)

    return {
      canComplete: false,
      color: normalizeWidgetColor(entry.item.color ?? '#B9B3FF'),
      dateBucket: isOverdue ? 'overdue' : 'today',
      icon: normalizeWidgetIcon(entry.item.icon ?? '') || '♥',
      id: `self-care:${getSelfCareWidgetEntryKey(entry)}`,
      isOverdue,
      source: 'self_care',
      timeLabel: sourceTime,
      title: `Забота: ${normalizeWidgetTaskTitle(entry.item.title)}`,
      visualTone: isOverdue ? 'overdue' : 'default',
    }
  })
}

function buildCleaningWidgetTasks(
  today: CleaningTodayResponse | undefined,
): NativePlannerWidgetTask[] {
  if (!today) {
    return []
  }

  return deduplicateCleaningItems([...today.items, ...today.generalItems]).map(
    (entry) => ({
      canComplete: true,
      color:
        entry.task.priority === 'high'
          ? '#FFD166'
          : entry.isOverdue
            ? '#FF9F7A'
            : '#8EE7C8',
      dateBucket: entry.isOverdue ? 'overdue' : 'today',
      icon: '🧹',
      id: `${NATIVE_PLANNER_WIDGET_CLEANING_TASK_PREFIX}${entry.task.id}`,
      isOverdue: entry.isOverdue,
      source: 'cleaning',
      timeLabel: null,
      title: `Уборка: ${normalizeWidgetTaskTitle(entry.task.title)}`,
      visualTone:
        entry.task.priority === 'high'
          ? 'urgent'
          : entry.isOverdue
            ? 'overdue'
            : 'default',
    }),
  )
}

function deduplicateSelfCareEntries(
  entries: SelfCareTodayItem[],
): SelfCareTodayItem[] {
  const seenKeys = new Set<string>()

  return entries.filter((entry) => {
    const key = getSelfCareWidgetEntryKey(entry)

    if (seenKeys.has(key)) {
      return false
    }

    seenKeys.add(key)
    return true
  })
}

function deduplicateCleaningItems(
  entries: CleaningTaskWithState[],
): CleaningTaskWithState[] {
  const seenTaskIds = new Set<string>()

  return entries.filter((entry) => {
    if (seenTaskIds.has(entry.task.id)) {
      return false
    }

    seenTaskIds.add(entry.task.id)
    return true
  })
}

function getSelfCareWidgetEntryKey(entry: SelfCareTodayItem): string {
  return entry.occurrence?.id ?? entry.item.id
}

function isVisibleSelfCareWidgetEntry(entry: SelfCareTodayItem): boolean {
  if (
    entry.item.isArchived ||
    !entry.item.isActive ||
    entry.completion ||
    ['cancelled', 'done', 'missed', 'moved', 'partial', 'skipped'].includes(
      entry.occurrence?.status ?? 'scheduled',
    )
  ) {
    return false
  }

  if (
    entry.item.type === 'course' &&
    (entry.courseDetails?.isCompleted ||
      entry.courseDetails?.isPaused ||
      (entry.occurrence &&
        entry.scheduleRule?.repeatKind === 'course' &&
        entry.scheduleRule.startDate &&
        entry.occurrence.scheduledFor < entry.scheduleRule.startDate))
  ) {
    return false
  }

  return !(
    entry.flexibleProgress &&
    entry.flexibleProgress.completedCount >= entry.flexibleProgress.targetCount
  )
}

function isSelfCareDailyFlexibleGoal(entry: SelfCareTodayItem): boolean {
  const rule = entry.scheduleRule

  return Boolean(
    rule &&
    rule.flexiblePeriod === 'day' &&
    (entry.item.type === 'flexible_goal' ||
      rule.repeatKind === 'flexible_goal'),
  )
}

function getSelfCareWidgetTime(
  entry: SelfCareTodayItem,
  timeZone: string,
): string | null {
  const sourceTime =
    entry.occurrence?.dueAt ??
    entry.appointment?.startsAt ??
    entry.scheduleRule?.preferredTime ??
    null

  if (!sourceTime) {
    return null
  }

  if (sourceTime.includes('T')) {
    try {
      return getTimeInTimeZone(
        sourceTime,
        entry.occurrence?.reminderTimeZone ??
          entry.scheduleRule?.timezone ??
          timeZone,
      )
    } catch {
      // Fall through to extracting a plain time below.
    }
  }

  return (
    /^\d{2}:\d{2}/.exec(sourceTime)?.[0] ??
    /T(\d{2}:\d{2})/.exec(sourceTime)?.[1] ??
    null
  )
}

function compareNativeWidgetTasks(
  left: NativePlannerWidgetTask,
  right: NativePlannerWidgetTask,
): number {
  const bucketComparison =
    getNativeWidgetDateBucketWeight(left.dateBucket) -
    getNativeWidgetDateBucketWeight(right.dateBucket)

  if (bucketComparison !== 0) {
    return bucketComparison
  }

  if (left.timeLabel !== right.timeLabel) {
    if (left.timeLabel === null) {
      return 1
    }

    if (right.timeLabel === null) {
      return -1
    }

    return left.timeLabel.localeCompare(right.timeLabel)
  }

  return 0
}

function getNativeWidgetDateBucketWeight(
  bucket: NativePlannerWidgetTaskDateBucket,
): number {
  switch (bucket) {
    case 'overdue':
      return 0
    case 'today':
      return 1
    case 'tomorrow':
      return 2
    case 'future':
      return 3
    case 'unscheduled':
      return 4
  }
}

function normalizePendingTaskIds(taskIds: unknown): string[] {
  return Array.isArray(taskIds) ? taskIds.filter(isNonEmptyString) : []
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

interface WidgetSphereLookup {
  byId: Map<string, Sphere>
  byTitle: Map<string, Sphere>
}

function resolveSnapshotContext(
  spheresOrNow: Sphere[] | Date,
  maybeNow: Date | undefined,
): { now: Date; spheres: Sphere[] } {
  if (spheresOrNow instanceof Date) {
    return {
      now: spheresOrNow,
      spheres: [],
    }
  }

  return {
    now: maybeNow ?? new Date(),
    spheres: spheresOrNow,
  }
}

function createSphereLookup(spheres: Sphere[]): WidgetSphereLookup {
  return {
    byId: new Map(spheres.map((sphere) => [sphere.id, sphere])),
    byTitle: new Map(
      spheres.map((sphere) => [normalizeSphereName(sphere.name), sphere]),
    ),
  }
}

function findWidgetSphere(
  task: Task,
  sphereLookup: WidgetSphereLookup,
): Sphere | undefined {
  const sphereId = task.sphereId ?? task.projectId

  if (sphereId) {
    const sphere = sphereLookup.byId.get(sphereId)

    if (sphere) {
      return sphere
    }
  }

  return sphereLookup.byTitle.get(normalizeSphereName(task.project))
}

function normalizeSphereName(name: string): string {
  return name.trim().toLowerCase()
}

function normalizeWidgetColor(color: string | undefined): string {
  const normalizedColor = color?.trim()

  return normalizedColor && /^#[0-9a-f]{6}$/i.test(normalizedColor)
    ? normalizedColor.toUpperCase()
    : '#8EE7C8'
}

function normalizeWidgetIcon(icon: string | undefined): string {
  return icon?.trim() ?? ''
}

function normalizeWidgetTaskTitle(title: string): string {
  const trimmedTitle = title.trim()

  return trimmedTitle.length > 0 ? trimmedTitle : 'Без названия'
}

function getWidgetTaskTitle(
  task: Task,
  todayKey: string,
  tomorrowKey: string,
  isOverdue: boolean,
): string {
  const title = normalizeWidgetTaskTitle(task.title)

  if (isOverdue || task.plannedDate === todayKey) {
    return title
  }

  if (task.plannedDate === tomorrowKey) {
    return `Завтра: ${title}`
  }

  if (task.plannedDate) {
    return `${formatShortDate(task.plannedDate)}: ${title}`
  }

  return `Без даты: ${title}`
}

function compareWidgetTasks(
  left: Task,
  right: Task,
  todayKey: string,
  tomorrowKey: string,
): number {
  const dateBucketComparison =
    getWidgetDateBucket(left, todayKey, tomorrowKey) -
    getWidgetDateBucket(right, todayKey, tomorrowKey)

  if (dateBucketComparison !== 0) {
    return dateBucketComparison
  }

  const statusComparison =
    getWidgetStatusWeight(left) - getWidgetStatusWeight(right)

  if (statusComparison !== 0) {
    return statusComparison
  }

  if (left.plannedDate && right.plannedDate) {
    if (left.plannedDate !== right.plannedDate) {
      return left.plannedDate < right.plannedDate ? -1 : 1
    }
  }

  if (left.plannedDate !== right.plannedDate) {
    if (left.plannedDate === null) {
      return 1
    }

    return -1
  }

  const timeComparison = compareOptionalTime(
    left.plannedStartTime,
    right.plannedStartTime,
  )

  if (timeComparison !== 0) {
    return timeComparison
  }

  const priorityComparison =
    getWidgetPriorityWeight(left) - getWidgetPriorityWeight(right)

  if (priorityComparison !== 0) {
    return priorityComparison
  }

  if (left.createdAt === right.createdAt) {
    return 0
  }

  return left.createdAt < right.createdAt ? -1 : 1
}

function getWidgetTaskDateBucket(
  task: Task,
  todayKey: string,
  tomorrowKey: string,
): NativePlannerWidgetTaskDateBucket {
  if (isWidgetTaskOverdue(task, todayKey)) {
    return 'overdue'
  }

  if (task.plannedDate === todayKey) {
    return 'today'
  }

  if (task.plannedDate === tomorrowKey) {
    return 'tomorrow'
  }

  if (task.plannedDate) {
    return 'future'
  }

  return 'unscheduled'
}

function getWidgetDateBucket(
  task: Task,
  todayKey: string,
  tomorrowKey: string,
): number {
  switch (getWidgetTaskDateBucket(task, todayKey, tomorrowKey)) {
    case 'overdue':
      return 0
    case 'today':
      return 1
    case 'tomorrow':
      return 2
    case 'future':
      return 3
    case 'unscheduled':
      return 4
  }
}

function isWidgetTaskOverdue(task: Task, todayKey: string): boolean {
  return task.plannedDate !== null && isBeforeDate(task.plannedDate, todayKey)
}

function compareOptionalTime(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0
  }

  if (left === null) {
    return 1
  }

  if (right === null) {
    return -1
  }

  return left < right ? -1 : 1
}

function getWidgetStatusWeight(task: Task): number {
  if (task.status === 'in_progress') {
    return 0
  }

  if (task.status === 'ready_for_review') {
    return 1
  }

  return 2
}

function getWidgetPriorityWeight(task: Task): number {
  if (task.importance === 'important' && task.urgency === 'urgent') {
    return 0
  }

  if (task.importance === 'not_important' && task.urgency === 'urgent') {
    return 1
  }

  if (task.importance === 'important' && task.urgency === 'not_urgent') {
    return 2
  }

  return 3
}

function getWidgetTaskVisualTone(
  task: Task,
  isOverdue: boolean,
): NativePlannerWidgetTaskVisualTone {
  if (task.status === 'in_progress') {
    return 'in_progress'
  }

  if (task.status === 'ready_for_review') {
    return 'review'
  }

  if (task.urgency === 'urgent') {
    return 'urgent'
  }

  if (isOverdue) {
    return 'overdue'
  }

  return 'default'
}
