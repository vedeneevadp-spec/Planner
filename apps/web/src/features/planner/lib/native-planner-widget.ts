import { App } from '@capacitor/app'
import {
  Capacitor,
  type PluginListenerHandle,
  registerPlugin,
} from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import {
  NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS,
  NATIVE_PLANNER_WIDGET_SNAPSHOT_VERSION,
  type NativePlannerWidgetSnapshot,
  nativePlannerWidgetSnapshotSchema,
  type NativePlannerWidgetTask,
  type NativePlannerWidgetTaskVisualTone,
} from '@planner/contracts'

import {
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
  type Task,
} from '@/entities/task'
import { formatTimeRange, getDateKey } from '@/shared/lib/date'

const PLANNER_WIDGET_SNAPSHOT_KEY = 'planner.widget.today.snapshot'
const PLANNER_WIDGET_BACKGROUND_OPACITY_KEY =
  'planner.widget.background.opacityPercent'
const DEFAULT_WIDGET_BACKGROUND_OPACITY = 85

export const NATIVE_PLANNER_WIDGET_BACKGROUND_OPACITY_OPTIONS = [
  40, 55, 70, 85, 100,
] as const

export type NativePlannerWidgetBackgroundOpacity =
  (typeof NATIVE_PLANNER_WIDGET_BACKGROUND_OPACITY_OPTIONS)[number]

interface PlannerWidgetPlugin {
  consumePendingCompletedTasks: () => Promise<{ taskIds: string[] }>
  consumePendingRoute: () => Promise<{ path: string | null }>
  refresh: () => Promise<void>
}

export type { NativePlannerWidgetSnapshot, NativePlannerWidgetTask }

const NativePlannerWidget = registerPlugin<PlannerWidgetPlugin>('PlannerWidget')

export function isAndroidPlannerWidgetRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function buildNativePlannerWidgetSnapshot(
  tasks: Task[],
  now: Date = new Date(),
): NativePlannerWidgetSnapshot {
  const dateKey = getDateKey(now)
  const todayTasks = selectTodayTasks(tasks, dateKey)
  const overdueTasks = selectOverdueTasks(tasks, dateKey)
  const doneTodayTasks = selectDoneTodayTasks(tasks, dateKey)
  const widgetTasks = [...overdueTasks, ...todayTasks]
    .sort((left, right) => compareWidgetTasks(left, right, dateKey))
    .map((task) =>
      toNativePlannerWidgetTask(task, task.plannedDate !== dateKey),
    )
  const snapshot = {
    dateKey,
    doneTodayCount: doneTodayTasks.length,
    generatedAt: now.toISOString(),
    hiddenTaskCount: Math.max(
      0,
      widgetTasks.length - NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS,
    ),
    overdueCount: overdueTasks.length,
    tasks: widgetTasks.slice(0, NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS),
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

  await Preferences.set({
    key: PLANNER_WIDGET_SNAPSHOT_KEY,
    value: JSON.stringify(snapshot),
  })
  await NativePlannerWidget.refresh()
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

  return Array.isArray(taskIds)
    ? taskIds.filter(
        (taskId) => typeof taskId === 'string' && taskId.length > 0,
      )
    : []
}

export async function getNativePlannerWidgetBackgroundOpacity(): Promise<NativePlannerWidgetBackgroundOpacity> {
  if (!isAndroidPlannerWidgetRuntime()) {
    return DEFAULT_WIDGET_BACKGROUND_OPACITY
  }

  const { value } = await Preferences.get({
    key: PLANNER_WIDGET_BACKGROUND_OPACITY_KEY,
  })

  return normalizeWidgetBackgroundOpacity(value)
}

export async function setNativePlannerWidgetBackgroundOpacity(
  opacity: number,
): Promise<NativePlannerWidgetBackgroundOpacity> {
  const normalizedOpacity = normalizeWidgetBackgroundOpacity(opacity)

  if (!isAndroidPlannerWidgetRuntime()) {
    return normalizedOpacity
  }

  await Preferences.set({
    key: PLANNER_WIDGET_BACKGROUND_OPACITY_KEY,
    value: String(normalizedOpacity),
  })
  await NativePlannerWidget.refresh()

  return normalizedOpacity
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
): NativePlannerWidgetTask {
  return {
    id: task.id,
    isOverdue,
    timeLabel:
      !isOverdue && task.plannedStartTime
        ? formatTimeRange(task.plannedStartTime, task.plannedEndTime)
        : null,
    title: normalizeWidgetTaskTitle(task.title),
    visualTone: getWidgetTaskVisualTone(task, isOverdue),
  }
}

function normalizeWidgetTaskTitle(title: string): string {
  const trimmedTitle = title.trim()

  return trimmedTitle.length > 0 ? trimmedTitle : 'Без названия'
}

function compareWidgetTasks(left: Task, right: Task, todayKey: string): number {
  const leftIsOverdue = left.plannedDate !== todayKey
  const rightIsOverdue = right.plannedDate !== todayKey

  if (leftIsOverdue !== rightIsOverdue) {
    return leftIsOverdue ? -1 : 1
  }

  const statusComparison =
    getWidgetStatusWeight(left) - getWidgetStatusWeight(right)

  if (statusComparison !== 0) {
    return statusComparison
  }

  if (leftIsOverdue && rightIsOverdue) {
    const leftPlannedDate = left.plannedDate ?? todayKey
    const rightPlannedDate = right.plannedDate ?? todayKey

    if (leftPlannedDate !== rightPlannedDate) {
      return leftPlannedDate < rightPlannedDate ? -1 : 1
    }
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

function normalizeWidgetBackgroundOpacity(
  value: number | string | null,
): NativePlannerWidgetBackgroundOpacity {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_WIDGET_BACKGROUND_OPACITY
  }

  return NATIVE_PLANNER_WIDGET_BACKGROUND_OPACITY_OPTIONS.reduce(
    (nearest, option) =>
      Math.abs(option - numericValue) < Math.abs(nearest - numericValue)
        ? option
        : nearest,
    DEFAULT_WIDGET_BACKGROUND_OPACITY,
  )
}
