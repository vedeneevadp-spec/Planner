import {
  getOfflineErrorMessage,
  isBrowserRetryableOfflineError,
  readOfflineConflictDetails,
} from '@/shared/lib/offline-sync'

import { type CleaningApiClient, CleaningApiError } from './cleaning-api'
import type { CleaningOfflineMutationRecord } from './offline-cleaning-mutation'
import {
  CleaningOfflineGenerationInvalidatedError,
  type CleaningServerConfirmation,
  completeCleaningOfflineMutation,
  getCleaningOfflineMutation,
  getCleaningOfflineWorkspaceWriteGeneration,
  isCleaningOfflineWorkspaceWriteGenerationCurrent,
  listCleaningOfflineMutations,
  markCleaningOfflineMutationConflicted,
  markCleaningOfflineMutationFailed,
  markCleaningOfflineMutationSyncing,
} from './offline-cleaning-store'

export interface CleaningOfflineDrainResult {
  conflicted: number
  failed: number
  processed: number
  synced: number
  unauthorized: boolean
}

export interface DrainCleaningOfflineQueueOptions {
  actorUserId: string
  api: CleaningApiClient
  workspaceId: string
}

const activeCleaningDrains = new Map<
  string,
  Promise<CleaningOfflineDrainResult>
>()

export function drainCleaningOfflineQueue(
  options: DrainCleaningOfflineQueueOptions,
): Promise<CleaningOfflineDrainResult> {
  const scopeKey = `${options.workspaceId}:${options.actorUserId}`
  const active = activeCleaningDrains.get(scopeKey)

  if (active) {
    return active
  }

  const drain = withCleaningSyncLock(scopeKey, () =>
    drainCleaningOfflineQueueUnlocked(options),
  ).finally(() => {
    if (activeCleaningDrains.get(scopeKey) === drain) {
      activeCleaningDrains.delete(scopeKey)
    }
  })

  activeCleaningDrains.set(scopeKey, drain)
  return drain
}

