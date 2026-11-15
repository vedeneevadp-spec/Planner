import { type CalendarViewMode } from '@planner/contracts'
import { type CSSProperties } from 'react'

import {
  getTaskResource,
  isActiveTaskStatus,
  type Task,
  type TimelineTaskLayout,
} from '@/entities/task'
import { type SessionReadiness } from '@/features/session'
import { formatLongDate } from '@/shared/lib/date'
import {
  addDateDays,
  getIsoWeekStartDate,
  getTimeInTimeZone,
} from '@/shared/time/time.service'

import {
  type CalendarDisplayTask,
  isRecurringGhostTask,
  isSelfCareCalendarTask,
} from '../lib/calendar-load'
import { SCHEDULE_PERIOD_DAYS } from '../lib/calendar-period'
import styles from './CalendarPage.module.css'
export const WEEKDAY_LABELS = [
  'Пн',
  'Вт',
  'Ср',
  'Чт',
  'Пт',
  'Сб',
  'Вс',
] as const

export const DEFAULT_START_HOUR = 0

export const DEFAULT_END_HOUR = 24

export const DEFAULT_WEEK_SCROLL_HOUR = 7

export const MIN_TASK_HEIGHT_REM = 2.2

export const MONTH_VISIBLE_TASK_LIMIT = 5

export const CALENDAR_VIEW_SEARCH_PARAM = 'calendarView'

export const DAY_SCHEDULE_SEARCH_PARAM = 'calendarDaySchedule'

export const LEGACY_TIMELINE_SCHEDULE_SEARCH_PARAM = 'timelineSchedule'

export const TASK_CREATE_SEARCH_PARAM = 'createTask'

export type CalendarBlockingState = 'error' | 'loading' | 'offline' | null

export function resolveCalendarBlockingState(input: {
  hasTaskRecords: boolean
  isCacheHydrating: boolean
  isOffline: boolean
  isLoading: boolean
  readiness: SessionReadiness
}): CalendarBlockingState {
  if (input.hasTaskRecords) {
    return null
  }

  if (
    input.readiness.reason === 'unauthorized' ||
    input.readiness.reason === 'auth_deferred' ||
    input.readiness.reason === 'no_session'
  ) {
    return 'error'
  }

  if (input.isCacheHydrating) {
    return 'loading'
  }

  if (input.isOffline) {
    return 'offline'
  }

  if (input.readiness.reason === 'auth_restoring') {
    return 'loading'
  }

  if (input.readiness.reason === 'planner_pending') {
    return 'loading'
  }

  if (input.readiness.reason === 'planner_error') {
    return 'error'
  }

  if (input.isLoading) {
    return 'loading'
  }

  return 'error'
}

export function getCalendarAccessErrorDescription(
  readiness: SessionReadiness,
): string {
  if (isCalendarAccessUnavailable(readiness)) {
    return 'Не удалось подтвердить доступ к данным. Повторите попытку, чтобы восстановить сессию.'
  }

  return 'Данные календаря не загрузились. Проверьте подключение и повторите попытку.'
}

export function isCalendarAccessUnavailable(
  readiness: SessionReadiness,
): boolean {
  return (
    readiness.reason === 'unauthorized' ||
    readiness.reason === 'auth_deferred' ||
    readiness.reason === 'no_session'
  )
}

export function getOldestCompleteSyncTimestamp(
  values: Array<string | null | undefined>,
): string | null {
  if (
    values.length === 0 ||
    values.some((value) => !value || Number.isNaN(new Date(value).getTime()))
  ) {
    return null
  }

  return values.reduce<string | null>((oldest, value) => {
    if (!value) {
      return oldest
    }

    if (!oldest || new Date(value).getTime() < new Date(oldest).getTime()) {
      return value
    }

    return oldest
  }, null)
}

export function getMillisecondsUntilNextMinute(date: Date): number {
  const elapsedMinuteMilliseconds =
    date.getSeconds() * 1000 + date.getMilliseconds()
  const remainingMilliseconds = 60_000 - elapsedMinuteMilliseconds

  return remainingMilliseconds > 0 ? remainingMilliseconds : 60_000
}

