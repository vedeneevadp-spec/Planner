import type {
  WorkspaceGroupRole,
  WorkspaceRole,
  WorkspaceUserRecord,
} from '@planner/contracts'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Sphere } from '@/entities/sphere'
import type { Task, TaskStatus, TaskUpdateInput } from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import { formatShortDate, formatTimeRange } from '@/shared/lib/date'
import { CheckIcon, IconMark, type UploadedIconAsset } from '@/shared/ui/Icon'

import { getTaskResource } from '../model/resource'
import { getRoutineTaskFrequencyLabel } from '../model/routine-task'
import { resolveTaskCardActionPolicy } from '../model/task-card-policy'
import { getTaskTypeValue } from '../model/task-meta'
import { getTaskRecurrenceLabel } from '../model/task-recurrence'
import styles from './TaskCard.module.css'
import { TaskEditDialog } from './TaskEditDialog'
import { TaskResourceMeter } from './TaskMetaPickers'
import { TaskNextStageDialog } from './TaskNextStageDialog'

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

function getTaskReminderLabel(
  task: Task,
  isSharedWorkspace: boolean,
): string | null {
  if (
    isSharedWorkspace ||
    !task.plannedDate ||
    !task.plannedStartTime ||
    !task.remindBeforeStart
  ) {
    return null
  }

  const offsets =
    task.reminderOffsets && task.reminderOffsets.length > 0
      ? task.reminderOffsets
      : [15]

  return `Напомнить: ${offsets.map(formatReminderOffset).join(', ')}`
}

function formatReminderOffset(offset: number): string {
  return offset === 60 ? '1 час' : `${offset} мин`
}

function sortChainTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const leftIndex = left.stageIndex ?? Number.MAX_SAFE_INTEGER
    const rightIndex = right.stageIndex ?? Number.MAX_SAFE_INTEGER

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex
    }

    if (left.createdAt === right.createdAt) {
      return left.id.localeCompare(right.id)
    }

    return left.createdAt < right.createdAt ? -1 : 1
  })
}

function getTaskStageLabel(task: Task, chainTasks: Task[]): string | null {
  if (!task.chainId || !task.stageIndex) {
    return null
  }

  return chainTasks.length > 1
    ? `${task.stageIndex}/${chainTasks.length}`
    : `Этап ${task.stageIndex}`
}

function getTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'archived':
      return 'Архив'
    case 'done':
      return 'Выполнено'
    case 'in_progress':
      return 'В работе'
    case 'ready_for_review':
      return 'На проверке'
    case 'todo':
      return 'Запланировано'
  }
}

interface TaskCardProps {
  allTasks?: Task[] | undefined
  currentActorUserId?: string | undefined
  isSharedWorkspace?: boolean | undefined
  sharedWorkspaceGroupRole?: WorkspaceGroupRole | null | undefined
  sharedWorkspaceRole?: WorkspaceRole | undefined
  workspaceUsers?: WorkspaceUserRecord[] | undefined
  task: Task
  sphere?: Sphere | undefined
  spheres?: Sphere[] | undefined
  todayKey: string
  tomorrowKey: string
  variant?: 'card' | 'compact' | 'detail' | undefined
  tone?: 'default' | 'warning' | 'success'
  isPending?: boolean | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  onCreateNextStage?:
    | ((
        taskId: string,
        input: {
          completeCurrent: boolean
          plannedDate?: string | null | undefined
          title: string
        },
      ) => Promise<unknown> | undefined)
    | undefined
  onCopyToPersonal?: ((taskId: string) => void) | undefined
  onDetachFromChain?: ((taskId: string) => void) | undefined
  onMoveToPersonal?: ((taskId: string) => void) | undefined
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
  onRemove: (taskId: string) => void
  onActionMenuOpenChange?:
    | ((taskId: string, isOpen: boolean) => void)
    | undefined
}

