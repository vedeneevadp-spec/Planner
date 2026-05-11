import type { WorkspaceGroupRole, WorkspaceRole } from '@planner/contracts'

import type { Task } from './task.types'

interface ResolveTaskCardActionPolicyInput {
  currentActorUserId?: string | undefined
  isSharedWorkspace: boolean
  sharedWorkspaceGroupRole?: WorkspaceGroupRole | null | undefined
  sharedWorkspaceRole?: WorkspaceRole | undefined
  task: Pick<
    Task,
    | 'assigneeUserId'
    | 'authorUserId'
    | 'plannedDate'
    | 'requiresConfirmation'
    | 'status'
  >
  todayKey: string
  tomorrowKey: string
}

export interface TaskCardActionPolicy {
  canCompleteTask: boolean
  canDeleteTask: boolean
  canEditTask: boolean
  canManageSchedule: boolean
  canManageWorkStatus: boolean
  canReopenTask: boolean
  hasActionMenu: boolean
  hasMoveToTodayAction: boolean
  hasMoveToTomorrowAction: boolean
  hasPostponeAction: boolean
  hasReopenAction: boolean
  hasReviewAction: boolean
  hasScheduleActions: boolean
  hasWorkAction: boolean
  isActiveTask: boolean
  isInProgress: boolean
  isLimitedSharedAssignee: boolean
  isReadyForReview: boolean
}

export function resolveTaskCardActionPolicy({
  currentActorUserId,
  isSharedWorkspace,
  sharedWorkspaceGroupRole,
  sharedWorkspaceRole,
  task,
  todayKey,
  tomorrowKey,
}: ResolveTaskCardActionPolicyInput): TaskCardActionPolicy {
  const isActiveTask = task.status !== 'done'
  const isInProgress = task.status === 'in_progress'
  const isReadyForReview = task.status === 'ready_for_review'
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
  const hasMoveToTodayAction = task.plannedDate !== todayKey
  const hasMoveToTomorrowAction = task.plannedDate !== tomorrowKey
  const hasPostponeAction =
    task.plannedDate === todayKey || task.plannedDate === tomorrowKey
  const hasScheduleActions =
    isActiveTask &&
    canManageSchedule &&
    (hasMoveToTodayAction || hasMoveToTomorrowAction || hasPostponeAction)
  const hasWorkAction = isActiveTask && canManageWorkStatus
  const hasReviewAction = canToggleReview
  const hasReopenAction = !isActiveTask && canReopenTask
  const hasActionMenu =
    hasScheduleActions ||
    hasWorkAction ||
    hasReviewAction ||
    hasReopenAction ||
    canEditTask ||
    canDeleteTask

  return {
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
    hasReopenAction,
    hasReviewAction,
    hasScheduleActions,
    hasWorkAction,
    isActiveTask,
    isInProgress,
    isLimitedSharedAssignee,
    isReadyForReview,
  }
}
