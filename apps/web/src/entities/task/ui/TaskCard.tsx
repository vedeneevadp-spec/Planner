import type {
  WorkspaceGroupRole,
  WorkspaceRole,
  WorkspaceUserRecord,
} from '@planner/contracts'
import { type FormEvent, useId, useState } from 'react'
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
  EditIcon,
  IconChoicePicker,
  IconMark,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import { getTaskResource } from '../model/resource'
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

const LEGACY_EMPTY_PROJECT_TITLES = new Set(['Без сферы', 'No sphere'])

function getEmptyProjectLabel(isSharedWorkspace: boolean): string {
  return isSharedWorkspace ? 'Без проекта' : 'Без сферы'
}

function getProjectPickerLabel(isSharedWorkspace: boolean): string {
  return isSharedWorkspace ? 'Проект' : 'Сфера'
}

function getProjectDisplayTitle(
  projectTitle: string,
  isSharedWorkspace: boolean,
): string {
  const normalizedProjectTitle = projectTitle.trim()

  if (
    !normalizedProjectTitle ||
    LEGACY_EMPTY_PROJECT_TITLES.has(normalizedProjectTitle)
  ) {
    return getEmptyProjectLabel(isSharedWorkspace)
  }

  return normalizedProjectTitle
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
}: TaskCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const rawProjectTitle = project?.title ?? task.project
  const projectTitle = getProjectDisplayTitle(rawProjectTitle, false)
  const normalizedRawProjectTitle = rawProjectTitle.trim()
  const hasProject =
    !isSharedWorkspace &&
    Boolean(normalizedRawProjectTitle) &&
    !LEGACY_EMPTY_PROJECT_TITLES.has(normalizedRawProjectTitle)
  const taskType = getTaskTypeValue(task)
  const taskResource = getTaskResource(task)
  const isActiveTask = task.status !== 'done'
  const isInProgress = task.status === 'in_progress'
  const isReadyForReview = task.status === 'ready_for_review'
  const canPostponeTask =
    task.plannedDate === todayKey || task.plannedDate === tomorrowKey
  const isTaskAuthor =
    task.authorUserId !== null && task.authorUserId === currentActorUserId
  const isTaskAssignee =
    task.assigneeUserId !== null && task.assigneeUserId === currentActorUserId
  const isSharedWorkspaceManager =
    sharedWorkspaceRole === 'owner' ||
    sharedWorkspaceGroupRole === 'group_admin'
  const isAuthorManagedTask = !isSharedWorkspace || isTaskAuthor
  const canManageSharedTask =
    isAuthorManagedTask || (!isTaskAssignee && isSharedWorkspaceManager)
  const isLimitedSharedAssignee =
    isSharedWorkspace && isTaskAssignee && !isTaskAuthor
  const canToggleReview =
    isSharedWorkspace &&
    task.requiresConfirmation &&
    isActiveTask &&
    (canManageSharedTask || isTaskAssignee)
  const canManageSchedule = !isSharedWorkspace || canManageSharedTask
  const canManageWorkStatus =
    !isSharedWorkspace || canManageSharedTask || isTaskAssignee
  const canCompleteTask =
    !isSharedWorkspace ||
    (canManageSharedTask && (!task.requiresConfirmation || isTaskAuthor))
  const canReopenTask = !isSharedWorkspace || canManageSharedTask
  const canEditTask = !isSharedWorkspace || canManageSharedTask
  const canDeleteTask =
    !isSharedWorkspace ||
    isTaskAuthor ||
    (!isTaskAssignee &&
      (sharedWorkspaceRole === 'owner' ||
        sharedWorkspaceGroupRole === 'group_admin'))
  const toneClass =
    tone === 'warning'
      ? styles.warning
      : tone === 'success'
        ? styles.success
        : undefined

  return (
    <article
      className={cx(
        styles.card,
        toneClass,
        task.importance === 'important' && styles.important,
        isInProgress && styles.inProgress,
      )}
    >
      <div className={styles.main}>
        <div className={styles.copy}>
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

      <div className={styles.actions}>
        {isActiveTask && canManageSchedule ? (
          <div className={styles.scheduleActions}>
            {task.plannedDate !== todayKey ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
                onClick={() => onSetPlannedDate(task.id, todayKey)}
              >
                На сегодня
              </button>
            ) : null}
            {task.plannedDate !== tomorrowKey ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
                onClick={() => onSetPlannedDate(task.id, tomorrowKey)}
              >
                На завтра
              </button>
            ) : null}
            {canPostponeTask ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
                onClick={() => onSetPlannedDate(task.id, null)}
              >
                Отложить
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={styles.cardMainActions}>
          {isActiveTask && canManageWorkStatus ? (
            <button
              className={cx(
                styles.button,
                styles.workButton,
                isInProgress && styles.workButtonActive,
              )}
              type="button"
              disabled={isPending || (isLimitedSharedAssignee && isInProgress)}
              aria-pressed={isInProgress}
              onClick={() =>
                onSetStatus(
                  task.id,
                  isLimitedSharedAssignee
                    ? 'in_progress'
                    : isInProgress
                      ? 'todo'
                      : 'in_progress',
                )
              }
            >
              В работе
            </button>
          ) : null}

          {canToggleReview ? (
            <button
              className={cx(
                styles.button,
                styles.reviewButton,
                isReadyForReview && styles.reviewButtonActive,
              )}
              type="button"
              disabled={isPending}
              aria-pressed={isReadyForReview}
              onClick={() =>
                onSetStatus(
                  task.id,
                  isReadyForReview ? 'in_progress' : 'ready_for_review',
                )
              }
            >
              На проверку
            </button>
          ) : null}

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
          ) : canReopenTask ? (
            <button
              className={styles.button}
              type="button"
              disabled={isPending}
              onClick={() => onSetStatus(task.id, 'todo')}
            >
              Вернуть
            </button>
          ) : null}

          {canEditTask ? (
            <button
              className={cx(styles.button, styles.iconButton)}
              type="button"
              disabled={isPending}
              aria-label="Редактировать задачу"
              title="Редактировать"
              onClick={() => setIsEditing(true)}
            >
              <EditIcon size={18} />
            </button>
          ) : null}

          {canDeleteTask ? (
            <button
              className={cx(
                styles.button,
                styles.iconButton,
                styles.dangerButton,
              )}
              type="button"
              disabled={isPending}
              aria-label="Удалить задачу"
              title="Удалить"
              onClick={() => onRemove(task.id)}
            >
              <TrashIcon size={18} />
            </button>
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

  function handlePlannedDateChange(nextPlannedDate: string) {
    setPlannedDate(nextPlannedDate)

    if (!nextPlannedDate) {
      setPlannedStartTime('')
      setPlannedEndTime('')
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
    const projectInput = isSharedWorkspace
      ? {
          project: '',
          projectId: null,
        }
      : {
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
                      setPlannedStartTime(event.target.value)
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
            {!isSharedWorkspace ? (
              <section className={styles.editorSection}>
                <ProjectPicker
                  className={styles.fieldProject}
                  emptyLabel={getEmptyProjectLabel(false)}
                  label={getProjectPickerLabel(false)}
                  projects={projects}
                  uploadedIcons={uploadedIcons}
                  value={projectId}
                  onChange={setProjectId}
                />
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
