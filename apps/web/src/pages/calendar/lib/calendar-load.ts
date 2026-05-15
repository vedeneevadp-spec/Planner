import { getTaskResource, type Task } from '@/entities/task'
import { addDays, getDateKey } from '@/shared/lib/date'

const CALENDAR_GRID_DAY_COUNT = 42
const DEFAULT_TIMED_TASK_MINUTES = 60

export type CalendarLoadState = 'calm' | 'heavy' | 'overload' | 'steady'

export interface CalendarGhostTask extends Task {
  isRecurringGhost: true
  sourceTaskId: string
}

export type CalendarDisplayTask = Task | CalendarGhostTask

export interface CalendarDaySummary {
  dateKey: string
  importantTaskCount: number
  loadState: CalendarLoadState
  loadUnits: number
  plannedTasks: CalendarDisplayTask[]
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

function getTaskLoadUnits(task: CalendarDisplayTask): number {
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

export function getCalendarMonthDateRange(anchorDateKey: string): {
  endDateKey: string
  startDateKey: string
} {
  const anchorDate = parseDateKey(anchorDateKey)
  const monthStart = new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    1,
    12,
  )
  const gridStart = addDays(monthStart, 1 - getIsoWeekday(monthStart))
  const gridEnd = addDays(gridStart, CALENDAR_GRID_DAY_COUNT - 1)

  return {
    endDateKey: getDateKey(gridEnd),
    startDateKey: getDateKey(gridStart),
  }
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
  tasks: CalendarDisplayTask[],
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
  tasks: CalendarDisplayTask[],
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

export function isRecurringGhostTask(task: Task): task is CalendarGhostTask {
  return 'isRecurringGhost' in task && task.isRecurringGhost === true
}

export function buildRecurringGhostTasks(
  tasks: Task[],
  rangeStartDateKey: string,
  rangeEndDateKey: string,
  todayDateKey: string,
): CalendarGhostTask[] {
  const existingDatesBySeries = new Set<string>()
  const sourceBySeries = new Map<string, Task>()

  for (const task of tasks) {
    const recurrence = task.recurrence

    if (!recurrence?.isActive) {
      continue
    }

    if (task.plannedDate) {
      existingDatesBySeries.add(`${recurrence.seriesId}:${task.plannedDate}`)
    }

    const currentSource = sourceBySeries.get(recurrence.seriesId)

    if (!currentSource || compareRecurringSource(task, currentSource) > 0) {
      sourceBySeries.set(recurrence.seriesId, task)
    }
  }

  return [...sourceBySeries.values()].flatMap((task) => {
    const recurrence = task.recurrence

    if (!recurrence?.isActive) {
      return []
    }

    return listRecurringDateKeys(
      recurrence,
      rangeStartDateKey,
      rangeEndDateKey,
    ).flatMap((dateKey) => {
      if (
        dateKey <= todayDateKey ||
        existingDatesBySeries.has(`${recurrence.seriesId}:${dateKey}`)
      ) {
        return []
      }

      return [
        {
          ...task,
          completedAt: null,
          dueDate: task.dueDate === task.plannedDate ? dateKey : null,
          id: `${task.id}:recurring:${dateKey}`,
          isRecurringGhost: true,
          plannedDate: dateKey,
          sourceTaskId: task.id,
          status: 'todo',
        } satisfies CalendarGhostTask,
      ]
    })
  })
}

function compareRecurringSource(left: Task, right: Task): number {
  const leftKey = `${left.plannedDate ?? left.createdAt.slice(0, 10)}:${left.createdAt}:${left.id}`
  const rightKey = `${right.plannedDate ?? right.createdAt.slice(0, 10)}:${right.createdAt}:${right.id}`

  return leftKey.localeCompare(rightKey)
}

function listRecurringDateKeys(
  recurrence: NonNullable<Task['recurrence']>,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): string[] {
  const effectiveStartDateKey = maxDateKey(
    recurrence.startDate,
    rangeStartDateKey,
  )
  const effectiveEndDateKey = recurrence.endDate
    ? minDateKey(recurrence.endDate, rangeEndDateKey)
    : rangeEndDateKey

  if (effectiveStartDateKey > effectiveEndDateKey) {
    return []
  }

  if (recurrence.frequency === 'daily') {
    return listDailyRecurringDateKeys(
      recurrence.startDate,
      recurrence.interval,
      effectiveStartDateKey,
      effectiveEndDateKey,
    )
  }

  if (recurrence.frequency === 'monthly') {
    return listMonthlyRecurringDateKeys(
      recurrence.startDate,
      recurrence.interval,
      effectiveStartDateKey,
      effectiveEndDateKey,
    )
  }

  return listWeeklyRecurringDateKeys(
    recurrence,
    effectiveStartDateKey,
    effectiveEndDateKey,
  )
}

function listDailyRecurringDateKeys(
  startDateKey: string,
  interval: number,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): string[] {
  const startOffset = Math.max(
    0,
    Math.ceil(getDateDistance(startDateKey, rangeStartDateKey) / interval),
  )
  let cursor = addDateKeyDays(startDateKey, startOffset * interval)
  const dateKeys: string[] = []

  while (cursor <= rangeEndDateKey) {
    dateKeys.push(cursor)
    cursor = addDateKeyDays(cursor, interval)
  }

  return dateKeys
}

function listMonthlyRecurringDateKeys(
  startDateKey: string,
  interval: number,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): string[] {
  const startDate = parseDateKey(startDateKey)
  const targetDay = startDate.getDate()
  const dateKeys: string[] = []

  for (let offset = 0; offset <= 600; offset += interval) {
    const candidate = addDateKeyMonthsClamped(startDateKey, offset, targetDay)
    const dateKey = getDateKey(candidate)

    if (dateKey > rangeEndDateKey) {
      break
    }

    if (dateKey >= rangeStartDateKey) {
      dateKeys.push(dateKey)
    }
  }

  return dateKeys
}

function listWeeklyRecurringDateKeys(
  recurrence: NonNullable<Task['recurrence']>,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): string[] {
  const scheduledDays = new Set(recurrence.daysOfWeek)
  const dateKeys: string[] = []
  let cursor = rangeStartDateKey
  const startWeek = getWeekStartDate(recurrence.startDate)

  while (cursor <= rangeEndDateKey) {
    const cursorDate = parseDateKey(cursor)

    if (
      scheduledDays.has(getIsoWeekday(cursorDate)) &&
      getWeekDistance(startWeek, cursorDate) % recurrence.interval === 0
    ) {
      dateKeys.push(cursor)
    }

    cursor = addDateKeyDays(cursor, 1)
  }

  return dateKeys
}

function addDateKeyDays(dateKey: string, amount: number): string {
  return getDateKey(addDays(parseDateKey(dateKey), amount))
}

function addDateKeyMonthsClamped(
  dateKey: string,
  monthOffset: number,
  targetDay: number,
): Date {
  const date = parseDateKey(dateKey)
  const year = date.getFullYear()
  const month = date.getMonth() + monthOffset
  const lastDay = new Date(year, month + 1, 0, 12).getDate()

  return new Date(year, month, Math.min(targetDay, lastDay), 12)
}

function getDateDistance(leftDateKey: string, rightDateKey: string): number {
  return Math.floor(
    (parseDateKey(rightDateKey).getTime() -
      parseDateKey(leftDateKey).getTime()) /
      (24 * 60 * 60 * 1000),
  )
}

function getWeekStartDate(dateKey: string): Date {
  const date = parseDateKey(dateKey)

  return addDays(date, 1 - getIsoWeekday(date))
}

function getWeekDistance(startWeek: Date, date: Date): number {
  const weekStart = addDays(date, 1 - getIsoWeekday(date))

  return Math.floor(
    (weekStart.getTime() - startWeek.getTime()) / (7 * 24 * 60 * 60 * 1000),
  )
}

function maxDateKey(left: string, right: string): string {
  return left > right ? left : right
}

function minDateKey(left: string, right: string): string {
  return left < right ? left : right
}
