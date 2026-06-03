import type { CalendarViewMode } from '@planner/contracts'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'

import {
  buildTimelineLayout,
  getTaskResource,
  selectPlannedTasks,
  type Task,
  TaskCard,
  type TimelineTaskLayout,
} from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import {
  usePlannerSession,
  useUpdateUserPreferences,
  useWorkspaceUsers,
} from '@/features/session'
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
import { cx } from '@/shared/lib/classnames'
import {
  addDays,
  formatLongDate,
  formatTimeRange,
  getDateKey,
} from '@/shared/lib/date'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  IconMark,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import {
  buildCalendarMonthLoad,
  buildRecurringGhostTasks,
  type CalendarDisplayTask,
  getCalendarMonthDateRange,
  isRecurringGhostTask,
} from '../lib/calendar-load'
import {
  type CalendarPeriodDirection,
  SCHEDULE_PERIOD_DAYS,
  shiftCalendarPeriod,
} from '../lib/calendar-period'
import { useHorizontalPeriodSwipe } from '../lib/useHorizontalPeriodSwipe'
import { CalendarDayScheduleDialog } from './CalendarDayScheduleDialog'
import styles from './CalendarPage.module.css'

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const
const DEFAULT_START_HOUR = 0
const DEFAULT_END_HOUR = 24
const DEFAULT_WEEK_SCROLL_HOUR = 7
const MIN_TASK_HEIGHT_REM = 2.2
const MONTH_VISIBLE_TASK_LIMIT = 5
const CALENDAR_VIEW_SEARCH_PARAM = 'calendarView'
const DAY_SCHEDULE_SEARCH_PARAM = 'calendarDaySchedule'
const LEGACY_TIMELINE_SCHEDULE_SEARCH_PARAM = 'timelineSchedule'
const TASK_CREATE_SEARCH_PARAM = 'createTask'

function getMillisecondsUntilNextMinute(date: Date): number {
  const elapsedMinuteMilliseconds =
    date.getSeconds() * 1000 + date.getMilliseconds()
  const remainingMilliseconds = 60_000 - elapsedMinuteMilliseconds

  return remainingMilliseconds > 0 ? remainingMilliseconds : 60_000
}

