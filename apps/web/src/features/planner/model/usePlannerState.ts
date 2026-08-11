import {
  generateUuidV7,
  type TaskNextStageInput,
  type TaskNextStageResponse,
  type TaskNextStageUndoInput,
  type TaskRecord,
  type TaskStageType,
} from '@planner/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  LifeSphereUpdateInput,
  NewLifeSphereInput,
  Sphere,
} from '@/entities/sphere'
import type {
  NewTaskInput,
  TaskScheduleInput,
  TaskStatus,
  TaskUpdateInput,
} from '@/entities/task'
import { isActiveTaskStatus, sortTasks } from '@/entities/task'
import type {
  NewTaskTemplateInput,
  TaskTemplate,
} from '@/entities/task-template'
import {
  isUnauthorizedSessionApiError,
  usePlannerTimeZone,
  useSessionAuth,
  useSessionFeatureReadiness,
} from '@/features/session'

import {
  enqueuePlannerOfflineMutation,
  getPlannerDataLastSuccessfulSyncAt,
  isPlannerOfflineStorageAvailable,
  type PlannerDataSyncScope,
  type PlannerOfflineMutationInput,
} from '../lib/offline-planner-store'
import {
  createPlannerApiClient,
  isUnauthorizedPlannerApiError,
} from '../lib/planner-api'
import { useTaskCompletionConfetti } from '../lib/task-completion-confetti'
import type { PlannerState } from './planner.types'
import {
  getErrorDebugDetails,
  getErrorMessage,
  getPlannerQueryErrorMessage,
  isRetryablePlannerConnectionError,
  shouldKeepOptimisticMutation,
} from './planner-error-policy'
import {
  getPlannerVersionConflict,
  getQueuedPlannerMutationMessage,
} from './planner-mutation-policy'
import { usePlannerMutations } from './planner-mutations'
import { usePlannerOfflineSync } from './planner-offline'
import { usePlannerQueries } from './planner-queries'
import {
  createOptimisticTaskNextStageResult,
  createOptimisticTaskRecord,
  createOptimisticTaskScheduleRecord,
  createOptimisticTaskStatusRecord,
  createOptimisticUpdatedTaskRecord,
  getTaskRecord,
  removeTaskRecord,
  replaceTaskRecord,
  sortSpheres,
  sortTaskTemplates,
  toggleTaskId,
  toPlannerTask,
  toPlannerTaskTemplate,
} from './planner-records'

type PlannerSyncFreshnessByScope = Record<PlannerDataSyncScope, string | null>
type PlannerTaskOfflineMutationInput = Extract<
  PlannerOfflineMutationInput,
  { taskId: string }
>
type PlannerTaskOptimisticProjection =
  | {
      optimisticTask: TaskRecord
      optimisticTasks?: never
      removeTaskId?: never
    }
  | {
      optimisticTask?: never
      optimisticTasks: readonly TaskRecord[]
      removeTaskId?: never
    }
  | {
      optimisticTask?: never
      optimisticTasks?: never
      removeTaskId: string
    }

interface PlannerSyncFreshness {
  byScope: PlannerSyncFreshnessByScope
  workspaceId: string
}

const EMPTY_PLANNER_SYNC_FRESHNESS: PlannerSyncFreshnessByScope = {
  'life-spheres': null,
  'task-templates': null,
  tasks: null,
}

