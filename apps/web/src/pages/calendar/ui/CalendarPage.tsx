import { type CalendarViewMode, generateUuidV7 } from '@planner/contracts'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router'

import {
  buildTimelineLayout,
  selectPlannedTasks,
  type Task,
} from '@/entities/task'
import { TaskCard } from '@/entities/task/ui'
import { useUploadedIconAssets } from '@/features/emoji-library'
import {
  toPlannerTask,
  usePlanner,
  usePlannerTaskCursor,
} from '@/features/planner'
import { useSelfCarePlan, useSelfCareSettings } from '@/features/self-care'
import {
  usePlannerSession,
  usePlannerTimeZone,
  useUpdateUserPreferences,
  useWorkspaceUsers,
} from '@/features/session'
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
import { cx } from '@/shared/lib/classnames'
import { formatLongDate, formatTimeZoneOffsetLabel } from '@/shared/lib/date'
import {
  isBrowserRetryableOfflineError,
  useBrowserOffline,
} from '@/shared/lib/offline-sync'
import {
  addDateDays,
  getDateDayOfMonth,
  getTodayDate,
} from '@/shared/time/time.service'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  IconMark,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageStateView, PageStatusBanner } from '@/shared/ui/PageState'
import { ModalSurface } from '@/shared/ui/PlannerDialog/ModalSurface'