export function formatTaskCount(value: number): string {
  const mod100 = value % 100

  if (mod100 >= 11 && mod100 <= 14) {
    return `${value} задач`
  }

  const mod10 = value % 10

  if (mod10 === 1) {
    return `${value} задача`
  }

  if (mod10 >= 2 && mod10 <= 4) {
    return `${value} задачи`
  }

  return `${value} задач`
}

export function getCalendarViewModeFromSearchParams(
  searchParams: URLSearchParams,
): CalendarViewMode | null {
  const viewMode = searchParams.get(CALENDAR_VIEW_SEARCH_PARAM)

  if (
    viewMode === 'day' ||
    viewMode === 'week' ||
    viewMode === 'month' ||
    viewMode === 'schedule'
  ) {
    return viewMode
  }

  return null
}

export function parseDateKey(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  return new Date(year, month - 1, day, 12)
}

export function formatMonthTitle(dateKey: string): string {
  const title = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(parseDateKey(dateKey))

  return title.charAt(0).toUpperCase() + title.slice(1)
}

export function formatDayTitle(dateKey: string): string {
  const title = formatLongDate(dateKey)

  return title.charAt(0).toUpperCase() + title.slice(1)
}

export function formatWeekTitle(
  startDateKey: string,
  endDateKey: string,
): string {
  const start = parseDateKey(startDateKey)
  const end = parseDateKey(endDateKey)
  const startLabel = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(start)
  const endLabel = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(end)

  return `${startLabel} - ${endLabel}`
}

export function getWeekStartDateKey(dateKey: string): string {
  return getIsoWeekStartDate(dateKey)
}

export function parseTimeMinutes(value: string | null): number | null {
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

export function getTaskEndMinutes(task: Task): number | null {
  const startMinutes = parseTimeMinutes(task.plannedStartTime)

  if (startMinutes === null) {
    return null
  }

  const endMinutes = parseTimeMinutes(task.plannedEndTime)

  if (endMinutes === null || endMinutes <= startMinutes) {
    return startMinutes + 60
  }

  return endMinutes
}

export function getWeekDateKeys(anchorDateKey: string): string[] {
  const weekStart = getWeekStartDateKey(anchorDateKey)

  return Array.from({ length: 7 }, (_, index) => addDateDays(weekStart, index))
}

export function getTaskSortKey(task: CalendarDisplayTask): string {
  return `${task.plannedStartTime ?? '99:99'}:${task.createdAt}:${task.id}`
}

export function sortCalendarTasks(
  tasks: CalendarDisplayTask[],
): CalendarDisplayTask[] {
  return [...tasks].sort((left, right) =>
    getTaskSortKey(left).localeCompare(getTaskSortKey(right)),
  )
}

export function getTasksForDate(
  tasks: CalendarDisplayTask[],
  dateKey: string,
): CalendarDisplayTask[] {
  return sortCalendarTasks(
    tasks.filter(
      (task) => isActiveTaskStatus(task.status) && task.plannedDate === dateKey,
    ),
  )
}

export function getScheduleDateKeys(anchorDateKey: string): string[] {
  return Array.from({ length: SCHEDULE_PERIOD_DAYS }, (_, index) =>
    addDateDays(anchorDateKey, index),
  )
}

export function getCalendarTitle(
  mode: CalendarViewMode,
  anchorDateKey: string,
) {
  if (mode === 'day') {
    return formatDayTitle(anchorDateKey)
  }

  if (mode === 'month') {
    return formatMonthTitle(anchorDateKey)
  }

  if (mode === 'schedule') {
    const endDateKey = addDateDays(anchorDateKey, SCHEDULE_PERIOD_DAYS - 1)

    return formatWeekTitle(anchorDateKey, endDateKey)
  }

  const weekDays = getWeekDateKeys(anchorDateKey)

  return formatWeekTitle(weekDays[0]!, weekDays[6]!)
}

export function getTimeRange(
  tasks: CalendarDisplayTask[],
  weekDateKeys: string[],
) {
  const timedTasks = tasks.filter(
    (task) =>
      isActiveTaskStatus(task.status) &&
      task.plannedDate !== null &&
      weekDateKeys.includes(task.plannedDate) &&
      task.plannedStartTime !== null,
  )
  const taskStartHours = timedTasks.flatMap((task) => {
    const startMinutes = parseTimeMinutes(task.plannedStartTime)

    return startMinutes === null ? [] : [Math.floor(startMinutes / 60)]
  })
  const taskEndHours = timedTasks.flatMap((task) => {
    const endMinutes = getTaskEndMinutes(task)

    return endMinutes === null ? [] : [Math.ceil(endMinutes / 60)]
  })
  const startHour = Math.max(0, Math.min(DEFAULT_START_HOUR, ...taskStartHours))
  const endHour = Math.min(24, Math.max(DEFAULT_END_HOUR, ...taskEndHours))

  return {
    endHour,
    hours: Array.from(
      { length: Math.max(1, endHour - startHour) },
      (_, index) => startHour + index,
    ),
    startHour,
  }
}

export function getTaskTone(task: CalendarDisplayTask) {
  if (isSelfCareCalendarTask(task)) {
    return styles.taskToneSelfCare
  }

  if (task.importance === 'important') {
    return styles.taskToneImportant
  }

  if (task.routine) {
    return styles.taskToneRoutine
  }

  if (getTaskResource(task) > 0) {
    return styles.taskToneRestore
  }

  return styles.taskToneDefault
}

export function getScheduleDotTone(task: CalendarDisplayTask) {
  if (isSelfCareCalendarTask(task)) {
    return styles.scheduleDotSelfCare
  }

  if (task.importance === 'important') {
    return styles.scheduleDotImportant
  }

  if (task.routine) {
    return styles.scheduleDotRoutine
  }

  if (getTaskResource(task) > 0) {
    return styles.scheduleDotRestore
  }

  return styles.scheduleDotDefault
}

export function isReadOnlyCalendarTask(task: CalendarDisplayTask): boolean {
  return isRecurringGhostTask(task) || isSelfCareCalendarTask(task)
}

export function getCalendarTaskAriaLabel(task: CalendarDisplayTask): string {
  if (isRecurringGhostTask(task)) {
    return `Будущий повтор задачи ${task.title}`
  }

  if (isSelfCareCalendarTask(task)) {
    return `Забота: ${task.title}`
  }

  return `Открыть задачу ${task.title}`
}

export function formatScheduleDateMeta(dateKey: string): string {
  const date = parseDateKey(dateKey)
  const month = new Intl.DateTimeFormat('ru-RU', {
    month: 'short',
  }).format(date)
  const weekday = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
  }).format(date)

  return `${month}, ${weekday}`.replaceAll('.', '').toUpperCase()
}

