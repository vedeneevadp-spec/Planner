import type { SelfCareSettings, SelfCareTodayItem } from '@planner/contracts'

import { getTaskResource, isActiveTaskStatus, type Task } from '@/entities/task'
import {
  addDateDays,
  addDateMonthsClamped,
  getDateDayOfMonth,
  getDateDistance,
  getDateMonthKey,
  getIsoWeekday,
  getIsoWeekStartDate,
  getMonthStartDate,
  getTimeInTimeZone,
} from '@/shared/time/time.service'

const CALENDAR_GRID_DAY_COUNT = 42
const DEFAULT_TIMED_TASK_MINUTES = 60
const HIDDEN_SELF_CARE_CALENDAR_OCCURRENCE_STATUSES: ReadonlySet<
  NonNullable<SelfCareTodayItem['occurrence']>['status']
> = new Set(['cancelled', 'done', 'missed', 'moved', 'partial', 'skipped'])
const SELF_CARE_APPOINTMENT_CALENDAR_TYPES = new Set<
  SelfCareTodayItem['item']['type']
>(['appointment', 'procedure', 'medical'])

export type CalendarLoadState = 'calm' | 'heavy' | 'overload' | 'steady'

export interface CalendarGhostTask extends Task {
  isRecurringGhost: true
  sourceTaskId: string
}

export interface CalendarSelfCareTask extends Task {
  isSelfCare: true
  selfCareEntry: SelfCareTodayItem
}

export type CalendarDisplayTask =
  | CalendarGhostTask
  | CalendarSelfCareTask
  | Task

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

function getCalendarMonthKey(dateKey: string): string {
  return getDateMonthKey(dateKey)
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
  if (isSelfCareCalendarTask(task)) {
    return 1
  }

  const resource = getTaskResource(task)

  if (resource < 0) {
    return Math.abs(resource)
  }

  return 1
}

export function shiftCalendarMonth(dateKey: string, amount: number): string {
  return addDateMonthsClamped(getMonthStartDate(dateKey), amount, 1)
}

