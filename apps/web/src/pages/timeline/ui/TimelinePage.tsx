import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'

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
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
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
  MoreIcon,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import styles from './TimelinePage.module.css'

const TIMELINE_START_HOUR = 0
const TIMELINE_END_HOUR = 24
const TIMELINE_INITIAL_SCROLL_HOUR = 8
const DAY_START_MINUTES = TIMELINE_START_HOUR * 60
const DAY_END_MINUTES = TIMELINE_END_HOUR * 60
const TIMELINE_INITIAL_SCROLL_MINUTES = TIMELINE_INITIAL_SCROLL_HOUR * 60
const TIMELINE_TOTAL_MINUTES = DAY_END_MINUTES - DAY_START_MINUTES
const TIMELINE_SCHEDULE_SEARCH_PARAM = 'timelineSchedule'
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
    height: `max(${height}%, var(--timeline-block-min-height, 2.9rem))`,
    left: `calc(${left}% + 0.35rem)`,
    width: `calc(${width}% - 0.7rem)`,
  }
}

function getNearestScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement

  while (parent) {
    const { overflowY } = window.getComputedStyle(parent)

    if (
      ['auto', 'scroll', 'overlay'].includes(overflowY) &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent
    }

    parent = parent.parentElement
  }

  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : null
}

function useTimelineTaskComposerDraft(
  selectedDate: string,
): TaskComposerDraft | null {
  const [searchParams, setSearchParams] = useSearchParams()
  const createTaskRequestId = searchParams.get('createTask')

  useEffect(() => {
    if (!createTaskRequestId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('createTask')
    setSearchParams(nextSearchParams, { replace: true })
  }, [createTaskRequestId, searchParams, setSearchParams])

  return useMemo(
    () =>
      createTaskRequestId
        ? {
            plannedDate: selectedDate,
            requestId: createTaskRequestId,
          }
        : null,
    [createTaskRequestId, selectedDate],
  )
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
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
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

export function TimelinePage() {
  const {
    copyTaskToPersonal,
    isTaskPending,
    moveTaskToPersonal,
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
  const taskComposerDraft = useTimelineTaskComposerDraft(selectedDate)
  const [searchParams, setSearchParams] = useSearchParams()
  const session = sessionQuery.data
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const timelineTrackRef = useRef<HTMLDivElement>(null)
  const scrolledTimelineDateRef = useRef<string | null>(null)
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
  const isScheduleModalRequested =
    searchParams.get(TIMELINE_SCHEDULE_SEARCH_PARAM) === '1'
  const isScheduleModalOpen = isScheduleModalRequested && unscheduledCount > 0

  function closeScheduleModal() {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(TIMELINE_SCHEDULE_SEARCH_PARAM)
    setSearchParams(nextSearchParams, { replace: true })
  }

  function renderUnscheduledTaskItems() {
    return unscheduledTasks.map((task) => (
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
    ))
  }

  useLayoutEffect(() => {
    if (
      timelineEntries.length === 0 ||
      scrolledTimelineDateRef.current === selectedDate
    ) {
      return
    }

    const track = timelineTrackRef.current

    if (!track) {
      return
    }

    const scrollContainer = getNearestScrollContainer(track)

    if (!scrollContainer) {
      return
    }

    const targetOffset =
      ((TIMELINE_INITIAL_SCROLL_MINUTES - DAY_START_MINUTES) /
        TIMELINE_TOTAL_MINUTES) *
      track.offsetHeight
    const hourHeight =
      track.offsetHeight / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)
    const labelOffset = Math.min(Math.max(hourHeight * 0.65, 28), 44)
    const containerRect = scrollContainer.getBoundingClientRect()
    const trackRect = track.getBoundingClientRect()
    const trackTop =
      scrollContainer.scrollTop + trackRect.top - containerRect.top

    scrollContainer.scrollTo({
      top: Math.max(trackTop + targetOffset - labelOffset, 0),
      behavior: 'auto',
    })
    scrolledTimelineDateRef.current = selectedDate
  }, [selectedDate, timelineEntries.length])

  useEffect(() => {
    if (!isScheduleModalRequested || unscheduledCount > 0) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(TIMELINE_SCHEDULE_SEARCH_PARAM)
    setSearchParams(nextSearchParams, { replace: true })
  }, [
    isScheduleModalRequested,
    searchParams,
    setSearchParams,
    unscheduledCount,
  ])

  return (
    <section className={pageStyles.page}>
      <TaskComposer
        desktopOpenButtonHidden
        key={selectedDate}
        initialPlannedDate={selectedDate}
        openDraft={taskComposerDraft}
        showTimeFields
      />

      <div className={styles.layout}>
        <section className={styles.panel}>
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

              <div className={styles.timelineTrack} ref={timelineTrackRef}>
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
      </div>

      {isScheduleModalOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={styles.taskOverlay}
              role="dialog"
              aria-modal="true"
              aria-labelledby="timeline-schedule-title"
            >
              <button
                className={styles.taskOverlayBackdrop}
                type="button"
                aria-label="Закрыть распределение задач"
                onClick={closeScheduleModal}
              />
              <div className={styles.scheduleOverlayPanel}>
                <div className={styles.scheduleOverlayHeader}>
                  <h2 id="timeline-schedule-title">
                    Распределить {unscheduledCount} задач
                  </h2>
                  <button
                    className={styles.taskOverlayClose}
                    type="button"
                    aria-label="Закрыть"
                    onClick={closeScheduleModal}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
                <div className={styles.taskList}>
                  {renderUnscheduledTaskItems()}
                </div>
              </div>
            </div>,
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