import {
  buildCalendarMonthLoad,
  buildRecurringGhostTasks,
  buildSelfCareCalendarTasks,
  type CalendarDisplayTask,
  getCalendarMonthDateRange,
  isRecurringGhostTask,
  isSelfCareCalendarTask,
} from '../lib/calendar-load'
import {
  type CalendarPeriodDirection,
  shiftCalendarPeriod,
} from '../lib/calendar-period'
import { useHorizontalPeriodSwipe } from '../lib/useHorizontalPeriodSwipe'
import {
  CALENDAR_VIEW_SEARCH_PARAM,
  DAY_SCHEDULE_SEARCH_PARAM,
  DEFAULT_WEEK_SCROLL_HOUR,
  formatScheduleDateMeta,
  formatTaskCount,
  getCalendarAccessErrorDescription,
  getCalendarTaskAriaLabel,
  getCalendarTitle,
  getCalendarViewModeFromSearchParams,
  getMillisecondsUntilNextMinute,
  getOldestCompleteSyncTimestamp,
  getScheduleDateKeys,
  getTasksForDate,
  getTaskTone,
  getTimedTaskStyle,
  getTimeRange,
  getWeekDateKeys,
  isCalendarAccessUnavailable,
  isReadOnlyCalendarTask,
  LEGACY_TIMELINE_SCHEDULE_SEARCH_PARAM,
  MONTH_VISIBLE_TASK_LIMIT,
  resolveCalendarBlockingState,
  sortCalendarTasks,
  TASK_CREATE_SEARCH_PARAM,
  WEEKDAY_LABELS,
} from './calendar-presentation'
import { CalendarDayScheduleDialog } from './CalendarDayScheduleDialog'
import styles from './CalendarPage.module.css'
import {
  CalendarScheduleTask,
  CalendarTaskPill,
  CurrentTimeMarker,
} from './CalendarPage.parts'
export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isBrowserOffline = useBrowserOffline()
  const {
    copyTaskToPersonal,
    createNextTaskStage,
    detachTaskFromChain,
    hasTaskRecords,
    hasTaskReadError,
    isTaskCacheHydrating,
    isLoading,
    isTaskPending,
    isTaskOffline,
    moveTaskToPersonal,
    readiness,
    refresh,
    removeTask,
    setTaskPlannedDate,
    setTaskSchedule,
    setTaskStatus,
    spheres,
    taskLastSuccessfulSyncAt,
    tasks,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const sessionQuery = usePlannerSession()
  const { mutate: updateUserPreferences } = useUpdateUserPreferences()
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const calendarTimeZoneLabel = formatTimeZoneOffsetLabel(
    currentTime,
    plannerTimeZone,
  )
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
  const [requestedTaskDraft, setRequestedTaskDraft] =
    useState<TaskComposerDraft | null>(null)
  const taskComposerDraft = useMemo<TaskComposerDraft | null>(
    () =>
      createTaskRequestId
        ? requestedTaskDraft?.requestId === createTaskRequestId
          ? requestedTaskDraft
          : {
              plannedDate: null,
              requestId: createTaskRequestId,
            }
        : null,
    [createTaskRequestId, requestedTaskDraft],
  )
  const weekDateKeys = useMemo(() => getWeekDateKeys(anchorDate), [anchorDate])
  const weekDateLabels = useMemo(
    () =>
      new Map(
        weekDateKeys.map((dateKey) => [dateKey, formatLongDate(dateKey)]),
      ),
    [weekDateKeys],
  )
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
  const calendarTaskRangeQuery = usePlannerTaskCursor(
    {
      dateFrom: addDateDays(visibleDateRange.startDateKey, -1),
      dateMode: 'planned',
      dateTo: addDateDays(visibleDateRange.endDateKey, 1),
      direction: 'asc',
      limit: 500,
      scope: 'all',
    },
    { enabled: Boolean(session?.workspaceId) },
  )
  const plannerCalendarTasks = useMemo<Task[]>(() => {
    const tasksById = new Map(tasks.map((task) => [task.id, task]))

    for (const task of calendarTaskRangeQuery.data?.items ?? []) {
      tasksById.set(task.id, toPlannerTask(task, plannerTimeZone))
    }

    return [...tasksById.values()]
  }, [calendarTaskRangeQuery.data?.items, plannerTimeZone, tasks])
  const selectedTask = useMemo(
    () =>
      plannerCalendarTasks.find((task) => task.id === selectedTaskId) ?? null,
    [plannerCalendarTasks, selectedTaskId],
  )
  const workspaceUsersQuery = useWorkspaceUsers({
    enabled: Boolean(selectedTask && isSharedWorkspace),
  })
  const workspaceUsers = workspaceUsersQuery.data?.users ?? []
  const isSelfCareCalendarEnabled = session?.workspace.kind === 'personal'
  const selfCareSettingsQuery = useSelfCareSettings({
    enabled: isSelfCareCalendarEnabled,
  })
  const shouldLoadSelfCareCalendarPlan = Boolean(
    isSelfCareCalendarEnabled &&
    selfCareSettingsQuery.data?.settings.showAppointmentsInCalendar !== false,
  )
  const selfCarePlanQuery = useSelfCarePlan(
    visibleDateRange.startDateKey,
    visibleDateRange.endDateKey,
    {
      enabled: shouldLoadSelfCareCalendarPlan,
    },
  )
  const isPlannerCalendarOffline = isBrowserOffline || isTaskOffline
  const plannerBlockingState = resolveCalendarBlockingState({
    hasTaskRecords,
    isCacheHydrating: isTaskCacheHydrating,
    isOffline: isPlannerCalendarOffline,
    isLoading,
    readiness,
  })
  const isSelfCareCalendarCacheHydrating = Boolean(
    isSelfCareCalendarEnabled &&
    ((selfCareSettingsQuery.data === undefined &&
      selfCareSettingsQuery.isCacheLoading) ||
      (shouldLoadSelfCareCalendarPlan &&
        selfCarePlanQuery.data === undefined &&
        selfCarePlanQuery.isCacheLoading)),
  )
  const isSelfCareCalendarLoading = Boolean(
    isSelfCareCalendarEnabled &&
    (isSelfCareCalendarCacheHydrating ||
      (!isBrowserOffline &&
        ((selfCareSettingsQuery.isPending &&
          selfCareSettingsQuery.data === undefined) ||
          (shouldLoadSelfCareCalendarPlan &&
            selfCarePlanQuery.isPending &&
            selfCarePlanQuery.data === undefined)))),
  )
  const selfCareCalendarError =
    selfCareSettingsQuery.error ??
    (shouldLoadSelfCareCalendarPlan ? selfCarePlanQuery.error : null)
  const isSelfCareCalendarOffline = Boolean(
    isSelfCareCalendarEnabled &&
    (isBrowserOffline || isBrowserRetryableOfflineError(selfCareCalendarError)),
  )
  const hasSelfCareCalendarData = Boolean(
    !isSelfCareCalendarEnabled ||
    (selfCareSettingsQuery.data !== undefined &&
      (!shouldLoadSelfCareCalendarPlan ||
        selfCarePlanQuery.data !== undefined)),
  )
  const calendarLastSuccessfulSyncAt = getOldestCompleteSyncTimestamp([
    taskLastSuccessfulSyncAt,
    ...(isSelfCareCalendarEnabled && hasSelfCareCalendarData
      ? [
          selfCareSettingsQuery.lastSuccessfulSyncAt,
          ...(shouldLoadSelfCareCalendarPlan
            ? [selfCarePlanQuery.lastSuccessfulSyncAt]
            : []),
        ]
      : []),
  ])
  const selfCareCalendarTasks = useMemo(
    () =>
      buildSelfCareCalendarTasks(
        selfCarePlanQuery.data?.occurrences ?? [],
        selfCareSettingsQuery.data?.settings,
        plannerTimeZone,
      ),
    [
      plannerTimeZone,
      selfCarePlanQuery.data?.occurrences,
      selfCareSettingsQuery.data?.settings,
    ],
  )
  const calendarTasks = useMemo<CalendarDisplayTask[]>(
    () => [
      ...plannerCalendarTasks,
      ...buildRecurringGhostTasks(
        plannerCalendarTasks,
        visibleDateRange.startDateKey,
        visibleDateRange.endDateKey,
        todayKey,
      ),
      ...selfCareCalendarTasks,
    ],
    [plannerCalendarTasks, selfCareCalendarTasks, todayKey, visibleDateRange],
  )
  const monthLoad = useMemo(
    () =>
      viewMode === 'month'
        ? buildCalendarMonthLoad(calendarTasks, anchorDate)
        : null,
    [anchorDate, calendarTasks, viewMode],
  )
  const scheduleDays = useMemo(
    () =>
      viewMode === 'schedule'
        ? scheduleDateKeys
            .map((dateKey) => ({
              dateKey,
              tasks: getTasksForDate(calendarTasks, dateKey),
            }))
            .filter((day) => day.tasks.length > 0)
        : [],
    [calendarTasks, scheduleDateKeys, viewMode],
  )
  const hasScheduleDays = scheduleDays.length > 0
  const calendarBlockingState = plannerBlockingState
  const isCalendarRestoring =
    readiness.reason === 'auth_restoring' ||
    readiness.reason === 'planner_pending'
  const canUseCalendarActions =
    calendarBlockingState === null &&
    !isCalendarAccessUnavailable(readiness) &&
    !isCalendarRestoring
  const calendarBannerKind =
    calendarBlockingState === null &&
    (isPlannerCalendarOffline || isSelfCareCalendarOffline)
      ? ('offline' as const)
      : calendarBlockingState === null && isCalendarRestoring
        ? ('info' as const)
        : calendarBlockingState === null &&
            (hasTaskReadError ||
              Boolean(calendarTaskRangeQuery.error) ||
              Boolean(selfCareCalendarError))
          ? ('error' as const)
          : calendarBlockingState === null &&
              calendarTaskRangeQuery.data?.truncated
            ? ('info' as const)
            : null
  const isCalendarUpdating =
    calendarBlockingState === null &&
    calendarBannerKind === null &&
    ((calendarTaskRangeQuery.isPending &&
      calendarTaskRangeQuery.data === undefined) ||
      (isSelfCareCalendarLoading && !hasSelfCareCalendarData))
  const isCalendarAccessIssue = isCalendarAccessUnavailable(readiness)
  const calendarBannerTitle =
    calendarBannerKind === 'offline'
      ? 'Нет подключения'
      : calendarBannerKind === 'info'
        ? isCalendarRestoring
          ? 'Восстанавливаем доступ'
          : 'Большой диапазон загружен частично'
        : isCalendarAccessIssue
          ? 'Нужно восстановить доступ'
          : 'Календарь обновился не полностью'
  const calendarBannerDescription =
    calendarBannerKind === 'offline'
      ? !hasSelfCareCalendarData
        ? 'Показываем сохранённые задачи. Записи заботы о себе появятся после восстановления подключения.'
        : 'Показываем последние сохранённые данные.'
      : calendarBannerKind === 'info'
        ? isCalendarRestoring
          ? 'Сохранённые данные доступны для просмотра. Изменения появятся после восстановления доступа.'
          : calendarTaskRangeQuery.data?.truncated
            ? `Показаны первые ${calendarTaskRangeQuery.data.returnedCount} из ${calendarTaskRangeQuery.data.totalCount} задач выбранного диапазона.`
            : undefined
        : isCalendarAccessIssue
          ? 'Сохранённые данные доступны для просмотра. Обновите доступ, чтобы снова получать изменения.'
          : 'Сохранённые данные остаются доступны. Повторите обновление.'
  const scheduleEmptyTitle = hasSelfCareCalendarData
    ? 'На выбранные дни задач нет'
    : 'В сохранённых задачах на выбранные дни ничего нет'
  const scheduleEmptyDescription = hasSelfCareCalendarData
    ? 'Добавьте задачу на один из выбранных дней — она появится в расписании.'
    : isSelfCareCalendarOffline
      ? 'Записи заботы о себе появятся после восстановления подключения. Обычную задачу можно добавить сейчас.'
      : isSelfCareCalendarLoading
        ? 'Записи заботы о себе ещё загружаются. Обычную задачу можно добавить сейчас.'
        : selfCareCalendarError
          ? 'Записи заботы о себе пока не удалось обновить. Обычную задачу можно добавить сейчас.'
          : 'Записи заботы о себе ещё не загружены. Обычную задачу можно добавить сейчас.'
  const dayTimelineEntries = useMemo(
    () =>
      viewMode === 'day' ? buildTimelineLayout(calendarTasks, anchorDate) : [],
    [anchorDate, calendarTasks, viewMode],
  )
  const weekTimelineEntries = useMemo(() => {
    if (viewMode !== 'week') {
      return new Map<string, ReturnType<typeof buildTimelineLayout>>()
    }

    return new Map(
      weekDateKeys.map((dateKey) => [
        dateKey,
        buildTimelineLayout(calendarTasks, dateKey),
      ]),
    )
  }, [calendarTasks, viewMode, weekDateKeys])
  const weekUntimedTasks = useMemo(
    () =>
      new Map(
        viewMode === 'week'
          ? weekDateKeys.map((dateKey) => [
              dateKey,
              getTasksForDate(calendarTasks, dateKey).filter(
                (task) => !task.plannedStartTime,
              ),
            ])
          : [],
      ),
    [calendarTasks, weekDateKeys, viewMode],
  )
  const hasWeekUntimedTasks = [...weekUntimedTasks.values()].some(
    (items) => items.length > 0,
  )
  const dayUnscheduledTasks = useMemo(() => {
    if (viewMode !== 'day') return []

    const scheduledTaskIds = new Set(
      buildTimelineLayout(plannerCalendarTasks, anchorDate).map(
        (entry) => entry.task.id,
      ),
    )

    return selectPlannedTasks(plannerCalendarTasks, anchorDate).filter(
      (task) => !scheduledTaskIds.has(task.id),
    )
  }, [anchorDate, plannerCalendarTasks, viewMode])
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
    enabled: canSwipePeriod,
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
    if (isReadOnlyCalendarTask(task)) {
      return
    }

    setSelectedTaskId(task.id)
  }

  function openDaySchedule() {
    if (!canUseCalendarActions) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set(DAY_SCHEDULE_SEARCH_PARAM, '1')
    setSearchParams(nextSearchParams)
  }

  function openTaskComposer() {
    requestTaskComposer({ plannedDate: anchorDate })
  }

  function requestTaskComposer(draft: Omit<TaskComposerDraft, 'requestId'>) {
    if (!canUseCalendarActions) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    const requestId = `calendar-empty-${generateUuidV7()}`
    setRequestedTaskDraft({ ...draft, requestId })
    nextSearchParams.set(TASK_CREATE_SEARCH_PARAM, requestId)
    setSearchParams(nextSearchParams)
  }

  function refreshCalendar() {
    const refreshOperations: Array<Promise<unknown>> = [
      refresh({ retryDeniedAuth: isCalendarAccessIssue }),
      calendarTaskRangeQuery.refetch(),
    ]

    if (isSelfCareCalendarEnabled) {
      refreshOperations.push(selfCareSettingsQuery.refetch())
    }

    if (shouldLoadSelfCareCalendarPlan) {
      refreshOperations.push(selfCarePlanQuery.refetch())
    }

    void Promise.allSettled(refreshOperations)
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
    if (!createTaskRequestId || !canUseCalendarActions) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(TASK_CREATE_SEARCH_PARAM)
    setSearchParams(nextSearchParams, { replace: true })
  }, [
    canUseCalendarActions,
    createTaskRequestId,
    searchParams,
    setSearchParams,
  ])

  useEffect(() => {
    if (
      !isDayScheduleModalRequested ||
      !canUseCalendarActions ||
      (viewMode === 'day' && dayUnscheduledTasks.length > 0)
    ) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(DAY_SCHEDULE_SEARCH_PARAM)
    nextSearchParams.delete(LEGACY_TIMELINE_SCHEDULE_SEARCH_PARAM)
    setSearchParams(nextSearchParams, { replace: true })
  }, [
    canUseCalendarActions,
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
    if (calendarBlockingState || (viewMode !== 'day' && viewMode !== 'week')) {
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
      const stickyOffset = header?.offsetHeight ?? 0
      const surfaceRect = surface.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const targetTop = targetRect.top - surfaceRect.top + surface.scrollTop

      surface.scrollTop = Math.max(0, targetTop - stickyOffset)
      lastTimelineScrollKeyRef.current = timelineScrollKey
    })

    return () => window.cancelAnimationFrame(frame)
  }, [
    anchorDate,
    calendarBlockingState,
    timeRange.endHour,
    timeRange.startHour,
    viewMode,
  ])

  return (
    <section
      className={`${pageStyles.page} ${styles.calendarPage}`}
      data-calendar-view={viewMode}
    >
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
          <div className={styles.periodTitle}>
            <strong data-testid="calendar-period-title">{title}</strong>
            {isCalendarUpdating ? (
              <span
                className={styles.calendarLoadingStatus}
                role="status"
                aria-label="Обновляем календарь"
                title="Обновляем календарь"
              >
                <span
                  className={styles.calendarLoadingSpinner}
                  aria-hidden="true"
                />
                <span className={styles.visuallyHidden}>
                  Обновляем календарь
                </span>
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.toolbarActions}>
          {canUseCalendarActions &&
          viewMode === 'day' &&
          dayUnscheduledTasks.length > 0 ? (
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
            hideOpenButton={!canUseCalendarActions}
            initialPlannedDate={null}
            openDraft={canUseCalendarActions ? taskComposerDraft : null}
            openButtonAriaLabel="Создать задачу"
            openButtonLabel="Задача"
            showTimeFields
          />
        </div>
      </header>

      <div className={styles.calendarContent}>
        {calendarBlockingState ? (
          <section
            className={cx(styles.scheduleSurface, styles.scheduleSurfaceState)}
            aria-label="Состояние календаря"
          >
            {calendarBlockingState === 'loading' ? (
              <PageStateView
                kind="loading"
                title={
                  isBrowserOffline &&
                  (isTaskCacheHydrating || isSelfCareCalendarCacheHydrating)
                    ? 'Проверяем сохранённый календарь'
                    : 'Загружаем календарь'
                }
                skeletonVariant="calendar"
              />
            ) : calendarBlockingState === 'offline' ? (
              <PageStateView
                kind="offline"
                title="Календарь недоступен без подключения"
                description="На этом устройстве ещё нет полного сохранённого набора данных календаря. Подключитесь к сети и попробуйте снова."
                lastSyncedAt={calendarLastSuccessfulSyncAt}
                showUnknownLastSync
                action={{ label: 'Повторить', onClick: refreshCalendar }}
              />
            ) : (
              <PageStateView
                kind="error"
                title={
                  selfCareCalendarError && hasTaskRecords
                    ? 'Не удалось загрузить календарь полностью'
                    : isCalendarAccessIssue
                      ? 'Нужно восстановить доступ к календарю'
                      : 'Не удалось загрузить календарь'
                }
                description={
                  selfCareCalendarError && hasTaskRecords
                    ? 'Основные задачи доступны, но данные заботы о себе не загрузились. Повторите попытку.'
                    : getCalendarAccessErrorDescription(readiness)
                }
                action={{ label: 'Повторить', onClick: refreshCalendar }}
              />
            )}
          </section>
        ) : (
          <>
            {calendarBannerKind ? (
              <div className={styles.calendarStatusBanner}>
                <PageStatusBanner
                  kind={calendarBannerKind}
                  title={calendarBannerTitle}
                  description={calendarBannerDescription}
                  lastSyncedAt={calendarLastSuccessfulSyncAt}
                  showUnknownLastSync
                  action={
                    calendarBannerKind === 'info' && !isCalendarRestoring
                      ? undefined
                      : {
                          label: isCalendarAccessIssue
                            ? 'Обновить доступ'
                            : 'Обновить',
                          onClick: refreshCalendar,
                        }
                  }
                />
              </div>
            ) : null}

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
                tabIndex={0}
              >
                <div
                  className={cx(styles.weekTimeGrid, styles.dayTimeGrid)}
                  style={
                    { '--hour-count': timeRange.hours.length } as CSSProperties
                  }
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
                      {dayTimelineEntries.map((entry) => {
                        const isGhost = isRecurringGhostTask(entry.task)
                        const isSelfCare = isSelfCareCalendarTask(entry.task)
                        const isReadOnly = isReadOnlyCalendarTask(entry.task)

                        return (
                          <button
                            data-no-swipe
                            key={entry.task.id}
                            className={cx(
                              styles.timedTask,
                              styles.dayTimedTask,
                              isGhost && styles.ghostTask,
                              isSelfCare && styles.selfCareCalendarTask,
                              getTaskTone(entry.task),
                            )}
                            type="button"
                            disabled={isReadOnly}
                            style={getTimedTaskStyle(
                              entry,
                              timeRange.startHour,
                              timeRange.endHour,
                            )}
                            aria-label={getCalendarTaskAriaLabel(entry.task)}
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
                        )
                      })}
                      {anchorDate === todayKey ? (
                        <CurrentTimeMarker
                          currentTime={currentTime}
                          endHour={timeRange.endHour}
                          startHour={timeRange.startHour}
                          timeZone={plannerTimeZone}
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
                tabIndex={0}
              >
                <div className={styles.weekHeaderGrid}>
                  <div className={styles.timeZoneLabel} title={plannerTimeZone}>
                    {calendarTimeZoneLabel}
                  </div>
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
                        <strong>{getDateDayOfMonth(dateKey)}</strong>
                      </div>
                    )
                  })}
                  {hasWeekUntimedTasks ? (
                    <>
                      <span className={styles.weekUntimedLabel}>
                        Без времени
                      </span>
                      {weekDateKeys.map((dateKey) => (
                        <div
                          key={dateKey}
                          className={styles.weekUntimedTasks}
                          role="group"
                          aria-label={`Без времени, ${weekDateLabels.get(dateKey)}`}
                        >
                          {(weekUntimedTasks.get(dateKey) ?? []).map((task) => (
                            <CalendarTaskPill
                              key={task.id}
                              compact
                              onOpenTask={openTaskCard}
                              task={task}
                            />
                          ))}
                        </div>
                      ))}
                    </>
                  ) : null}
                </div>

                <div
                  className={styles.weekTimeGrid}
                  style={
                    { '--hour-count': timeRange.hours.length } as CSSProperties
                  }
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
                      const timelineEntries =
                        weekTimelineEntries.get(dateKey) ?? []

                      return (
                        <div key={dateKey} className={styles.weekColumn}>
                          {timeRange.hours.map((hour) => {
                            const startTime = `${String(hour).padStart(2, '0')}:00`

                            return (
                              <button
                                key={hour}
                                data-period-swipe
                                className={cx(
                                  styles.hourSlot,
                                  styles.hourSlotButton,
                                )}
                                type="button"
                                disabled={!canUseCalendarActions}
                                aria-label={`Создать задачу, ${weekDateLabels.get(dateKey)}, ${startTime}`}
                                onClick={() =>
                                  requestTaskComposer({
                                    plannedDate: dateKey,
                                    plannedStartTime: startTime,
                                    preservePlannedDate: true,
                                  })
                                }
                              />
                            )
                          })}
                          {timelineEntries.map((entry) => {
                            const isGhost = isRecurringGhostTask(entry.task)
                            const isSelfCare = isSelfCareCalendarTask(
                              entry.task,
                            )
                            const isReadOnly = isReadOnlyCalendarTask(
                              entry.task,
                            )

                            return (
                              <button
                                data-no-swipe
                                key={entry.task.id}
                                className={cx(
                                  styles.timedTask,
                                  isGhost && styles.ghostTask,
                                  isSelfCare && styles.selfCareCalendarTask,
                                  getTaskTone(entry.task),
                                )}
                                type="button"
                                disabled={isReadOnly}
                                style={getTimedTaskStyle(
                                  entry,
                                  timeRange.startHour,
                                  timeRange.endHour,
                                )}
                                aria-label={getCalendarTaskAriaLabel(
                                  entry.task,
                                )}
                                title={entry.task.title}
                                onClick={() => openTaskCard(entry.task)}
                              >
                                <strong>{entry.task.title}</strong>
                              </button>
                            )
                          })}
                          {dateKey === todayKey ? (
                            <CurrentTimeMarker
                              currentTime={currentTime}
                              endHour={timeRange.endHour}
                              startHour={timeRange.startHour}
                              timeZone={plannerTimeZone}
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
                tabIndex={0}
              >
                <div className={styles.monthWeekdays}>
                  {WEEKDAY_LABELS.map((weekday) => (
                    <span key={weekday}>{weekday}</span>
                  ))}
                </div>

                <div className={styles.monthGrid}>
                  {monthLoad?.days.map((day) => {
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
                          aria-label={`Открыть день ${getDateDayOfMonth(day.dateKey)}`}
                          onClick={() => {
                            setAnchorDate(day.dateKey)
                            selectViewMode('day')
                          }}
                        >
                          <span className={styles.monthDate}>
                            {getDateDayOfMonth(day.dateKey)}
                          </span>
                        </button>
                        <span className={styles.monthTaskList}>
                          {dayTasks
                            .slice(0, MONTH_VISIBLE_TASK_LIMIT)
                            .map((task) => (
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
              <section
                className={cx(
                  styles.scheduleSurface,
                  !hasScheduleDays && styles.scheduleSurfaceState,
                )}
                aria-label="Расписание"
                tabIndex={hasScheduleDays ? 0 : undefined}
              >
                {hasScheduleDays ? (
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
                              {getDateDayOfMonth(day.dateKey)}
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
                    <PageStateView
                      kind="empty"
                      title={scheduleEmptyTitle}
                      description={scheduleEmptyDescription}
                      action={
                        canUseCalendarActions
                          ? {
                              label: 'Добавить задачу',
                              onClick: openTaskComposer,
                            }
                          : undefined
                      }
                    />
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {canUseCalendarActions &&
      isDayScheduleModalOpen &&
      typeof document !== 'undefined'
        ? createPortal(
            <CalendarDayScheduleDialog
              tasks={dayUnscheduledTasks}
              spheres={spheres}
              todayKey={todayKey}
              isTaskPending={(taskId) =>
                !canUseCalendarActions || isTaskPending(taskId)
              }
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
            <ModalSurface
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
                  allTasks={plannerCalendarTasks}
                  task={selectedTask}
                  sphere={spheres.find(
                    (sphere) => sphere.id === selectedTask.projectId,
                  )}
                  spheres={spheres}
                  todayKey={todayKey}
                  tomorrowKey={addDateDays(todayKey, 1)}
                  variant="detail"
                  isPending={
                    !canUseCalendarActions || isTaskPending(selectedTask.id)
                  }
                  isSharedWorkspace={isSharedWorkspace}
                  currentActorUserId={session?.actorUserId}
                  sharedWorkspaceGroupRole={session?.groupRole}
                  sharedWorkspaceRole={session?.role}
                  uploadedIcons={uploadedIcons}
                  workspaceUsers={workspaceUsers}
                  onCreateNextStage={(taskId, input) =>
                    createNextTaskStage(taskId, input)
                  }
                  onCopyToPersonal={(taskId) => {
                    void copyTaskToPersonal(taskId)
                  }}
                  onDetachFromChain={(taskId) => {
                    void detachTaskFromChain(taskId)
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
            </ModalSurface>,
            document.body,
          )
        : null}
    </section>
  )
}