export function getCalendarMonthDateRange(anchorDateKey: string): {
  endDateKey: string
  startDateKey: string
} {
  const monthStart = getMonthStartDate(anchorDateKey)
  const gridStart = addDateDays(monthStart, 1 - getIsoWeekday(monthStart))
  const gridEnd = addDateDays(gridStart, CALENDAR_GRID_DAY_COUNT - 1)

  return {
    endDateKey: gridEnd,
    startDateKey: gridStart,
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
    (task) => isActiveTaskStatus(task.status) && task.plannedDate === dateKey,
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
  const monthStart = getMonthStartDate(anchorDateKey)
  const gridStart = addDateDays(monthStart, 1 - getIsoWeekday(monthStart))
  const monthKey = getCalendarMonthKey(monthStart)
  const days = Array.from({ length: CALENDAR_GRID_DAY_COUNT }, (_, index) => {
    const dateKey = addDateDays(gridStart, index)
    const summary = getCalendarDaySummary(tasks, dateKey)

    return {
      ...summary,
      dayOfMonth: getDateDayOfMonth(dateKey),
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

export function isRecurringGhostTask(
  task: CalendarDisplayTask,
): task is CalendarGhostTask {
  return 'isRecurringGhost' in task && task.isRecurringGhost === true
}

export function isSelfCareCalendarTask(
  task: CalendarDisplayTask,
): task is CalendarSelfCareTask {
  return 'isSelfCare' in task && task.isSelfCare === true
}

function extractSelfCareTime(
  value: string | null | undefined,
  timeZone?: string | null,
): string | null {
  if (!value) {
    return null
  }

  if (value.includes('T') && timeZone) {
    try {
      return getTimeInTimeZone(value, timeZone)
    } catch {
      // Fall through to legacy string extraction below.
    }
  }

  const isoTime = /T(\d{2}:\d{2})/.exec(value)?.[1]
  const plainTime = /^(\d{2}:\d{2})/.exec(value)?.[1]

  return isoTime ?? plainTime ?? null
}

function getSelfCareCalendarStartTime(
  entry: SelfCareTodayItem,
  plannerTimeZone: string,
): string | null {
  const timeZone =
    entry.occurrence?.reminderTimeZone ??
    entry.scheduleRule?.timezone ??
    plannerTimeZone

  return (
    extractSelfCareTime(entry.occurrence?.dueAt, timeZone) ??
    extractSelfCareTime(entry.appointment?.startsAt, timeZone) ??
    extractSelfCareTime(entry.scheduleRule?.preferredTime, timeZone)
  )
}

function addMinutesToTime(startTime: string, minutes: number): string | null {
  const startMinutes = parseTimeMinutes(startTime)

  if (startMinutes === null) {
    return null
  }

  const endMinutes = Math.min(startMinutes + minutes, 23 * 60 + 59)

  if (endMinutes <= startMinutes) {
    return null
  }

  const hours = Math.floor(endMinutes / 60)
  const minutesPart = endMinutes % 60

  return `${String(hours).padStart(2, '0')}:${String(minutesPart).padStart(
    2,
    '0',
  )}`
}

function getSelfCareCalendarEndTime(
  entry: SelfCareTodayItem,
  startTime: string | null,
  plannerTimeZone: string,
): string | null {
  if (!startTime) {
    return null
  }

  const appointmentEndTime = extractSelfCareTime(
    entry.appointment?.endsAt,
    entry.occurrence?.reminderTimeZone ??
      entry.scheduleRule?.timezone ??
      plannerTimeZone,
  )

  if (appointmentEndTime && appointmentEndTime > startTime) {
    return appointmentEndTime
  }

  return addMinutesToTime(startTime, entry.item.defaultDurationMinutes ?? 45)
}

function shouldShowSelfCareCalendarEntry(
  entry: SelfCareTodayItem,
  settings: SelfCareSettings | null | undefined,
  plannerTimeZone: string,
): boolean {
  if (!settings || entry.item.isArchived || !entry.item.isActive) {
    return false
  }

  if (!entry.occurrence) {
    return false
  }

  if (
    HIDDEN_SELF_CARE_CALENDAR_OCCURRENCE_STATUSES.has(entry.occurrence.status)
  ) {
    return false
  }

  if (!SELF_CARE_APPOINTMENT_CALENDAR_TYPES.has(entry.item.type)) {
    return false
  }

  if (isPlanningOnlySelfCareRepeat(entry)) {
    return false
  }

  return (
    settings.showAppointmentsInCalendar &&
    getSelfCareCalendarStartTime(entry, plannerTimeZone) !== null
  )
}

function isPlanningOnlySelfCareRepeat(entry: SelfCareTodayItem): boolean {
  return Boolean(
    entry.scheduleRule?.repeatKind === 'after_completion' &&
    entry.occurrence &&
    entry.appointment?.occurrenceId !== entry.occurrence.id,
  )
}

export function buildSelfCareCalendarTask(
  entry: SelfCareTodayItem,
  plannerTimeZone = 'UTC',
): CalendarSelfCareTask | null {
  const occurrence = entry.occurrence

  if (!occurrence) {
    return null
  }

  const plannedStartTime = getSelfCareCalendarStartTime(entry, plannerTimeZone)

  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: occurrence.createdAt,
    dueDate: null,
    icon: entry.item.icon ?? '',
    id: `self-care:${occurrence.id}`,
    importance: 'not_important',
    isSelfCare: true,
    linkedTask: null,
    note: entry.item.description,
    plannedDate: occurrence.scheduledFor,
    plannedEndTime: getSelfCareCalendarEndTime(
      entry,
      plannedStartTime,
      plannerTimeZone,
    ),
    plannedStartTime,
    project: 'Забота',
    projectId: null,
    recurrence: null,
    reminderOffsets: undefined,
    remindBeforeStart: undefined,
    requiresConfirmation: false,
    resource: null,
    routine: null,
    selfCareEntry: entry,
    sourceWorkspace: null,
    sphereId: null,
    status: 'todo',
    title: entry.item.title,
    urgency: 'not_urgent',
  }
}

export function buildSelfCareCalendarTasks(
  entries: SelfCareTodayItem[],
  settings: SelfCareSettings | null | undefined,
  plannerTimeZone = 'UTC',
): CalendarSelfCareTask[] {
  return entries
    .filter((entry) =>
      shouldShowSelfCareCalendarEntry(entry, settings, plannerTimeZone),
    )
    .map((entry) => buildSelfCareCalendarTask(entry, plannerTimeZone))
    .filter((task): task is CalendarSelfCareTask => task !== null)
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

    if (!isActiveTaskStatus(task.status)) {
      continue
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
  const targetDay = getDateDayOfMonth(startDateKey)
  const dateKeys: string[] = []

  for (let offset = 0; offset <= 600; offset += interval) {
    const dateKey = addDateKeyMonthsClamped(startDateKey, offset, targetDay)

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
    if (
      scheduledDays.has(getIsoWeekday(cursor)) &&
      getWeekDistance(startWeek, cursor) % recurrence.interval === 0
    ) {
      dateKeys.push(cursor)
    }

    cursor = addDateKeyDays(cursor, 1)
  }

  return dateKeys
}

function addDateKeyDays(dateKey: string, amount: number): string {
  return addDateDays(dateKey, amount)
}

function addDateKeyMonthsClamped(
  dateKey: string,
  monthOffset: number,
  targetDay: number,
): string {
  return addDateMonthsClamped(dateKey, monthOffset, targetDay)
}

function getWeekStartDate(dateKey: string): string {
  return getIsoWeekStartDate(dateKey)
}

function getWeekDistance(startWeek: string, dateKey: string): number {
  return Math.floor(
    getDateDistance(startWeek, getIsoWeekStartDate(dateKey)) / 7,
  )
}

function maxDateKey(left: string, right: string): string {
  return left > right ? left : right
}

function minDateKey(left: string, right: string): string {
  return left < right ? left : right
}
