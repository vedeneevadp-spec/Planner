import type { CalendarViewMode } from '@planner/contracts'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  buildTimelineLayout,
  getTaskResource,
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
import { TaskComposer } from '@/features/task-create'
import { cx } from '@/shared/lib/classnames'
import { addDays, formatTimeRange, getDateKey } from '@/shared/lib/date'
import { ChevronLeftIcon, ChevronRightIcon } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import {
  buildCalendarMonthLoad,
  buildRecurringGhostTasks,
  type CalendarDisplayTask,
  getCalendarMonthDateRange,
  isRecurringGhostTask,
  shiftCalendarMonth,
} from '../lib/calendar-load'
import styles from './CalendarPage.module.css'

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const
const DEFAULT_START_HOUR = 0
const DEFAULT_END_HOUR = 24
const MIN_TASK_HEIGHT_REM = 2.2
const MONTH_VISIBLE_TASK_LIMIT = 5
const SCHEDULE_VISIBLE_DAYS = 14

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

  return Array.from({ length: SCHEDULE_VISIBLE_DAYS }, (_, index) =>
    getDateKey(addDays(startDate, index)),
  )
}

function getCalendarTitle(mode: CalendarViewMode, anchorDateKey: string) {
  if (mode === 'month') {
    return formatMonthTitle(anchorDateKey)
  }

  if (mode === 'schedule') {
    const endDateKey = getDateKey(
      addDays(parseDateKey(anchorDateKey), SCHEDULE_VISIBLE_DAYS - 1),
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

function shiftCalendarDate(
  dateKey: string,
  mode: CalendarViewMode,
  amount: number,
): string {
  if (mode === 'month') {
    return shiftCalendarMonth(dateKey, amount)
  }

  if (mode === 'schedule') {
    return getDateKey(
      addDays(parseDateKey(dateKey), amount * SCHEDULE_VISIBLE_DAYS),
    )
  }

  return getDateKey(addDays(parseDateKey(dateKey), amount * 7))
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
  const {
    isTaskPending,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
    spheres,
    tasks,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const sessionQuery = usePlannerSession()
  const updateUserPreferencesMutation = useUpdateUserPreferences()
  const todayKey = getDateKey(new Date())
  const session = sessionQuery.data
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const persistedViewMode = session?.userPreferences.calendarViewMode ?? 'week'
  const [viewMode, setViewMode] = useState<CalendarViewMode>(persistedViewMode)
  const [anchorDate, setAnchorDate] = useState(todayKey)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
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
  const visibleDateRange = useMemo(() => {
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
  const timeRange = useMemo(
    () => getTimeRange(calendarTasks, weekDateKeys),
    [calendarTasks, weekDateKeys],
  )
  const title = getCalendarTitle(viewMode, anchorDate)

  function shiftPeriod(amount: number) {
    setAnchorDate((current) => shiftCalendarDate(current, viewMode, amount))
  }

  function selectViewMode(nextViewMode: CalendarViewMode) {
    setViewMode(nextViewMode)

    if (
      sessionQuery.data &&
      nextViewMode !== sessionQuery.data.userPreferences.calendarViewMode
    ) {
      updateUserPreferencesMutation.mutate({
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

  useEffect(() => {
    setViewMode(persistedViewMode)
  }, [persistedViewMode])

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
            onClick={() => shiftPeriod(-1)}
          >
            <ChevronLeftIcon size={18} strokeWidth={2.2} />
          </button>
          <button
            className={styles.arrowButton}
            type="button"
            aria-label="Следующий период"
            title="Следующий период"
            onClick={() => shiftPeriod(1)}
          >
            <ChevronRightIcon size={18} strokeWidth={2.2} />
          </button>
          <strong className={styles.periodTitle}>{title}</strong>
        </div>

        <div className={styles.viewControls}>
          <div className={styles.segmentedControl} role="group">
            <button
              className={cx(
                styles.segmentButton,
                viewMode === 'week' && styles.segmentButtonActive,
              )}
              type="button"
              aria-pressed={viewMode === 'week'}
              onClick={() => selectViewMode('week')}
            >
              Неделя
            </button>
            <button
              className={cx(
                styles.segmentButton,
                viewMode === 'month' && styles.segmentButtonActive,
              )}
              type="button"
              aria-pressed={viewMode === 'month'}
              onClick={() => selectViewMode('month')}
            >
              Месяц
            </button>
            <button
              className={cx(
                styles.segmentButton,
                viewMode === 'schedule' && styles.segmentButtonActive,
              )}
              type="button"
              aria-pressed={viewMode === 'schedule'}
              onClick={() => selectViewMode('schedule')}
            >
              Расписание
            </button>
          </div>

          <TaskComposer
            key={anchorDate}
            initialPlannedDate={anchorDate}
            openButtonLabel="Задача"
          />
        </div>
      </header>

      {viewMode === 'week' ? (
        <section className={styles.weekSurface} aria-label="Неделя">
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
                <div key={hour} className={styles.timeLabel}>
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
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      ) : viewMode === 'month' ? (
        <section className={styles.monthSurface} aria-label="Месяц">
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
                    className={styles.monthDateButton}
                    type="button"
                    aria-label={`Открыть неделю ${parseDateKey(day.dateKey).getDate()}`}
                    onClick={() => {
                      setAnchorDate(day.dateKey)
                      selectViewMode('week')
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
                  isPending={isTaskPending(selectedTask.id)}
                  isSharedWorkspace={isSharedWorkspace}
                  currentActorUserId={session?.actorUserId}
                  sharedWorkspaceGroupRole={session?.groupRole}
                  sharedWorkspaceRole={session?.role}
                  uploadedIcons={uploadedIcons}
                  workspaceUsers={workspaceUsers}
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
