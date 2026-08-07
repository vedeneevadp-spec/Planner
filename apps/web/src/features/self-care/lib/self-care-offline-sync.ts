import type { SelfCareOfflineCommandResponse } from '@planner/contracts'

import {
  enqueueSelfCareOfflineMutation,
  type EnqueueSelfCareOfflineMutationInput,
  getSelfCareOfflineWorkspaceWriteGeneration,
  isSelfCareOfflineWorkspaceWriteGenerationCurrent,
  listSelfCareOfflineMutations,
  markSelfCareOfflineMutationAwaitingRefresh,
  markSelfCareOfflineMutationConflicted,
  markSelfCareOfflineMutationFailed,
  markSelfCareOfflineMutationSyncing,
  type SelfCareOfflineMutationConflict,
  type SelfCareOfflineMutationRecord,
} from './offline-self-care-store'
import { type SelfCareApiClient, SelfCareApiError } from './self-care-api'

export interface SelfCareOfflineDrainResult {
  awaitingRefresh: number
  conflicted: number
  failed: number
  processed: number
}

export interface DrainSelfCareOfflineQueueOptions {
  actorUserId: string
  api: SelfCareApiClient
  onApplied?:
    | ((input: {
        mutation: SelfCareOfflineMutationRecord
        response: SelfCareOfflineCommandResponse
      }) => Promise<void> | void)
    | undefined
  workspaceId: string
}

const activeDrains = new Map<string, Promise<SelfCareOfflineDrainResult>>()
const RETRYABLE_HTTP_STATUSES = new Set([401, 408, 425, 429])
const RETRYABLE_MUTATION_STATUSES = new Set(['failed', 'pending', 'syncing'])

export async function enqueueAndDrainSelfCareOfflineMutation(
  input: EnqueueSelfCareOfflineMutationInput & {
    api: SelfCareApiClient
    onApplied?: DrainSelfCareOfflineQueueOptions['onApplied']
  },
): Promise<{
  drain: SelfCareOfflineDrainResult
  mutation: SelfCareOfflineMutationRecord
} | null> {
  const mutation = await enqueueSelfCareOfflineMutation(input)

  if (!mutation) {
    return null
  }

  const drain = await drainSelfCareOfflineQueue({
    actorUserId: input.actorUserId,
    api: input.api,
    onApplied: input.onApplied,
    workspaceId: input.workspaceId,
  })

  return { drain, mutation }
}

export function drainSelfCareOfflineQueue(
  options: DrainSelfCareOfflineQueueOptions,
): Promise<SelfCareOfflineDrainResult> {
  const ownerKey = `${options.workspaceId}:${options.actorUserId}`
  const active = activeDrains.get(ownerKey)

  if (active) {
    return active
  }

  const drain = withCrossTabDrainLock(ownerKey, () =>
    drainSelfCareOfflineQueueOnce(options),
  ).finally(() => {
    if (activeDrains.get(ownerKey) === drain) {
      activeDrains.delete(ownerKey)
    }
  })
  activeDrains.set(ownerKey, drain)

  return drain
}

