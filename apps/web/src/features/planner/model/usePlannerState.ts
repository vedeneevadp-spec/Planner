import { generateUuidV7, type TaskRecord } from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  NewTaskInput,
  Task,
  TaskScheduleInput,
  TaskStatus,
} from '@/entities/task'
import { sortTasks } from '@/entities/task'
import { usePlannerSession, useSessionAuth } from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  countRetryablePlannerOfflineMutations,
  enqueuePlannerOfflineMutation,
  isPlannerOfflineStorageAvailable,
  loadCachedTaskRecords,
  replaceCachedTaskRecords,
} from '../lib/offline-planner-store'
import {
  drainPlannerOfflineQueue,
  isQueueablePlannerMutationError,
} from '../lib/offline-planner-sync'
import {
  createPlannerApiClient,
  type PlannerApiClient,
  PlannerApiError,
} from '../lib/planner-api'
import type { PlannerState } from './planner.types'

interface PlannerMutationContext {
  optimisticTaskId: string | undefined
  previousTaskRecords: TaskRecord[] | undefined
}

interface ScheduleMutationVariables {
  expectedVersion: number
  schedule: TaskScheduleInput
  taskId: string
}

interface StatusMutationVariables {
  expectedVersion: number
  status: TaskStatus
  taskId: string
}

interface RemoveTaskMutationVariables {
  expectedVersion: number
  taskId: string
}

function toPlannerTask(task: TaskRecord): Task {
  return {
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    dueDate: task.dueDate,
    id: task.id,
    note: task.note,
    plannedDate: task.plannedDate,
    plannedEndTime: task.plannedEndTime,
    plannedStartTime: task.plannedStartTime,
    project: task.project,
    status: task.status,
    title: task.title,
  }
}

function normalizeSchedule({
  plannedDate,
  plannedStartTime,
  plannedEndTime,
}: TaskScheduleInput): TaskScheduleInput {
  if (!plannedDate) {
    return {
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
    }
  }

  if (!plannedStartTime) {
    return {
      plannedDate,
      plannedEndTime: null,
      plannedStartTime: null,
    }
  }

  if (!plannedEndTime || plannedEndTime <= plannedStartTime) {
    return {
      plannedDate,
      plannedEndTime: null,
      plannedStartTime,
    }
  }

  return {
    plannedDate,
    plannedEndTime,
    plannedStartTime,
  }
}

function createOptimisticTaskRecord(
  input: NewTaskInput,
  workspaceId: string,
): TaskRecord {
  const now = new Date().toISOString()
  const schedule = normalizeSchedule({
    plannedDate: input.plannedDate,
    plannedEndTime: input.plannedEndTime,
    plannedStartTime: input.plannedStartTime,
  })

  return {
    completedAt: null,
    createdAt: now,
    deletedAt: null,
    dueDate: input.dueDate,
    id: input.id ?? generateUuidV7(),
    note: input.note.trim(),
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: input.project.trim(),
    status: 'todo',
    title: input.title.trim(),
    updatedAt: now,
    version: 1,
    workspaceId,
  }
}

function replaceTaskRecord(
  taskRecords: TaskRecord[],
  nextTask: TaskRecord,
): TaskRecord[] {
  const existingIndex = taskRecords.findIndex((task) => task.id === nextTask.id)

  if (existingIndex === -1) {
    return [nextTask, ...taskRecords]
  }

  return taskRecords.map((task) => (task.id === nextTask.id ? nextTask : task))
}

function replaceOptimisticTaskRecord(
  taskRecords: TaskRecord[],
  optimisticTaskId: string | undefined,
  nextTask: TaskRecord,
): TaskRecord[] {
  if (!optimisticTaskId) {
    return replaceTaskRecord(taskRecords, nextTask)
  }

  let replaced = false
  const nextTaskRecords = taskRecords.map((task) => {
    if (task.id !== optimisticTaskId) {
      return task
    }

    replaced = true

    return nextTask
  })

  return replaced
    ? nextTaskRecords
    : replaceTaskRecord(nextTaskRecords, nextTask)
}

function updateTaskRecord(
  taskRecords: TaskRecord[],
  taskId: string,
  updater: (task: TaskRecord) => TaskRecord,
): TaskRecord[] {
  return taskRecords.map((task) => (task.id === taskId ? updater(task) : task))
}

function removeTaskRecord(
  taskRecords: TaskRecord[],
  taskId: string,
): TaskRecord[] {
  return taskRecords.filter((task) => task.id !== taskId)
}

function getTaskRecord(
  taskRecords: TaskRecord[],
  taskId: string,
): TaskRecord | undefined {
  return taskRecords.find((task) => task.id === taskId)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof PlannerApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Не удалось синхронизировать данные.'
}

function shouldKeepOptimisticMutation(error: unknown): boolean {
  return (
    isPlannerOfflineStorageAvailable() && isQueueablePlannerMutationError(error)
  )
}

function requirePlannerApi(
  plannerApi: PlannerApiClient | null,
): PlannerApiClient {
  if (!plannerApi) {
    throw new Error('Planner session is not ready.')
  }

  return plannerApi
}

