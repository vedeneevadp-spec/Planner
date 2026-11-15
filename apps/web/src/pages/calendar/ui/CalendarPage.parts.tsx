import { cx } from '@/shared/lib/classnames'
import { formatTimeRange } from '@/shared/lib/date'

import {
  type CalendarDisplayTask,
  isRecurringGhostTask,
  isSelfCareCalendarTask,
} from '../lib/calendar-load'
import {
  getCalendarTaskAriaLabel,
  getCurrentTimeMarkerStyle,
  getScheduleDotTone,
  getTaskTone,
  isReadOnlyCalendarTask,
} from './calendar-presentation'
import styles from './CalendarPage.module.css'
export function CurrentTimeMarker({
  currentTime,
  endHour,
  startHour,
  timeZone,
}: {
  currentTime: Date
  endHour: number
  startHour: number
  timeZone: string
}) {
  const markerStyle = getCurrentTimeMarkerStyle(
    currentTime,
    startHour,
    endHour,
    timeZone,
  )

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

export function CalendarTaskPill({
  compact = false,
  onOpenTask,
  task,
}: {
  compact?: boolean
  onOpenTask?: (task: CalendarDisplayTask) => void
  task: CalendarDisplayTask
}) {
  const isGhost = isRecurringGhostTask(task)
  const isSelfCare = isSelfCareCalendarTask(task)
  const isReadOnly = isReadOnlyCalendarTask(task)

  return (
    <button
      data-no-swipe
      className={cx(
        styles.taskPill,
        compact && styles.taskPillCompact,
        isGhost && styles.ghostTask,
        isSelfCare && styles.selfCareCalendarTask,
        getTaskTone(task),
      )}
      type="button"
      aria-label={getCalendarTaskAriaLabel(task)}
      title={task.title}
      disabled={isReadOnly}
      onClick={() => onOpenTask?.(task)}
    >
      <span>{task.title}</span>
    </button>
  )
}

export function CalendarScheduleTask({
  onOpenTask,
  task,
}: {
  onOpenTask: (task: CalendarDisplayTask) => void
  task: CalendarDisplayTask
}) {
  const isGhost = isRecurringGhostTask(task)
  const isSelfCare = isSelfCareCalendarTask(task)
  const isReadOnly = isReadOnlyCalendarTask(task)
  const timeLabel = task.plannedStartTime
    ? formatTimeRange(task.plannedStartTime, task.plannedEndTime)
    : 'Без времени'
  const projectTitle = task.project.trim()

  return (
    <button
      data-no-swipe
      className={cx(
        styles.scheduleTask,
        isGhost && styles.ghostTask,
        isSelfCare && styles.selfCareCalendarTask,
      )}
      type="button"
      aria-label={getCalendarTaskAriaLabel(task)}
      title={task.title}
      disabled={isReadOnly}
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