export function getTimedTaskStyle(
  entry: TimelineTaskLayout,
  startHour: number,
  endHour: number,
): CSSProperties {
  const calendarStartMinutes = startHour * 60
  const calendarEndMinutes = endHour * 60
  const totalMinutes = calendarEndMinutes - calendarStartMinutes
  const clampedStart = Math.max(entry.startMinutes, calendarStartMinutes)
  const clampedEnd = Math.min(
    Math.max(entry.endMinutes, clampedStart + 30),
    calendarEndMinutes,
  )
  const top = ((clampedStart - calendarStartMinutes) / totalMinutes) * 100
  const height = ((clampedEnd - clampedStart) / totalMinutes) * 100
  const width = 100 / entry.columns
  const left = entry.column * width

  return {
    height: `max(${height}%, ${MIN_TASK_HEIGHT_REM}rem)`,
    left: `calc(${left}% + 0.18rem)`,
    top: `${top}%`,
    width: `calc(${width}% - 0.36rem)`,
  }
}

export function getCurrentTimeMarkerStyle(
  currentTime: Date,
  startHour: number,
  endHour: number,
  timeZone: string,
): CSSProperties | null {
  const calendarStartMinutes = startHour * 60
  const calendarEndMinutes = endHour * 60
  const totalMinutes = calendarEndMinutes - calendarStartMinutes

  if (totalMinutes <= 0) {
    return null
  }

  const currentMinutes = parseTimeMinutes(
    getTimeInTimeZone(currentTime, timeZone),
  )

  if (currentMinutes === null) {
    return null
  }

  if (
    currentMinutes < calendarStartMinutes ||
    currentMinutes > calendarEndMinutes
  ) {
    return null
  }

  return {
    top: `${((currentMinutes - calendarStartMinutes) / totalMinutes) * 100}%`,
  }
}
