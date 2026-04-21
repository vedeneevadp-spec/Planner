import type { ProjectRecord, TaskRecord } from '@planner/contracts'

import {
  completePlannerOfflineMutation,
  listRetryablePlannerOfflineMutations,
  markPlannerOfflineMutationConflicted,
  markPlannerOfflineMutationFailed,
  markPlannerOfflineMutationSyncing,
  type PlannerOfflineMutationRecord,
  removeCachedTaskRecord,
  upsertCachedProjectRecord,
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
  onProjectSynced?: (project: ProjectRecord) => void
  onTaskDeleted?: (taskId: string) => void
  onTaskSynced?: (task: TaskRecord) => void
  workspaceId: string
}

interface ConflictDetails {
  actualVersion: number | null
  expectedVersion: number | null
}

interface OfflineMutationCallbacks {
  onProjectSynced?: (project: ProjectRecord) => void
  onTaskDeleted?: (taskId: string) => void
  onTaskSynced?: (task: TaskRecord) => void
}

export async function drainPlannerOfflineQueue({
  api,
  onProjectSynced,
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

  if (onProjectSynced) {
    callbacks.onProjectSynced = onProjectSynced
  }

  if (onTaskDeleted) {
    callbacks.onTaskDeleted = onTaskDeleted
  }

  if (onTaskSynced) {
    callbacks.onTaskSynced = onTaskSynced
  }

  for (const mutation of mutations) {
    result.processed += 1
    await markPlannerOfflineMutationSyncing(mutation.id)

    try {
      await applyOfflineMutation(api, mutation, callbacks)
      await completePlannerOfflineMutation(mutation.id)
      result.synced += 1
    } catch (error) {
      if (isVersionConflict(error)) {
        const conflict = getConflictDetails(error)

        await markPlannerOfflineMutationConflicted(mutation.id, {
          actualVersion: conflict.actualVersion,
          expectedVersion: conflict.expectedVersion,
          message: getErrorMessage(error),
        })
        result.conflicted += 1
        continue
      }

      await markPlannerOfflineMutationFailed(
        mutation.id,
        getErrorMessage(error),
      )
      result.failed += 1
      break
    }
  }

  return result
}

export function isQueueablePlannerMutationError(error: unknown): boolean {
  if (error instanceof PlannerApiError) {
    return false
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }

  return error instanceof DOMException || error instanceof TypeError
}

async function applyOfflineMutation(
  api: PlannerApiClient,
  mutation: PlannerOfflineMutationRecord,
  callbacks: OfflineMutationCallbacks,
): Promise<void> {
  if (mutation.type === 'project.create') {
    const project = await api.createProject(mutation.input)

    await upsertCachedProjectRecord(mutation.workspaceId, project)
    callbacks.onProjectSynced?.(project)

    return
  }

  if (mutation.type === 'project.update') {
    const project = await api.updateProject(mutation.projectId, mutation.input)

    await upsertCachedProjectRecord(mutation.workspaceId, project)
    callbacks.onProjectSynced?.(project)

    return
  }

  if (mutation.type === 'task.create') {
    const task = await api.createTask(mutation.input)

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

  await api.removeTask(mutation.taskId, mutation.expectedVersion)
  await removeCachedTaskRecord(mutation.workspaceId, mutation.taskId)
  callbacks.onTaskDeleted?.(mutation.taskId)
}

function isVersionConflict(error: unknown): error is PlannerApiError {
  return (
    error instanceof PlannerApiError &&
    (error.code === 'project_version_conflict' ||
      error.code === 'task_version_conflict')
  )
}

function getConflictDetails(error: PlannerApiError): ConflictDetails {
  if (!isRecord(error.details)) {
    return {
      actualVersion: null,
      expectedVersion: null,
    }
  }

  return {
    actualVersion: getNumber(error.details.actualVersion),
    expectedVersion: getNumber(error.details.expectedVersion),
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Не удалось синхронизировать offline-операцию.'
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