async function drainCleaningOfflineQueueUnlocked({
  actorUserId,
  api,
  workspaceId,
}: DrainCleaningOfflineQueueOptions): Promise<CleaningOfflineDrainResult> {
  const result: CleaningOfflineDrainResult = {
    conflicted: 0,
    failed: 0,
    processed: 0,
    synced: 0,
    unauthorized: false,
  }
  const generation = getCleaningOfflineWorkspaceWriteGeneration(workspaceId)
  const mutations = await listCleaningOfflineMutations(
    workspaceId,
    actorUserId,
    generation,
  )
  const remaining = new Map(
    mutations.map((mutation) => [mutation.operationId, mutation]),
  )
  const retryable = mutations.filter((mutation) =>
    ['failed', 'pending', 'syncing'].includes(mutation.status),
  )
  const processed = new Set<string>()

  while (processed.size < retryable.length) {
    let madeProgress = false

    for (const mutation of retryable) {
      if (processed.has(mutation.operationId)) {
        continue
      }

      const queuedMutation = await getCleaningOfflineMutation(
        mutation.operationId,
        workspaceId,
        actorUserId,
        generation,
      )

      if (
        !isCleaningOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          generation,
        )
      ) {
        return result
      }

      if (!queuedMutation) {
        remaining.delete(mutation.operationId)
        processed.add(mutation.operationId)
        madeProgress = true
        continue
      }

      remaining.set(mutation.operationId, queuedMutation)

      if (!['failed', 'pending', 'syncing'].includes(queuedMutation.status)) {
        processed.add(mutation.operationId)
        madeProgress = true
        continue
      }

      const dependencies = queuedMutation.dependsOnOperationIds
        .map((operationId) => remaining.get(operationId))
        .filter((item): item is CleaningOfflineMutationRecord => Boolean(item))
      const missingDependencyIds = queuedMutation.dependsOnOperationIds.filter(
        (operationId) => !remaining.has(operationId),
      )

      if (missingDependencyIds.length > 0) {
        try {
          await markCleaningOfflineMutationConflicted(
            mutation.operationId,
            {
              actualVersion: null,
              expectedVersion: null,
              message:
                'Не удалось подтвердить предыдущее связанное изменение. Обновите данные перед повтором.',
            },
            workspaceId,
            actorUserId,
            generation,
          )
        } catch (error) {
          if (isCleaningDrainInvalidated(error, workspaceId, generation)) {
            return result
          }

          throw error
        }
        remaining.set(mutation.operationId, {
          ...queuedMutation,
          status: 'conflicted',
        })
        processed.add(mutation.operationId)
        result.conflicted += 1
        result.processed += 1
        madeProgress = true
        continue
      }
      const conflictedDependency = dependencies.find(
        (dependency) => dependency.status === 'conflicted',
      )

      if (conflictedDependency) {
        try {
          await markCleaningOfflineMutationConflicted(
            mutation.operationId,
            {
              actualVersion: null,
              expectedVersion: null,
              message:
                'Предыдущее связанное изменение конфликтует с серверными данными.',
            },
            workspaceId,
            actorUserId,
            generation,
          )
        } catch (error) {
          if (isCleaningDrainInvalidated(error, workspaceId, generation)) {
            return result
          }

          throw error
        }
        remaining.set(mutation.operationId, {
          ...queuedMutation,
          status: 'conflicted',
        })
        processed.add(mutation.operationId)
        result.conflicted += 1
        result.processed += 1
        madeProgress = true
        continue
      }

      if (
        dependencies.some((dependency) =>
          ['failed', 'pending', 'syncing'].includes(dependency.status),
        )
      ) {
        continue
      }

      madeProgress = true
      processed.add(mutation.operationId)
      result.processed += 1

      try {
        assertGenerationCurrent(workspaceId, generation)
        await markCleaningOfflineMutationSyncing(
          mutation.operationId,
          workspaceId,
          actorUserId,
          generation,
        )
        const currentMutation = await getCleaningOfflineMutation(
          mutation.operationId,
          workspaceId,
          actorUserId,
          generation,
        )

        if (!currentMutation || currentMutation.status !== 'syncing') {
          remaining.delete(mutation.operationId)
          continue
        }

        const confirmation = await applyCleaningOfflineMutation(
          api,
          currentMutation,
        )
        assertGenerationCurrent(workspaceId, generation)
        await completeCleaningOfflineMutation(
          mutation.operationId,
          confirmation,
          workspaceId,
          actorUserId,
          generation,
        )
        remaining.delete(mutation.operationId)
        for (const [operationId, candidate] of remaining) {
          if (!candidate.dependsOnOperationIds.includes(mutation.operationId)) {
            continue
          }

          remaining.set(operationId, {
            ...candidate,
            dependsOnOperationIds: candidate.dependsOnOperationIds.filter(
              (dependencyId) => dependencyId !== mutation.operationId,
            ),
          })
        }
        result.synced += 1
      } catch (error) {
        if (isCleaningDrainInvalidated(error, workspaceId, generation)) {
          return result
        }

        if (isTerminalCleaningConflict(error)) {
          const conflict =
            error instanceof CleaningApiError
              ? readOfflineConflictDetails(error.details)
              : { actualVersion: null, expectedVersion: null }
          await markCleaningOfflineMutationConflicted(
            mutation.operationId,
            {
              ...conflict,
              message: getCleaningSyncErrorMessage(error),
            },
            workspaceId,
            actorUserId,
            generation,
          )
          remaining.set(mutation.operationId, {
            ...queuedMutation,
            status: 'conflicted',
          })
          result.conflicted += 1
          continue
        }

        await markCleaningOfflineMutationFailed(
          mutation.operationId,
          getCleaningSyncErrorMessage(error),
          workspaceId,
          actorUserId,
          generation,
        )
        result.failed += 1
        result.unauthorized =
          error instanceof CleaningApiError && error.status === 401
        return result
      }
    }

    if (!madeProgress) {
      for (const mutation of retryable) {
        if (processed.has(mutation.operationId)) {
          continue
        }

        try {
          await markCleaningOfflineMutationConflicted(
            mutation.operationId,
            {
              actualVersion: null,
              expectedVersion: null,
              message:
                'Не удалось определить безопасный порядок связанных изменений. Обновите данные перед повтором.',
            },
            workspaceId,
            actorUserId,
            generation,
          )
        } catch (error) {
          if (isCleaningDrainInvalidated(error, workspaceId, generation)) {
            return result
          }

          throw error
        }
        processed.add(mutation.operationId)
        result.conflicted += 1
        result.processed += 1
      }
      break
    }
  }

  return result
}

