import type {
  WorkspaceGroupRole,
  WorkspaceRole,
  WorkspaceUserRecord,
} from '@planner/contracts'
import { useEffect, useRef, useState } from 'react'

import type { Sphere } from '@/entities/sphere'
import type { Task, TaskStatus, TaskUpdateInput } from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import {
  addDays,
  formatShortDate,
  formatTimeRange,
  getDateKey,
} from '@/shared/lib/date'
import { CheckIcon, IconMark, type UploadedIconAsset } from '@/shared/ui/Icon'

import { getTaskResource } from '../model/resource'
import {
  getRoutineTaskFrequencyLabel,
  getRoutineTaskTargetLabel,
} from '../model/routine-task'
import { resolveTaskCardActionPolicy } from '../model/task-card-policy'
import { getTaskTypeValue } from '../model/task-meta'
import { getTaskRecurrenceLabel } from '../model/task-recurrence'
import styles from './TaskCard.module.css'
import { TaskEditDialog } from './TaskEditDialog'
import { TaskResourceMeter } from './TaskMetaPickers'

const LEGACY_EMPTY_PROJECT_TITLES = new Set([
  'Без сферы',
  'Без проекта',
  'No sphere',
  'No project',
])

function getEmptyProjectLabel(): string {
  return 'Без сферы'
}

function getSphereDisplayTitle(projectTitle: string): string {
  const normalizedProjectTitle = projectTitle.trim()

  if (
    !normalizedProjectTitle ||
    LEGACY_EMPTY_PROJECT_TITLES.has(normalizedProjectTitle)
  ) {
    return getEmptyProjectLabel()
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
  sphere?: Sphere | undefined
  spheres?: Sphere[] | undefined
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
  sphere,
  spheres = [],
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
  const rawProjectTitle = sphere?.name ?? task.project
  const projectTitle = getSphereDisplayTitle(rawProjectTitle)
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
              {sphere ? (
                <span
                  className={styles.projectIcon}
                  style={{ backgroundColor: sphere.color }}
                  aria-hidden="true"
                >
                  <IconMark value={sphere.icon} uploadedIcons={uploadedIcons} />
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
          {task.routine ? (
            <span className={styles.metaChip}>
              {getRoutineTaskFrequencyLabel(task.routine)}
            </span>
          ) : null}
          {task.routine ? (
            <span className={styles.metaChip}>
              {getRoutineTaskTargetLabel(task.routine)}
            </span>
          ) : null}
          {task.recurrence && taskType !== 'routine' ? (
            <span className={styles.metaChip}>
              Повтор: {getTaskRecurrenceLabel(task.recurrence)}
            </span>
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
          spheres={spheres}
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
