import type { Task, TaskStatus } from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import {
  addDays,
  formatShortDate,
  formatTimeRange,
  getDateKey,
} from '@/shared/lib/date'

import styles from './TaskCard.module.css'

interface TaskCardProps {
  task: Task
  tone?: 'default' | 'warning' | 'success'
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onRemove: (taskId: string) => void
}

export function TaskCard({
  task,
  tone = 'default',
  onSetStatus,
  onSetPlannedDate,
  onRemove,
}: TaskCardProps) {
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const toneClass =
    tone === 'warning'
      ? styles.warning
      : tone === 'success'
        ? styles.success
        : undefined

  return (
    <article className={cx(styles.card, toneClass)}>
      <div className={styles.main}>
        <div className={styles.copy}>
          <h4>{task.title}</h4>
          {task.note ? <p>{task.note}</p> : null}
        </div>

        <div className={styles.meta}>
          {task.project ? (
            <span className={styles.metaChip}>{task.project}</span>
          ) : null}
          {task.plannedStartTime ? (
            <span className={styles.metaChip}>
              Time {formatTimeRange(task.plannedStartTime, task.plannedEndTime)}
            </span>
          ) : null}
          {task.plannedDate ? (
            <span className={styles.metaChip}>
              Plan {formatShortDate(task.plannedDate)}
            </span>
          ) : null}
          {task.dueDate ? (
            <span className={styles.metaChip}>
              Due {formatShortDate(task.dueDate)}
            </span>
          ) : null}
        </div>
      </div>

      <div className={styles.actions}>
        {task.status === 'todo' ? (
          <>
            <button
              className={styles.button}
              type="button"
              onClick={() => onSetStatus(task.id, 'done')}
            >
              Done
            </button>
            {task.plannedDate !== todayKey ? (
              <button
                className={styles.button}
                type="button"
                onClick={() => onSetPlannedDate(task.id, todayKey)}
              >
                Today
              </button>
            ) : null}
            {task.plannedDate !== tomorrowKey ? (
              <button
                className={styles.button}
                type="button"
                onClick={() => onSetPlannedDate(task.id, tomorrowKey)}
              >
                Tomorrow
              </button>
            ) : null}
            {task.plannedDate ? (
              <button
                className={styles.button}
                type="button"
                onClick={() => onSetPlannedDate(task.id, null)}
              >
                Inbox
              </button>
            ) : null}
          </>
        ) : (
          <button
            className={styles.button}
            type="button"
            onClick={() => onSetStatus(task.id, 'todo')}
          >
            Reopen
          </button>
        )}

        <button
          className={cx(styles.button, styles.dangerButton)}
          type="button"
          onClick={() => onRemove(task.id)}
        >
          Delete
        </button>
      </div>
    </article>
  )
}