export function isQueueableCleaningMutationError(error: unknown): boolean {
  return (
    isBrowserRetryableOfflineError(error) ||
    (error instanceof CleaningApiError &&
      (error.status === 401 || error.status >= 500))
  )
}

async function applyCleaningOfflineMutation(
  api: CleaningApiClient,
  mutation: CleaningOfflineMutationRecord,
): Promise<CleaningServerConfirmation> {
  const operation = { operationId: mutation.operationId }

  if (mutation.type === 'zone.create') {
    return {
      kind: 'zone',
      value: await api.createZone(mutation.input, operation),
    }
  }

  if (mutation.type === 'zone.update') {
    return {
      kind: 'zone',
      value: await api.updateZone(
        mutation.zoneId,
        { ...mutation.input, expectedVersion: mutation.expectedVersion },
        operation,
      ),
    }
  }

  if (mutation.type === 'zone.delete') {
    await api.removeZone(mutation.zoneId, {
      expectedTaskVersions: mutation.expectedTaskVersions,
      expectedVersion: mutation.expectedVersion,
      operationId: mutation.operationId,
    })
    return { kind: 'void' }
  }

  if (mutation.type === 'task.create') {
    return {
      kind: 'task',
      value: await api.createTask(mutation.input, operation),
    }
  }

  if (mutation.type === 'task.update') {
    return {
      kind: 'task',
      value: await api.updateTask(
        mutation.taskId,
        { ...mutation.input, expectedVersion: mutation.expectedVersion },
        operation,
      ),
    }
  }

  if (mutation.type === 'task.delete') {
    await api.removeTask(mutation.taskId, {
      expectedVersion: mutation.expectedVersion,
      operationId: mutation.operationId,
    })
    return { kind: 'void' }
  }

  if (mutation.type === 'task.action') {
    const input = {
      ...mutation.input,
      expectedStateVersion: mutation.expectedStateVersion,
      expectedTaskVersion: mutation.expectedTaskVersion,
    }
    const value =
      mutation.action === 'completed'
        ? await api.completeTask(mutation.taskId, input, operation)
        : mutation.action === 'postponed'
          ? await api.postponeTask(mutation.taskId, input, operation)
          : await api.skipTask(mutation.taskId, input, operation)

    return { kind: 'action', value }
  }

  return {
    kind: 'plan',
    value: await api.seed(mutation.input, operation),
  }
}

function isTerminalCleaningConflict(error: unknown): boolean {
  return (
    error instanceof CleaningApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 425, 429].includes(error.status)
  )
}

function isCleaningDrainInvalidated(
  error: unknown,
  workspaceId: string,
  generation: number,
): boolean {
  return (
    error instanceof CleaningOfflineGenerationInvalidatedError ||
    !isCleaningOfflineWorkspaceWriteGenerationCurrent(workspaceId, generation)
  )
}

function getCleaningSyncErrorMessage(error: unknown): string {
  if (error instanceof CleaningApiError) {
    if (error.status === 401) {
      return 'Сессия требует обновления. Изменение остаётся на устройстве.'
    }

    if (error.status === 403) {
      return 'Доступ к изменению уборки был отозван.'
    }

    if (error.status === 404) {
      return 'Связанные данные уже изменены или удалены на другом устройстве.'
    }

    if (error.status === 409) {
      return 'Данные изменились на другом устройстве.'
    }

    if (error.status >= 400 && error.status < 500) {
      return 'Изменение больше не подходит к текущим данным.'
    }
  }

  return getOfflineErrorMessage(
    error,
    'Не удалось синхронизировать изменение уборки.',
  )
}

async function withCleaningSyncLock<T>(
  scopeKey: string,
  run: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return run()
  }

  return navigator.locks.request(`cleaning-sync:${scopeKey}`, run)
}

function assertGenerationCurrent(
  workspaceId: string,
  generation: number,
): void {
  if (
    !isCleaningOfflineWorkspaceWriteGenerationCurrent(workspaceId, generation)
  ) {
    throw new CleaningOfflineGenerationInvalidatedError()
  }
}
