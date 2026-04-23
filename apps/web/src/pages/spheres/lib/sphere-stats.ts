import type { Project } from '@/entities/project'
import { getTaskResource, type Task } from '@/entities/task'
import { addDays, getDateKey } from '@/shared/lib/date'
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
  weeklyShare: number
}

export function getCurrentWeekRange(today: Date): WeekRange {
  const day = today.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  const monday = addDays(today, -daysFromMonday)
  const sunday = addDays(monday, 6)

  return {
    from: getDateKey(monday),
    to: getDateKey(sunday),
  }
}

function toLocalDate(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')

  return new Date(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw), 12)
}

function diffInDays(left: string, right: string): number {
  const leftTime = toLocalDate(left).getTime()
  const rightTime = toLocalDate(right).getTime()

  return Math.floor((rightTime - leftTime) / 86_400_000)
}

function getTaskCreatedDate(task: Pick<Task, 'createdAt'>): string {
  return getDateKey(new Date(task.createdAt))
}

function getTaskCompletedDate(task: Pick<Task, 'completedAt'>): string | null {
  return task.completedAt ? getDateKey(new Date(task.completedAt)) : null
}

function getTaskWeekAnchor(task: Task): string {
  return (
    task.plannedDate ??
    task.dueDate ??
    getTaskCompletedDate(task) ??
    getTaskCreatedDate(task)
  )
}

function isInWeek(value: string | null, week: WeekRange): boolean {
  return value !== null && value >= week.from && value <= week.to
}

function getLatestActivityDate(task: Task): string {
  return [
    task.plannedDate,
    task.dueDate,
    getTaskCompletedDate(task),
    getTaskCreatedDate(task),
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

function createProjectStats(project: Project): SphereStats {
  return {
    color: project.color,
    completedCount: 0,
    health: 'abandoned',
    icon: project.icon,
    idleDays: null,
    isUnassigned: false,
    lastActivityAt: null,
    overdueCount: 0,
    plannedCount: 0,
    projectId: project.id,
    sphereId: project.id,
    title: project.title,
    totalResource: 0,
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
    weeklyShare: 0,
  }
}

export function buildSphereStats(
  projects: Project[],
  tasks: Task[],
  week: WeekRange,
  todayKey: string,
): SphereStats[] {
  const statsBySphereId = new Map<string, SphereStats>()

  for (const project of projects) {
    statsBySphereId.set(project.id, createProjectStats(project))
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
    const completedDate = getTaskCompletedDate(task)
    const weekAnchor = getTaskWeekAnchor(task)
    const latestActivityDate = getLatestActivityDate(task)

    if (
      task.status === 'todo' &&
      isInWeek(task.plannedDate ?? task.dueDate, week)
    ) {
      stats.plannedCount += 1
    }

    if (task.status === 'done' && isInWeek(completedDate, week)) {
      stats.completedCount += 1
    }

    if (
      task.status === 'todo' &&
      task.plannedDate !== null &&
      task.plannedDate < todayKey
    ) {
      stats.overdueCount += 1
    }

    if (isInWeek(weekAnchor, week)) {
      stats.totalResource += getTaskResource(task)
    }

    if (!stats.lastActivityAt || latestActivityDate > stats.lastActivityAt) {
      stats.lastActivityAt = latestActivityDate
    }
  }

  const totalWeeklyResource = [...statsBySphereId.values()].reduce(
    (sum, stats) => sum + stats.totalResource,
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
          totalWeeklyResource > 0
            ? Math.round((stats.totalResource / totalWeeklyResource) * 100)
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
