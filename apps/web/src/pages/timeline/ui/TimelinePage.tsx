import { type CSSProperties, type FormEvent, useMemo, useState } from 'react'

import type { Project } from '@/entities/project'
import {
  buildTimelineLayout,
  selectPlannedTasks,
  type Task,
  TaskEditDialog,
  type TaskScheduleInput,
  type TaskStatus,
  type TaskUpdateInput,
} from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { TaskComposer } from '@/features/task-create'
import { cx } from '@/shared/lib/classnames'
import {
  addDays,
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

const TIMELINE_START_HOUR = 6
const TIMELINE_END_HOUR = 23
const DAY_START_MINUTES = TIMELINE_START_HOUR * 60
const DAY_END_MINUTES = TIMELINE_END_HOUR * 60
const TIMELINE_TOTAL_MINUTES = DAY_END_MINUTES - DAY_START_MINUTES
const TIMELINE_HOURS = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR },
  (_, index) => TIMELINE_START_HOUR + index,
)

function getShiftedDateKey(dateKey: string, amount: number): string {
  return getDateKey(addDays(new Date(`${dateKey}T12:00:00`), amount))
}

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
  projects: Project[]
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
  projects,
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
        {task.dueDate ? (
          <span className={styles.metaChip}>
            Дедлайн {formatShortDate(task.dueDate)}
          </span>
        ) : null}
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
          projects={projects}
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
    projects,
    tasks,
    removeTask,
    setTaskPlannedDate,
    setTaskSchedule,
    setTaskStatus,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const todayKey = getDateKey(new Date())
  const [selectedDate, setSelectedDate] = useState(todayKey)

  const dayTasks = useMemo(
    () => selectPlannedTasks(tasks, selectedDate),
    [selectedDate, tasks],
  )
  const timelineEntries = useMemo(
    () => buildTimelineLayout(tasks, selectedDate),
    [selectedDate, tasks],
  )

  const scheduledCount = timelineEntries.length
  const unscheduledCount = dayTasks.length - scheduledCount
  const allocatedHours = timelineEntries.reduce(
    (total, entry) => total + (entry.endMinutes - entry.startMinutes) / 60,
    0,
  )

  return (
    <section className={pageStyles.page}>
      <PageHeader kicker="Timeline" />

      <section className={styles.toolbar}>
        <div className={styles.dateControls}>
          <div className={styles.quickSwitches}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() =>
                setSelectedDate(getShiftedDateKey(selectedDate, -1))
              }
            >
              Вчера
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setSelectedDate(todayKey)}
            >
              Сегодня
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() =>
                setSelectedDate(getShiftedDateKey(selectedDate, 1))
              }
            >
              Завтра
            </button>
          </div>

          <label className={styles.field}>
            <span>Дата</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) =>
                setSelectedDate(event.target.value || todayKey)
              }
            />
          </label>
        </div>

        <div className={styles.metrics}>
          <div className={styles.metricCard}>
            <span>Дата</span>
            <strong>{formatLongDate(selectedDate)}</strong>
          </div>
          <div className={styles.metricCard}>
            <span>Задач на день</span>
            <strong>{dayTasks.length}</strong>
          </div>
          <div className={styles.metricCard}>
            <span>В таймлайне</span>
            <strong>{scheduledCount}</strong>
          </div>
          <div className={styles.metricCard}>
            <span>Часов занято</span>
            <strong>{allocatedHours.toFixed(1)}</strong>
          </div>
        </div>
      </section>

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
                  <article
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
                  >
                    <span className={styles.timelineTime}>
                      {formatTimeRange(
                        entry.task.plannedStartTime!,
                        entry.task.plannedEndTime,
                      )}
                    </span>
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
                  </article>
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

          {dayTasks.length === 0 ? (
            <div className={pageStyles.emptyPanel}>
              <p>
                На {formatLongDate(selectedDate)} пока ничего не запланировано.
              </p>
            </div>
          ) : (
            <div className={styles.taskList}>
              {dayTasks.map((task) => (
                <TimelineTaskItem
                  key={`${task.id}:${task.plannedStartTime ?? ''}:${task.plannedEndTime ?? ''}`}
                  task={task}
                  projects={projects}
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
    </section>
  )
}
