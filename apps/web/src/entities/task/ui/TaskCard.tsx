import type {
  WorkspaceGroupRole,
  WorkspaceRole,
  WorkspaceUserRecord,
} from '@planner/contracts'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Project } from '@/entities/project'
import { ProjectPicker } from '@/entities/project'
import type { Task, TaskStatus, TaskUpdateInput } from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import {
  addDays,
  formatShortDate,
  formatTimeRange,
  getDateKey,
} from '@/shared/lib/date'
import {
  CheckIcon,
  IconChoicePicker,
  IconMark,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import { getTaskResource } from '../model/resource'
import { resolveTaskCardActionPolicy } from '../model/task-card-policy'
import {
  getResourceFromValue,
  getResourceValueFromTaskResource,
  getTaskImportanceFromType,
  getTaskTypeValue,
  getTaskUrgencyFromType,
  type TaskTypeValue,
} from '../model/task-meta'
import styles from './TaskCard.module.css'
import {
  ResourcePicker,
  TaskResourceMeter,
  TaskTypePicker,
} from './TaskMetaPickers'

const LEGACY_EMPTY_PROJECT_TITLES = new Set([
  'Без сферы',
  'Без проекта',
  'No sphere',
  'No project',
])

function getEmptyProjectLabel(): string {
  return 'Без сферы'
}

function getProjectPickerLabel(): string {
  return 'Сфера'
}

function getProjectDisplayTitle(projectTitle: string): string {
  const normalizedProjectTitle = projectTitle.trim()

  if (
    !normalizedProjectTitle ||
    LEGACY_EMPTY_PROJECT_TITLES.has(normalizedProjectTitle)
  ) {
    return getEmptyProjectLabel()
  }

  return normalizedProjectTitle
}

function resolveClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

interface TaskCardProps {
  currentActorUserId?: string | undefined
  isSharedWorkspace?: boolean | undefined
  sharedWorkspaceGroupRole?: WorkspaceGroupRole | null | undefined
  sharedWorkspaceRole?: WorkspaceRole | undefined
  workspaceUsers?: WorkspaceUserRecord[] | undefined
  task: Task
  project?: Project | undefined
  projects?: Project[] | undefined
  tone?: 'default' | 'warning' | 'success'
  isPending?: boolean | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
  onRemove: (taskId: string) => void
  onActionMenuOpenChange?:
    | ((taskId: string, isOpen: boolean) => void)
    | undefined
}

export function TaskCard({
  currentActorUserId,
  isSharedWorkspace = false,
  sharedWorkspaceGroupRole,
  sharedWorkspaceRole,
  workspaceUsers = [],
  task,
  project,
  projects = [],
  tone = 'default',
  isPending = false,
  uploadedIcons = [],
  onSetStatus,
  onSetPlannedDate,
  onUpdate,
  onRemove,
  onActionMenuOpenChange,
}: TaskCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const rawProjectTitle = project?.title ?? task.project
  const projectTitle = getProjectDisplayTitle(rawProjectTitle)
  const normalizedRawProjectTitle = rawProjectTitle.trim()
  const hasProject =
    !isSharedWorkspace &&
    Boolean(normalizedRawProjectTitle) &&
    !LEGACY_EMPTY_PROJECT_TITLES.has(normalizedRawProjectTitle)
  const taskType = getTaskTypeValue(task)
  const taskResource = getTaskResource(task)
  const actionPolicy = resolveTaskCardActionPolicy({
    currentActorUserId,
    isSharedWorkspace,
    sharedWorkspaceGroupRole,
    sharedWorkspaceRole,
    task,
    todayKey,
    tomorrowKey,
  })
  const {
    canCompleteTask,
    canDeleteTask,
    canEditTask,
    canManageSchedule,
    canManageWorkStatus,
    canReopenTask,
    hasActionMenu,
    hasMoveToTodayAction,
    hasMoveToTomorrowAction,
    hasPostponeAction,
    hasReviewAction,
    isActiveTask,
    isInProgress,
    isLimitedSharedAssignee,
    isReadyForReview,
  } = actionPolicy
  const scheduleDetails = [
    task.plannedStartTime
      ? formatTimeRange(task.plannedStartTime, task.plannedEndTime)
      : null,
    task.plannedDate ? formatShortDate(task.plannedDate) : null,
    task.dueDate ? `Дедлайн ${formatShortDate(task.dueDate)}` : null,
  ].filter((value): value is string => Boolean(value))
  const toneClass =
    tone === 'warning'
      ? styles.warning
      : tone === 'success'
        ? styles.success
        : undefined

  useEffect(() => {
    if (!isActionMenuOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        actionMenuRef.current?.contains(event.target)
      ) {
        return
      }

      setIsActionMenuOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsActionMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActionMenuOpen])

  useEffect(() => {
    onActionMenuOpenChange?.(task.id, isActionMenuOpen)

    return () => {
      if (isActionMenuOpen) {
        onActionMenuOpenChange?.(task.id, false)
      }
    }
  }, [isActionMenuOpen, onActionMenuOpenChange, task.id])

  function runMenuAction(action: () => void) {
    setIsActionMenuOpen(false)
    action()
  }

  return (
    <article
      className={cx(
        styles.card,
        toneClass,
        task.importance === 'important' && styles.important,
        isInProgress && styles.inProgress,
        isActionMenuOpen && styles.cardMenuOpen,
      )}
    >
      <div className={styles.main}>
        <div className={styles.cardHeader}>
          <div className={styles.titleRow}>
            {task.icon ? (
              <IconMark
                className={styles.taskIcon}
                value={task.icon}
                uploadedIcons={uploadedIcons}
              />
            ) : null}
            <h4>{task.title}</h4>
          </div>

          <div className={styles.quickActions}>
            {isActiveTask ? (
              canCompleteTask ? (
                <button
                  className={cx(styles.button, styles.iconButton)}
                  type="button"
                  disabled={isPending}
                  aria-label={
                    task.requiresConfirmation
                      ? 'Подтвердить выполнение задачи'
                      : 'Завершить задачу'
                  }
                  title={
                    task.requiresConfirmation
                      ? 'Подтвердить выполнение'
                      : 'Завершить'
                  }
                  onClick={() => onSetStatus(task.id, 'done')}
                >
                  <CheckIcon size={18} />
                </button>
              ) : null
            ) : null}

            {hasActionMenu ? (
              <div ref={actionMenuRef} className={styles.actionMenuWrap}>
                <button
                  className={cx(styles.button, styles.iconButton)}
                  type="button"
                  aria-expanded={isActionMenuOpen}
                  aria-haspopup="menu"
                  aria-label={`Действия с задачей ${task.title}`}
                  title="Действия"
                  onClick={() => setIsActionMenuOpen((value) => !value)}
                >
                  <MoreHorizontalIcon />
                </button>

                {isActionMenuOpen ? (
                  <div
                    className={styles.actionMenu}
                    role="menu"
                    aria-label={`Действия с задачей ${task.title}`}
                  >
                    {isActiveTask && canManageSchedule ? (
                      <>
                        {hasMoveToTodayAction ? (
                          <button
                            className={styles.menuItem}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() =>
                                onSetPlannedDate(task.id, todayKey),
                              )
                            }
                          >
                            На сегодня
                          </button>
                        ) : null}
                        {hasMoveToTomorrowAction ? (
                          <button
                            className={styles.menuItem}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() =>
                                onSetPlannedDate(task.id, tomorrowKey),
                              )
                            }
                          >
                            На завтра
                          </button>
                        ) : null}
                        {hasPostponeAction ? (
                          <button
                            className={styles.menuItem}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() =>
                                onSetPlannedDate(task.id, null),
                              )
                            }
                          >
                            Отложить
                          </button>
                        ) : null}
                      </>
                    ) : null}

                    {isActiveTask && canManageWorkStatus ? (
                      <button
                        className={cx(
                          styles.menuItem,
                          isInProgress && styles.menuItemActive,
                        )}
                        type="button"
                        role="menuitem"
                        disabled={
                          isPending || (isLimitedSharedAssignee && isInProgress)
                        }
                        aria-pressed={isInProgress}
                        onClick={() =>
                          runMenuAction(() =>
                            onSetStatus(
                              task.id,
                              isLimitedSharedAssignee
                                ? 'in_progress'
                                : isInProgress
                                  ? 'todo'
                                  : 'in_progress',
                            ),
                          )
                        }
                      >
                        В работе
                      </button>
                    ) : null}

                    {hasReviewAction ? (
                      <button
                        className={cx(
                          styles.menuItem,
                          isReadyForReview && styles.menuItemActive,
                        )}
                        type="button"
                        role="menuitem"
                        disabled={isPending}
                        aria-pressed={isReadyForReview}
                        onClick={() =>
                          runMenuAction(() =>
                            onSetStatus(
                              task.id,
                              isReadyForReview
                                ? 'in_progress'
                                : 'ready_for_review',
                            ),
                          )
                        }
                      >
                        На проверку
                      </button>
                    ) : null}

                    {!isActiveTask && canReopenTask ? (
                      <button
                        className={styles.menuItem}
                        type="button"
                        role="menuitem"
                        disabled={isPending}
                        onClick={() =>
                          runMenuAction(() => onSetStatus(task.id, 'todo'))
                        }
                      >
                        Вернуть
                      </button>
                    ) : null}

                    {canEditTask ? (
                      <button
                        className={styles.menuItem}
                        type="button"
                        role="menuitem"
                        disabled={isPending}
                        onClick={() =>
                          runMenuAction(() => {
                            setIsEditing(true)
                          })
                        }
                      >
                        Редактировать
                      </button>
                    ) : null}

                    {canDeleteTask ? (
                      <button
                        className={cx(styles.menuItem, styles.menuItemDanger)}
                        type="button"
                        role="menuitem"
                        disabled={isPending}
                        onClick={() => runMenuAction(() => onRemove(task.id))}
                      >
                        Удалить
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {task.note ? <p className={styles.note}>{task.note}</p> : null}

        <div className={styles.detailRow}>
          {hasProject ? (
            <span className={styles.projectBadge}>
              {project ? (
                <span
                  className={styles.projectIcon}
                  style={{ backgroundColor: project.color }}
                  aria-hidden="true"
                >
                  <IconMark
                    value={project.icon}
                    uploadedIcons={uploadedIcons}
                  />
                </span>
              ) : null}
              <span>{projectTitle}</span>
            </span>
          ) : !isSharedWorkspace ? (
            <span className={styles.projectBadgeMuted}>{projectTitle}</span>
          ) : null}
          {scheduleDetails.length > 0 ? (
            <span className={styles.detailText}>
              {scheduleDetails.join(' • ')}
            </span>
          ) : null}
        </div>

        <div className={styles.meta}>
          {taskType === 'important' ? (
            <span className={cx(styles.metaChip, styles.markerChipStrong)}>
              Важное
            </span>
          ) : null}
          {taskType === 'routine' ? (
            <span className={styles.metaChip}>Рутина</span>
          ) : null}
          {taskResource !== 0 ? (
            <span className={cx(styles.metaChip, styles.resourceChip)}>
              <TaskResourceMeter
                className={styles.cardResourceMeter}
                value={taskResource}
              />
            </span>
          ) : null}
          {isSharedWorkspace && task.authorDisplayName ? (
            <span className={styles.metaChip}>
              Автор: {task.authorDisplayName}
            </span>
          ) : null}
          {task.assigneeDisplayName ? (
            <span className={styles.metaChip}>
              Исполнитель: {task.assigneeDisplayName}
            </span>
          ) : null}
          {!isSharedWorkspace &&
          task.remindBeforeStart &&
          task.plannedDate &&
          task.plannedStartTime ? (
            <span className={styles.metaChip}>Напомнить за 15 минут</span>
          ) : null}
          {isSharedWorkspace && task.requiresConfirmation ? (
            <span className={cx(styles.metaChip, styles.confirmationChip)}>
              Требуется подтверждение
            </span>
          ) : null}
          {isReadyForReview ? (
            <span className={cx(styles.metaChip, styles.reviewChip)}>
              Готово к проверке
            </span>
          ) : null}
        </div>
      </div>

      {isEditing ? (
        <TaskEditDialog
          currentActorUserId={currentActorUserId}
          isSharedWorkspace={isSharedWorkspace}
          task={task}
          projects={projects}
          uploadedIcons={uploadedIcons}
          isPending={isPending}
          onClose={() => setIsEditing(false)}
          onUpdate={onUpdate}
          workspaceUsers={workspaceUsers}
        />
      ) : null}
    </article>
  )
}

function MoreHorizontalIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="6" cy="12" r="1.85" fill="currentColor" />
      <circle cx="12" cy="12" r="1.85" fill="currentColor" />
      <circle cx="18" cy="12" r="1.85" fill="currentColor" />
    </svg>
  )
}

