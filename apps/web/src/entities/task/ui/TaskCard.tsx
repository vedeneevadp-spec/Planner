import type { Project } from '@/entities/project'
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
  project?: Project | undefined
  tone?: 'default' | 'warning' | 'success'
  isPending?: boolean | undefined
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onRemove: (taskId: string) => void
}

export function TaskCard({
  task,
  project,
  tone = 'default',
  isPending = false,
  onSetStatus,
  onSetPlannedDate,
  onRemove,
}: TaskCardProps) {
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const projectTitle = project?.title ?? task.project.trim()
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
          {projectTitle ? (
            <span className={styles.projectBadge}>
              {project ? (
                <span
                  className={styles.projectIcon}
                  style={{ backgroundColor: project.color }}
                  aria-hidden="true"
                >
                  {project.icon}
                </span>
              ) : null}
              <span>Проект: {projectTitle}</span>
            </span>
          ) : (
            <span className={styles.projectBadgeMuted}>Без проекта</span>
          )}

          <h4>{task.title}</h4>
          {task.note ? <p>{task.note}</p> : null}
        </div>

        <div className={styles.meta}>
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
              disabled={isPending}
              onClick={() => onSetStatus(task.id, 'done')}
            >
              Done
            </button>
            {task.plannedDate !== todayKey ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
                onClick={() => onSetPlannedDate(task.id, todayKey)}
              >
                Today
              </button>
            ) : null}
            {task.plannedDate !== tomorrowKey ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
                onClick={() => onSetPlannedDate(task.id, tomorrowKey)}
              >
                Tomorrow
              </button>
            ) : null}
            {task.plannedDate ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
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
            disabled={isPending}
            onClick={() => onSetStatus(task.id, 'todo')}
          >
            Reopen
          </button>
        )}

        <button
          className={cx(styles.button, styles.dangerButton)}
          type="button"
          disabled={isPending}
          onClick={() => onRemove(task.id)}
        >
          Delete
        </button>
      </div>
    </article>
  )
}