function formatTaskCount(value: number): string {
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

function getCalendarViewModeFromSearchParams(
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

function parseDateKey(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  return new Date(year, month - 1, day, 12)
}

function formatMonthTitle(dateKey: string): string {
  const title = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(parseDateKey(dateKey))

  return title.charAt(0).toUpperCase() + title.slice(1)
}

function formatDayTitle(dateKey: string): string {
  const title = formatLongDate(dateKey)

  return title.charAt(0).toUpperCase() + title.slice(1)
}

function formatWeekTitle(startDateKey: string, endDateKey: string): string {
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

function getWeekStartDateKey(dateKey: string): string {
  const date = parseDateKey(dateKey)
  const day = date.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1

  return getDateKey(addDays(date, -daysFromMonday))
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

function getTaskEndMinutes(task: Task): number | null {
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

function getWeekDateKeys(anchorDateKey: string): string[] {
  const weekStart = getWeekStartDateKey(anchorDateKey)
  const weekStartDate = parseDateKey(weekStart)

  return Array.from({ length: 7 }, (_, index) =>
    getDateKey(addDays(weekStartDate, index)),
  )
}

function getTaskSortKey(task: CalendarDisplayTask): string {
  return `${task.plannedStartTime ?? '99:99'}:${task.createdAt}:${task.id}`
}

function sortCalendarTasks(
  tasks: CalendarDisplayTask[],
): CalendarDisplayTask[] {
  return [...tasks].sort((left, right) =>
    getTaskSortKey(left).localeCompare(getTaskSortKey(right)),
  )
}

function getTasksForDate(
  tasks: CalendarDisplayTask[],
  dateKey: string,
): CalendarDisplayTask[] {
  return sortCalendarTasks(
    tasks.filter(
      (task) => task.status !== 'done' && task.plannedDate === dateKey,
    ),
  )
}

function getUntimedTasksForDate(
  tasks: CalendarDisplayTask[],
  dateKey: string,
): CalendarDisplayTask[] {
  return getTasksForDate(tasks, dateKey).filter(
    (task) => !task.plannedStartTime,
  )
}

function getScheduleDateKeys(anchorDateKey: string): string[] {
  const startDate = parseDateKey(anchorDateKey)

  return Array.from({ length: SCHEDULE_PERIOD_DAYS }, (_, index) =>
    getDateKey(addDays(startDate, index)),
  )
}

function getCalendarTitle(mode: CalendarViewMode, anchorDateKey: string) {
  if (mode === 'day') {
    return formatDayTitle(anchorDateKey)
  }

  if (mode === 'month') {
    return formatMonthTitle(anchorDateKey)
  }

  if (mode === 'schedule') {
    const endDateKey = getDateKey(
      addDays(parseDateKey(anchorDateKey), SCHEDULE_PERIOD_DAYS - 1),
    )

    return formatWeekTitle(anchorDateKey, endDateKey)
  }

  const weekDays = getWeekDateKeys(anchorDateKey)

  return formatWeekTitle(weekDays[0]!, weekDays[6]!)
}

function getTimeRange(tasks: CalendarDisplayTask[], weekDateKeys: string[]) {
  const timedTasks = tasks.filter(
    (task) =>
      task.status !== 'done' &&
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

function getTaskTone(task: CalendarDisplayTask) {
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

function getScheduleDotTone(task: CalendarDisplayTask) {
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

function formatScheduleDateMeta(dateKey: string): string {
  const date = parseDateKey(dateKey)
  const month = new Intl.DateTimeFormat('ru-RU', {
    month: 'short',
  }).format(date)
  const weekday = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
  }).format(date)

  return `${month}, ${weekday}`.replaceAll('.', '').toUpperCase()
}

function getTimedTaskStyle(
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

function getCurrentTimeMarkerStyle(
  currentTime: Date,
  startHour: number,
  endHour: number,
): CSSProperties | null {
  const calendarStartMinutes = startHour * 60
  const calendarEndMinutes = endHour * 60
  const totalMinutes = calendarEndMinutes - calendarStartMinutes

  if (totalMinutes <= 0) {
    return null
  }

  const currentMinutes =
    currentTime.getHours() * 60 +
    currentTime.getMinutes() +
    currentTime.getSeconds() / 60

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

function CurrentTimeMarker({
  currentTime,
  endHour,
  startHour,
}: {
  currentTime: Date
  endHour: number
  startHour: number
}) {
  const markerStyle = getCurrentTimeMarkerStyle(currentTime, startHour, endHour)

  if (!markerStyle) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className={styles.currentTimeMarker}
      data-testid="calendar-current-time-marker"
      style={markerStyle}
    />
  )
}

function CalendarTaskPill({
  compact = false,
  onOpenTask,
  task,
}: {
  compact?: boolean
  onOpenTask?: (task: CalendarDisplayTask) => void
  task: CalendarDisplayTask
}) {
  const isGhost = isRecurringGhostTask(task)

  return (
    <button
      data-no-swipe
      className={cx(
        styles.taskPill,
        compact && styles.taskPillCompact,
        isGhost && styles.ghostTask,
        getTaskTone(task),
      )}
      type="button"
      aria-label={
        isGhost
          ? `Будущий повтор задачи ${task.title}`
          : `Открыть задачу ${task.title}`
      }
      title={task.title}
      disabled={isGhost}
      onClick={() => onOpenTask?.(task)}
    >
      <span>{task.title}</span>
    </button>
  )
}

function CalendarScheduleTask({
  onOpenTask,
  task,
}: {
  onOpenTask: (task: CalendarDisplayTask) => void
  task: CalendarDisplayTask
}) {
  const isGhost = isRecurringGhostTask(task)
  const timeLabel = task.plannedStartTime
    ? formatTimeRange(task.plannedStartTime, task.plannedEndTime)
    : 'Без времени'
  const projectTitle = task.project.trim()

  return (
    <button
      data-no-swipe
      className={cx(styles.scheduleTask, isGhost && styles.ghostTask)}
      type="button"
      aria-label={
        isGhost
          ? `Будущий повтор задачи ${task.title}`
          : `Открыть задачу ${task.title}`
      }
      title={task.title}
      disabled={isGhost}
      onClick={() => onOpenTask(task)}
    >
      <span
        className={cx(styles.scheduleDot, getScheduleDotTone(task))}
        aria-hidden="true"
      />
      <span className={styles.scheduleTime}>{timeLabel}</span>
      <span className={styles.scheduleTaskBody}>
        <span className={styles.scheduleTaskTitle}>{task.title}</span>
        {projectTitle ? (
          <span className={styles.scheduleTaskContext}>{projectTitle}</span>
        ) : null}
      </span>
    </button>
  )
}

export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    copyTaskToPersonal,
    isTaskPending,
    moveTaskToPersonal,
    removeTask,
    setTaskPlannedDate,
    setTaskSchedule,
    setTaskStatus,
    spheres,
    tasks,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const sessionQuery = usePlannerSession()
  const { mutate: updateUserPreferences } = useUpdateUserPreferences()
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const todayKey = getDateKey(currentTime)
  const session = sessionQuery.data
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const persistedViewMode = session?.userPreferences.calendarViewMode ?? 'week'
  const requestedViewMode = getCalendarViewModeFromSearchParams(searchParams)
  const sessionPreferenceKey = session
    ? `${session.actorUserId}:${session.workspaceId}`
    : null
  const timelineSurfaceRef = useRef<HTMLElement | null>(null)
  const lastTimelineScrollKeyRef = useRef<string | null>(null)
  const lastCalendarViewPreferenceSyncRef = useRef<string | null>(null)
  const periodTransitionTimeoutRef = useRef<number | null>(null)
  const [viewModeState, setViewModeState] = useState<{
    mode: CalendarViewMode
    sessionPreferenceKey: string | null
  }>(() => ({
    mode: persistedViewMode,
    sessionPreferenceKey,
  }))
  const viewMode =
    requestedViewMode ??
    (viewModeState.sessionPreferenceKey === sessionPreferenceKey
      ? viewModeState.mode
      : persistedViewMode)
  const calendarSearch = searchParams.toString()
  const [anchorDate, setAnchorDate] = useState(todayKey)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [periodTransition, setPeriodTransition] =
    useState<CalendarPeriodDirection | null>(null)
  const createTaskRequestId = searchParams.get(TASK_CREATE_SEARCH_PARAM)
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )
  const taskComposerDraft = useMemo<TaskComposerDraft | null>(
    () =>
      createTaskRequestId
        ? {
            plannedDate: anchorDate,
            requestId: createTaskRequestId,
          }
        : null,
    [anchorDate, createTaskRequestId],
  )
  const workspaceUsersQuery = useWorkspaceUsers({
    enabled: Boolean(selectedTask && isSharedWorkspace),
  })
  const workspaceUsers = workspaceUsersQuery.data?.users ?? []
  const weekDateKeys = useMemo(() => getWeekDateKeys(anchorDate), [anchorDate])
  const scheduleDateKeys = useMemo(
    () => getScheduleDateKeys(anchorDate),
    [anchorDate],
  )
  const timedDateKeys = useMemo(
    () => (viewMode === 'day' ? [anchorDate] : weekDateKeys),
    [anchorDate, viewMode, weekDateKeys],
  )
  const visibleDateRange = useMemo(() => {
    if (viewMode === 'day') {
      return {
        endDateKey: anchorDate,
        startDateKey: anchorDate,
      }
    }

    if (viewMode === 'month') {
      return getCalendarMonthDateRange(anchorDate)
    }

    if (viewMode === 'schedule') {
      return {
        endDateKey: scheduleDateKeys[scheduleDateKeys.length - 1] ?? anchorDate,
        startDateKey: scheduleDateKeys[0] ?? anchorDate,
      }
    }

    return {
      endDateKey: weekDateKeys[weekDateKeys.length - 1] ?? anchorDate,
      startDateKey: weekDateKeys[0] ?? anchorDate,
    }
  }, [anchorDate, scheduleDateKeys, viewMode, weekDateKeys])
  const calendarTasks = useMemo<CalendarDisplayTask[]>(
    () => [
      ...tasks,
      ...buildRecurringGhostTasks(
        tasks,
        visibleDateRange.startDateKey,
        visibleDateRange.endDateKey,
        todayKey,
      ),
    ],
    [tasks, todayKey, visibleDateRange],
  )
  const monthLoad = useMemo(
    () => buildCalendarMonthLoad(calendarTasks, anchorDate),
    [anchorDate, calendarTasks],
  )
  const scheduleDays = useMemo(
    () =>
      scheduleDateKeys
        .map((dateKey) => ({
          dateKey,
          tasks: getTasksForDate(calendarTasks, dateKey),
        }))
        .filter((day) => day.tasks.length > 0),
    [calendarTasks, scheduleDateKeys],
  )
  const dayTimelineEntries = useMemo(
    () => buildTimelineLayout(calendarTasks, anchorDate),
    [anchorDate, calendarTasks],
  )
  const dayUnscheduledTasks = useMemo(() => {
    const scheduledTaskIds = new Set(
      buildTimelineLayout(tasks, anchorDate).map((entry) => entry.task.id),
    )

    return selectPlannedTasks(tasks, anchorDate).filter(
      (task) => !scheduledTaskIds.has(task.id),
    )
  }, [anchorDate, tasks])
  const timeRange = useMemo(
    () => getTimeRange(calendarTasks, timedDateKeys),
    [calendarTasks, timedDateKeys],
  )
  const isDayScheduleModalRequested =
    searchParams.get(DAY_SCHEDULE_SEARCH_PARAM) === '1' ||
    searchParams.get(LEGACY_TIMELINE_SCHEDULE_SEARCH_PARAM) === '1'
  const isDayScheduleModalOpen =
    viewMode === 'day' &&
    isDayScheduleModalRequested &&
    dayUnscheduledTasks.length > 0
  const dayUnscheduledTaskCountLabel = formatTaskCount(
    dayUnscheduledTasks.length,
  )
  const title = getCalendarTitle(viewMode, anchorDate)
  const canSwipePeriod =
    viewMode === 'day' || viewMode === 'week' || viewMode === 'month'
  const periodTransitionClass =
    periodTransition === 'next'
      ? styles.periodTransitionNext
      : periodTransition === 'prev'
        ? styles.periodTransitionPrev
        : undefined
  const periodSwipeHandlers = useHorizontalPeriodSwipe({
    enabled: canSwipePeriod && !periodTransition,
    onSwipeLeft: () => shiftPeriod('next'),
    onSwipeRight: () => shiftPeriod('prev'),
  })

  function startPeriodTransition(direction: CalendarPeriodDirection) {
    if (periodTransitionTimeoutRef.current !== null) {
      window.clearTimeout(periodTransitionTimeoutRef.current)
    }

    setPeriodTransition(direction)
    periodTransitionTimeoutRef.current = window.setTimeout(() => {
      setPeriodTransition(null)
      periodTransitionTimeoutRef.current = null
    }, 220)
  }

  function shiftPeriod(direction: CalendarPeriodDirection) {
    startPeriodTransition(direction)
    setAnchorDate((current) =>
      shiftCalendarPeriod(current, viewMode, direction),
    )
  }

  function selectViewMode(nextViewMode: CalendarViewMode) {
    setViewModeState({
      mode: nextViewMode,
      sessionPreferenceKey,
    })

    if (requestedViewMode !== nextViewMode) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set(CALENDAR_VIEW_SEARCH_PARAM, nextViewMode)
      setSearchParams(nextParams)
    }

    if (
      sessionQuery.data &&
      nextViewMode !== sessionQuery.data.userPreferences.calendarViewMode
    ) {
      lastCalendarViewPreferenceSyncRef.current = `${sessionPreferenceKey ?? 'anonymous'}:${nextViewMode}`
      updateUserPreferences({
        calendarViewMode: nextViewMode,
      })
    }
  }

  function openTaskCard(task: CalendarDisplayTask) {
    if (isRecurringGhostTask(task)) {
      return
    }

    setSelectedTaskId(task.id)
  }

  function openDaySchedule() {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set(DAY_SCHEDULE_SEARCH_PARAM, '1')
    setSearchParams(nextSearchParams)
  }

  function closeDaySchedule() {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(DAY_SCHEDULE_SEARCH_PARAM)
    nextSearchParams.delete(LEGACY_TIMELINE_SCHEDULE_SEARCH_PARAM)
    setSearchParams(nextSearchParams, { replace: true })
  }

  useEffect(() => {
    return () => {
      if (periodTransitionTimeoutRef.current !== null) {
        window.clearTimeout(periodTransitionTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    function syncCurrentTime() {
      setCurrentTime(new Date())
    }

    let intervalId: number | undefined
    const timeoutId = window.setTimeout(() => {
      syncCurrentTime()
      intervalId = window.setInterval(syncCurrentTime, 60_000)
    }, getMillisecondsUntilNextMinute(new Date()))

    return () => {
      window.clearTimeout(timeoutId)

      if (intervalId !== undefined) {
        window.clearInterval(intervalId)
      }
    }
  }, [])

  useEffect(() => {
    if (!createTaskRequestId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(TASK_CREATE_SEARCH_PARAM)
    setSearchParams(nextSearchParams, { replace: true })
  }, [createTaskRequestId, searchParams, setSearchParams])

  useEffect(() => {
    if (
      !isDayScheduleModalRequested ||
      (viewMode === 'day' && dayUnscheduledTasks.length > 0)
    ) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(DAY_SCHEDULE_SEARCH_PARAM)
    nextSearchParams.delete(LEGACY_TIMELINE_SCHEDULE_SEARCH_PARAM)
    setSearchParams(nextSearchParams, { replace: true })
  }, [
    dayUnscheduledTasks.length,
    isDayScheduleModalRequested,
    searchParams,
    setSearchParams,
    viewMode,
  ])

  useEffect(() => {
    if (requestedViewMode || persistedViewMode === 'week') {
      return
    }

    const nextParams = new URLSearchParams(calendarSearch)
    nextParams.delete(TASK_CREATE_SEARCH_PARAM)
    nextParams.set(CALENDAR_VIEW_SEARCH_PARAM, persistedViewMode)
    setSearchParams(nextParams, { replace: true })
  }, [calendarSearch, persistedViewMode, requestedViewMode, setSearchParams])

  useEffect(() => {
    if (!requestedViewMode) {
      return
    }

    if (!sessionQuery.data) {
      return
    }

    if (
      requestedViewMode === sessionQuery.data.userPreferences.calendarViewMode
    ) {
      lastCalendarViewPreferenceSyncRef.current = null

      return
    }

    const syncKey = `${sessionPreferenceKey ?? 'anonymous'}:${requestedViewMode}`

    if (lastCalendarViewPreferenceSyncRef.current === syncKey) {
      return
    }

    lastCalendarViewPreferenceSyncRef.current = syncKey
    updateUserPreferences({
      calendarViewMode: requestedViewMode,
    })
  }, [
    requestedViewMode,
    sessionPreferenceKey,
    sessionQuery.data,
    updateUserPreferences,
  ])

  useEffect(() => {
    if (viewMode !== 'day' && viewMode !== 'week') {
      lastTimelineScrollKeyRef.current = null

      return
    }

    const timelineScrollKey = `${viewMode}:${anchorDate}:${timeRange.startHour}:${timeRange.endHour}`

    if (lastTimelineScrollKeyRef.current === timelineScrollKey) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const surface = timelineSurfaceRef.current

      if (!surface) {
        return
      }

      const lastVisibleHour = Math.max(
        timeRange.startHour,
        timeRange.endHour - 1,
      )
      const targetHour = Math.min(
        Math.max(DEFAULT_WEEK_SCROLL_HOUR, timeRange.startHour),
        lastVisibleHour,
      )
      const target = surface.querySelector<HTMLElement>(
        `[data-calendar-hour="${targetHour}"]`,
      )

      if (!target) {
        return
      }

      const header = surface.querySelector<HTMLElement>(
        `.${styles.weekHeaderGrid}`,
      )
      const allDay = surface.querySelector<HTMLElement>(`.${styles.allDayGrid}`)
      const stickyOffset =
        (header?.offsetHeight ?? 0) + (allDay?.offsetHeight ?? 0)
      const surfaceRect = surface.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const targetTop = targetRect.top - surfaceRect.top + surface.scrollTop

      surface.scrollTop = Math.max(0, targetTop - stickyOffset)
      lastTimelineScrollKeyRef.current = timelineScrollKey
    })

    return () => window.cancelAnimationFrame(frame)
  }, [anchorDate, timeRange.endHour, timeRange.startHour, viewMode])

  return (
    <section className={`${pageStyles.page} ${styles.calendarPage}`}>
      <h1 className={styles.visuallyHidden}>Календарь</h1>

      <header className={styles.toolbar}>
        <div className={styles.periodControls}>
          <button
            className={styles.todayButton}
            type="button"
            onClick={() => setAnchorDate(todayKey)}
          >
            Сегодня
          </button>
          <button
            className={styles.arrowButton}
            type="button"
            aria-label="Предыдущий период"
            title="Предыдущий период"
            onClick={() => shiftPeriod('prev')}
          >
            <ChevronLeftIcon size={18} strokeWidth={2.2} />
          </button>
          <button
            className={styles.arrowButton}
            type="button"
            aria-label="Следующий период"
            title="Следующий период"
            onClick={() => shiftPeriod('next')}
          >
            <ChevronRightIcon size={18} strokeWidth={2.2} />
          </button>
          <strong
            className={styles.periodTitle}
            data-testid="calendar-period-title"
          >
            {title}
          </strong>
        </div>

        <div className={styles.toolbarActions}>
          {viewMode === 'day' && dayUnscheduledTasks.length > 0 ? (
            <button
              className={styles.distributeButton}
              type="button"
              aria-label={`Распределить ${dayUnscheduledTaskCountLabel}`}
              title={`Распределить ${dayUnscheduledTaskCountLabel}`}
              onClick={openDaySchedule}
            >
              <ClockIcon size={22} strokeWidth={2.2} />
              <span>Распределить {dayUnscheduledTaskCountLabel}</span>
            </button>
          ) : null}
          <TaskComposer
            key={anchorDate}
            desktopOpenButtonHidden
            initialPlannedDate={anchorDate}
            openDraft={taskComposerDraft}
            openButtonAriaLabel="Создать задачу"
            openButtonLabel="Задача"
            showTimeFields
          />
        </div>
      </header>

      {viewMode === 'day' ? (
        <section
          {...periodSwipeHandlers}
          ref={timelineSurfaceRef}
          className={cx(
            styles.weekSurface,
            styles.daySurface,
            styles.periodSwipeSurface,
            periodTransitionClass,
          )}
          aria-label="День"
        >
          <div
            className={cx(styles.weekTimeGrid, styles.dayTimeGrid)}
            style={{ '--hour-count': timeRange.hours.length } as CSSProperties}
          >
            <div className={styles.timeAxis}>
              {timeRange.hours.map((hour) => (
                <div
                  key={hour}
                  className={styles.timeLabel}
                  data-calendar-hour={hour}
                >
                  {String(hour).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            <div className={cx(styles.weekColumns, styles.dayColumns)}>
              <div className={cx(styles.weekColumn, styles.dayColumn)}>
                {timeRange.hours.map((hour) => (
                  <div key={hour} className={styles.hourSlot} />
                ))}
                {dayTimelineEntries.map((entry) => (
                  <button
                    data-no-swipe
                    key={entry.task.id}
                    className={cx(
                      styles.timedTask,
                      styles.dayTimedTask,
                      isRecurringGhostTask(entry.task) && styles.ghostTask,
                      getTaskTone(entry.task),
                    )}
                    type="button"
                    disabled={isRecurringGhostTask(entry.task)}
                    style={getTimedTaskStyle(
                      entry,
                      timeRange.startHour,
                      timeRange.endHour,
                    )}
                    aria-label={
                      isRecurringGhostTask(entry.task)
                        ? `Будущий повтор задачи ${entry.task.title}`
                        : `Открыть задачу ${entry.task.title}`
                    }
                    title={entry.task.title}
                    onClick={() => openTaskCard(entry.task)}
                  >
                    <strong className={styles.timedTaskTitle}>
                      {entry.task.icon ? (
                        <IconMark
                          className={styles.timedTaskIcon}
                          value={entry.task.icon}
                          uploadedIcons={uploadedIcons}
                        />
                      ) : null}
                      <span>{entry.task.title}</span>
                    </strong>
                    {entry.task.project ? (
                      <span className={styles.timedTaskProject}>
                        {entry.task.project}
                      </span>
                    ) : null}
                  </button>
                ))}
                {anchorDate === todayKey ? (
                  <CurrentTimeMarker
                    currentTime={currentTime}
                    endHour={timeRange.endHour}
                    startHour={timeRange.startHour}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : viewMode === 'week' ? (
        <section
          {...periodSwipeHandlers}
          ref={timelineSurfaceRef}
          className={cx(
            styles.weekSurface,
            styles.periodSwipeSurface,
            periodTransitionClass,
          )}
          aria-label="Неделя"
        >
          <div className={styles.weekHeaderGrid}>
            <div className={styles.timeZoneLabel}>GMT+7</div>
            {weekDateKeys.map((dateKey, index) => {
              const isToday = dateKey === todayKey

              return (
                <div
                  key={dateKey}
                  className={cx(
                    styles.weekDayHeader,
                    isToday && styles.weekDayHeaderToday,
                  )}
                >
                  <span>{WEEKDAY_LABELS[index] ?? ''}</span>
                  <strong>{parseDateKey(dateKey).getDate()}</strong>
                </div>
              )
            })}
          </div>

          <div className={styles.allDayGrid}>
            <div className={styles.allDayLabel}>Без времени</div>
            {weekDateKeys.map((dateKey) => {
              const untimedTasks = getUntimedTasksForDate(
                calendarTasks,
                dateKey,
              )

              return (
                <div key={dateKey} className={styles.allDayCell}>
                  {untimedTasks.slice(0, 3).map((task) => (
                    <CalendarTaskPill
                      key={task.id}
                      compact
                      task={task}
                      onOpenTask={openTaskCard}
                    />
                  ))}
                  {untimedTasks.length > 3 ? (
                    <span className={styles.moreTasks}>
                      +{untimedTasks.length - 3}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div
            className={styles.weekTimeGrid}
            style={{ '--hour-count': timeRange.hours.length } as CSSProperties}
          >
            <div className={styles.timeAxis}>
              {timeRange.hours.map((hour) => (
                <div
                  key={hour}
                  className={styles.timeLabel}
                  data-calendar-hour={hour}
                >
                  {String(hour).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            <div className={styles.weekColumns}>
              {weekDateKeys.map((dateKey) => {
                const timelineEntries = buildTimelineLayout(
                  calendarTasks,
                  dateKey,
                )

                return (
                  <div key={dateKey} className={styles.weekColumn}>
                    {timeRange.hours.map((hour) => (
                      <div key={hour} className={styles.hourSlot} />
                    ))}
                    {timelineEntries.map((entry) => (
                      <button
                        data-no-swipe
                        key={entry.task.id}
                        className={cx(
                          styles.timedTask,
                          isRecurringGhostTask(entry.task) && styles.ghostTask,
                          getTaskTone(entry.task),
                        )}
                        type="button"
                        disabled={isRecurringGhostTask(entry.task)}
                        style={getTimedTaskStyle(
                          entry,
                          timeRange.startHour,
                          timeRange.endHour,
                        )}
                        aria-label={
                          isRecurringGhostTask(entry.task)
                            ? `Будущий повтор задачи ${entry.task.title}`
                            : `Открыть задачу ${entry.task.title}`
                        }
                        title={entry.task.title}
                        onClick={() => openTaskCard(entry.task)}
                      >
                        <strong>{entry.task.title}</strong>
                      </button>
                    ))}
                    {dateKey === todayKey ? (
                      <CurrentTimeMarker
                        currentTime={currentTime}
                        endHour={timeRange.endHour}
                        startHour={timeRange.startHour}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      ) : viewMode === 'month' ? (
        <section
          {...periodSwipeHandlers}
          className={cx(
            styles.monthSurface,
            styles.periodSwipeSurface,
            periodTransitionClass,
          )}
          aria-label="Месяц"
        >
          <div className={styles.monthWeekdays}>
            {WEEKDAY_LABELS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className={styles.monthGrid}>
            {monthLoad.days.map((day) => {
              const dayTasks = sortCalendarTasks(day.plannedTasks)
              const hiddenTaskCount = Math.max(
                0,
                dayTasks.length - MONTH_VISIBLE_TASK_LIMIT,
              )

              return (
                <div
                  key={day.dateKey}
                  className={cx(
                    styles.monthCell,
                    !day.isCurrentMonth && styles.monthCellMuted,
                    day.dateKey === todayKey && styles.monthCellToday,
                  )}
                >
                  <button
                    data-no-swipe
                    className={styles.monthDateButton}
                    type="button"
                    aria-label={`Открыть день ${parseDateKey(day.dateKey).getDate()}`}
                    onClick={() => {
                      setAnchorDate(day.dateKey)
                      selectViewMode('day')
                    }}
                  >
                    <span className={styles.monthDate}>
                      {parseDateKey(day.dateKey).getDate()}
                    </span>
                  </button>
                  <span className={styles.monthTaskList}>
                    {dayTasks.slice(0, MONTH_VISIBLE_TASK_LIMIT).map((task) => (
                      <CalendarTaskPill
                        key={task.id}
                        compact
                        task={task}
                        onOpenTask={openTaskCard}
                      />
                    ))}
                    {hiddenTaskCount > 0 ? (
                      <span className={styles.moreTasks}>
                        +{hiddenTaskCount}
                      </span>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <section className={styles.scheduleSurface} aria-label="Расписание">
          {scheduleDays.length > 0 ? (
            <div className={styles.scheduleList}>
              {scheduleDays.map((day) => {
                const isToday = day.dateKey === todayKey

                return (
                  <section
                    key={day.dateKey}
                    className={cx(
                      styles.scheduleDay,
                      isToday && styles.scheduleDayToday,
                    )}
                    aria-label={formatScheduleDateMeta(day.dateKey)}
                  >
                    <div className={styles.scheduleDate}>
                      <span className={styles.scheduleDateNumber}>
                        {parseDateKey(day.dateKey).getDate()}
                      </span>
                      <span className={styles.scheduleDateMeta}>
                        {formatScheduleDateMeta(day.dateKey)}
                      </span>
                    </div>
                    <div className={styles.scheduleTasks}>
                      {isToday ? (
                        <span
                          className={styles.scheduleTodayLine}
                          aria-hidden="true"
                        />
                      ) : null}
                      {day.tasks.map((task) => (
                        <CalendarScheduleTask
                          key={task.id}
                          task={task}
                          onOpenTask={openTaskCard}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <div className={styles.scheduleEmpty}>
              На выбранные дни задач нет.
            </div>
          )}
        </section>
      )}

      {isDayScheduleModalOpen && typeof document !== 'undefined'
        ? createPortal(
            <CalendarDayScheduleDialog
              tasks={dayUnscheduledTasks}
              spheres={spheres}
              isTaskPending={isTaskPending}
              uploadedIcons={uploadedIcons}
              onClose={closeDaySchedule}
              onRemove={(taskId) => {
                void removeTask(taskId)
              }}
              onSetPlannedDate={(taskId, plannedDate) => {
                void setTaskPlannedDate(taskId, plannedDate)
              }}
              onSetSchedule={(taskId, schedule) => {
                void setTaskSchedule(taskId, schedule)
              }}
              onSetStatus={(taskId, status) => {
                void setTaskStatus(taskId, status)
              }}
              onUpdate={updateTask}
            />,
            document.body,
          )
        : null}

      {selectedTask && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={styles.taskOverlay}
              role="dialog"
              aria-modal="true"
              aria-label="Карточка задачи"
            >
              <button
                className={styles.taskOverlayBackdrop}
                type="button"
                aria-label="Закрыть карточку задачи"
                onClick={() => setSelectedTaskId(null)}
              />
              <div className={styles.taskOverlayPanel}>
                <div className={styles.taskOverlayHeader}>
                  <button
                    className={styles.taskOverlayClose}
                    type="button"
                    aria-label="Закрыть"
                    onClick={() => setSelectedTaskId(null)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
                <TaskCard
                  task={selectedTask}
                  sphere={spheres.find(
                    (sphere) => sphere.id === selectedTask.projectId,
                  )}
                  spheres={spheres}
                  variant="detail"
                  isPending={isTaskPending(selectedTask.id)}
                  isSharedWorkspace={isSharedWorkspace}
                  currentActorUserId={session?.actorUserId}
                  sharedWorkspaceGroupRole={session?.groupRole}
                  sharedWorkspaceRole={session?.role}
                  uploadedIcons={uploadedIcons}
                  workspaceUsers={workspaceUsers}
                  onCopyToPersonal={(taskId) => {
                    void copyTaskToPersonal(taskId)
                  }}
                  onMoveToPersonal={(taskId) => {
                    void moveTaskToPersonal(taskId)
                  }}
                  onRemove={(taskId) => {
                    void removeTask(taskId)
                  }}
                  onSetPlannedDate={(taskId, plannedDate) => {
                    void setTaskPlannedDate(taskId, plannedDate)
                  }}
                  onSetStatus={(taskId, status) => {
                    void setTaskStatus(taskId, status)
                  }}
                  onUpdate={updateTask}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
