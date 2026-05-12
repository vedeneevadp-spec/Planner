import {
  type ProjectRecord,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  getLastTaskEventId,
  loadCachedProjectRecords,
  loadCachedTaskRecords,
  loadCachedTaskTemplateRecords,
  replaceCachedProjectRecords,
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
  type PlannerProjectQueryKey,
  type PlannerTaskQueryKey,
  type PlannerTaskTemplateQueryKey,
  TASK_EVENT_POLL_INTERVAL_MS,
} from './planner-queries'
import {
  removeTaskRecord,
  replaceProjectRecord,
  replaceTaskRecord,
  updateTaskProjectRecords,
  updateTaskTemplateProjectRecords,
} from './planner-records'

interface PlannerOfflineSyncParams {
  invalidatePlannerQueries: () => Promise<void>
  plannerApi: PlannerApiClient | null
  projectQueryKey: PlannerProjectQueryKey
  projects: ProjectRecord[] | undefined
  queryClient: QueryClient
  recoverSession: () => Promise<unknown>
  setMutationErrorMessage: (message: string | null) => void
  taskQueryKey: PlannerTaskQueryKey
  taskTemplateQueryKey: PlannerTaskTemplateQueryKey
  taskTemplates: TaskTemplateRecord[] | undefined
  tasks: TaskRecord[] | undefined
  workspaceId: string | undefined
}

interface PlannerOfflineSync {
  conflictedMutationCount: number
  isDrainingOfflineQueue: boolean
  persistCurrentProjectRecords: () => Promise<void>
  persistCurrentTaskRecords: () => Promise<void>
  persistCurrentTaskTemplateRecords: () => Promise<void>
  queuedMutationCount: number
  refreshQueuedMutationCount: () => Promise<void>
}

export function usePlannerOfflineSync({
  invalidatePlannerQueries,
  plannerApi,
  projectQueryKey,
  projects,
  queryClient,
  recoverSession,
  setMutationErrorMessage,
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

  const persistCurrentProjectRecords = useCallback(async () => {
    if (!workspaceId) {
      return
    }

    const currentProjectRecords =
      queryClient.getQueryData<ProjectRecord[]>(projectQueryKey)

    if (currentProjectRecords) {
      await replaceCachedProjectRecords(workspaceId, currentProjectRecords)
    }
  }, [projectQueryKey, queryClient, workspaceId])

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
        onProjectSynced: (project) => {
          queryClient.setQueryData<ProjectRecord[]>(
            projectQueryKey,
            (current = []) => replaceProjectRecord(current, project),
          )
          queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
            updateTaskProjectRecords(current, project),
          )
          queryClient.setQueryData<TaskTemplateRecord[]>(
            taskTemplateQueryKey,
            (current = []) =>
              updateTaskTemplateProjectRecords(current, project),
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
        await queryClient.invalidateQueries({ queryKey: projectQueryKey })
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
    projectQueryKey,
    queryClient,
    refreshQueuedMutationCount,
    setMutationErrorMessage,
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
    void loadCachedProjectRecords(workspaceId).then((cachedProjectRecords) => {
      if (!isActive || cachedProjectRecords.length === 0) {
        return
      }

      queryClient.setQueryData<ProjectRecord[]>(
        projectQueryKey,
        (currentProjectRecords) =>
          currentProjectRecords ?? cachedProjectRecords,
      )
    })
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
    projectQueryKey,
    queryClient,
    refreshQueuedMutationCount,
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
    if (!workspaceId || !projects) {
      return
    }

    void replaceCachedProjectRecords(workspaceId, projects)
  }, [projects, workspaceId])

  useEffect(() => {
    if (!workspaceId || !taskTemplates) {
      return
    }

    void replaceCachedTaskTemplateRecords(workspaceId, taskTemplates)
  }, [taskTemplates, workspaceId])

  useEffect(() => {
    void drainQueuedMutations()
  }, [drainQueuedMutations])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    function handleOnline() {
      void drainQueuedMutations()
    }

    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [drainQueuedMutations])

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
    persistCurrentProjectRecords,
    persistCurrentTaskRecords,
    persistCurrentTaskTemplateRecords,
    queuedMutationCount,
    refreshQueuedMutationCount,
  }
}