function toggleTaskId(
  taskIds: Set<string>,
  taskId: string,
  isPending: boolean,
): Set<string> {
  const nextTaskIds = new Set(taskIds)

  if (isPending) {
    nextTaskIds.add(taskId)
  } else {
    nextTaskIds.delete(taskId)
  }

  return nextTaskIds
}

export function usePlannerState(): PlannerState {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const actorUserId = session?.actorUserId
  const workspaceId = session?.workspaceId
  const queryClient = useQueryClient()
  const [mutationErrorMessage, setMutationErrorMessage] = useState<
    string | null
  >(null)
  const [isDrainingOfflineQueue, setIsDrainingOfflineQueue] = useState(false)
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [queuedMutationCount, setQueuedMutationCount] = useState(0)
  const plannerApi = useMemo(() => {
    if (!session) {
      return null
    }

    return createPlannerApiClient({
      ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
      actorUserId: session.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId: session.workspaceId,
    })
  }, [auth.accessToken, session])
  const taskQueryKey = useMemo(
    () => ['planner', 'tasks', workspaceId ?? 'pending'] as const,
    [workspaceId],
  )

  const tasksQuery = useQuery({
    enabled: plannerApi !== null,
    queryFn: ({ signal }) =>
      requirePlannerApi(plannerApi).listTasks({}, signal),
    queryKey: taskQueryKey,
  })
  const refreshQueuedMutationCount = useCallback(async () => {
    if (!workspaceId) {
      setQueuedMutationCount(0)

      return
    }

    setQueuedMutationCount(
      await countRetryablePlannerOfflineMutations(workspaceId),
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
  const drainQueuedMutations = useCallback(async () => {
    if (!plannerApi || !workspaceId) {
      return
    }

    setIsDrainingOfflineQueue(true)

    try {
      const result = await drainPlannerOfflineQueue({
        api: plannerApi,
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
        await queryClient.invalidateQueries({ queryKey: taskQueryKey })
      }

      if (result.conflicted > 0) {
        setMutationErrorMessage(
          'Часть offline-изменений конфликтует с серверной версией. Обновили данные, повторите действие.',
        )
      }
    } finally {
      await refreshQueuedMutationCount()
      setIsDrainingOfflineQueue(false)
    }
  }, [
    plannerApi,
    queryClient,
    refreshQueuedMutationCount,
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
    void refreshQueuedMutationCount()

    return () => {
      isActive = false
    }
  }, [queryClient, refreshQueuedMutationCount, taskQueryKey, workspaceId])

  useEffect(() => {
    if (!workspaceId || !tasksQuery.data) {
      return
    }

    void replaceCachedTaskRecords(workspaceId, tasksQuery.data)
  }, [tasksQuery.data, workspaceId])

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

  const createTaskMutation = useMutation({
    mutationFn: (input: NewTaskInput) =>
      requirePlannerApi(plannerApi).createTask(input),
    onMutate: async (input): Promise<PlannerMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: taskQueryKey })

      const previousTaskRecords =
        queryClient.getQueryData<TaskRecord[]>(taskQueryKey)
      const optimisticTask = createOptimisticTaskRecord(
        input,
        session?.workspaceId ?? 'pending',
      )

      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) => [
        optimisticTask,
        ...current,
      ])

      return {
        optimisticTaskId: optimisticTask.id,
        previousTaskRecords,
      }
    },
    onError: (error, _input, context) => {
      if (shouldKeepOptimisticMutation(error)) {
        return
      }

      if (context?.previousTaskRecords) {
        queryClient.setQueryData(taskQueryKey, context.previousTaskRecords)
      }
    },
    onSuccess: (task, _input, context) => {
      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        replaceOptimisticTaskRecord(current, context?.optimisticTaskId, task),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskQueryKey })
    },
  })

  const setTaskStatusMutation = useMutation({
    mutationFn: ({
      expectedVersion,
      status,
      taskId,
    }: StatusMutationVariables) =>
      requirePlannerApi(plannerApi).setTaskStatus(taskId, {
        expectedVersion,
        status,
      }),
    onMutate: async ({ status, taskId }): Promise<PlannerMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: taskQueryKey })

      const previousTaskRecords =
        queryClient.getQueryData<TaskRecord[]>(taskQueryKey)
      const now = new Date().toISOString()

      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        updateTaskRecord(current, taskId, (task) => ({
          ...task,
          completedAt: status === 'done' ? now : null,
          status,
          updatedAt: now,
          version: task.version + 1,
        })),
      )

      return {
        optimisticTaskId: undefined,
        previousTaskRecords,
      }
    },
    onError: (error, _variables, context) => {
      if (shouldKeepOptimisticMutation(error)) {
        return
      }

      if (context?.previousTaskRecords) {
        queryClient.setQueryData(taskQueryKey, context.previousTaskRecords)
      }
    },
    onSuccess: (task) => {
      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        replaceTaskRecord(current, task),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskQueryKey })
    },
  })

  const setTaskScheduleMutation = useMutation({
    mutationFn: ({
      expectedVersion,
      schedule,
      taskId,
    }: ScheduleMutationVariables) =>
      requirePlannerApi(plannerApi).setTaskSchedule(taskId, {
        expectedVersion,
        schedule,
      }),
    onMutate: async ({ schedule, taskId }): Promise<PlannerMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: taskQueryKey })

      const previousTaskRecords =
        queryClient.getQueryData<TaskRecord[]>(taskQueryKey)
      const normalizedSchedule = normalizeSchedule(schedule)
      const now = new Date().toISOString()

      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        updateTaskRecord(current, taskId, (task) => ({
          ...task,
          plannedDate: normalizedSchedule.plannedDate,
          plannedEndTime: normalizedSchedule.plannedEndTime,
          plannedStartTime: normalizedSchedule.plannedStartTime,
          updatedAt: now,
          version: task.version + 1,
        })),
      )

      return {
        optimisticTaskId: undefined,
        previousTaskRecords,
      }
    },
    onError: (error, _variables, context) => {
      if (shouldKeepOptimisticMutation(error)) {
        return
      }

      if (context?.previousTaskRecords) {
        queryClient.setQueryData(taskQueryKey, context.previousTaskRecords)
      }
    },
    onSuccess: (task) => {
      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        replaceTaskRecord(current, task),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskQueryKey })
    },
  })

  const removeTaskMutation = useMutation({
    mutationFn: ({ expectedVersion, taskId }: RemoveTaskMutationVariables) =>
      requirePlannerApi(plannerApi).removeTask(taskId, expectedVersion),
    onMutate: async ({
      taskId,
    }: RemoveTaskMutationVariables): Promise<PlannerMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: taskQueryKey })

      const previousTaskRecords =
        queryClient.getQueryData<TaskRecord[]>(taskQueryKey)

      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        removeTaskRecord(current, taskId),
      )

      return {
        optimisticTaskId: undefined,
        previousTaskRecords,
      }
    },
    onError: (error, _taskId, context) => {
      if (shouldKeepOptimisticMutation(error)) {
        return
      }

      if (context?.previousTaskRecords) {
        queryClient.setQueryData(taskQueryKey, context.previousTaskRecords)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskQueryKey })
    },
  })

  const tasks = useMemo(
    () => sortTasks((tasksQuery.data ?? []).map((task) => toPlannerTask(task))),
    [tasksQuery.data],
  )
  const hasTaskRecords = tasksQuery.data !== undefined

  function setTaskPending(taskId: string, isPending: boolean): void {
    setPendingTaskIds((current) => toggleTaskId(current, taskId, isPending))
  }

  function isTaskPending(taskId: string): boolean {
    return pendingTaskIds.has(taskId)
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
  ): Promise<boolean> {
    try {
      await action()

      return true
    } catch (error) {
      if (queueOfflineMutation && shouldKeepOptimisticMutation(error)) {
        await queueOfflineMutation()
        await persistCurrentTaskRecords()
        await refreshQueuedMutationCount()
        setMutationErrorMessage(
          'Нет соединения. Изменение сохранено локально и синхронизируется автоматически.',
        )

        return true
      }

      if (
        error instanceof PlannerApiError &&
        error.code === 'task_version_conflict'
      ) {
        await queryClient.invalidateQueries({ queryKey: taskQueryKey })
        setMutationErrorMessage(
          'Задача уже изменилась на сервере. Обновили данные, повторите действие.',
        )

        return false
      }

      setMutationErrorMessage(getErrorMessage(error))

      return false
    }
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

  async function runTaskMutation(
    taskId: string,
    action: () => Promise<boolean>,
  ): Promise<boolean> {
    if (pendingTaskIds.has(taskId)) {
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

    return runTaskMutation(taskId, () =>
      runMutation(
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
      ),
    )
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

  async function refresh(): Promise<void> {
    setMutationErrorMessage(null)

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['planner', 'session'] }),
      queryClient.invalidateQueries({ queryKey: ['planner', 'tasks'] }),
    ])
  }

  return {
    addTask,
    errorMessage:
      mutationErrorMessage ??
      (sessionQuery.error ? getErrorMessage(sessionQuery.error) : null) ??
      (tasksQuery.error ? getErrorMessage(tasksQuery.error) : null),
    isLoading:
      sessionQuery.isPending ||
      (sessionQuery.isSuccess && tasksQuery.isPending && !hasTaskRecords),
    isSyncing:
      sessionQuery.isFetching ||
      tasksQuery.isFetching ||
      isDrainingOfflineQueue ||
      queuedMutationCount > 0 ||
      createTaskMutation.isPending ||
      setTaskStatusMutation.isPending ||
      setTaskScheduleMutation.isPending ||
      removeTaskMutation.isPending,
    isTaskPending,
    refresh,
    removeTask,
    setTaskPlannedDate,
    setTaskSchedule,
    setTaskStatus,
    tasks,
  }
}
