import type { TaskRecord } from '@planner/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import type { Sphere } from '@/entities/sphere'
import {
  isActiveTaskStatus,
  sortTasks,
  type Task,
  type TaskStatus,
} from '@/entities/task'
import { useSessionAuth, useSessionFeatureReadiness } from '@/features/session'
import { recordClientEvent } from '@/shared/lib/observability'

import {
  ackPendingNativePlannerWidgetCompletedTasks,
  addNativePlannerWidgetResumeListener,
  buildNativePlannerWidgetSnapshot,
  consumePendingNativePlannerWidgetRoute,
  isAndroidPlannerWidgetRuntime,
  persistNativePlannerWidgetSnapshot,
  readPendingNativePlannerWidgetCompletedTasks,
} from '../lib/native-planner-widget'
import {
  enqueuePlannerOfflineMutation,
  loadCachedLifeSphereRecords,
  loadCachedTaskRecords,
  replaceCachedLifeSphereRecords,
  replaceCachedTaskRecords,
  upsertCachedTaskRecord,
} from '../lib/offline-planner-store'
import {
  createPlannerApiClient,
  type PlannerApiClient,
} from '../lib/planner-api'
import { usePlanner } from '../lib/usePlanner'
import {
  PlannerApiUnavailableError,
  shouldKeepOptimisticMutation,
} from '../model/planner-error-policy'
import { replaceTaskRecord, toPlannerTask } from '../model/planner-records'

interface NativeCompletionSyncResult {
  didCompleteTask: boolean
  hasPendingCompletions: boolean
}

type NativeWidgetTaskQueryKey = readonly [
  'planner',
  'native-widget',
  'personal-tasks',
  string,
  number,
]

type NativeWidgetSphereQueryKey = readonly [
  'planner',
  'native-widget',
  'personal-spheres',
  string,
  number,
]

interface NativeWidgetPlannerRef {
  actorUserId: string | undefined
  isActivePersonalWorkspace: boolean
  isLoading: boolean
  personalApi: PlannerApiClient | null
  personalTaskQueryKey: NativeWidgetTaskQueryKey
  personalWorkspaceId: string | undefined
  setActiveTaskStatus: (taskId: string, status: TaskStatus) => Promise<boolean>
  spheres: Sphere[]
  taskRecords: TaskRecord[]
  tasks: Task[]
}

const EMPTY_PERSONAL_TASK_RECORDS: TaskRecord[] = []
const EMPTY_PERSONAL_SPHERES: Sphere[] = []

