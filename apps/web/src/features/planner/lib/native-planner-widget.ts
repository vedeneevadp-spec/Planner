import { App } from '@capacitor/app'
import {
  Capacitor,
  type PluginListenerHandle,
  registerPlugin,
} from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

import {
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
  type Task,
} from '@/entities/task'
import { formatTimeRange, getDateKey } from '@/shared/lib/date'

const PLANNER_WIDGET_SNAPSHOT_KEY = 'planner.widget.today.snapshot'
const MAX_WIDGET_TASKS = 5

interface PlannerWidgetPlugin {
  consumePendingRoute: () => Promise<{ path: string | null }>
  refresh: () => Promise<void>
}

export interface NativePlannerWidgetTask {
  isOverdue: boolean
  timeLabel: string | null
  title: string
}

export interface NativePlannerWidgetSnapshot {
  dateKey: string
  doneTodayCount: number
  generatedAt: string
  moreCount: number
  overdueCount: number
  tasks: NativePlannerWidgetTask[]
  todayCount: number
  version: 1
}

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
  const widgetTasks = [
    ...overdueTasks.map((task) => toNativePlannerWidgetTask(task, true)),
    ...todayTasks.map((task) => toNativePlannerWidgetTask(task, false)),
  ]

  return {
    dateKey,
    doneTodayCount: doneTodayTasks.length,
    generatedAt: now.toISOString(),
    moreCount: Math.max(0, widgetTasks.length - MAX_WIDGET_TASKS),
    overdueCount: overdueTasks.length,
    tasks: widgetTasks.slice(0, MAX_WIDGET_TASKS),
    todayCount: todayTasks.length,
    version: 1,
  }
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

  return typeof path === 'string' && path.startsWith('/') ? path : null
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
    isOverdue,
    timeLabel:
      !isOverdue && task.plannedStartTime
        ? formatTimeRange(task.plannedStartTime, task.plannedEndTime)
        : null,
    title: normalizeWidgetTaskTitle(task.title),
  }
}

function normalizeWidgetTaskTitle(title: string): string {
  const trimmedTitle = title.trim()

  return trimmedTitle.length > 0 ? trimmedTitle : 'Без названия'
}
