import {
  getRoutineTaskFrequencyLabel,
  getRoutineTaskTargetLabel,
  isRoutineHabitTask,
  type RoutineTask,
  type Task,
} from '@/entities/task'

export interface RoutineHabitStats {
  bestStreak: number
  completedToday: boolean
  completionRate: number
  currentStreak: number
  frequencyLabel: string
  icon: string
  lastCompletedDate: string | null
  monthCompleted: number
  monthScheduled: number
  nextPlannedDate: string | null
  routine: RoutineTask
  seriesId: string
  targetLabel: string
  title: string
}

export interface RoutineHabitStatsSummary {
  activeCount: number
  bestStreak: number
  completedToday: number
  items: RoutineHabitStats[]
  scheduledToday: number
}

export function buildRoutineHabitStats(
  tasks: Task[],
  todayKey: string,
): RoutineHabitStatsSummary {
  const monthStart = `${todayKey.slice(0, 7)}-01`
  const groups = groupRoutineTasks(tasks)
  const items = [...groups.entries()]
    .map(([seriesId, seriesTasks]) =>
      buildRoutineHabitStatsItem(seriesId, seriesTasks, monthStart, todayKey),
    )
    .sort((left, right) => {
      if (left.nextPlannedDate && right.nextPlannedDate) {
        return left.nextPlannedDate.localeCompare(right.nextPlannedDate)
      }

      if (left.nextPlannedDate) {
        return -1
      }

      if (right.nextPlannedDate) {
        return 1
      }

      return left.title.localeCompare(right.title, 'ru')
    })
  const completedToday = items.filter((item) => item.completedToday).length
  const scheduledToday = items.filter((item) =>
    isRoutineScheduledOnDate(item.routine, item.firstDate, todayKey),
  ).length

  return {
    activeCount: items.length,
    bestStreak: Math.max(0, ...items.map((item) => item.bestStreak)),
    completedToday,
    items,
    scheduledToday,
  }
}

function buildRoutineHabitStatsItem(
  seriesId: string,
  tasks: Task[],
  monthStart: string,
  todayKey: string,
): RoutineHabitStats & { firstDate: string } {
  const representative = getRepresentativeTask(tasks)
  const routine = representative.routine!
  const firstDate = getFirstRoutineDate(tasks)
  const completedDates = getCompletedRoutineDates(tasks)
  const scheduledDates = enumerateDates(firstDate, todayKey).filter((dateKey) =>
    isRoutineScheduledOnDate(routine, firstDate, dateKey),
  )
  const monthDates = scheduledDates.filter((dateKey) => dateKey >= monthStart)
  const monthCompleted = monthDates.filter((dateKey) =>
    completedDates.has(dateKey),
  ).length

  return {
    bestStreak: calculateBestStreak(scheduledDates, completedDates),
    completedToday: completedDates.has(todayKey),
    completionRate:
      monthDates.length === 0
        ? 0
        : Math.round((monthCompleted / monthDates.length) * 100),
    currentStreak: calculateCurrentStreak(
      scheduledDates,
      completedDates,
      todayKey,
    ),
    firstDate,
    frequencyLabel: getRoutineTaskFrequencyLabel(routine),
    icon: representative.icon,
    lastCompletedDate: getLastCompletedDate(completedDates),
    monthCompleted,
    monthScheduled: monthDates.length,
    nextPlannedDate: getNextPlannedDate(tasks, todayKey),
    routine,
    seriesId,
    targetLabel: getRoutineTaskTargetLabel(routine),
    title: representative.title,
  }
}

function groupRoutineTasks(tasks: Task[]): Map<string, Task[]> {
  const groups = new Map<string, Task[]>()

  for (const task of tasks) {
    if (!isRoutineHabitTask(task) || !task.routine) {
      continue
    }

    const group = groups.get(task.routine.seriesId) ?? []
    group.push(task)
    groups.set(task.routine.seriesId, group)
  }

  return groups
}

function getRepresentativeTask(tasks: Task[]): Task {
  return [...tasks].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'done' ? 1 : -1
    }

    return getTaskDate(right).localeCompare(getTaskDate(left))
  })[0]!
}

function getFirstRoutineDate(tasks: Task[]): string {
  return tasks
    .map((task) => task.plannedDate ?? task.createdAt.slice(0, 10))
    .sort()[0]!
}

function getTaskDate(task: Task): string {
  return task.plannedDate ?? task.completedAt?.slice(0, 10) ?? task.createdAt
}

function getCompletedRoutineDates(tasks: Task[]): Set<string> {
  return new Set(
    tasks
      .filter((task) => task.status === 'done')
      .map((task) => task.plannedDate ?? task.completedAt?.slice(0, 10))
      .filter((dateKey): dateKey is string => Boolean(dateKey)),
  )
}

function getLastCompletedDate(completedDates: Set<string>): string | null {
  return [...completedDates].sort().at(-1) ?? null
}

function getNextPlannedDate(tasks: Task[], todayKey: string): string | null {
  return (
    tasks
      .filter((task) => task.status !== 'done' && task.plannedDate)
      .map((task) => task.plannedDate!)
      .filter((dateKey) => dateKey >= todayKey)
      .sort()[0] ?? null
  )
}

function isRoutineScheduledOnDate(
  routine: Pick<RoutineTask, 'daysOfWeek'>,
  firstDate: string,
  dateKey: string,
): boolean {
  return dateKey >= firstDate && routine.daysOfWeek.includes(getIsoWeekday(dateKey))
}

function calculateCurrentStreak(
  scheduledDates: string[],
  completedDates: Set<string>,
  todayKey: string,
): number {
  let streak = 0
  let isFirstScheduledDate = true

  for (const dateKey of [...scheduledDates].reverse()) {
    if (dateKey > todayKey) {
      continue
    }

    if (completedDates.has(dateKey)) {
      streak += 1
      isFirstScheduledDate = false
      continue
    }

    if (isFirstScheduledDate && dateKey === todayKey) {
      isFirstScheduledDate = false
      continue
    }

    break
  }

  return streak
}

function calculateBestStreak(
  scheduledDates: string[],
  completedDates: Set<string>,
): number {
  let bestStreak = 0
  let currentStreak = 0

  for (const dateKey of scheduledDates) {
    if (completedDates.has(dateKey)) {
      currentStreak += 1
      bestStreak = Math.max(bestStreak, currentStreak)
      continue
    }

    currentStreak = 0
  }

  return bestStreak
}

function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return dates
}

function getIsoWeekday(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()

  return day === 0 ? 7 : day
}