async function drainSelfCareOfflineQueueOnce({
  actorUserId,
  api,
  onApplied,
  workspaceId,
}: DrainSelfCareOfflineQueueOptions): Promise<SelfCareOfflineDrainResult> {
  const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)
  const result: SelfCareOfflineDrainResult = {
    awaitingRefresh: 0,
    conflicted: 0,
    failed: 0,
    processed: 0,
  }
  while (isCurrent(workspaceId, generation)) {
    const mutations = await listSelfCareOfflineMutations(
      workspaceId,
      actorUserId,
      generation,
    )
    const mutation = findNextDrainableMutation(mutations)

    if (!mutation) {
      break
    }

    if (!isCurrent(workspaceId, generation)) {
      break
    }

    await markSelfCareOfflineMutationSyncing(
      mutation.id,
      workspaceId,
      actorUserId,
      generation,
    )

    // Queue state can change in another tab while this drain waits for the
    // cross-tab lock or between commands. Never send from an earlier snapshot.
    const currentMutations = await listSelfCareOfflineMutations(
      workspaceId,
      actorUserId,
      generation,
    )
    const currentMutation = currentMutations.find(
      (candidate) => candidate.id === mutation.id,
    )

    if (
      !currentMutation ||
      currentMutation.status !== 'syncing' ||
      hasBlockingDependency(currentMutation, currentMutations)
    ) {
      continue
    }

    result.processed += 1

    let response: SelfCareOfflineCommandResponse

    try {
      response = await api.executeOfflineCommand({
        ...(currentMutation.clientTimeZone
          ? { clientTimeZone: currentMutation.clientTimeZone }
          : {}),
        command: currentMutation.command,
        operationId: currentMutation.operationId,
      })
    } catch (error) {
      if (!isCurrent(workspaceId, generation)) {
        break
      }

      if (classifySelfCareOfflineSyncError(error) === 'terminal') {
        await markSelfCareOfflineMutationConflicted(
          mutation.id,
          workspaceId,
          actorUserId,
          generation,
          readConflict(error),
          readErrorMessage(error),
        )
        result.conflicted += 1
        continue
      }

      await markSelfCareOfflineMutationFailed(
        mutation.id,
        workspaceId,
        actorUserId,
        generation,
        readErrorMessage(error),
      )
      result.failed += 1
      break
    }

    if (!isCurrent(workspaceId, generation)) {
      break
    }

    await markSelfCareOfflineMutationAwaitingRefresh(
      mutation.id,
      workspaceId,
      actorUserId,
      generation,
      response.result,
    )
    result.awaitingRefresh += 1

    try {
      await onApplied?.({ mutation: currentMutation, response })
    } catch {
      // The server command is already durable and idempotent. Keep its server
      // result in awaiting_refresh so reconciliation can be retried safely.
    }
  }

  return result
}

export function classifySelfCareOfflineSyncError(
  error: unknown,
): 'retryable' | 'terminal' {
  if (isRetryableTransportError(error)) {
    return 'retryable'
  }

  if (!(error instanceof SelfCareApiError)) {
    return 'terminal'
  }

  return RETRYABLE_HTTP_STATUSES.has(error.status) ||
    (error.status >= 500 && error.status < 600)
    ? 'retryable'
    : 'terminal'
}

export function isQueueableSelfCareMutationError(error: unknown): boolean {
  return classifySelfCareOfflineSyncError(error) === 'retryable'
}

function withCrossTabDrainLock<T>(
  ownerKey: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockManager =
    typeof navigator === 'undefined' ? undefined : navigator.locks

  if (!lockManager) {
    return run()
  }

  return lockManager.request(
    `self-care-offline-drain:${ownerKey}`,
    { mode: 'exclusive' },
    run,
  )
}

function findNextDrainableMutation(
  mutations: readonly SelfCareOfflineMutationRecord[],
): SelfCareOfflineMutationRecord | null {
  return (
    mutations.find(
      (mutation) =>
        RETRYABLE_MUTATION_STATUSES.has(mutation.status) &&
        !hasBlockingDependency(mutation, mutations),
    ) ?? null
  )
}

function hasBlockingDependency(
  mutation: SelfCareOfflineMutationRecord,
  mutations: readonly SelfCareOfflineMutationRecord[],
): boolean {
  const byId = new Map(
    mutations.map((candidate) => [candidate.id, candidate] as const),
  )

  return mutation.dependsOn.some((dependency) => {
    const candidate = byId.get(dependency)
    return !candidate || candidate.status !== 'awaiting_refresh'
  })
}

function isRetryableTransportError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException)
  )
}

function readConflict(error: unknown): SelfCareOfflineMutationConflict {
  const fallback: SelfCareOfflineMutationConflict = {
    actualVersion: null,
    entityId: null,
    entityType: null,
    expectedVersion: null,
  }

  if (!(error instanceof SelfCareApiError) || !isRecord(error.details)) {
    return fallback
  }

  return {
    actualVersion: readNumber(error.details.actualVersion),
    entityId: readString(error.details.entityId),
    entityType: readString(error.details.entityType),
    expectedVersion: readNumber(error.details.expectedVersion),
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Не удалось синхронизировать изменение.'
}

function isCurrent(workspaceId: string, generation: number): boolean {
  return isSelfCareOfflineWorkspaceWriteGenerationCurrent(
    workspaceId,
    generation,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