interface TaskEditDialogProps {
  currentActorUserId?: string | undefined
  isSharedWorkspace?: boolean | undefined
  task: Task
  projects: Project[]
  uploadedIcons: UploadedIconAsset[]
  workspaceUsers?: WorkspaceUserRecord[] | undefined
  isPending?: boolean | undefined
  onClose: () => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
}

export function TaskEditDialog({
  currentActorUserId,
  isSharedWorkspace = false,
  task,
  projects,
  uploadedIcons,
  workspaceUsers = [],
  isPending = false,
  onClose,
  onUpdate,
}: TaskEditDialogProps) {
  const confirmationFieldId = useId()
  const reminderFieldId = useId()
  const reminderAvailabilityRef = useRef(
    !isSharedWorkspace && Boolean(task.plannedDate && task.plannedStartTime),
  )
  const [assigneeUserId, setAssigneeUserId] = useState(
    task.assigneeUserId ?? '',
  )
  const [requiresConfirmation, setRequiresConfirmation] = useState(
    task.requiresConfirmation,
  )
  const [title, setTitle] = useState(task.title)
  const [projectId, setProjectId] = useState(task.projectId ?? '')
  const [plannedDate, setPlannedDate] = useState(task.plannedDate ?? '')
  const [plannedStartTime, setPlannedStartTime] = useState(
    task.plannedStartTime ?? '',
  )
  const [plannedEndTime, setPlannedEndTime] = useState(
    task.plannedEndTime ?? '',
  )
  const [remindBeforeStart, setRemindBeforeStart] = useState(
    task.remindBeforeStart === true,
  )
  const [icon, setIcon] = useState(task.icon)
  const [resource, setResource] = useState(
    getResourceValueFromTaskResource(task.resource),
  )
  const [taskType, setTaskType] = useState<TaskTypeValue>(
    getTaskTypeValue(task),
  )
  const [note, setNote] = useState(task.note)
  const canManageConfirmation =
    task.authorUserId !== null && task.authorUserId === currentActorUserId
  const isReminderAvailable =
    !isSharedWorkspace && Boolean(plannedDate && plannedStartTime)

  function handlePlannedDateChange(nextPlannedDate: string) {
    setPlannedDate(nextPlannedDate)

    if (!nextPlannedDate) {
      setPlannedStartTime('')
      setPlannedEndTime('')
      setRemindBeforeStart(false)
      reminderAvailabilityRef.current = false
    }
  }

  function handlePlannedStartTimeChange(nextStartTime: string) {
    const wasAvailable = reminderAvailabilityRef.current
    const nextAvailable =
      !isSharedWorkspace && Boolean(plannedDate && nextStartTime)

    setPlannedStartTime(nextStartTime)

    if (!nextAvailable) {
      setRemindBeforeStart(false)
      reminderAvailabilityRef.current = false
    } else if (!wasAvailable) {
      setRemindBeforeStart(true)
      reminderAvailabilityRef.current = true
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return
    }

    const selectedProject =
      projects.find((project) => project.id === projectId) ?? null
    const projectInput = {
      project: selectedProject?.title ?? '',
      projectId: selectedProject?.id ?? null,
    }
    const hasPlannedDate = Boolean(plannedDate)
    const isUpdated = await onUpdate(task.id, {
      assigneeUserId: isSharedWorkspace ? assigneeUserId || null : null,
      dueDate: task.dueDate ?? null,
      icon,
      importance: getTaskImportanceFromType(taskType),
      note,
      plannedDate: plannedDate || null,
      plannedEndTime:
        hasPlannedDate && plannedStartTime ? plannedEndTime || null : null,
      plannedStartTime: hasPlannedDate ? plannedStartTime || null : null,
      project: projectInput.project,
      projectId: projectInput.projectId,
      remindBeforeStart: isSharedWorkspace ? false : remindBeforeStart,
      reminderTimeZone:
        !isSharedWorkspace && remindBeforeStart
          ? resolveClientTimeZone()
          : undefined,
      resource: getResourceFromValue(resource),
      requiresConfirmation: isSharedWorkspace ? requiresConfirmation : false,
      sphereId: task.sphereId,
      title: normalizedTitle,
      urgency: getTaskUrgencyFromType(taskType),
    })

    if (isUpdated) {
      onClose()
    }
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className={styles.editorOverlay} role="dialog" aria-modal="true">
      <button
        className={styles.editorBackdrop}
        type="button"
        aria-label="Закрыть редактирование"
        onClick={onClose}
      />

      <form
        className={styles.editorPanel}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className={styles.editorHeader}>
          <h3>Редактировать задачу</h3>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <label className={cx(styles.field, styles.titleField)}>
          <span>Задача</span>
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div className={styles.editorColumns}>
          <div className={styles.editorColumnPanel}>
            <section className={styles.editorSection}>
              <div className={styles.editorGrid}>
                <label className={styles.field}>
                  <span>План</span>
                  <input
                    type="date"
                    value={plannedDate}
                    onChange={(event) =>
                      handlePlannedDateChange(event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Старт</span>
                  <input
                    type="time"
                    value={plannedStartTime}
                    disabled={!plannedDate}
                    onChange={(event) =>
                      handlePlannedStartTimeChange(event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Финиш</span>
                  <input
                    type="time"
                    value={plannedEndTime}
                    disabled={!plannedDate || !plannedStartTime}
                    onChange={(event) => setPlannedEndTime(event.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className={styles.editorSection}>
              <label className={cx(styles.field, styles.notePanel)}>
                <span>Заметка</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
            </section>

            <section className={styles.editorSection}>
              <div className={styles.editorVisual}>
                <IconChoicePicker
                  allowEmpty={false}
                  label="Иконка"
                  showEmojiChoices={false}
                  value={icon}
                  uploadedIcons={uploadedIcons}
                  onChange={setIcon}
                />
              </div>
            </section>
          </div>

          <div className={styles.editorColumnPanel}>
            <section className={styles.editorSection}>
              <ProjectPicker
                className={styles.fieldProject}
                emptyLabel={getEmptyProjectLabel()}
                label={getProjectPickerLabel()}
                projects={projects}
                uploadedIcons={uploadedIcons}
                value={projectId}
                onChange={setProjectId}
              />
            </section>

            {!isSharedWorkspace ? (
              <section className={styles.editorSection}>
                <div className={styles.checkboxField}>
                  <input
                    id={reminderFieldId}
                    type="checkbox"
                    checked={remindBeforeStart}
                    disabled={!isReminderAvailable}
                    onChange={(event) =>
                      setRemindBeforeStart(event.target.checked)
                    }
                  />
                  <span className={styles.checkboxCopy}>
                    <label
                      className={styles.checkboxLabel}
                      htmlFor={reminderFieldId}
                    >
                      Напомнить за 15 минут
                    </label>
                    <small>Доступно, когда у задачи указан старт.</small>
                  </span>
                </div>
              </section>
            ) : null}

            {isSharedWorkspace ? (
              <section className={styles.editorSection}>
                <label className={styles.field}>
                  <span>Исполнитель</span>
                  <select
                    value={assigneeUserId}
                    onChange={(event) => setAssigneeUserId(event.target.value)}
                  >
                    <option value="">Без исполнителя</option>
                    {workspaceUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            ) : null}

            {isSharedWorkspace ? (
              <section className={styles.editorSection}>
                <div className={styles.checkboxField}>
                  <input
                    id={confirmationFieldId}
                    type="checkbox"
                    checked={requiresConfirmation}
                    disabled={!canManageConfirmation}
                    onChange={(event) =>
                      setRequiresConfirmation(event.target.checked)
                    }
                  />
                  <span className={styles.checkboxCopy}>
                    <label
                      className={styles.checkboxLabel}
                      htmlFor={confirmationFieldId}
                    >
                      Требуется подтверждение
                    </label>
                    <small id={`${confirmationFieldId}-hint`}>
                      Завершить такую задачу сможет только её автор.
                    </small>
                  </span>
                </div>
              </section>
            ) : null}

            <section className={styles.editorSection}>
              <TaskTypePicker
                className={styles.fieldType}
                value={taskType}
                onChange={setTaskType}
              />
            </section>

            <section className={styles.editorSection}>
              <ResourcePicker
                className={styles.fieldResource}
                value={resource}
                onChange={setResource}
              />
            </section>
          </div>
        </div>

        <div className={styles.editorActions}>
          <button className={styles.button} type="button" onClick={onClose}>
            Отмена
          </button>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={isPending || !title.trim()}
          >
            Сохранить
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