export function NativePlannerWidgetSync() {
  const activePlanner = usePlanner()
  const { sessionVersion } = useSessionAuth()
  const { apiConfig, session } = useSessionFeatureReadiness()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const personalWorkspaceId =
    session?.workspaces.find((workspace) => workspace.kind === 'personal')
      ?.id ??
    (session?.workspace.kind === 'personal' ? session.workspaceId : undefined)
  const isActivePersonalWorkspace =
    Boolean(personalWorkspaceId) &&
    session?.workspace.kind === 'personal' &&
    session.workspaceId === personalWorkspaceId
  const personalApi = useMemo(() => {
    if (!apiConfig || !personalWorkspaceId) {
      return null
    }

    return createPlannerApiClient({
      ...apiConfig,
      workspaceId: personalWorkspaceId,
    })
  }, [apiConfig, personalWorkspaceId])
  const personalTaskQueryKey = useMemo<NativeWidgetTaskQueryKey>(
    () => [
      'planner',
      'native-widget',
      'personal-tasks',
      personalWorkspaceId ?? 'pending',
      sessionVersion,
    ],
    [personalWorkspaceId, sessionVersion],
  )
  const personalSphereQueryKey = useMemo<NativeWidgetSphereQueryKey>(
    () => [
      'planner',
      'native-widget',
      'personal-spheres',
      personalWorkspaceId ?? 'pending',
      sessionVersion,
    ],
    [personalWorkspaceId, sessionVersion],
  )
  const shouldLoadPersonalWorkspace =
    isAndroidPlannerWidgetRuntime() &&
    Boolean(personalApi && personalWorkspaceId) &&
    !isActivePersonalWorkspace
  const personalTasksQuery = useQuery({
    enabled: shouldLoadPersonalWorkspace,
    queryFn: () =>
      loadPersonalWidgetTaskRecords(personalApi, personalWorkspaceId),
    queryKey: personalTaskQueryKey,
    retry: 1,
    staleTime: 30_000,
  })
  const personalSpheresQuery = useQuery({
    enabled: shouldLoadPersonalWorkspace,
    queryFn: () =>
      loadPersonalWidgetSphereRecords(personalApi, personalWorkspaceId),
    queryKey: personalSphereQueryKey,
    retry: 1,
    staleTime: 30_000,
  })
  const personalTaskRecords =
    personalTasksQuery.data ?? EMPTY_PERSONAL_TASK_RECORDS
  const widgetTasks = useMemo(
    () =>
      isActivePersonalWorkspace
        ? activePlanner.tasks
        : sortTasks(personalTaskRecords.map((task) => toPlannerTask(task))),
    [activePlanner.tasks, isActivePersonalWorkspace, personalTaskRecords],
  )
  const widgetSpheres = isActivePersonalWorkspace
    ? activePlanner.spheres
    : (personalSpheresQuery.data ?? EMPTY_PERSONAL_SPHERES)
  const isWidgetLoading = isActivePersonalWorkspace
    ? activePlanner.isLoading
    : !personalWorkspaceId ||
      personalTasksQuery.data === undefined ||
      personalSpheresQuery.data === undefined
  const isWidgetSyncing = isActivePersonalWorkspace
    ? activePlanner.isSyncing
    : personalTasksQuery.isFetching || personalSpheresQuery.isFetching
  const plannerRef = useRef<NativeWidgetPlannerRef>({
    actorUserId: session?.actorUserId,
    isActivePersonalWorkspace,
    isLoading: isWidgetLoading,
    personalApi,
    personalTaskQueryKey,
    personalWorkspaceId,
    setActiveTaskStatus: activePlanner.setTaskStatus,
    spheres: widgetSpheres,
    taskRecords: isActivePersonalWorkspace ? [] : personalTaskRecords,
    tasks: widgetTasks,
  })
  const deferredCompletedTaskIdsRef = useRef<Set<string>>(new Set())
  const completionSyncPromiseRef =
    useRef<Promise<NativeCompletionSyncResult> | null>(null)
  const previousSessionVersionRef = useRef(sessionVersion)
  const wasSyncingRef = useRef(false)

  useEffect(() => {
    plannerRef.current = {
      actorUserId: session?.actorUserId,
      isActivePersonalWorkspace,
      isLoading: isWidgetLoading,
      personalApi,
      personalTaskQueryKey,
      personalWorkspaceId,
      setActiveTaskStatus: activePlanner.setTaskStatus,
      spheres: widgetSpheres,
      taskRecords: isActivePersonalWorkspace ? [] : personalTaskRecords,
      tasks: widgetTasks,
    }
  }, [
    activePlanner.setTaskStatus,
    isActivePersonalWorkspace,
    isWidgetLoading,
    personalApi,
    personalTaskQueryKey,
    personalTaskRecords,
    personalWorkspaceId,
    session?.actorUserId,
    widgetSpheres,
    widgetTasks,
  ])

  const syncSnapshot = useCallback(() => {
    const planner = plannerRef.current

    if (planner.isLoading || !isAndroidPlannerWidgetRuntime()) {
      return
    }

    const snapshot = buildNativePlannerWidgetSnapshot(
      planner.tasks,
      planner.spheres,
    )

    void persistNativePlannerWidgetSnapshot(snapshot).catch((error) => {
      console.warn('Failed to update Android planner widget.', error)
    })
  }, [])

  const completeWidgetTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      const planner = plannerRef.current
      const task = planner.tasks.find((candidate) => candidate.id === taskId)

      if (!task || !isActiveTaskStatus(task.status)) {
        recordClientEvent('widget_completion_replayed', {
          activePersonalWorkspace: planner.isActivePersonalWorkspace,
          reason: task ? 'already_completed' : 'missing_local_task',
        })

        return true
      }

      if (planner.isActivePersonalWorkspace) {
        return planner.setActiveTaskStatus(taskId, 'done')
      }

      const taskRecord = planner.taskRecords.find(
        (candidate) => candidate.id === taskId,
      )

      if (!taskRecord || !planner.actorUserId || !planner.personalWorkspaceId) {
        return false
      }

      return completePersonalWidgetTask({
        actorUserId: planner.actorUserId,
        api: planner.personalApi,
        queryClient,
        taskQueryKey: planner.personalTaskQueryKey,
        taskRecord,
        workspaceId: planner.personalWorkspaceId,
      })
    },
    [queryClient],
  )

  const consumePendingCompletedTasks =
    useCallback(async (): Promise<NativeCompletionSyncResult> => {
      if (completionSyncPromiseRef.current) {
        return completionSyncPromiseRef.current
      }

      const planner = plannerRef.current

      if (planner.isLoading || !isAndroidPlannerWidgetRuntime()) {
        return {
          didCompleteTask: false,
          hasPendingCompletions: false,
        }
      }

      completionSyncPromiseRef.current = (async () => {
        const taskIds = [
          ...new Set(await readPendingNativePlannerWidgetCompletedTasks()),
        ]
        const acknowledgedTaskIds: string[] = []
        let didCompleteTask = false

        for (const taskId of taskIds) {
          if (deferredCompletedTaskIdsRef.current.has(taskId)) {
            continue
          }

          const didUpdateTask = await completeWidgetTask(taskId)

          if (didUpdateTask) {
            didCompleteTask = true
            acknowledgedTaskIds.push(taskId)
            deferredCompletedTaskIdsRef.current.delete(taskId)
          } else {
            deferredCompletedTaskIdsRef.current.add(taskId)
          }
        }

        if (acknowledgedTaskIds.length > 0) {
          await ackPendingNativePlannerWidgetCompletedTasks(acknowledgedTaskIds)
          recordClientEvent('widget_completion_acknowledged', {
            count: acknowledgedTaskIds.length,
            pendingCount: taskIds.length,
          })
        }

        return {
          didCompleteTask,
          hasPendingCompletions: acknowledgedTaskIds.length < taskIds.length,
        }
      })().finally(() => {
        completionSyncPromiseRef.current = null
      })

      return completionSyncPromiseRef.current
    }, [completeWidgetTask])

  const syncFromNativeWidget = useCallback(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    void consumePendingCompletedTasks()
      .then(({ didCompleteTask, hasPendingCompletions }) => {
        if (!didCompleteTask && !hasPendingCompletions) {
          syncSnapshot()
        }
      })
      .catch((error) => {
        console.warn('Failed to sync Android planner widget.', error)
      })
  }, [consumePendingCompletedTasks, syncSnapshot])

  const consumePendingRoute = useCallback(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    void consumePendingNativePlannerWidgetRoute()
      .then((path) => {
        if (path) {
          void navigate(path)
        }
      })
      .catch((error) => {
        console.warn('Failed to open planner widget route.', error)
      })
  }, [navigate])

  useEffect(() => {
    syncFromNativeWidget()
  }, [isWidgetLoading, syncFromNativeWidget, widgetSpheres, widgetTasks])

  useEffect(() => {
    consumePendingRoute()
  }, [consumePendingRoute])

  useEffect(() => {
    if (previousSessionVersionRef.current === sessionVersion) {
      return
    }

    previousSessionVersionRef.current = sessionVersion
    deferredCompletedTaskIdsRef.current.clear()
    syncFromNativeWidget()
  }, [sessionVersion, syncFromNativeWidget])

  useEffect(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    if (wasSyncingRef.current && !isWidgetSyncing) {
      syncFromNativeWidget()
    }

    wasSyncingRef.current = isWidgetSyncing
  }, [isWidgetSyncing, syncFromNativeWidget])

  useEffect(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    let timeoutId: number | undefined

    function scheduleNextDaySync() {
      const now = new Date()
      const nextDay = new Date(now)

      nextDay.setDate(now.getDate() + 1)
      nextDay.setHours(0, 0, 5, 0)

      timeoutId = window.setTimeout(
        () => {
          syncFromNativeWidget()
          scheduleNextDaySync()
        },
        Math.max(1_000, nextDay.getTime() - now.getTime()),
      )
    }

    scheduleNextDaySync()

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [syncFromNativeWidget])

  useEffect(() => {
    if (!isAndroidPlannerWidgetRuntime()) {
      return
    }

    let isDisposed = false
    const listenerHandlePromise = addNativePlannerWidgetResumeListener(() => {
      if (isDisposed) {
        return
      }

      consumePendingRoute()
      syncFromNativeWidget()
    })

    return () => {
      isDisposed = true
      void listenerHandlePromise
        .then((handle) => {
          void handle.remove()
        })
        .catch((error) => {
          console.warn('Failed to remove planner widget listener.', error)
        })
    }
  }, [consumePendingRoute, syncFromNativeWidget])

  return null
}

