import type { LifeSphereRecord, TaskRecord } from '@planner/contracts'

import {
  createOfflineDrainErrorHandler,
  createOfflineDrainResult,
  drainOfflineQueue,
  getOfflineErrorMessage,
  isBrowserRetryableOfflineError,
  readOfflineConflictDetails,
} from '@/shared/lib/offline-sync'

import {
  completePlannerOfflineMutation,
  getPlannerOfflineWorkspaceWriteGeneration,
  isPlannerOfflineWorkspaceWriteGenerationCurrent,
  listRetryablePlannerOfflineMutations,
  markPlannerOfflineMutationConflicted,
  markPlannerOfflineMutationFailed,
  markPlannerOfflineMutationSyncing,
  type PlannerOfflineMutationRecord,
  removeCachedTaskRecord,
  upsertCachedLifeSphereRecord,
  upsertCachedTaskRecord,
  upsertCachedTaskRecords,
} from './offline-planner-store'
import { type PlannerApiClient, PlannerApiError } from './planner-api'

export interface PlannerOfflineDrainResult {
  conflicted: number
  failed: number
  processed: number
  synced: number
}

export interface DrainPlannerOfflineQueueOptions {
  actorUserId: string
  api: PlannerApiClient
  onLifeSphereSynced?: (sphere: LifeSphereRecord) => void
  onTaskDeleted?: (taskId: string) => void
  onTaskSynced?: (task: TaskRecord) => void
  workspaceId: string
}

interface OfflineMutationCallbacks {
  onLifeSphereSynced?: (sphere: LifeSphereRecord) => void
  onTaskDeleted?: (taskId: string) => void
  onTaskSynced?: (task: TaskRecord) => void
}

export async function drainPlannerOfflineQueue({
  actorUserId,
  api,
  onLifeSphereSynced,
  onTaskDeleted,
  onTaskSynced,
  workspaceId,
}: DrainPlannerOfflineQueueOptions): Promise<PlannerOfflineDrainResult> {
  const result = createOfflineDrainResult<PlannerOfflineDrainResult>({
    conflicted: 0,
  })
  const callbacks: OfflineMutationCallbacks = {}
  const expectedWriteGeneration =
    getPlannerOfflineWorkspaceWriteGeneration(workspaceId)

  if (onLifeSphereSynced) {
    callbacks.onLifeSphereSynced = onLifeSphereSynced
  }

  if (onTaskDeleted) {
    callbacks.onTaskDeleted = onTaskDeleted
  }

  if (onTaskSynced) {
    callbacks.onTaskSynced = onTaskSynced
  }

  const handleError = createOfflineDrainErrorHandler<PlannerOfflineDrainResult>(
    {
      getErrorMessage,
      isTerminalError: isTerminalPlannerSyncError,
      markConflicted: (mutationId, conflict) =>
        markPlannerOfflineMutationConflicted(
          mutationId,
          conflict,
          workspaceId,
          expectedWriteGeneration,
        ),
      markFailed: (mutationId, message) =>
        markPlannerOfflineMutationFailed(
          mutationId,
          message,
          workspaceId,
          expectedWriteGeneration,
        ),
      readConflict: (error) =>
        error instanceof PlannerApiError
          ? readOfflineConflictDetails(error.details)
          : { actualVersion: null, expectedVersion: null },
    },
  )

  return drainOfflineQueue({
    adapter: {
      completeMutation: (mutationId) =>
        completePlannerOfflineMutation(
          mutationId,
          workspaceId,
          expectedWriteGeneration,
        ),
      getMutationId: (mutation) => mutation.id,
      listRetryableMutations: () =>
        listRetryablePlannerOfflineMutations(
          workspaceId,
          actorUserId,
          expectedWriteGeneration,
        ),
      markMutationSyncing: (mutationId) =>
        markPlannerOfflineMutationSyncing(
          mutationId,
          workspaceId,
          expectedWriteGeneration,
        ),
    },
    apply: (mutation) =>
      applyOfflineMutation(api, mutation, callbacks, expectedWriteGeneration),
    result,
    onError: (input) => {
      if (
        input.error instanceof PlannerOfflineDrainInvalidatedError ||
        !isPlannerOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          expectedWriteGeneration,
        )
      ) {
        return Promise.resolve('break')
      }

      return handleError(input)
    },
  })
}