export function usePlannerState(): PlannerState {
  const plannerTimeZone = usePlannerTimeZone()
  const { accessToken, isAuthEnabled, recoverSession, sessionVersion } =
    useSessionAuth()
  const { apiConfig, getReadiness, session, sessionQuery } =
    useSessionFeatureReadiness()
  const actorUserId = session?.actorUserId
  const fireTaskCompletionConfetti = useTaskCompletionConfetti()
  const isTaskCompletionConfettiEnabled =
    session?.workspaceSettings.taskCompletionConfettiEnabled ?? true
  const workspaceId = session?.workspaceId
  const queryClient = useQueryClient()
  const [syncFreshness, setSyncFreshness] =
    useState<PlannerSyncFreshness | null>(null)
  const currentWorkspaceIdRef = useRef(workspaceId)
  currentWorkspaceIdRef.current = workspaceId
  const [mutationErrorMessage, setMutationErrorMessage] = useState<
    string | null
  >(null)
  const [taskActionSnackbar, setTaskActionSnackbar] =
    useState<PlannerState['taskActionSnackbar']>(null)
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(
    () => new Set(),
  )
  const pendingTaskIdsRef = useRef<Set<string>>(new Set())
  const plannerApi = useMemo(
    () => (apiConfig ? createPlannerApiClient(apiConfig) : null),
    [apiConfig],
  )
  const recordServerReadSuccess = useCallback(
    (scope: PlannerDataSyncScope, lastSuccessfulSyncAt: string) => {
      if (!workspaceId) {
        return
      }

      if (currentWorkspaceIdRef.current !== workspaceId) {
        return
      }

      setSyncFreshness((current) =>
        mergePlannerSyncFreshness(current, workspaceId, {
          ...EMPTY_PLANNER_SYNC_FRESHNESS,
          [scope]: lastSuccessfulSyncAt,
        }),
      )
    },
    [workspaceId],
  )
  const {
    invalidatePlannerQueries,
    sphereQueryKey,
    spheresQuery,
    taskQueryKey,
    taskTemplateQueryKey,
    taskTemplatesQuery,
    tasksQuery,
  } = usePlannerQueries({
    authSessionVersion: sessionVersion,
    onServerReadSuccess: recordServerReadSuccess,
    plannerApi,
    queryClient,
    workspaceId,
  })
  const hasTaskRecords = tasksQuery.data !== undefined
  const hasLifeSphereRecords = spheresQuery.data !== undefined
  const hasTaskTemplateRecords = taskTemplatesQuery.data !== undefined
  const readiness = getReadiness({
    hasCachedData:
      hasTaskRecords || hasLifeSphereRecords || hasTaskTemplateRecords,
  })
  const currentSyncFreshness =
    syncFreshness && syncFreshness.workspaceId === workspaceId
      ? syncFreshness.byScope
      : null
  const taskLastSuccessfulSyncAt = currentSyncFreshness?.tasks ?? null
  const lifeSphereLastSuccessfulSyncAt =
    currentSyncFreshness?.['life-spheres'] ?? null
  const taskTemplateLastSuccessfulSyncAt =
    currentSyncFreshness?.['task-templates'] ?? null
  const lastSuccessfulSyncAt = getOldestCompleteTimestamp([
    taskLastSuccessfulSyncAt,
    lifeSphereLastSuccessfulSyncAt,
    taskTemplateLastSuccessfulSyncAt,
  ])

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    let isActive = true

    void Promise.all([
      getPlannerDataLastSuccessfulSyncAt(workspaceId, 'tasks'),
      getPlannerDataLastSuccessfulSyncAt(workspaceId, 'life-spheres'),
      getPlannerDataLastSuccessfulSyncAt(workspaceId, 'task-templates'),
    ])
      .then(([tasks, lifeSpheres, taskTemplates]) => {
        if (isActive) {
          setSyncFreshness((current) =>
            mergePlannerSyncFreshness(current, workspaceId, {
              'life-spheres': lifeSpheres,
              'task-templates': taskTemplates,
              tasks,
            }),
          )
        }
      })
      .catch((error) => {
        console.warn('Failed to read planner sync freshness.', error)
      })

    return () => {
      isActive = false
    }
  }, [workspaceId])
  const {
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
    requestQueuedMutationDrain,
  } = usePlannerOfflineSync({
    actorUserId,
    invalidatePlannerQueries,
    plannerApi,
    sphereQueryKey,
    queryClient,
    recoverSession,
    readiness,
    setMutationErrorMessage,
    spheres: spheresQuery.data,
    taskQueryKey,
    taskTemplateQueryKey,
    taskTemplates: taskTemplatesQuery.data,
    tasks: tasksQuery.data,
    workspaceId,
  })
  const {
    closeTaskChainMutation,
    createLifeSphereMutation,
    createNextTaskStageMutation,
    copyTaskToPersonalMutation,
    createTaskMutation,
    createTaskTemplateMutation,
    detachTaskChainMutation,
    moveTaskToPersonalMutation,
    removeLifeSphereMutation,
    removeTaskMutation,
    removeTaskTemplateMutation,
    setTaskScheduleMutation,
    setTaskStatusMutation,
    undoNextTaskStageMutation,
    updateLifeSphereMutation,
    updateTaskMutation,
  } = usePlannerMutations({
    plannerApi,
    sphereQueryKey,
    queryClient,
    session,
    setMutationErrorMessage,
    taskQueryKey,
    taskTemplateQueryKey,
  })
  const authError =
    sessionQuery.error ??
    spheresQuery.error ??
    taskTemplatesQuery.error ??
    tasksQuery.error ??
    createLifeSphereMutation.error ??
    createNextTaskStageMutation.error ??
    closeTaskChainMutation.error ??
    copyTaskToPersonalMutation.error ??
    createTaskTemplateMutation.error ??
    moveTaskToPersonalMutation.error ??
    updateLifeSphereMutation.error ??
    removeLifeSphereMutation.error ??
    detachTaskChainMutation.error ??
    createTaskMutation.error ??
    updateTaskMutation.error ??
    removeTaskTemplateMutation.error ??
    setTaskStatusMutation.error ??
    undoNextTaskStageMutation.error ??
    setTaskScheduleMutation.error ??
    removeTaskMutation.error
  const hasUnauthorizedAuthError =
    isUnauthorizedSessionApiError(authError) ||
    isUnauthorizedPlannerApiError(authError)
  const readErrors = [
    sessionQuery.error,
    spheresQuery.error,
    taskTemplatesQuery.error,
    tasksQuery.error,
  ]
  const hasReadError = readErrors.some(Boolean)
  const isOffline = readErrors.some(isRetryablePlannerConnectionError)
  const taskReadErrors = [sessionQuery.error, tasksQuery.error]
  const lifeSphereReadErrors = [sessionQuery.error, spheresQuery.error]
  const taskTemplateReadErrors = [sessionQuery.error, taskTemplatesQuery.error]
  const hasTaskReadError = taskReadErrors.some(Boolean)
  const hasLifeSphereReadError = lifeSphereReadErrors.some(Boolean)
  const hasTaskTemplateReadError = taskTemplateReadErrors.some(Boolean)
  const isTaskOffline = taskReadErrors.some(isRetryablePlannerConnectionError)
  const isLifeSphereOffline = lifeSphereReadErrors.some(
    isRetryablePlannerConnectionError,
  )
  const isTaskTemplateOffline = taskTemplateReadErrors.some(
    isRetryablePlannerConnectionError,
  )

  useEffect(() => {
    if (
      !isAuthEnabled ||
      !accessToken ||
      !authError ||
      !hasUnauthorizedAuthError
    ) {
      return
    }

    void recoverSession().then((result) => {
      if (result === 'recovered') {
        void invalidatePlannerQueries()
      }
    })
  }, [
    accessToken,
    authError,
    hasUnauthorizedAuthError,
    invalidatePlannerQueries,
    isAuthEnabled,
    recoverSession,
  ])

  const spheres = useMemo<Sphere[]>(
    () => sortSpheres(spheresQuery.data ?? []),
    [spheresQuery.data],
  )
  const taskTemplates = useMemo<TaskTemplate[]>(
    () =>
      sortTaskTemplates(taskTemplatesQuery.data ?? []).map((template) =>
        toPlannerTaskTemplate(template),
      ),
    [taskTemplatesQuery.data],
  )
  const tasks = useMemo(
    () =>
      sortTasks(
        (tasksQuery.data ?? []).map((task) =>
          toPlannerTask(task, plannerTimeZone),
        ),
      ),
    [plannerTimeZone, tasksQuery.data],
  )

  function setTaskPending(taskId: string, isPending: boolean): void {
    pendingTaskIdsRef.current = toggleTaskId(
      pendingTaskIdsRef.current,
      taskId,
      isPending,
    )
    setPendingTaskIds(new Set(pendingTaskIdsRef.current))
  }

  function isTaskPending(taskId: string): boolean {
    return pendingTaskIds.has(taskId)
  }

  function clearTaskActionSnackbar(): void {
    setTaskActionSnackbar(null)
  }

  function getCachedTaskRecord(taskId: string): TaskRecord | undefined {
    return getTaskRecord(
      queryClient.getQueryData<TaskRecord[]>(taskQueryKey) ?? [],
      taskId,
    )
  }

  async function runMutation(
    action: () => Promise<unknown>,
    queueOfflineMutation?: () => Promise<void>,
    persistOfflineSnapshot: () => Promise<void> = persistCurrentTaskRecords,
  ): Promise<boolean> {
    try {
      await action()

      return true
    } catch (error) {
      if (queueOfflineMutation && shouldKeepOptimisticMutation(error)) {
        await queueOfflineMutation()
        await persistOfflineSnapshot()
        await refreshQueuedMutationCount()
        setMutationErrorMessage(getQueuedPlannerMutationMessage(error))

        return true
      }

      const versionConflict = getPlannerVersionConflict(error)

      if (versionConflict) {
        await queryClient.invalidateQueries({
          queryKey:
            versionConflict.target === 'task' ? taskQueryKey : sphereQueryKey,
        })
        setMutationErrorMessage(versionConflict.message)
        return false
      }

      setMutationErrorMessage(getErrorMessage(error))

      return false
    }
  }

  async function enqueueOptimisticTaskMutation(
    mutation: PlannerTaskOfflineMutationInput,
    projection: PlannerTaskOptimisticProjection,
  ): Promise<boolean | null> {
    if (!isPlannerOfflineStorageAvailable()) {
      return null
    }

    try {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: taskQueryKey })

      const queuedMutation = await enqueuePlannerOfflineMutation(mutation, {
        optimisticTask: projection.optimisticTask,
        optimisticTasks: projection.optimisticTasks,
        removeCachedTaskId: projection.removeTaskId,
      })

      if (!queuedMutation) {
        return null
      }

      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) => {
        if (projection.optimisticTask) {
          return replaceTaskRecord(current, projection.optimisticTask)
        }

        if (projection.optimisticTasks) {
          return projection.optimisticTasks.reduce(
            (tasks, task) => replaceTaskRecord(tasks, task),
            current,
          )
        }

        return removeTaskRecord(current, projection.removeTaskId)
      })
      void refreshQueuedMutationCount()

      if (isBrowserOfflineNow()) {
        setMutationErrorMessage(
          getQueuedPlannerMutationMessage(
            new TypeError('Browser is currently offline.'),
          ),
        )
      } else {
        requestQueuedMutationDrain()
      }

      return true
    } catch (error) {
      if (!isBrowserOfflineNow()) {
        return null
      }

      setMutationErrorMessage(getErrorMessage(error))

      return false
    }
  }

  async function addSphere(input: NewLifeSphereInput): Promise<boolean> {
    const sphereId = input.id ?? generateUuidV7()
    const inputWithId = {
      ...input,
      id: sphereId,
    }

    return runMutation(
      () => createLifeSphereMutation.mutateAsync(inputWithId),
      async () => {
        if (!actorUserId || !workspaceId) {
          throw new Error('Planner session is not ready.')
        }

        await enqueuePlannerOfflineMutation({
          actorUserId,
          input: inputWithId,
          sphereId,
          type: 'lifeSphere.create',
          workspaceId,
        })
      },
      persistCurrentLifeSphereRecords,
    )
  }

  async function updateSphere(
    sphereId: string,
    input: LifeSphereUpdateInput,
  ): Promise<boolean> {
    return runMutation(
      () =>
        updateLifeSphereMutation.mutateAsync({
          input,
          sphereId,
        }),
      async () => {
        if (!actorUserId || !workspaceId) {
          throw new Error('Planner session is not ready.')
        }

        await enqueuePlannerOfflineMutation({
          actorUserId,
          input,
          sphereId,
          type: 'lifeSphere.update',
          workspaceId,
        })
      },
      persistCurrentLifeSphereRecords,
    )
  }

  async function removeSphere(sphereId: string): Promise<boolean> {
    return runMutation(() => removeLifeSphereMutation.mutateAsync(sphereId))
  }

  async function addTask(input: NewTaskInput): Promise<boolean> {
    const taskId = input.id ?? generateUuidV7()
    const inputWithId = {
      ...input,
      id: taskId,
    }

    if (actorUserId && workspaceId) {
      const queuedResult = await enqueueOptimisticTaskMutation(
        {
          actorUserId,
          input: inputWithId,
          taskId,
          type: 'task.create',
          workspaceId,
        },
        {
          optimisticTask: createOptimisticTaskRecord(inputWithId, {
            authorDisplayName: session?.actor.displayName ?? null,
            authorUserId: actorUserId,
            workspaceId,
          }),
        },
      )

      if (queuedResult !== null) {
        return queuedResult
      }
    }

    if (isBrowserOfflineNow()) {
      setMutationErrorMessage(
        'Не удалось сохранить задачу на устройстве. Проверьте доступное место и повторите.',
      )

      return false
    }

    return runMutation(
      () => createTaskMutation.mutateAsync(inputWithId),
      async () => {
        if (!actorUserId || !workspaceId) {
          throw new Error('Planner session is not ready.')
        }

        await enqueuePlannerOfflineMutation({
          actorUserId,
          input: inputWithId,
          taskId,
          type: 'task.create',
          workspaceId,
        })
      },
    )
  }

  async function updateTask(
    taskId: string,
    input: TaskUpdateInput,
  ): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    return runTaskMutation(taskId, async () => {
      if (actorUserId && workspaceId) {
        const queuedResult = await enqueueOptimisticTaskMutation(
          {
            actorUserId,
            expectedVersion: task.version,
            input,
            taskId,
            type: 'task.update',
            workspaceId,
          },
          { optimisticTask: createOptimisticUpdatedTaskRecord(task, input) },
        )

        if (queuedResult !== null) {
          return queuedResult
        }
      }

      if (isBrowserOfflineNow()) {
        setMutationErrorMessage(
          'Не удалось сохранить изменения на устройстве. Проверьте доступное место и повторите.',
        )

        return false
      }

      return runMutation(
        () =>
          updateTaskMutation.mutateAsync({
            expectedVersion: task.version,
            input,
            taskId,
          }),
        async () => {
          if (!actorUserId || !workspaceId) {
            throw new Error('Planner session is not ready.')
          }

          await enqueuePlannerOfflineMutation({
            actorUserId,
            expectedVersion: task.version,
            input,
            taskId,
            type: 'task.update',
            workspaceId,
          })
        },
      )
    })
  }

  async function copyTaskToPersonal(taskId: string): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    return runTaskMutation(taskId, () =>
      runMutation(() =>
        copyTaskToPersonalMutation.mutateAsync({
          expectedVersion: task.version,
          taskId,
        }),
      ),
    )
  }

  async function moveTaskToPersonal(taskId: string): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    return runTaskMutation(taskId, () =>
      runMutation(() =>
        moveTaskToPersonalMutation.mutateAsync({
          expectedVersion: task.version,
          taskId,
        }),
      ),
    )
  }

  async function createNextTaskStage(
    taskId: string,
    input: {
      completeCurrent?: boolean
      note?: string | undefined
      plannedDate?: string | null | undefined
      stageType?: TaskStageType | undefined
      title?: string | undefined
    } = {},
  ): Promise<TaskNextStageResponse | null> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return null
    }

    if (pendingTaskIdsRef.current.has(taskId)) {
      setMutationErrorMessage(
        'Дождитесь завершения текущего изменения задачи и повторите действие.',
      )

      return null
    }

    setTaskPending(taskId, true)

    try {
      const nextTaskId = generateUuidV7()
      const chainId = task.chainId ?? generateUuidV7()
      const nextStageInput = {
        chainId,
        completeCurrent: input.completeCurrent === true,
        expectedVersion: task.version,
        nextTaskId,
        ...(input.note !== undefined ? { note: input.note } : {}),
        plannedDate: input.plannedDate ?? null,
        ...(input.stageType !== undefined
          ? { stageType: input.stageType }
          : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
      } satisfies TaskNextStageInput
      const optimisticResult = createOptimisticTaskNextStageResult(
        task,
        nextStageInput,
        {
          authorDisplayName: session?.actor.displayName ?? null,
          authorUserId: actorUserId ?? null,
          nextTaskId,
        },
      )

      if (actorUserId && workspaceId) {
        const queuedResult = await enqueueOptimisticTaskMutation(
          {
            actorUserId,
            expectedVersion: task.version,
            input: nextStageInput,
            nextTaskId,
            taskId,
            type: 'task.next-stage',
            workspaceId,
          },
          {
            optimisticTasks: [
              optimisticResult.currentTask,
              optimisticResult.nextTask,
            ],
          },
        )

        if (queuedResult !== null) {
          if (queuedResult) {
            setTaskActionSnackbar({
              id: generateUuidV7(),
              message:
                input.completeCurrent === true
                  ? 'Выполнено, следующий этап создан'
                  : 'Следующий этап создан',
            })

            if (
              input.completeCurrent === true &&
              isTaskCompletionConfettiEnabled
            ) {
              fireTaskCompletionConfetti()
            }
          }

          return queuedResult ? optimisticResult : null
        }
      }

      if (isBrowserOfflineNow()) {
        setMutationErrorMessage(
          'Не удалось сохранить этап на устройстве. Проверьте доступное место и повторите.',
        )

        return null
      }

      let result: TaskNextStageResponse | null = null
      const didUpdate = await runMutation(async () => {
        const nextResult = await createNextTaskStageMutation.mutateAsync({
          ...nextStageInput,
          taskId,
        })
        result = nextResult
        setTaskActionSnackbar({
          id: generateUuidV7(),
          message:
            input.completeCurrent === true
              ? 'Выполнено, следующий этап создан'
              : 'Следующий этап создан',
          undo: {
            input: nextResult.undo,
            taskId,
          },
        })
      })

      if (
        didUpdate &&
        input.completeCurrent === true &&
        isTaskCompletionConfettiEnabled
      ) {
        fireTaskCompletionConfetti()
      }

      return didUpdate ? result : null
    } finally {
      setTaskPending(taskId, false)
    }
  }

  async function undoNextTaskStage(
    taskId: string,
    input: TaskNextStageUndoInput,
  ): Promise<boolean> {
    if (pendingTaskIdsRef.current.has(taskId)) {
      setMutationErrorMessage(
        'Дождитесь завершения текущего изменения задачи и повторите действие.',
      )

      return false
    }

    setTaskPending(taskId, true)

    try {
      const didUndo = await runMutation(() =>
        undoNextTaskStageMutation.mutateAsync({
          input,
          taskId,
        }),
      )

      if (didUndo) {
        setTaskActionSnackbar({
          id: generateUuidV7(),
          message: 'Действие отменено',
        })
      }

      return didUndo
    } finally {
      setTaskPending(taskId, false)
    }
  }

  async function detachTaskFromChain(taskId: string): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    return runTaskMutation(taskId, () =>
      runMutation(() =>
        detachTaskChainMutation.mutateAsync({
          expectedVersion: task.version,
          taskId,
        }),
      ),
    )
  }

  async function closeTaskChain(taskId: string): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    const didClose = await runTaskMutation(taskId, () =>
      runMutation(() =>
        closeTaskChainMutation.mutateAsync({
          expectedVersion: task.version,
          taskId,
        }),
      ),
    )

    if (didClose) {
      setTaskActionSnackbar({
        id: generateUuidV7(),
        message: 'Цепочка завершена',
      })
    }

    return didClose
  }

  async function addTaskTemplate(
    input: NewTaskTemplateInput,
  ): Promise<boolean> {
    const templateId = input.id ?? generateUuidV7()
    const inputWithId = {
      ...input,
      id: templateId,
    }

    return runMutation(
      () => createTaskTemplateMutation.mutateAsync(inputWithId),
      undefined,
      persistCurrentTaskTemplateRecords,
    )
  }

  async function runTaskMutation(
    taskId: string,
    action: () => Promise<boolean>,
  ): Promise<boolean> {
    if (pendingTaskIdsRef.current.has(taskId)) {
      setMutationErrorMessage(
        'Дождитесь завершения текущего изменения задачи и повторите действие.',
      )

      return false
    }

    setTaskPending(taskId, true)

    try {
      return await action()
    } finally {
      setTaskPending(taskId, false)
    }
  }

  async function setTaskStatus(
    taskId: string,
    status: TaskStatus,
  ): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    return runTaskMutation(taskId, async () => {
      const didCompleteTask =
        isActiveTaskStatus(task.status) && status === 'done'
      const queuedResult =
        actorUserId && workspaceId
          ? await enqueueOptimisticTaskMutation(
              {
                actorUserId,
                expectedVersion: task.version,
                statusValue: status,
                taskId,
                type: 'task.status.update',
                workspaceId,
              },
              {
                optimisticTask: createOptimisticTaskStatusRecord(task, status),
              },
            )
          : null
      let didUpdate: boolean

      if (queuedResult !== null) {
        didUpdate = queuedResult
      } else if (isBrowserOfflineNow()) {
        setMutationErrorMessage(
          'Не удалось сохранить выполнение на устройстве. Проверьте доступное место и повторите.',
        )
        didUpdate = false
      } else {
        didUpdate = await runMutation(
          () =>
            setTaskStatusMutation.mutateAsync({
              expectedVersion: task.version,
              status,
              taskId,
            }),
          async () => {
            if (!actorUserId || !workspaceId) {
              throw new Error('Planner session is not ready.')
            }

            await enqueuePlannerOfflineMutation({
              actorUserId,
              expectedVersion: task.version,
              statusValue: status,
              taskId,
              type: 'task.status.update',
              workspaceId,
            })
          },
        )
      }

      if (didUpdate && didCompleteTask && isTaskCompletionConfettiEnabled) {
        fireTaskCompletionConfetti()
      }

      if (didUpdate && didCompleteTask && task.chainId) {
        setTaskActionSnackbar({
          chainCompletionTaskId: taskId,
          id: generateUuidV7(),
          message: 'Этап выполнен',
        })
      }

      return didUpdate
    })
  }

  async function setTaskPlannedDate(
    taskId: string,
    plannedDate: string | null,
  ): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    const displayedTask = toPlannerTask(task, plannerTimeZone)
    const schedule = {
      plannedDate,
      plannedEndTime: plannedDate
        ? (displayedTask.plannedEndTime ?? null)
        : null,
      plannedStartTime: plannedDate
        ? (displayedTask.plannedStartTime ?? null)
        : null,
    }

    return runTaskMutation(taskId, async () => {
      if (actorUserId && workspaceId) {
        const queuedResult = await enqueueOptimisticTaskMutation(
          {
            actorUserId,
            expectedVersion: task.version,
            schedule,
            taskId,
            type: 'task.schedule.update',
            workspaceId,
          },
          {
            optimisticTask: createOptimisticTaskScheduleRecord(task, schedule),
          },
        )

        if (queuedResult !== null) {
          return queuedResult
        }
      }

      if (isBrowserOfflineNow()) {
        setMutationErrorMessage(
          'Не удалось сохранить расписание на устройстве. Проверьте доступное место и повторите.',
        )

        return false
      }

      return runMutation(
        () =>
          setTaskScheduleMutation.mutateAsync({
            expectedVersion: task.version,
            schedule,
            taskId,
          }),
        async () => {
          if (!actorUserId || !workspaceId) {
            throw new Error('Planner session is not ready.')
          }

          await enqueuePlannerOfflineMutation({
            actorUserId,
            expectedVersion: task.version,
            schedule,
            taskId,
            type: 'task.schedule.update',
            workspaceId,
          })
        },
      )
    })
  }

  async function setTaskSchedule(
    taskId: string,
    schedule: TaskScheduleInput,
  ): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    return runTaskMutation(taskId, async () => {
      if (actorUserId && workspaceId) {
        const queuedResult = await enqueueOptimisticTaskMutation(
          {
            actorUserId,
            expectedVersion: task.version,
            schedule,
            taskId,
            type: 'task.schedule.update',
            workspaceId,
          },
          {
            optimisticTask: createOptimisticTaskScheduleRecord(task, schedule),
          },
        )

        if (queuedResult !== null) {
          return queuedResult
        }
      }

      if (isBrowserOfflineNow()) {
        setMutationErrorMessage(
          'Не удалось сохранить расписание на устройстве. Проверьте доступное место и повторите.',
        )

        return false
      }

      return runMutation(
        () =>
          setTaskScheduleMutation.mutateAsync({
            expectedVersion: task.version,
            schedule,
            taskId,
          }),
        async () => {
          if (!actorUserId || !workspaceId) {
            throw new Error('Planner session is not ready.')
          }

          await enqueuePlannerOfflineMutation({
            actorUserId,
            expectedVersion: task.version,
            schedule,
            taskId,
            type: 'task.schedule.update',
            workspaceId,
          })
        },
      )
    })
  }

  async function removeTask(taskId: string): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    return runTaskMutation(taskId, async () => {
      if (actorUserId && workspaceId) {
        const queuedResult = await enqueueOptimisticTaskMutation(
          {
            actorUserId,
            expectedVersion: task.version,
            taskId,
            type: 'task.delete',
            workspaceId,
          },
          { removeTaskId: taskId },
        )

        if (queuedResult !== null) {
          return queuedResult
        }
      }

      if (isBrowserOfflineNow()) {
        setMutationErrorMessage(
          'Не удалось сохранить удаление на устройстве. Проверьте доступное место и повторите.',
        )

        return false
      }

      return runMutation(
        () =>
          removeTaskMutation.mutateAsync({
            expectedVersion: task.version,
            taskId,
          }),
        async () => {
          if (!actorUserId || !workspaceId) {
            throw new Error('Planner session is not ready.')
          }

          await enqueuePlannerOfflineMutation({
            actorUserId,
            expectedVersion: task.version,
            taskId,
            type: 'task.delete',
            workspaceId,
          })
        },
      )
    })
  }

  async function removeTaskTemplate(templateId: string): Promise<boolean> {
    return runMutation(
      () => removeTaskTemplateMutation.mutateAsync(templateId),
      undefined,
      persistCurrentTaskTemplateRecords,
    )
  }

  async function refresh(): Promise<void> {
    setMutationErrorMessage(null)

    if (isAuthEnabled && (!accessToken || hasUnauthorizedAuthError)) {
      const recoveryResult = await recoverSession()

      if (recoveryResult === 'signed_out') {
        return
      }
    }

    await invalidatePlannerQueries()
  }

  const debugErrorDetails =
    [
      getErrorDebugDetails('sessionQuery.error', sessionQuery.error),
      getErrorDebugDetails('spheresQuery.error', spheresQuery.error),
      getErrorDebugDetails(
        'taskTemplatesQuery.error',
        taskTemplatesQuery.error,
      ),
      getErrorDebugDetails('tasksQuery.error', tasksQuery.error),
      getErrorDebugDetails(
        'createLifeSphereMutation.error',
        createLifeSphereMutation.error,
      ),
      getErrorDebugDetails(
        'createNextTaskStageMutation.error',
        createNextTaskStageMutation.error,
      ),
      getErrorDebugDetails(
        'copyTaskToPersonalMutation.error',
        copyTaskToPersonalMutation.error,
      ),
      getErrorDebugDetails(
        'createTaskTemplateMutation.error',
        createTaskTemplateMutation.error,
      ),
      getErrorDebugDetails(
        'moveTaskToPersonalMutation.error',
        moveTaskToPersonalMutation.error,
      ),
      getErrorDebugDetails(
        'updateLifeSphereMutation.error',
        updateLifeSphereMutation.error,
      ),
      getErrorDebugDetails(
        'removeLifeSphereMutation.error',
        removeLifeSphereMutation.error,
      ),
      getErrorDebugDetails(
        'detachTaskChainMutation.error',
        detachTaskChainMutation.error,
      ),
      getErrorDebugDetails(
        'createTaskMutation.error',
        createTaskMutation.error,
      ),
      getErrorDebugDetails(
        'updateTaskMutation.error',
        updateTaskMutation.error,
      ),
      getErrorDebugDetails(
        'removeTaskTemplateMutation.error',
        removeTaskTemplateMutation.error,
      ),
      getErrorDebugDetails(
        'setTaskStatusMutation.error',
        setTaskStatusMutation.error,
      ),
      getErrorDebugDetails(
        'undoNextTaskStageMutation.error',
        undoNextTaskStageMutation.error,
      ),
      getErrorDebugDetails(
        'setTaskScheduleMutation.error',
        setTaskScheduleMutation.error,
      ),
      getErrorDebugDetails(
        'removeTaskMutation.error',
        removeTaskMutation.error,
      ),
      mutationErrorMessage
        ? `[mutationErrorMessage]\nmessage=${mutationErrorMessage}`
        : null,
    ]
      .filter((details): details is string => Boolean(details))
      .join('\n\n') || null

  return {
    addSphere,
    addTask,
    addTaskTemplate,
    clearTaskActionSnackbar,
    closeTaskChain,
    conflictedMutationCount,
    createNextTaskStage,
    copyTaskToPersonal,
    detachTaskFromChain,
    debugErrorDetails,
    errorMessage:
      mutationErrorMessage ??
      (sessionQuery.error ? getErrorMessage(sessionQuery.error) : null) ??
      getPlannerQueryErrorMessage(spheresQuery.error, {
        hasCachedRecords: hasLifeSphereRecords,
      }) ??
      (taskTemplatesQuery.error
        ? getPlannerQueryErrorMessage(taskTemplatesQuery.error, {
            hasCachedRecords: hasTaskTemplateRecords,
          })
        : null) ??
      getPlannerQueryErrorMessage(tasksQuery.error, {
        hasCachedRecords: hasTaskRecords,
      }),
    isLoading:
      sessionQuery.isPending ||
      (sessionQuery.isSuccess &&
        spheresQuery.isPending &&
        !hasLifeSphereRecords) ||
      (sessionQuery.isSuccess &&
        taskTemplatesQuery.isPending &&
        !hasTaskTemplateRecords) ||
      (sessionQuery.isSuccess && tasksQuery.isPending && !hasTaskRecords),
    isSyncing:
      sessionQuery.isFetching ||
      spheresQuery.isFetching ||
      taskTemplatesQuery.isFetching ||
      tasksQuery.isFetching ||
      isDrainingOfflineQueue ||
      queuedMutationCount > 0 ||
      createLifeSphereMutation.isPending ||
      closeTaskChainMutation.isPending ||
      createNextTaskStageMutation.isPending ||
      copyTaskToPersonalMutation.isPending ||
      updateLifeSphereMutation.isPending ||
      removeLifeSphereMutation.isPending ||
      detachTaskChainMutation.isPending ||
      createTaskMutation.isPending ||
      updateTaskMutation.isPending ||
      moveTaskToPersonalMutation.isPending ||
      createTaskTemplateMutation.isPending ||
      removeTaskTemplateMutation.isPending ||
      setTaskStatusMutation.isPending ||
      undoNextTaskStageMutation.isPending ||
      setTaskScheduleMutation.isPending ||
      removeTaskMutation.isPending,
    isTaskPending,
    hasLifeSphereRecords,
    hasLifeSphereReadError,
    hasReadError,
    hasTaskRecords,
    hasTaskReadError,
    hasTaskTemplateReadError,
    isLifeSphereOffline,
    isLifeSphereCacheHydrating,
    isOffline,
    isTaskOffline,
    isTaskCacheHydrating,
    isTaskTemplateOffline,
    isTaskTemplateCacheHydrating,
    lifeSphereLastSuccessfulSyncAt,
    lastSuccessfulSyncAt,
    readiness,
    spheres,
    queuedMutationCount,
    refresh,
    moveTaskToPersonal,
    removeSphere,
    removeTask,
    removeTaskTemplate,
    setTaskPlannedDate,
    setTaskSchedule,
    setTaskStatus,
    tasks,
    taskActionSnackbar,
    taskLastSuccessfulSyncAt,
    taskTemplateLastSuccessfulSyncAt,
    taskTemplates,
    undoNextTaskStage,
    updateSphere,
    updateTask,
  }
}

