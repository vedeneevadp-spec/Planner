import {
  generateUuidV7,
  type TaskNextStageResponse,
  type TaskNextStageUndoInput,
  type TaskRecord,
  type TaskStageType,
} from '@planner/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

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
  useSessionAuth,
  useSessionFeatureReadiness,
} from '@/features/session'

import { enqueuePlannerOfflineMutation } from '../lib/offline-planner-store'
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
  getTaskRecord,
  sortSpheres,
  sortTaskTemplates,
  toggleTaskId,
  toPlannerTask,
  toPlannerTaskTemplate,
} from './planner-records'

export function usePlannerState(): PlannerState {
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
  const {
    conflictedMutationCount,
    isDrainingOfflineQueue,
    persistCurrentLifeSphereRecords,
    persistCurrentTaskRecords,
    persistCurrentTaskTemplateRecords,
    queuedMutationCount,
    refreshQueuedMutationCount,
  } = usePlannerOfflineSync({
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
    () => sortTasks((tasksQuery.data ?? []).map((task) => toPlannerTask(task))),
    [tasksQuery.data],
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

    return runTaskMutation(taskId, () =>
      runMutation(
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
      ),
    )
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
      let result: TaskNextStageResponse | null = null
      const didUpdate = await runMutation(async () => {
        const nextResult = await createNextTaskStageMutation.mutateAsync({
          completeCurrent: input.completeCurrent === true,
          expectedVersion: task.version,
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.plannedDate !== undefined
            ? { plannedDate: input.plannedDate }
            : {}),
          ...(input.stageType !== undefined
            ? { stageType: input.stageType }
            : {}),
          taskId,
          ...(input.title !== undefined ? { title: input.title } : {}),
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
      const didUpdate = await runMutation(
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

    const schedule = {
      plannedDate,
      plannedEndTime: plannedDate ? (task.plannedEndTime ?? null) : null,
      plannedStartTime: plannedDate ? (task.plannedStartTime ?? null) : null,
    }

    return runTaskMutation(taskId, () =>
      runMutation(
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
      ),
    )
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

    return runTaskMutation(taskId, () =>
      runMutation(
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
      ),
    )
  }

  async function removeTask(taskId: string): Promise<boolean> {
    const task = getCachedTaskRecord(taskId)

    if (!task) {
      setMutationErrorMessage(`Task "${taskId}" was not found.`)

      return false
    }

    return runTaskMutation(taskId, () =>
      runMutation(
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
      ),
    )
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
    taskTemplates,
    undoNextTaskStage,
    updateSphere,
    updateTask,
  }
}
