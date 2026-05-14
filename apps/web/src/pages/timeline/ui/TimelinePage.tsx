import { type CSSProperties, type FormEvent, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Sphere } from '@/entities/sphere'
import {
  buildTimelineLayout,
  selectPlannedTasks,
  type Task,
  TaskCard,
  TaskEditDialog,
  type TaskScheduleInput,
  type TaskStatus,
  type TaskUpdateInput,
} from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { usePlannerSession, useWorkspaceUsers } from '@/features/session'
import { TaskComposer } from '@/features/task-create'
import { cx } from '@/shared/lib/classnames'
import {
  formatLongDate,
  formatShortDate,
  formatTimeRange,
  getDateKey,
} from '@/shared/lib/date'
import {
  CheckIcon,
  EditIcon,
  IconMark,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './TimelinePage.module.css'

const TIMELINE_START_HOUR = 0
const TIMELINE_END_HOUR = 24
const DAY_START_MINUTES = TIMELINE_START_HOUR * 60
const DAY_END_MINUTES = TIMELINE_END_HOUR * 60
const TIMELINE_TOTAL_MINUTES = DAY_END_MINUTES - DAY_START_MINUTES
const TIMELINE_HOURS = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR },
  (_, index) => TIMELINE_START_HOUR + index,
)

function getTimelineBlockStyle(
  startMinutes: number,
  endMinutes: number,
  column: number,
  columns: number,
): CSSProperties {
  const clampedStart = Math.min(
    Math.max(startMinutes, DAY_START_MINUTES),
    DAY_END_MINUTES - 30,
  )
  const clampedEnd = Math.min(
    Math.max(endMinutes, clampedStart + 30),
    DAY_END_MINUTES,
  )
  const top =
    ((clampedStart - DAY_START_MINUTES) / TIMELINE_TOTAL_MINUTES) * 100
  const height = ((clampedEnd - clampedStart) / TIMELINE_TOTAL_MINUTES) * 100
  const width = 100 / columns
  const left = column * width

  return {
    top: `${top}%`,
    height: `max(${height}%, 2.9rem)`,
    left: `calc(${left}% + 0.35rem)`,
    width: `calc(${width}% - 0.7rem)`,
  }
}

interface TimelineTaskItemProps {
  task: Task
  spheres: Sphere[]
  isPending?: boolean | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  onRemove: (taskId: string) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onSetSchedule: (taskId: string, schedule: TaskScheduleInput) => void
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
}

