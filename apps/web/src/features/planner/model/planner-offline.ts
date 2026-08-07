import {
  type LifeSphereRecord,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { SessionReadiness } from '@/features/session'
import { recordClientEvent } from '@/shared/lib/observability'
import {
  createOfflineDrainCoordinator,
  useOfflineQueueDrain,
} from '@/shared/lib/offline-sync'

import {
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  getLastTaskEventId,
  getPlannerDataLastSuccessfulSyncAt,
  loadCachedLifeSphereRecords,
  loadCachedTaskRecords,
  loadCachedTaskTemplateRecords,
  replaceCachedLifeSphereRecords,
  replaceCachedTaskRecords,
  replaceCachedTaskTemplateRecords,
  setLastTaskEventId,
} from '../lib/offline-planner-store'
import {
  drainPlannerOfflineQueue,
  isQueueablePlannerMutationError,
} from '../lib/offline-planner-sync'
import {
  isUnauthorizedPlannerApiError,
  type PlannerApiClient,
} from '../lib/planner-api'
import { getErrorMessage } from './planner-error-policy'
import {
  type PlannerSphereQueryKey,
  type PlannerTaskQueryKey,
  type PlannerTaskTemplateQueryKey,
  TASK_EVENT_POLL_INTERVAL_MS,
} from './planner-queries'
import {
  removeTaskRecord,
  replaceLifeSphereRecord,
  replaceTaskRecord,
  updateTaskLifeSphereRecords,
  updateTaskTemplateLifeSphereRecords,
} from './planner-records'

interface PlannerOfflineSyncParams {
  actorUserId: string | undefined
  invalidatePlannerQueries: () => Promise<void>
  plannerApi: PlannerApiClient | null
  queryClient: QueryClient
  recoverSession: () => Promise<unknown>
  readiness: SessionReadiness
  setMutationErrorMessage: (message: string | null) => void
  sphereQueryKey: PlannerSphereQueryKey
  spheres: LifeSphereRecord[] | undefined
  taskQueryKey: PlannerTaskQueryKey
  taskTemplateQueryKey: PlannerTaskTemplateQueryKey
  taskTemplates: TaskTemplateRecord[] | undefined
  tasks: TaskRecord[] | undefined
  workspaceId: string | undefined
}

interface PlannerOfflineSync {
  conflictedMutationCount: number
  isDrainingOfflineQueue: boolean
  isLifeSphereCacheHydrating: boolean
  isTaskCacheHydrating: boolean
  isTaskTemplateCacheHydrating: boolean
  persistCurrentLifeSphereRecords: () => Promise<void>
  persistCurrentTaskRecords: () => Promise<void>
  persistCurrentTaskTemplateRecords: () => Promise<void>
  queuedMutationCount: number
  refreshQueuedMutationCount: () => Promise<void>
}

type PlannerCacheHydrationScope = 'life-spheres' | 'task-templates' | 'tasks'

interface PlannerCacheHydrationState {
  completedScopes: ReadonlySet<PlannerCacheHydrationScope>
  workspaceId: string
}

const plannerDrainCoordinator = createOfflineDrainCoordinator<string, void>()

export function usePlannerOfflineSync({
  actorUserId,
  invalidatePlannerQueries,
  plannerApi,
  queryClient,
  recoverSession,
  readiness,
  setMutationErrorMessage,
  sphereQueryKey,
  spheres,
  taskQueryKey,
  taskTemplateQueryKey,
  taskTemplates,
  tasks,
  workspaceId,
}: PlannerOfflineSyncParams): PlannerOfflineSync {
  const taskEventCursorSyncRef = useRef<Promise<void> | null>(null)
  const [isDrainingOfflineQueue, setIsDrainingOfflineQueue] = useState(false)
  const [queuedMutationCount, setQueuedMutationCount] = useState(0)
  const [conflictedMutationCount, setConflictedMutationCount] = useState(0)
  const [cacheHydration, setCacheHydration] =
    useState<PlannerCacheHydrationState | null>(null)
  const completedHydrationScopes =
    cacheHydration && cacheHydration.workspaceId === workspaceId
      ? cacheHydration.completedScopes
      : EMPTY_CACHE_HYDRATION_SCOPES
  const isTaskCacheHydrating = Boolean(
    workspaceId && !completedHydrationScopes.has('tasks'),
  )
  const isLifeSphereCacheHydrating = Boolean(
    workspaceId && !completedHydrationScopes.has('life-spheres'),
  )
  const isTaskTemplateCacheHydrating = Boolean(
    workspaceId && !completedHydrationScopes.has('task-templates'),
  )

  const refreshQueuedMutationCount = useCallback(async () => {
    if (!actorUserId || !workspaceId) {
      setQueuedMutationCount(0)
      setConflictedMutationCount(0)

      return
    }

    setQueuedMutationCount(
      await countRetryablePlannerOfflineMutations(workspaceId, actorUserId),
    )
    setConflictedMutationCount(
      await countConflictedPlannerOfflineMutations(workspaceId, actorUserId),
    )
  }, [actorUserId, workspaceId])

  const persistCurrentTaskRecords = useCallback(async () => {
    if (!workspaceId) {
      return
    }

    const currentTaskRecords =
      queryClient.getQueryData<TaskRecord[]>(taskQueryKey)

    if (currentTaskRecords) {
      await replaceCachedTaskRecords(workspaceId, currentTaskRecords)
    }
  }, [queryClient, taskQueryKey, workspaceId])

  const persistCurrentLifeSphereRecords = useCallback(async () => {
    if (!workspaceId) {
      return
    }

    const currentLifeSphereRecords =
      queryClient.getQueryData<LifeSphereRecord[]>(sphereQueryKey)

    if (currentLifeSphereRecords) {
      await replaceCachedLifeSphereRecords(
        workspaceId,
        currentLifeSphereRecords,
      )
    }
  }, [queryClient, sphereQueryKey, workspaceId])

  const persistCurrentTaskTemplateRecords = useCallback(async () => {
    if (!workspaceId) {
      return
    }

    const currentTemplateRecords =
      queryClient.getQueryData<TaskTemplateRecord[]>(taskTemplateQueryKey)

    if (currentTemplateRecords) {
      await replaceCachedTaskTemplateRecords(
        workspaceId,
        currentTemplateRecords,
      )
    }
  }, [queryClient, taskTemplateQueryKey, workspaceId])

  const syncTaskEventCursor = useCallback(async () => {
    if (taskEventCursorSyncRef.current) {
      try {
        await taskEventCursorSyncRef.current
      } catch {
        // The owner call reports the sync error.
      }

      return
    }

    if (
      !actorUserId ||
      !plannerApi ||
      !workspaceId ||
      !readiness.canWriteProtectedData
    ) {
      return
    }

    taskEventCursorSyncRef.current = (async () => {
      const afterEventId = await getLastTaskEventId(workspaceId)
      const result = await plannerApi.listTaskEvents({
        afterEventId,
        limit: 500,
      })

      if (result.nextEventId > afterEventId) {
        await setLastTaskEventId(workspaceId, result.nextEventId)
        await queryClient.invalidateQueries({ queryKey: taskQueryKey })
      }
    })()

    try {
      await taskEventCursorSyncRef.current
    } catch (error) {
      if (isUnauthorizedPlannerApiError(error)) {
        const recoveryResult = await recoverSession()

        if (recoveryResult === 'recovered') {
          await invalidatePlannerQueries()
        }

        return
      }

      if (!isQueueablePlannerMutationError(error)) {
        setMutationErrorMessage(getErrorMessage(error))
      }
    } finally {
      taskEventCursorSyncRef.current = null
    }
  }, [
    actorUserId,
    invalidatePlannerQueries,
    plannerApi,
    queryClient,
    recoverSession,
    readiness.canWriteProtectedData,
    setMutationErrorMessage,
    taskQueryKey,
    workspaceId,
  ])

  const drainQueuedMutations = useCallback(async () => {
    const currentActorUserId = actorUserId

    if (
      !currentActorUserId ||
      !plannerApi ||
      !workspaceId ||
      !readiness.canWriteProtectedData
    ) {
      return
    }

    await plannerDrainCoordinator
      .drain(`${currentActorUserId}:${workspaceId}`, async () => {
        setIsDrainingOfflineQueue(true)
        const result = await drainPlannerOfflineQueue({
          actorUserId: currentActorUserId,
          api: plannerApi,
          onLifeSphereSynced: (sphere) => {
            queryClient.setQueryData<LifeSphereRecord[]>(
              sphereQueryKey,
              (current = []) => replaceLifeSphereRecord(current, sphere),
            )
            queryClient.setQueryData<TaskRecord[]>(
              taskQueryKey,
              (current = []) => updateTaskLifeSphereRecords(current, sphere),
            )
            queryClient.setQueryData<TaskTemplateRecord[]>(
              taskTemplateQueryKey,
              (current = []) =>
                updateTaskTemplateLifeSphereRecords(current, sphere),
            )
          },
          onTaskDeleted: (taskId) => {
            queryClient.setQueryData<TaskRecord[]>(
              taskQueryKey,
              (current = []) => removeTaskRecord(current, taskId),
            )
          },
          onTaskSynced: (task) => {
            queryClient.setQueryData<TaskRecord[]>(
              taskQueryKey,
              (current = []) => replaceTaskRecord(current, task),
            )
          },
          workspaceId,
        })

        if (result.synced > 0 || result.conflicted > 0) {
          await queryClient.invalidateQueries({ queryKey: sphereQueryKey })
          await queryClient.invalidateQueries({
            queryKey: taskTemplateQueryKey,
          })
          await queryClient.invalidateQueries({ queryKey: taskQueryKey })
        }

        if (result.conflicted > 0) {
          recordClientEvent(
            'offline_mutation_conflicted',
            {
              conflicted: result.conflicted,
              failed: result.failed,
              processed: result.processed,
              scope: 'planner',
              synced: result.synced,
            },
            { level: 'warn' },
          )
          setMutationErrorMessage(
            'Часть offline-изменений конфликтует с серверной версией. Обновили данные, повторите действие.',
          )
        }

        if (result.processed > 0 && result.failed === 0) {
          await syncTaskEventCursor()
        }
      })
      .finally(async () => {
        await refreshQueuedMutationCount()
        setIsDrainingOfflineQueue(false)
      })
  }, [
    actorUserId,
    plannerApi,
    queryClient,
    readiness.canWriteProtectedData,
    refreshQueuedMutationCount,
    setMutationErrorMessage,
    sphereQueryKey,
    syncTaskEventCursor,
    taskTemplateQueryKey,
    taskQueryKey,
    workspaceId,
  ])

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    let isActive = true

    void Promise.all([
      loadCachedTaskRecords(workspaceId),
      getPlannerDataLastSuccessfulSyncAt(workspaceId, 'tasks'),
    ])
      .then(([cachedTaskRecords, lastSuccessfulSyncAt]) => {
        if (
          !isActive ||
          (cachedTaskRecords.length === 0 && !lastSuccessfulSyncAt)
        ) {
          return
        }

        queryClient.setQueryData<TaskRecord[]>(
          taskQueryKey,
          (currentTaskRecords) => currentTaskRecords ?? cachedTaskRecords,
        )
      })
      .catch((error) => {
        console.warn('Failed to hydrate cached planner tasks.', error)
      })
      .finally(() => {
        if (isActive) {
          setCacheHydration((current) =>
            completeCacheHydration(current, workspaceId, 'tasks'),
          )
        }
      })
    void Promise.all([
      loadCachedLifeSphereRecords(workspaceId),
      getPlannerDataLastSuccessfulSyncAt(workspaceId, 'life-spheres'),
    ])
      .then(([cachedLifeSphereRecords, lastSuccessfulSyncAt]) => {
        if (
          !isActive ||
          (cachedLifeSphereRecords.length === 0 && !lastSuccessfulSyncAt)
        ) {
          return
        }

        queryClient.setQueryData<LifeSphereRecord[]>(
          sphereQueryKey,
          (currentLifeSphereRecords) =>
            currentLifeSphereRecords ?? cachedLifeSphereRecords,
        )
      })
      .catch((error) => {
        console.warn('Failed to hydrate cached planner spheres.', error)
      })
      .finally(() => {
        if (isActive) {
          setCacheHydration((current) =>
            completeCacheHydration(current, workspaceId, 'life-spheres'),
          )
        }
      })
    void Promise.all([
      loadCachedTaskTemplateRecords(workspaceId),
      getPlannerDataLastSuccessfulSyncAt(workspaceId, 'task-templates'),
    ])
      .then(([cachedTemplateRecords, lastSuccessfulSyncAt]) => {
        if (
          !isActive ||
          (cachedTemplateRecords.length === 0 && !lastSuccessfulSyncAt)
        ) {
          return
        }

        queryClient.setQueryData<TaskTemplateRecord[]>(
          taskTemplateQueryKey,
          (currentTemplateRecords) =>
            currentTemplateRecords ?? cachedTemplateRecords,
        )
      })
      .catch((error) => {
        console.warn('Failed to hydrate cached planner templates.', error)
      })
      .finally(() => {
        if (isActive) {
          setCacheHydration((current) =>
            completeCacheHydration(current, workspaceId, 'task-templates'),
          )
        }
      })
    const refreshQueuedMutationTimer = window.setTimeout(() => {
      void refreshQueuedMutationCount()
    }, 0)

    return () => {
      isActive = false
      window.clearTimeout(refreshQueuedMutationTimer)
    }
  }, [
    queryClient,
    refreshQueuedMutationCount,
    sphereQueryKey,
    taskTemplateQueryKey,
    taskQueryKey,
    workspaceId,
  ])

  useEffect(() => {
    if (!workspaceId || !tasks) {
      return
    }

    void replaceCachedTaskRecords(workspaceId, tasks).catch((error) => {
      console.warn('Failed to persist cached planner tasks.', error)
    })
  }, [tasks, workspaceId])

  useEffect(() => {
    if (!workspaceId || !spheres) {
      return
    }

    void replaceCachedLifeSphereRecords(workspaceId, spheres).catch((error) => {
      console.warn('Failed to persist cached planner spheres.', error)
    })
  }, [spheres, workspaceId])

  useEffect(() => {
    if (!workspaceId || !taskTemplates) {
      return
    }

    void replaceCachedTaskTemplateRecords(workspaceId, taskTemplates).catch(
      (error) => {
        console.warn('Failed to persist cached planner templates.', error)
      },
    )
  }, [taskTemplates, workspaceId])

  useOfflineQueueDrain({
    drain: drainQueuedMutations,
    enabled: Boolean(
      plannerApi && workspaceId && readiness.canWriteProtectedData,
    ),
  })

  useEffect(() => {
    if (
      !workspaceId ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return
    }

    void syncTaskEventCursor()

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return
      }

      void syncTaskEventCursor()
    }, TASK_EVENT_POLL_INTERVAL_MS)

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void syncTaskEventCursor()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [syncTaskEventCursor, workspaceId])

  return {
    conflictedMutationCount,
    isDrainingOfflineQueue,
    isLifeSphereCacheHydrating,
    isTaskCacheHydrating,
    isTaskTemplateCacheHydrating,
    persistCurrentLifeSphereRecords,
    persistCurrentTaskRecords,
    persistCurrentTaskTemplateRecords,
    queuedMutationCount,
    refreshQueuedMutationCount,
  }
}

const EMPTY_CACHE_HYDRATION_SCOPES: ReadonlySet<PlannerCacheHydrationScope> =
  new Set()

function completeCacheHydration(
  current: PlannerCacheHydrationState | null,
  workspaceId: string,
  scope: PlannerCacheHydrationScope,
): PlannerCacheHydrationState {
  const completedScopes =
    current?.workspaceId === workspaceId
      ? new Set(current.completedScopes)
      : new Set<PlannerCacheHydrationScope>()

  completedScopes.add(scope)

  return { completedScopes, workspaceId }
}
