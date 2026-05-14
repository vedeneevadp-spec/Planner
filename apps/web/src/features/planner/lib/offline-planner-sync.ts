import type { LifeSphereRecord, TaskRecord } from '@planner/contracts'

import {
  drainOfflineMutations,
  getOfflineErrorMessage,
  isBrowserRetryableOfflineError,
  readOfflineConflictDetails,
} from '@/shared/lib/offline-sync'

import {
  completePlannerOfflineMutation,
  listRetryablePlannerOfflineMutations,
  markPlannerOfflineMutationConflicted,
  markPlannerOfflineMutationFailed,
  markPlannerOfflineMutationSyncing,
  type PlannerOfflineMutationRecord,
  removeCachedTaskRecord,
  upsertCachedLifeSphereRecord,
  upsertCachedTaskRecord,
} from './offline-planner-store'
import { type PlannerApiClient, PlannerApiError } from './planner-api'

export interface PlannerOfflineDrainResult {
  conflicted: number
  failed: number
  processed: number
  synced: number
}

export interface DrainPlannerOfflineQueueOptions {
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
  api,
  onLifeSphereSynced,
  onTaskDeleted,
  onTaskSynced,
  workspaceId,
}: DrainPlannerOfflineQueueOptions): Promise<PlannerOfflineDrainResult> {
  const result: PlannerOfflineDrainResult = {
    conflicted: 0,
    failed: 0,
    processed: 0,
    synced: 0,
  }
  const mutations = await listRetryablePlannerOfflineMutations(workspaceId)
  const callbacks: OfflineMutationCallbacks = {}

  if (onLifeSphereSynced) {
    callbacks.onLifeSphereSynced = onLifeSphereSynced
  }

  if (onTaskDeleted) {
    callbacks.onTaskDeleted = onTaskDeleted
  }

  if (onTaskSynced) {
    callbacks.onTaskSynced = onTaskSynced
  }

  return drainOfflineMutations({
    apply: (mutation) => applyOfflineMutation(api, mutation, callbacks),
    complete: completePlannerOfflineMutation,
    getMutationId: (mutation) => mutation.id,
    markSyncing: markPlannerOfflineMutationSyncing,
    mutations,
    result,
    onError: async ({ error, mutationId, result: drainResult }) => {
      if (isVersionConflict(error)) {
        const conflict = readOfflineConflictDetails(error.details)

        await markPlannerOfflineMutationConflicted(mutationId, {
          actualVersion: conflict.actualVersion,
          expectedVersion: conflict.expectedVersion,
          message: getErrorMessage(error),
        })
        drainResult.conflicted += 1

        return 'continue'
      }

      await markPlannerOfflineMutationFailed(mutationId, getErrorMessage(error))
      drainResult.failed += 1

      return 'break'
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
): Promise<void> {
  if (mutation.type === 'lifeSphere.create') {
    const sphere = await api.createLifeSphere(mutation.input)

    await upsertCachedLifeSphereRecord(mutation.workspaceId, sphere)
    callbacks.onLifeSphereSynced?.(sphere)

    return
  }

  if (mutation.type === 'lifeSphere.update') {
    const sphere = await api.updateLifeSphere(mutation.sphereId, mutation.input)

    await upsertCachedLifeSphereRecord(mutation.workspaceId, sphere)
    callbacks.onLifeSphereSynced?.(sphere)

    return
  }

  if (mutation.type === 'task.create') {
    const task = await api.createTask(mutation.input)

    await upsertCachedTaskRecord(mutation.workspaceId, task)
    callbacks.onTaskSynced?.(task)

    return
  }

  if (mutation.type === 'task.update') {
    const task = await api.updateTask(mutation.taskId, {
      ...mutation.input,
      expectedVersion: mutation.expectedVersion,
    })

    await upsertCachedTaskRecord(mutation.workspaceId, task)
    callbacks.onTaskSynced?.(task)

    return
  }

  if (mutation.type === 'task.status.update') {
    const task = await api.setTaskStatus(mutation.taskId, {
      expectedVersion: mutation.expectedVersion,
      status: mutation.statusValue,
    })

    await upsertCachedTaskRecord(mutation.workspaceId, task)
    callbacks.onTaskSynced?.(task)

    return
  }

  if (mutation.type === 'task.schedule.update') {
    const task = await api.setTaskSchedule(mutation.taskId, {
      expectedVersion: mutation.expectedVersion,
      schedule: mutation.schedule,
    })

    await upsertCachedTaskRecord(mutation.workspaceId, task)
    callbacks.onTaskSynced?.(task)

    return
  }

  if (mutation.type === 'task.delete') {
    await api.removeTask(mutation.taskId, mutation.expectedVersion)
    await removeCachedTaskRecord(mutation.workspaceId, mutation.taskId)
    callbacks.onTaskDeleted?.(mutation.taskId)

    return
  }

  const unsupportedMutation = mutation as { type: string }
  throw new Error(
    `Unsupported offline mutation type "${unsupportedMutation.type}".`,
  )
}

function isVersionConflict(error: unknown): error is PlannerApiError {
  return (
    error instanceof PlannerApiError &&
    (error.code === 'life_sphere_version_conflict' ||
      error.code === 'task_version_conflict')
  )
}

function getErrorMessage(error: unknown): string {
  return getOfflineErrorMessage(
    error,
    'Не удалось синхронизировать offline-операцию.',
  )
}