export function TaskCard({
  allTasks = [],
  currentActorUserId,
  isSharedWorkspace = false,
  sharedWorkspaceGroupRole,
  sharedWorkspaceRole,
  workspaceUsers = [],
  task,
  sphere,
  spheres = [],
  todayKey,
  tomorrowKey,
  variant = 'card',
  tone = 'default',
  isPending = false,
  uploadedIcons = [],
  onCreateNextStage,
  onCopyToPersonal,
  onDetachFromChain,
  onMoveToPersonal,
  onSetStatus,
  onSetPlannedDate,
  onUpdate,
  onRemove,
  onActionMenuOpenChange,
}: TaskCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isViewing, setIsViewing] = useState(false)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const [nextStageRequest, setNextStageRequest] = useState<{
    completeCurrent: boolean
  } | null>(null)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)
  const isCompactView = variant === 'compact'
  const isDetailView = variant === 'detail'
  const rawProjectTitle = sphere?.name ?? task.project
  const projectTitle = getSphereDisplayTitle(rawProjectTitle)
  const normalizedRawProjectTitle = rawProjectTitle.trim()
  const hasProject =
    !isSharedWorkspace &&
    Boolean(normalizedRawProjectTitle) &&
    !LEGACY_EMPTY_PROJECT_TITLES.has(normalizedRawProjectTitle)
  const taskType = getTaskTypeValue(task)
  const taskResource = getTaskResource(task)
  const reminderLabel = getTaskReminderLabel(task, isSharedWorkspace)
  const chainTasks = task.chainId
    ? sortChainTasks(
        allTasks.filter((candidate) => candidate.chainId === task.chainId),
      )
    : []
  const stageLabel = getTaskStageLabel(task, chainTasks)
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
    canCopyToPersonal,
    canDeleteTask,
    canEditTask,
    canManageSchedule,
    canManageWorkStatus,
    canMoveToPersonal,
    canReopenTask,
    hasActionMenu,
    hasArchiveAction,
    hasMoveToTodayAction,
    hasMoveToTomorrowAction,
    hasPostponeAction,
    hasReviewAction,
    isActiveTask,
    isInProgress,
    isLimitedSharedAssignee,
    isReadyForReview,
  } = actionPolicy
  const hasNextStageAction = Boolean(onCreateNextStage && canEditTask)
  const hasCompleteAndNextStageAction = Boolean(
    onCreateNextStage && isActiveTask && canCompleteTask,
  )
  const hasVisibleActionMenu =
    hasActionMenu || hasNextStageAction || hasCompleteAndNextStageAction
  const scheduleDetails = [
    task.plannedStartTime
      ? formatTimeRange(task.plannedStartTime, task.plannedEndTime)
      : null,
    task.plannedDate ? formatShortDate(task.plannedDate) : null,
  ].filter((value): value is string => Boolean(value))
  const toneClass =
    tone === 'warning'
      ? styles.warning
      : tone === 'success'
        ? styles.success
        : undefined
  const completeTaskButton =
    isActiveTask && canCompleteTask ? (
      <button
        className={cx(
          styles.button,
          styles.iconButton,
          isCompactView && styles.compactCompleteButton,
        )}
        type="button"
        disabled={isPending}
        aria-label={
          task.requiresConfirmation
            ? 'Подтвердить выполнение задачи'
            : 'Завершить задачу'
        }
        title={
          task.requiresConfirmation ? 'Подтвердить выполнение' : 'Завершить'
        }
        onClick={() => onSetStatus(task.id, 'done')}
      >
        <CheckIcon size={isCompactView ? 16 : 18} />
      </button>
    ) : null

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

  useEffect(() => {
    if (!isViewing) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsViewing(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isViewing])

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
        isCompactView && styles.compactCard,
        isDetailView && styles.detailCard,
      )}
    >
      {!isDetailView ? (
        <button
          className={styles.openCardButton}
          type="button"
          aria-label={`Открыть карточку задачи ${task.title}`}
          onClick={() => setIsViewing(true)}
        />
      ) : null}

      <div className={cx(styles.main, isCompactView && styles.compactMain)}>
        {isCompactView ? (
          <div className={styles.compactRow}>
            <h4 className={styles.compactTitle}>{task.title}</h4>
            {completeTaskButton ? (
              <div className={styles.quickActions}>{completeTaskButton}</div>
            ) : null}
          </div>
        ) : (
          <>
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
                {completeTaskButton}

                {hasVisibleActionMenu ? (
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
                              isPending ||
                              (isLimitedSharedAssignee && isInProgress)
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

                        {hasArchiveAction ? (
                          <button
                            className={styles.menuItem}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() =>
                                onSetStatus(task.id, 'archived'),
                              )
                            }
                          >
                            В архив
                          </button>
                        ) : null}

                        {onCreateNextStage && canEditTask ? (
                          <button
                            className={styles.menuItem}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() =>
                                setNextStageRequest({ completeCurrent: false }),
                              )
                            }
                          >
                            Создать следующий этап
                          </button>
                        ) : null}

                        {onCreateNextStage &&
                        isActiveTask &&
                        canCompleteTask ? (
                          <button
                            className={styles.menuItem}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() =>
                                setNextStageRequest({ completeCurrent: true }),
                              )
                            }
                          >
                            Завершить и создать следующий этап
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

                        {canCopyToPersonal && onCopyToPersonal ? (
                          <button
                            className={styles.menuItem}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() => onCopyToPersonal(task.id))
                            }
                          >
                            Скопировать в личное
                          </button>
                        ) : null}

                        {canMoveToPersonal && onMoveToPersonal ? (
                          <button
                            className={styles.menuItem}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() => onMoveToPersonal(task.id))
                            }
                          >
                            Перенести в личное
                          </button>
                        ) : null}

                        {canDeleteTask ? (
                          <button
                            className={cx(
                              styles.menuItem,
                              styles.menuItemDanger,
                            )}
                            type="button"
                            role="menuitem"
                            disabled={isPending}
                            onClick={() =>
                              runMenuAction(() => onRemove(task.id))
                            }
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
                      <IconMark
                        value={sphere.icon}
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
              {task.routine ? (
                <span className={styles.metaChip}>
                  {getRoutineTaskFrequencyLabel(task.routine)}
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
              {isSharedWorkspace && task.assigneeDisplayName ? (
                <span className={styles.metaChip}>
                  Исполнитель: {task.assigneeDisplayName}
                </span>
              ) : null}
              {!isSharedWorkspace && task.sourceWorkspace ? (
                <span
                  className={cx(styles.metaChip, styles.sourceWorkspaceChip)}
                >
                  Из: {task.sourceWorkspace.name}
                </span>
              ) : null}
              {reminderLabel ? (
                <span className={styles.metaChip}>{reminderLabel}</span>
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
              {stageLabel ? (
                <span className={cx(styles.metaChip, styles.chainChip)}>
                  {stageLabel}
                </span>
              ) : null}
            </div>

            {isDetailView && chainTasks.length > 0 ? (
              <section className={styles.chainSection}>
                <div className={styles.chainSectionHeader}>
                  <h5>Этапы</h5>
                  <span>{chainTasks.length}</span>
                </div>
                <ol className={styles.chainList}>
                  {chainTasks.map((chainTask) => (
                    <li
                      key={chainTask.id}
                      className={cx(
                        styles.chainItem,
                        chainTask.id === task.id && styles.chainItemCurrent,
                      )}
                    >
                      <span className={styles.chainIndex}>
                        {chainTask.stageIndex ?? '•'}
                      </span>
                      <span className={styles.chainBody}>
                        <span className={styles.chainTitle}>
                          {chainTask.title}
                        </span>
                        <span className={styles.chainMeta}>
                          {getTaskStatusLabel(chainTask.status)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        )}
      </div>

      {isEditing ? (
        <TaskEditDialog
          currentActorUserId={currentActorUserId}
          isSharedWorkspace={isSharedWorkspace}
          task={task}
          todayKey={todayKey}
          spheres={spheres}
          uploadedIcons={uploadedIcons}
          isPending={isPending}
          onClose={() => setIsEditing(false)}
          onUpdate={onUpdate}
          workspaceUsers={workspaceUsers}
        />
      ) : null}

      {nextStageRequest ? (
        <TaskNextStageDialog
          completeCurrent={nextStageRequest.completeCurrent}
          defaultTitle={task.title}
          isPending={isPending}
          onClose={() => setNextStageRequest(null)}
          todayKey={todayKey}
          tomorrowKey={tomorrowKey}
          onSubmit={(input) =>
            onCreateNextStage?.(task.id, {
              completeCurrent: nextStageRequest.completeCurrent,
              plannedDate: input.plannedDate,
              title: input.title,
            })
          }
        />
      ) : null}

      {isViewing && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={styles.viewerOverlay}
              role="dialog"
              aria-modal="true"
              aria-label="Карточка задачи"
            >
              <button
                className={styles.viewerBackdrop}
                type="button"
                aria-label="Закрыть карточку задачи"
                onClick={() => setIsViewing(false)}
              />
              <div className={styles.viewerPanel}>
                <div className={styles.viewerHeader}>
                  <button
                    className={styles.closeButton}
                    type="button"
                    aria-label="Закрыть"
                    onClick={() => setIsViewing(false)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
                <TaskCard
                  allTasks={allTasks}
                  currentActorUserId={currentActorUserId}
                  isSharedWorkspace={isSharedWorkspace}
                  sharedWorkspaceGroupRole={sharedWorkspaceGroupRole}
                  sharedWorkspaceRole={sharedWorkspaceRole}
                  workspaceUsers={workspaceUsers}
                  task={task}
                  sphere={sphere}
                  spheres={spheres}
                  todayKey={todayKey}
                  tomorrowKey={tomorrowKey}
                  variant="detail"
                  tone={tone}
                  isPending={isPending}
                  uploadedIcons={uploadedIcons}
                  onCreateNextStage={onCreateNextStage}
                  onCopyToPersonal={onCopyToPersonal}
                  onDetachFromChain={onDetachFromChain}
                  onMoveToPersonal={onMoveToPersonal}
                  onSetStatus={onSetStatus}
                  onSetPlannedDate={onSetPlannedDate}
                  onUpdate={onUpdate}
                  onRemove={(taskId) => {
                    setIsViewing(false)
                    onRemove(taskId)
                  }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
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