function TimelineTaskItem({
  task,
  spheres,
  isPending = false,
  uploadedIcons = [],
  onRemove,
  onSetPlannedDate,
  onSetSchedule,
  onSetStatus,
  onUpdate,
}: TimelineTaskItemProps) {
  const [isEditing, setIsEditing] = useState(false)
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    onSetSchedule(task.id, {
      plannedDate: task.plannedDate,
      plannedStartTime: plannedStartTime || null,
      plannedEndTime: plannedEndTime || null,
    })
  }

  function handleClearSchedule() {
    setPlannedStartTime('')
    setPlannedEndTime('')
    onSetSchedule(task.id, {
      plannedDate: task.plannedDate,
      plannedStartTime: null,
      plannedEndTime: null,
    })
  }

  return (
    <article
      className={cx(
        styles.taskItem,
        task.importance === 'important' && styles.taskItemImportant,
      )}
    >
      <div className={styles.taskHeader}>
        <div>
          <div className={styles.taskTitleRow}>
            {task.icon ? (
              <IconMark
                className={styles.taskIcon}
                value={task.icon}
                uploadedIcons={uploadedIcons}
              />
            ) : null}
            <h3>{task.title}</h3>
          </div>
          {task.note ? <p>{task.note}</p> : null}
        </div>
        {task.project ? (
          <span className={styles.projectChip}>{task.project}</span>
        ) : null}
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
      </form>

      {isInvalidRange ? (
        <p className={styles.helper}>Финиш должен быть позже старта.</p>
      ) : (
        <p className={styles.helper}>
          Если оставить только старт, задача займёт час в таймлайне.
        </p>
      )}

      <div className={styles.actions}>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={isPending}
          onClick={handleClearSchedule}
        >
          Без времени
        </button>
        <button
          className={cx(styles.secondaryButton, styles.iconButton)}
          type="button"
          disabled={isPending}
          aria-label="Завершить задачу"
          title="Завершить"
          onClick={() => onSetStatus(task.id, 'done')}
        >
          <CheckIcon size={18} />
        </button>
        <button
          className={cx(styles.secondaryButton, styles.iconButton)}
          type="button"
          disabled={isPending}
          aria-label="Редактировать задачу"
          title="Редактировать"
          onClick={() => setIsEditing(true)}
        >
          <EditIcon size={18} />
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={isPending}
          onClick={() => onSetPlannedDate(task.id, null)}
        >
          Inbox
        </button>
        <button
          className={cx(styles.dangerButton, styles.iconButton)}
          type="button"
          disabled={isPending}
          aria-label="Удалить задачу"
          title="Удалить"
          onClick={() => onRemove(task.id)}
        >
          <TrashIcon size={18} />
        </button>
      </div>

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

export function TimelinePage() {
  const {
    isTaskPending,
    spheres,
    tasks,
    removeTask,
    setTaskPlannedDate,
    setTaskSchedule,
    setTaskStatus,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const sessionQuery = usePlannerSession()
  const selectedDate = getDateKey(new Date())
  const session = sessionQuery.data
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )
  const workspaceUsersQuery = useWorkspaceUsers({
    enabled: Boolean(selectedTask && isSharedWorkspace),
  })
  const workspaceUsers = workspaceUsersQuery.data?.users ?? []

  const dayTasks = useMemo(
    () => selectPlannedTasks(tasks, selectedDate),
    [selectedDate, tasks],
  )
  const timelineEntries = useMemo(
    () => buildTimelineLayout(tasks, selectedDate),
    [selectedDate, tasks],
  )

  const unscheduledTasks = useMemo(() => {
    const scheduledTaskIds = new Set(
      timelineEntries.map((entry) => entry.task.id),
    )

    return dayTasks.filter((task) => !scheduledTaskIds.has(task.id))
  }, [dayTasks, timelineEntries])
  const unscheduledCount = unscheduledTasks.length

  return (
    <section className={pageStyles.page}>
      <PageHeader kicker="Timeline" />

      <TaskComposer
        key={selectedDate}
        initialPlannedDate={selectedDate}
        showTimeFields
      />

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Day View</p>
              <h2>Сетка времени</h2>
            </div>
            <p className={styles.panelCopy}>
              Таймлайн показывает только задачи со временем. Остальные остаются
              в списке справа, пока ты не дашь им слот.
            </p>
          </div>

          {timelineEntries.length === 0 ? (
            <div className={pageStyles.emptyPanel}>
              <p>
                На {formatLongDate(selectedDate)} пока нет задач с указанным
                временем.
              </p>
            </div>
          ) : (
            <div className={styles.timelineShell}>
              <div className={styles.timeAxis}>
                {TIMELINE_HOURS.map((hour) => (
                  <div key={hour} className={styles.timeTick}>
                    {String(hour).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              <div className={styles.timelineTrack}>
                <div className={styles.hourGrid} aria-hidden="true">
                  {TIMELINE_HOURS.map((hour) => (
                    <div key={hour} className={styles.hourStripe} />
                  ))}
                </div>

                {timelineEntries.map((entry) => (
                  <button
                    key={entry.task.id}
                    className={cx(
                      styles.timelineBlock,
                      entry.task.importance === 'important' &&
                        styles.timelineBlockImportant,
                    )}
                    style={getTimelineBlockStyle(
                      entry.startMinutes,
                      entry.endMinutes,
                      entry.column,
                      entry.columns,
                    )}
                    type="button"
                    aria-label={`Открыть задачу ${entry.task.title}`}
                    title={entry.task.title}
                    onClick={() => setSelectedTaskId(entry.task.id)}
                  >
                    <strong className={styles.timelineTitle}>
                      {entry.task.icon ? (
                        <IconMark
                          className={styles.timelineIcon}
                          value={entry.task.icon}
                          uploadedIcons={uploadedIcons}
                        />
                      ) : null}
                      <span>{entry.task.title}</span>
                    </strong>
                    {entry.task.project ? (
                      <span>{entry.task.project}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Task List</p>
              <h2>Задачи дня</h2>
            </div>
            <p className={styles.panelCopy}>
              {unscheduledCount > 0
                ? `${unscheduledCount} задач ещё не получили время.`
                : 'Все задачи дня уже распределены по времени.'}
            </p>
          </div>

          {unscheduledTasks.length === 0 ? (
            <div className={pageStyles.emptyPanel}>
              <p>
                {dayTasks.length === 0
                  ? `На ${formatLongDate(selectedDate)} пока ничего не запланировано.`
                  : 'Все задачи дня уже распределены по времени.'}
              </p>
            </div>
          ) : (
            <div className={styles.taskList}>
              {unscheduledTasks.map((task) => (
                <TimelineTaskItem
                  key={`${task.id}:${task.plannedStartTime ?? ''}:${task.plannedEndTime ?? ''}`}
                  task={task}
                  spheres={spheres}
                  isPending={isTaskPending(task.id)}
                  uploadedIcons={uploadedIcons}
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
                />
              ))}
            </div>
          )}
        </section>
      </div>

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