export function isQueueablePlannerMutationError(error: unknown): boolean {
  if (error instanceof PlannerApiError) {
    return false
  }

  return isBrowserRetryableOfflineError(error)
}

async function applyOfflineMutation(
  api: PlannerApiClient,
  mutation: PlannerOfflineMutationRecord,
  callbacks: OfflineMutationCallbacks,
  expectedWriteGeneration: number,
): Promise<void> {
  assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)

  if (mutation.type === 'lifeSphere.create') {
    const sphere = await api.createLifeSphere(mutation.input)

    assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
    await upsertCachedLifeSphereRecord(
      mutation.workspaceId,
      sphere,
      expectedWriteGeneration,
    )
    assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
    callbacks.onLifeSphereSynced?.(sphere)

    return
  }

  if (mutation.type === 'lifeSphere.update') {
    const sphere = await api.updateLifeSphere(mutation.sphereId, mutation.input)

    assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
    await upsertCachedLifeSphereRecord(
      mutation.workspaceId,
      sphere,
      expectedWriteGeneration,
    )
    assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
    callbacks.onLifeSphereSynced?.(sphere)

    return
  }

  if (mutation.type === 'task.create') {
    const task = await api.createTask(mutation.input)

    await commitSyncedTask(mutation, task, callbacks, expectedWriteGeneration)

    return
  }

  if (mutation.type === 'task.next-stage') {
    const result = await createNextTaskStageOrReconcile(api, mutation)

    await commitSyncedTaskStage(
      mutation,
      result,
      callbacks,
      expectedWriteGeneration,
    )

    return
  }

  if (mutation.type === 'task.update') {
    const task = await api.updateTask(mutation.taskId, {
      ...mutation.input,
      expectedVersion: mutation.expectedVersion,
    })

    await commitSyncedTask(mutation, task, callbacks, expectedWriteGeneration)

    return
  }

  if (mutation.type === 'task.status.update') {
    const task = await api.setTaskStatus(mutation.taskId, {
      expectedVersion: mutation.expectedVersion,
      status: mutation.statusValue,
    })

    await commitSyncedTask(mutation, task, callbacks, expectedWriteGeneration)

    return
  }

  if (mutation.type === 'task.schedule.update') {
    const task = await api.setTaskSchedule(mutation.taskId, {
      expectedVersion: mutation.expectedVersion,
      schedule: mutation.schedule,
    })

    await commitSyncedTask(mutation, task, callbacks, expectedWriteGeneration)

    return
  }

  if (mutation.type === 'task.delete') {
    try {
      await api.removeTask(mutation.taskId, mutation.expectedVersion)
    } catch (error) {
      if (!isMissingTaskError(error)) {
        throw error
      }
    }
    assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
    await removeCachedTaskRecord(
      mutation.workspaceId,
      mutation.taskId,
      expectedWriteGeneration,
    )
    assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
    callbacks.onTaskDeleted?.(mutation.taskId)

    return
  }

  const unsupportedMutation = mutation as { type: string }
  throw new Error(
    `Unsupported offline mutation type "${unsupportedMutation.type}".`,
  )
}

type PlannerTaskOfflineMutation = Extract<
  PlannerOfflineMutationRecord,
  { taskId: string }
>

async function commitSyncedTask(
  mutation: PlannerTaskOfflineMutation,
  task: TaskRecord,
  callbacks: OfflineMutationCallbacks,
  expectedWriteGeneration: number,
): Promise<void> {
  assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)

  if (await hasLaterTaskMutation(mutation, expectedWriteGeneration)) {
    return
  }

  assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
  await upsertCachedTaskRecord(
    mutation.workspaceId,
    task,
    expectedWriteGeneration,
  )
  assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
  callbacks.onTaskSynced?.(task)
}

async function commitSyncedTaskStage(
  mutation: Extract<PlannerOfflineMutationRecord, { type: 'task.next-stage' }>,
  result: { currentTask: TaskRecord; nextTask: TaskRecord },
  callbacks: OfflineMutationCallbacks,
  expectedWriteGeneration: number,
): Promise<void> {
  assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)

  const tasks: TaskRecord[] = []

  if (
    !(await hasLaterTaskMutationForId(
      mutation,
      result.currentTask.id,
      expectedWriteGeneration,
    ))
  ) {
    tasks.push(result.currentTask)
  }

  if (
    !(await hasLaterTaskMutationForId(
      mutation,
      result.nextTask.id,
      expectedWriteGeneration,
    ))
  ) {
    tasks.push(result.nextTask)
  }

  assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)
  await upsertCachedTaskRecords(
    mutation.workspaceId,
    tasks,
    expectedWriteGeneration,
  )
  assertPlannerOfflineDrainIsCurrent(mutation, expectedWriteGeneration)

  for (const task of tasks) {
    callbacks.onTaskSynced?.(task)
  }
}

