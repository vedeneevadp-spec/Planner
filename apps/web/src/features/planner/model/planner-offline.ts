import {
  type LifeSphereRecord,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useOnlineSync } from '@/shared/lib/offline-sync'

import {
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  getLastTaskEventId,
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
  invalidatePlannerQueries: () => Promise<void>
  plannerApi: PlannerApiClient | null
  queryClient: QueryClient
  recoverSession: () => Promise<unknown>
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
  persistCurrentLifeSphereRecords: () => Promise<void>
  persistCurrentTaskRecords: () => Promise<void>
  persistCurrentTaskTemplateRecords: () => Promise<void>
  queuedMutationCount: number
  refreshQueuedMutationCount: () => Promise<void>
}

export function usePlannerOfflineSync({
  invalidatePlannerQueries,
  plannerApi,
  queryClient,
  recoverSession,
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

  const refreshQueuedMutationCount = useCallback(async () => {
    if (!workspaceId) {
      setQueuedMutationCount(0)
      setConflictedMutationCount(0)

      return
    }

    setQueuedMutationCount(
      await countRetryablePlannerOfflineMutations(workspaceId),
    )
    setConflictedMutationCount(
      await countConflictedPlannerOfflineMutations(workspaceId),
    )
  }, [workspaceId])

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

    if (!plannerApi || !workspaceId) {
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
    invalidatePlannerQueries,
    plannerApi,
    queryClient,
    recoverSession,
    setMutationErrorMessage,
    taskQueryKey,
    workspaceId,
  ])

  const drainQueuedMutations = useCallback(async () => {
    if (!plannerApi || !workspaceId) {
      return
    }

    setIsDrainingOfflineQueue(true)

    try {
      const result = await drainPlannerOfflineQueue({
        api: plannerApi,
        onLifeSphereSynced: (sphere) => {
          queryClient.setQueryData<LifeSphereRecord[]>(
            sphereQueryKey,
            (current = []) => replaceLifeSphereRecord(current, sphere),
          )
          queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
            updateTaskLifeSphereRecords(current, sphere),
          )
          queryClient.setQueryData<TaskTemplateRecord[]>(
            taskTemplateQueryKey,
            (current = []) =>
              updateTaskTemplateLifeSphereRecords(current, sphere),
          )
        },
        onTaskDeleted: (taskId) => {
          queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
            removeTaskRecord(current, taskId),
          )
        },
        onTaskSynced: (task) => {
          queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
            replaceTaskRecord(current, task),
          )
        },
        workspaceId,
      })

      if (result.synced > 0 || result.conflicted > 0) {
        await queryClient.invalidateQueries({ queryKey: sphereQueryKey })
        await queryClient.invalidateQueries({ queryKey: taskTemplateQueryKey })
        await queryClient.invalidateQueries({ queryKey: taskQueryKey })
      }

      if (result.conflicted > 0) {
        setMutationErrorMessage(
          'Часть offline-изменений конфликтует с серверной версией. Обновили данные, повторите действие.',
        )
      }

      if (result.processed > 0 && result.failed === 0) {
        await syncTaskEventCursor()
      }
    } finally {
      await refreshQueuedMutationCount()
      setIsDrainingOfflineQueue(false)
    }
  }, [
    plannerApi,
    queryClient,
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

    void loadCachedTaskRecords(workspaceId).then((cachedTaskRecords) => {
      if (!isActive || cachedTaskRecords.length === 0) {
        return
      }

      queryClient.setQueryData<TaskRecord[]>(
        taskQueryKey,
        (currentTaskRecords) => currentTaskRecords ?? cachedTaskRecords,
      )
    })
    void loadCachedLifeSphereRecords(workspaceId).then(
      (cachedLifeSphereRecords) => {
        if (!isActive || cachedLifeSphereRecords.length === 0) {
          return
        }

        queryClient.setQueryData<LifeSphereRecord[]>(
          sphereQueryKey,
          (currentLifeSphereRecords) =>
            currentLifeSphereRecords ?? cachedLifeSphereRecords,
        )
      },
    )
    void loadCachedTaskTemplateRecords(workspaceId).then(
      (cachedTemplateRecords) => {
        if (!isActive || cachedTemplateRecords.length === 0) {
          return
        }

        queryClient.setQueryData<TaskTemplateRecord[]>(
          taskTemplateQueryKey,
          (currentTemplateRecords) =>
            currentTemplateRecords ?? cachedTemplateRecords,
        )
      },
    )
    void refreshQueuedMutationCount()

    return () => {
      isActive = false
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

    void replaceCachedTaskRecords(workspaceId, tasks)
  }, [tasks, workspaceId])

  useEffect(() => {
    if (!workspaceId || !spheres) {
      return
    }

    void replaceCachedLifeSphereRecords(workspaceId, spheres)
  }, [spheres, workspaceId])

  useEffect(() => {
    if (!workspaceId || !taskTemplates) {
      return
    }

    void replaceCachedTaskTemplateRecords(workspaceId, taskTemplates)
  }, [taskTemplates, workspaceId])

  useEffect(() => {
    void drainQueuedMutations()
  }, [drainQueuedMutations])

  useOnlineSync({ onOnline: drainQueuedMutations })

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
    persistCurrentLifeSphereRecords,
    persistCurrentTaskRecords,
    persistCurrentTaskTemplateRecords,
    queuedMutationCount,
    refreshQueuedMutationCount,
  }
}
