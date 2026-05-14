import { getTaskResource, type Task } from '@/entities/task'
import { addDays, getDateKey } from '@/shared/lib/date'

const CALENDAR_GRID_DAY_COUNT = 42
const DEFAULT_TIMED_TASK_MINUTES = 60

export type CalendarLoadState = 'calm' | 'heavy' | 'overload' | 'steady'

export interface CalendarDaySummary {
  dateKey: string
  importantTaskCount: number
  loadState: CalendarLoadState
  loadUnits: number
  plannedTasks: Task[]
  restoreUnits: number
  routineTaskCount: number
  timedMinutes: number
  timedTaskCount: number
}

export interface CalendarDayCell extends CalendarDaySummary {
  dayOfMonth: number
  isCurrentMonth: boolean
}

export interface CalendarMonthLoad {
  activeTaskCount: number
  busiestDay: CalendarDayCell | null
  days: CalendarDayCell[]
  loadUnits: number
  overloadedDayCount: number
}

function parseDateKey(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  return new Date(year, month - 1, day, 12)
}

function getIsoWeekday(date: Date): number {
  const day = date.getDay()

  return day === 0 ? 7 : day
}

function getCalendarMonthKey(dateKey: string): string {
  return dateKey.slice(0, 7)
}

function parseTimeMinutes(value: string | null): number | null {
  if (!value) {
    return null
  }

  const [hoursRaw, minutesRaw] = value.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }

  return hours * 60 + minutes
}

function getTimedTaskMinutes(
  task: Pick<Task, 'plannedEndTime' | 'plannedStartTime'>,
): number {
  const startMinutes = parseTimeMinutes(task.plannedStartTime)

  if (startMinutes === null) {
    return 0
  }

  const endMinutes = parseTimeMinutes(task.plannedEndTime)

  if (endMinutes === null || endMinutes <= startMinutes) {
    return DEFAULT_TIMED_TASK_MINUTES
  }

  return endMinutes - startMinutes
}

function getTaskLoadUnits(task: Task): number {
  const resource = getTaskResource(task)

  if (resource < 0) {
    return Math.abs(resource)
  }

  return 1
}

export function shiftCalendarMonth(dateKey: string, amount: number): string {
  const date = parseDateKey(dateKey)
  const nextDate = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12)

  return getDateKey(nextDate)
}

export function getCalendarLoadState(loadUnits: number): CalendarLoadState {
  if (loadUnits >= 11) {
    return 'overload'
  }

  if (loadUnits >= 8) {
    return 'heavy'
  }

  if (loadUnits >= 4) {
    return 'steady'
  }

  return 'calm'
}

export function getCalendarDaySummary(
  tasks: Task[],
  dateKey: string,
): CalendarDaySummary {
  const plannedTasks = tasks.filter(
    (task) => task.status !== 'done' && task.plannedDate === dateKey,
  )
  const loadUnits = plannedTasks.reduce(
    (total, task) => total + getTaskLoadUnits(task),
    0,
  )
  const restoreUnits = plannedTasks.reduce(
    (total, task) => total + Math.max(0, getTaskResource(task)),
    0,
  )
  const timedMinutes = plannedTasks.reduce(
    (total, task) => total + getTimedTaskMinutes(task),
    0,
  )

  return {
    dateKey,
    importantTaskCount: plannedTasks.filter(
      (task) => task.importance === 'important',
    ).length,
    loadState: getCalendarLoadState(loadUnits),
    loadUnits,
    plannedTasks,
    restoreUnits,
    routineTaskCount: plannedTasks.filter((task) => Boolean(task.routine))
      .length,
    timedMinutes,
    timedTaskCount: plannedTasks.filter((task) => task.plannedStartTime).length,
  }
}

export function buildCalendarMonthLoad(
  tasks: Task[],
  anchorDateKey: string,
): CalendarMonthLoad {
  const anchorDate = parseDateKey(anchorDateKey)
  const monthStart = new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    1,
    12,
  )
  const gridStart = addDays(monthStart, 1 - getIsoWeekday(monthStart))
  const monthKey = getCalendarMonthKey(getDateKey(monthStart))
  const days = Array.from({ length: CALENDAR_GRID_DAY_COUNT }, (_, index) => {
    const date = addDays(gridStart, index)
    const dateKey = getDateKey(date)
    const summary = getCalendarDaySummary(tasks, dateKey)

    return {
      ...summary,
      dayOfMonth: date.getDate(),
      isCurrentMonth: getCalendarMonthKey(dateKey) === monthKey,
    }
  })
  const currentMonthDays = days.filter((day) => day.isCurrentMonth)
  const busiestDay = currentMonthDays.reduce<CalendarDayCell | null>(
    (current, day) => {
      if (!current || day.loadUnits > current.loadUnits) {
        return day
      }

      return current
    },
    null,
  )

  return {
    activeTaskCount: currentMonthDays.reduce(
      (total, day) => total + day.plannedTasks.length,
      0,
    ),
    busiestDay,
    days,
    loadUnits: currentMonthDays.reduce(
      (total, day) => total + day.loadUnits,
      0,
    ),
    overloadedDayCount: currentMonthDays.filter(
      (day) => day.loadState === 'overload',
    ).length,
  }
}
