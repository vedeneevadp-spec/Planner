import {
  type CleaningListResponse,
  type CleaningTaskWithState,
  type CleaningTodayResponse,
  generateUuidV7,
} from '@planner/contracts'

import type { CleaningApiClient } from './cleaning-api'
import {
  CleaningOfflineGenerationInvalidatedError,
  CleaningOfflineMutationNotPersistedError,
  enqueueCleaningOfflineMutation,
  getCleaningOfflineStorageHealth,
  getCleaningOfflineWorkspaceWriteGeneration,
  isCleaningOfflineWorkspaceWriteGenerationCurrent,
  loadCachedCleaningPlan,
  loadCachedCleaningToday,
  probeCleaningOfflineStorage,
  replaceCachedCleaningPlan,
  replaceCachedCleaningToday,
} from './offline-cleaning-store'
import { drainCleaningOfflineQueue } from './offline-cleaning-sync'

export interface QueueCleaningTaskCompletionInput {
  actorUserId: string
  api?: CleaningApiClient | null | undefined
  date: string
  occurredAt?: string | undefined
  taskId: string
  today: CleaningTodayResponse
  workspaceId: string
}

export interface QueueCleaningTaskCompletionResult {
  operationId: string
  queued: boolean
  today: CleaningTodayResponse
}

export async function queueCleaningTaskCompletion({
  actorUserId,
  api,
  date,
  occurredAt = new Date().toISOString(),
  taskId,
  today,
  workspaceId,
}: QueueCleaningTaskCompletionInput): Promise<QueueCleaningTaskCompletionResult> {
  const generation = getCleaningOfflineWorkspaceWriteGeneration(workspaceId)
  const taskWithState = findCleaningTask(today, taskId)

  if (!taskWithState) {
    throw new Error('Задача уборки больше недоступна.')
  }

  const operationId = generateUuidV7()
  const actionInput = {
    date,
    expectedStateVersion: taskWithState.state.version,
    expectedTaskVersion: taskWithState.task.version,
    mode: 'next_cycle' as const,
    note: '',
    occurredAt,
    targetDate: null,
  }
  const storageHealth = await probeCleaningOfflineStorage()

  assertGenerationCurrent(workspaceId, generation)

  if (storageHealth !== 'ready') {
    if (
      !api ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) {
      throw new Error(
        'Надёжное локальное сохранение недоступно. Подключитесь к сети и повторите.',
      )
    }

    await api.completeTask(taskId, actionInput, { operationId })
    return { operationId, queued: false, today }
  }

  try {
    const existingPlan = await loadCachedCleaningPlan(workspaceId, actorUserId)

    assertGenerationCurrent(workspaceId, generation)

    if (!existingPlan) {
      await replaceCachedCleaningPlan(
        workspaceId,
        actorUserId,
        createPlanFromToday(today),
        new Date().toISOString(),
        generation,
      )
    }

    assertGenerationCurrent(workspaceId, generation)

    if (!(await loadCachedCleaningToday(workspaceId, actorUserId, date))) {
      assertGenerationCurrent(workspaceId, generation)
      await replaceCachedCleaningToday(
        workspaceId,
        actorUserId,
        date,
        today,
        new Date().toISOString(),
        generation,
      )
    }

    assertGenerationCurrent(workspaceId, generation)
    await enqueueCleaningOfflineMutation(
      {
        action: 'completed',
        actorUserId,
        entityKeys: [`task:${taskId}`],
        expectedStateVersion: taskWithState.state.version,
        expectedTaskVersion: taskWithState.task.version,
        input: {
          date,
          mode: 'next_cycle',
          note: '',
          occurredAt,
          targetDate: null,
        },
        operationId,
        taskId,
        type: 'task.action',
        workspaceId,
      },
      generation,
    )
  } catch (error) {
    if (
      error instanceof CleaningOfflineGenerationInvalidatedError ||
      (!['failed', 'unavailable'].includes(getCleaningOfflineStorageHealth()) &&
        !(error instanceof CleaningOfflineMutationNotPersistedError))
    ) {
      throw error
    }

    assertGenerationCurrent(workspaceId, generation)

    if (
      !api ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) {
      throw new Error(
        'Надёжное локальное сохранение недоступно. Подключитесь к сети и повторите.',
      )
    }

    await api.completeTask(taskId, actionInput, { operationId })
    return { operationId, queued: false, today }
  }

  if (api && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    await drainCleaningOfflineQueue({ actorUserId, api, workspaceId })
  }

  const projectedToday = await loadCachedCleaningToday(
    workspaceId,
    actorUserId,
    date,
  )

  return {
    operationId,
    queued: true,
    today: projectedToday?.data ?? today,
  }
}

function assertGenerationCurrent(
  workspaceId: string,
  expectedWriteGeneration: number,
): void {
  if (
    !isCleaningOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      expectedWriteGeneration,
    )
  ) {
    throw new CleaningOfflineGenerationInvalidatedError()
  }
}

function findCleaningTask(
  today: CleaningTodayResponse,
  taskId: string,
): CleaningTaskWithState | null {
  return (
    collectTodayItems(today).find((item) => item.task.id === taskId) ?? null
  )
}

function createPlanFromToday(
  today: CleaningTodayResponse,
): CleaningListResponse {
  const items = collectTodayItems(today)

  return {
    history: today.history,
    states: uniqueBy(
      items.map((item) => item.state),
      (state) => state.taskId,
    ),
    tasks: uniqueBy(
      items.map((item) => item.task),
      (task) => task.id,
    ),
    zones: uniqueBy(
      [
        ...today.zones,
        ...items.flatMap((item) => (item.zone ? [item.zone] : [])),
      ],
      (zone) => zone.id,
    ),
  }
}

function collectTodayItems(
  today: CleaningTodayResponse,
): CleaningTaskWithState[] {
  return uniqueBy(
    [
      ...today.items,
      ...today.generalItems,
      ...today.accumulatedItems,
      ...today.quickItems,
      ...today.seasonalItems,
      ...today.urgentItems,
    ],
    (item) => item.task.id,
  )
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [getKey(item), item])).values()]
}
