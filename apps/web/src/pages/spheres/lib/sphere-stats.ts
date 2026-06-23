import type { Sphere } from '@/entities/sphere'
import { getTaskResource, isActiveTaskStatus, type Task } from '@/entities/task'
import {
  addDateDays,
  getDateDistance,
  getDateKeyInTimeZone,
  getIsoWeekStartDate,
} from '@/shared/time/time.service'
import { createSvgIconValue } from '@/shared/ui/Icon'

export const UNSPHERED_ID = '__unsphered__'

export type SphereHealth = 'abandoned' | 'healthy' | 'warning'

export interface WeekRange {
  from: string
  to: string
}

export interface SphereStats {
  color: string
  completedCount: number
  health: SphereHealth
  icon: string
  idleDays: number | null
  isUnassigned: boolean
  lastActivityAt: string | null
  overdueCount: number
  plannedCount: number
  projectId: string | null
  sphereId: string
  title: string
  totalResource: number
  weeklyLoad: number
  weeklyShare: number
}

export function getCurrentWeekRange(todayKey: string): WeekRange {
  const monday = getIsoWeekStartDate(todayKey)
  const sunday = addDateDays(monday, 6)

  return {
    from: monday,
    to: sunday,
  }
}

function diffInDays(left: string, right: string): number {
  return getDateDistance(left, right)
}

function getTaskCreatedDate(
  task: Pick<Task, 'createdAt'>,
  timeZone: string,
): string {
  return getDateKeyInTimeZone(task.createdAt, timeZone)
}

function getTaskCompletedDate(
  task: Pick<Task, 'completedAt'>,
  timeZone: string,
): string | null {
  return task.completedAt
    ? getDateKeyInTimeZone(task.completedAt, timeZone)
    : null
}

function getTaskWeekAnchor(task: Task, timeZone: string): string {
  return (
    task.plannedDate ??
    getTaskCompletedDate(task, timeZone) ??
    getTaskCreatedDate(task, timeZone)
  )
}

function isInWeek(value: string | null, week: WeekRange): boolean {
  return value !== null && value >= week.from && value <= week.to
}

function getLatestActivityDate(task: Task, timeZone: string): string {
  return [
    task.plannedDate,
    getTaskCompletedDate(task, timeZone),
    getTaskCreatedDate(task, timeZone),
  ]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)!
}

function resolveHealth(options: {
  idleDays: number | null
  overdueCount: number
  plannedCount: number
  completedCount: number
}): SphereHealth {
  if (options.idleDays === null || options.idleDays >= 10) {
    return 'abandoned'
  }

  if (
    options.idleDays >= 5 ||
    options.overdueCount > 0 ||
    options.plannedCount + options.completedCount === 0
  ) {
    return 'warning'
  }

  return 'healthy'
}

function createSphereStats(sphere: Sphere): SphereStats {
  return {
    color: sphere.color,
    completedCount: 0,
    health: 'abandoned',
    icon: sphere.icon,
    idleDays: null,
    isUnassigned: false,
    lastActivityAt: null,
    overdueCount: 0,
    plannedCount: 0,
    projectId: sphere.id,
    sphereId: sphere.id,
    title: sphere.name,
    totalResource: 0,
    weeklyLoad: 0,
    weeklyShare: 0,
  }
}

function createUnassignedStats(): SphereStats {
  return {
    color: '#6f766d',
    completedCount: 0,
    health: 'warning',
    icon: createSvgIconValue('folder'),
    idleDays: null,
    isUnassigned: true,
    lastActivityAt: null,
    overdueCount: 0,
    plannedCount: 0,
    projectId: null,
    sphereId: UNSPHERED_ID,
    title: 'Без сферы',
    totalResource: 0,
    weeklyLoad: 0,
    weeklyShare: 0,
  }
}

export function buildSphereStats(
  spheres: Sphere[],
  tasks: Task[],
  week: WeekRange,
  todayKey: string,
  timeZone: string,
): SphereStats[] {
  const statsBySphereId = new Map<string, SphereStats>()

  for (const sphere of spheres) {
    statsBySphereId.set(sphere.id, createSphereStats(sphere))
  }

  for (const task of tasks) {
    const sphereId =
      task.projectId && statsBySphereId.has(task.projectId)
        ? task.projectId
        : UNSPHERED_ID

    if (!statsBySphereId.has(sphereId)) {
      statsBySphereId.set(sphereId, createUnassignedStats())
    }

    const stats = statsBySphereId.get(sphereId)!
    const completedDate = getTaskCompletedDate(task, timeZone)
    const weekAnchor = getTaskWeekAnchor(task, timeZone)
    const latestActivityDate = getLatestActivityDate(task, timeZone)

    if (isActiveTaskStatus(task.status) && isInWeek(task.plannedDate, week)) {
      stats.plannedCount += 1
    }

    if (task.status === 'done' && isInWeek(completedDate, week)) {
      stats.completedCount += 1
    }

    if (
      isActiveTaskStatus(task.status) &&
      task.plannedDate !== null &&
      task.plannedDate < todayKey
    ) {
      stats.overdueCount += 1
    }

    if (isInWeek(weekAnchor, week)) {
      const taskResource = Math.max(0, -getTaskResource(task))

      stats.totalResource += taskResource
      stats.weeklyLoad += taskResource > 0 ? taskResource : 1
    }

    if (!stats.lastActivityAt || latestActivityDate > stats.lastActivityAt) {
      stats.lastActivityAt = latestActivityDate
    }
  }

  const totalWeeklyLoad = [...statsBySphereId.values()].reduce(
    (sum, stats) => sum + stats.weeklyLoad,
    0,
  )

  return [...statsBySphereId.values()]
    .map((stats) => {
      const idleDays = stats.lastActivityAt
        ? Math.max(0, diffInDays(stats.lastActivityAt, todayKey))
        : null

      return {
        ...stats,
        health: resolveHealth({
          completedCount: stats.completedCount,
          idleDays,
          overdueCount: stats.overdueCount,
          plannedCount: stats.plannedCount,
        }),
        idleDays,
        weeklyShare:
          totalWeeklyLoad > 0
            ? Math.round((stats.weeklyLoad / totalWeeklyLoad) * 100)
            : 0,
      }
    })
    .sort((left, right) => {
      if (left.health !== right.health) {
        const healthOrder: Record<SphereHealth, number> = {
          abandoned: 0,
          warning: 1,
          healthy: 2,
        }

        return healthOrder[left.health] - healthOrder[right.health]
      }

      if (left.weeklyShare !== right.weeklyShare) {
        return right.weeklyShare - left.weeklyShare
      }

      return left.title.localeCompare(right.title)
    })
}

export function getSphereHealthLabel(health: SphereHealth): string {
  if (health === 'abandoned') {
    return 'заброшено'
  }

  if (health === 'warning') {
    return 'проседает'
  }

  return 'в порядке'
}