function mergePlannerSyncFreshness(
  current: PlannerSyncFreshness | null,
  workspaceId: string,
  incoming: PlannerSyncFreshnessByScope,
): PlannerSyncFreshness {
  const currentByScope =
    current?.workspaceId === workspaceId
      ? current.byScope
      : EMPTY_PLANNER_SYNC_FRESHNESS

  return {
    byScope: {
      'life-spheres': getNewestSyncTimestamp(
        currentByScope['life-spheres'],
        incoming['life-spheres'],
      ),
      'task-templates': getNewestSyncTimestamp(
        currentByScope['task-templates'],
        incoming['task-templates'],
      ),
      tasks: getNewestSyncTimestamp(currentByScope.tasks, incoming.tasks),
    },
    workspaceId,
  }
}

function isBrowserOfflineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function getNewestSyncTimestamp(
  current: string | null,
  incoming: string | null,
): string | null {
  if (!current) {
    return incoming
  }

  if (!incoming) {
    return current
  }

  return incoming > current ? incoming : current
}

function getOldestCompleteTimestamp(
  timestamps: readonly (string | null)[],
): string | null {
  const completeTimestamps = timestamps.filter(
    (timestamp): timestamp is string => Boolean(timestamp),
  )

  if (
    completeTimestamps.length === 0 ||
    completeTimestamps.length !== timestamps.length
  ) {
    return null
  }

  return completeTimestamps.reduce((oldest, timestamp) =>
    timestamp < oldest ? timestamp : oldest,
  )
}