async function loadPersonalWidgetTaskRecords(
  api: PlannerApiClient | null,
  workspaceId: string | undefined,
): Promise<TaskRecord[]> {
  if (!api || !workspaceId) {
    return []
  }

  try {
    const records = await api.listTasks()
    await replaceCachedTaskRecords(workspaceId, records)

    return records
  } catch (error) {
    const cachedRecords = await loadCachedTaskRecords(workspaceId)

    if (cachedRecords.length > 0) {
      return cachedRecords
    }

    throw error
  }
}

async function loadPersonalWidgetSphereRecords(
  api: PlannerApiClient | null,
  workspaceId: string | undefined,
): Promise<Sphere[]> {
  if (!api || !workspaceId) {
    return []
  }

  try {
    const records = await api.listLifeSpheres()
    await replaceCachedLifeSphereRecords(workspaceId, records)

    return records
  } catch (error) {
    const cachedRecords = await loadCachedLifeSphereRecords(workspaceId)

    if (cachedRecords.length > 0) {
      return cachedRecords
    }

    throw error
  }
}

async function completePersonalWidgetTask({
  actorUserId,
  api,
  queryClient,
  taskQueryKey,
  taskRecord,
  workspaceId,
}: {
  actorUserId: string
  api: PlannerApiClient | null
  queryClient: ReturnType<typeof useQueryClient>
  taskQueryKey: NativeWidgetTaskQueryKey
  taskRecord: TaskRecord
  workspaceId: string
}): Promise<boolean> {
  const previousTaskRecords =
    queryClient.getQueryData<TaskRecord[]>(taskQueryKey)
  const now = new Date().toISOString()
  const optimisticTask = {
    ...taskRecord,
    completedAt: now,
    status: 'done' as const,
    updatedAt: now,
    version: taskRecord.version + 1,
  }

  queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
    replaceTaskRecord(current, optimisticTask),
  )
  await upsertCachedTaskRecord(workspaceId, optimisticTask)

  try {
    if (!api) {
      throw new PlannerApiUnavailableError()
    }

    const nextTask = await api.setTaskStatus(taskRecord.id, {
      expectedVersion: taskRecord.version,
      status: 'done',
    })

    queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
      replaceTaskRecord(current, nextTask),
    )
    await upsertCachedTaskRecord(workspaceId, nextTask)

    return true
  } catch (error) {
    if (shouldKeepOptimisticMutation(error)) {
      await enqueuePlannerOfflineMutation({
        actorUserId,
        expectedVersion: taskRecord.version,
        statusValue: 'done',
        taskId: taskRecord.id,
        type: 'task.status.update',
        workspaceId,
      })
      recordClientEvent(
        'widget_completion_queued',
        {
          reason: 'offline_or_auth_deferred',
        },
        { level: 'warn' },
      )

      return true
    }

    if (previousTaskRecords) {
      queryClient.setQueryData(taskQueryKey, previousTaskRecords)
      await replaceCachedTaskRecords(workspaceId, previousTaskRecords)
    }

    return false
  }
}