async function createNextTaskStageOrReconcile(
  api: PlannerApiClient,
  mutation: Extract<PlannerOfflineMutationRecord, { type: 'task.next-stage' }>,
): Promise<{ currentTask: TaskRecord; nextTask: TaskRecord }> {
  try {
    return await api.createNextTaskStage(mutation.taskId, {
      ...mutation.input,
      expectedVersion: mutation.expectedVersion,
      nextTaskId: mutation.nextTaskId,
    })
  } catch (error) {
    if (!isTaskVersionConflictError(error)) {
      throw error
    }

    const tasks = await api.listTasks()
    const currentTask = tasks.find((task) => task.id === mutation.taskId)
    const nextTask = tasks.find((task) => task.id === mutation.nextTaskId)
    const isAcknowledgedStage = Boolean(
      currentTask &&
      nextTask &&
      nextTask.previousTaskId === currentTask.id &&
      currentTask.chainId &&
      nextTask.chainId === currentTask.chainId &&
      (!mutation.input.chainId ||
        currentTask.chainId === mutation.input.chainId) &&
      nextTask.stageIndex === (currentTask.stageIndex ?? 1) + 1 &&
      currentTask.version >= mutation.expectedVersion + 1,
    )

    if (currentTask && nextTask && isAcknowledgedStage) {
      return { currentTask, nextTask }
    }

    throw error
  }
}

async function hasLaterTaskMutation(
  mutation: PlannerTaskOfflineMutation,
  expectedWriteGeneration: number,
): Promise<boolean> {
  return hasLaterTaskMutationForId(
    mutation,
    mutation.taskId,
    expectedWriteGeneration,
  )
}

async function hasLaterTaskMutationForId(
  mutation: PlannerTaskOfflineMutation,
  taskId: string,
  expectedWriteGeneration: number,
): Promise<boolean> {
  const queuedMutations = await listRetryablePlannerOfflineMutations(
    mutation.workspaceId,
    mutation.actorUserId,
    expectedWriteGeneration,
  )
  const currentIndex = queuedMutations.findIndex(
    (queuedMutation) => queuedMutation.id === mutation.id,
  )

  if (currentIndex === -1) {
    return false
  }

  return queuedMutations
    .slice(currentIndex + 1)
    .some((queuedMutation) =>
      plannerMutationTouchesTask(queuedMutation, taskId),
    )
}

function plannerMutationTouchesTask(
  mutation: PlannerOfflineMutationRecord,
  taskId: string,
): boolean {
  if (!('taskId' in mutation)) {
    return false
  }

  return (
    mutation.taskId === taskId ||
    (mutation.type === 'task.next-stage' && mutation.nextTaskId === taskId)
  )
}

function isMissingTaskError(error: unknown): error is PlannerApiError {
  return error instanceof PlannerApiError && error.code === 'task_not_found'
}

function isTaskVersionConflictError(error: unknown): error is PlannerApiError {
  return (
    error instanceof PlannerApiError && error.code === 'task_version_conflict'
  )
}

class PlannerOfflineDrainInvalidatedError extends Error {}

function assertPlannerOfflineDrainIsCurrent(
  mutation: PlannerOfflineMutationRecord,
  expectedWriteGeneration: number,
): void {
  if (
    !isPlannerOfflineWorkspaceWriteGenerationCurrent(
      mutation.workspaceId,
      expectedWriteGeneration,
    )
  ) {
    throw new PlannerOfflineDrainInvalidatedError()
  }
}

function isTerminalPlannerSyncError(error: unknown): error is PlannerApiError {
  return (
    error instanceof PlannerApiError &&
    (error.code === 'life_sphere_version_conflict' ||
      error.code === 'life_sphere_not_found' ||
      error.code === 'task_assignee_not_found' ||
      error.code === 'task_not_found' ||
      error.code === 'task_version_conflict')
  )
}

function getErrorMessage(error: unknown): string {
  return getOfflineErrorMessage(
    error,
    'Не удалось синхронизировать offline-операцию.',
  )
}
