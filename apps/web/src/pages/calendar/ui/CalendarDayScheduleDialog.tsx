import { type FormEvent, useEffect, useRef, useState } from 'react'

import type { Sphere } from '@/entities/sphere'
import {
  type Task,
  TaskEditDialog,
  type TaskScheduleInput,
  type TaskStatus,
  type TaskUpdateInput,
} from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import { formatShortDate, formatTimeRange } from '@/shared/lib/date'
import {
  CheckIcon,
  EditIcon,
  IconMark,
  MoreIcon,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import styles from './CalendarPage.module.css'

interface CalendarDayScheduleDialogProps {
  isTaskPending: (taskId: string) => boolean
  onClose: () => void
  onRemove: (taskId: string) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onSetSchedule: (taskId: string, schedule: TaskScheduleInput) => void
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
  spheres: Sphere[]
  tasks: Task[]
  uploadedIcons?: UploadedIconAsset[] | undefined
}

interface CalendarDayScheduleTaskProps extends Omit<
  CalendarDayScheduleDialogProps,
  'onClose' | 'tasks'
> {
  task: Task
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

function CalendarDayScheduleTask({
  isTaskPending,
  onRemove,
  onSetPlannedDate,
  onSetSchedule,
  onSetStatus,
  onUpdate,
  spheres,
  task,
  uploadedIcons = [],
}: CalendarDayScheduleTaskProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isPending = isTaskPending(task.id)
  const [plannedStartTime, setPlannedStartTime] = useState(
    task.plannedStartTime ?? '',
  )
  const [plannedEndTime, setPlannedEndTime] = useState(
    task.plannedEndTime ?? '',
  )
  const isInvalidRange =
    plannedStartTime !== '' &&
    plannedEndTime !== '' &&
    plannedEndTime <= plannedStartTime
  const hasScheduleDraft = plannedStartTime !== '' || plannedEndTime !== ''

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    onSetSchedule(task.id, {
      plannedDate: task.plannedDate,
      plannedEndTime: plannedEndTime || null,
      plannedStartTime: plannedStartTime || null,
    })
  }

  function handleClearSchedule() {
    setPlannedStartTime('')
    setPlannedEndTime('')
    onSetSchedule(task.id, {
      plannedDate: task.plannedDate,
      plannedEndTime: null,
      plannedStartTime: null,
    })
  }

  function closeMenu() {
    setIsMenuOpen(false)
  }

  function handleMenuAction(action: () => void) {
    closeMenu()
    action()
  }

  useEffect(() => {
    if (!isMenuOpen || typeof document === 'undefined') {
      return undefined
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return
      }

      closeMenu()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  return (
    <article
      className={cx(
        styles.taskItem,
        task.importance === 'important' && styles.taskItemImportant,
      )}
    >
      <div className={styles.taskHeader}>
        <div className={styles.taskMain}>
          <div className={styles.taskTitleRow}>
            {task.icon ? (
              <IconMark
                className={styles.taskIcon}
                value={task.icon}
                uploadedIcons={uploadedIcons}
              />
            ) : null}
            <h3>{task.title}</h3>
            {task.project ? (
              <span className={styles.projectChip}>{task.project}</span>
            ) : null}
          </div>
          {task.note ? <p>{task.note}</p> : null}
        </div>
        <div className={styles.taskHeaderActions}>
          <div className={styles.taskMenu} ref={menuRef}>
            <button
              className={styles.menuButton}
              type="button"
              disabled={isPending}
              aria-label="Действия с задачей"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              <MoreIcon size={18} strokeWidth={2.1} />
            </button>
            {isMenuOpen ? (
              <div className={styles.menuPanel} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={isPending}
                  onClick={() =>
                    handleMenuAction(() => onSetStatus(task.id, 'done'))
                  }
                >
                  <CheckIcon size={16} />
                  <span>Завершить</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={isPending}
                  onClick={() => handleMenuAction(() => setIsEditing(true))}
                >
                  <EditIcon size={16} />
                  <span>Редактировать</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={isPending}
                  onClick={() =>
                    handleMenuAction(() => onSetPlannedDate(task.id, null))
                  }
                >
                  Отложить
                </button>
                <button
                  className={styles.menuDangerItem}
                  type="button"
                  role="menuitem"
                  disabled={isPending}
                  onClick={() => handleMenuAction(() => onRemove(task.id))}
                >
                  <TrashIcon size={16} />
                  <span>Удалить</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.metaRow}>
        <span className={styles.metaChip}>
          План{' '}
          {task.plannedDate ? formatShortDate(task.plannedDate) : 'без даты'}
        </span>
        <span className={styles.metaChip}>
          {task.plannedStartTime
            ? formatTimeRange(task.plannedStartTime, task.plannedEndTime)
            : 'Без времени'}
        </span>
        {task.importance === 'important' ? (
          <span className={cx(styles.metaChip, styles.importantChip)}>
            Важно
          </span>
        ) : null}
      </div>

      <form className={styles.scheduleForm} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>Старт</span>
          <input
            type="time"
            value={plannedStartTime}
            disabled={isPending}
            onChange={(event) => setPlannedStartTime(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Финиш</span>
          <input
            type="time"
            value={plannedEndTime}
            disabled={isPending || !plannedStartTime}
            onChange={(event) => setPlannedEndTime(event.target.value)}
          />
        </label>

        <button
          className={styles.primaryButton}
          type="submit"
          disabled={isPending || isInvalidRange}
        >
          Сохранить
        </button>
        {hasScheduleDraft ? (
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={isPending}
            onClick={handleClearSchedule}
          >
            Сбросить
          </button>
        ) : null}
      </form>

      {isInvalidRange ? (
        <p className={styles.helper}>Финиш должен быть позже старта.</p>
      ) : (
        <p className={styles.helper}>
          Если оставить только старт, задача займёт час в таймлайне.
        </p>
      )}

      {isEditing ? (
        <TaskEditDialog
          task={task}
          spheres={spheres}
          uploadedIcons={uploadedIcons}
          isPending={isPending}
          onClose={() => setIsEditing(false)}
          onUpdate={onUpdate}
        />
      ) : null}
    </article>
  )
}

export function CalendarDayScheduleDialog({
  isTaskPending,
  onClose,
  onRemove,
  onSetPlannedDate,
  onSetSchedule,
  onSetStatus,
  onUpdate,
  spheres,
  tasks,
  uploadedIcons = [],
}: CalendarDayScheduleDialogProps) {
  const unscheduledCount = tasks.length
  const unscheduledCountLabel = formatTaskCount(unscheduledCount)

  return (
    <div
      className={styles.taskOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-day-schedule-title"
    >
      <button
        className={styles.taskOverlayBackdrop}
        type="button"
        aria-label="Закрыть распределение задач"
        onClick={onClose}
      />
      <div className={styles.scheduleOverlayPanel}>
        <div className={styles.scheduleOverlayHeader}>
          <h2 id="calendar-day-schedule-title">
            Распределить {unscheduledCountLabel}
          </h2>
          <button
            className={styles.taskOverlayClose}
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className={styles.taskList}>
          {tasks.map((task) => (
            <CalendarDayScheduleTask
              key={`${task.id}:${task.plannedStartTime ?? ''}:${task.plannedEndTime ?? ''}`}
              task={task}
              spheres={spheres}
              isTaskPending={isTaskPending}
              uploadedIcons={uploadedIcons}
              onRemove={onRemove}
              onSetPlannedDate={onSetPlannedDate}
              onSetSchedule={onSetSchedule}
              onSetStatus={onSetStatus}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
