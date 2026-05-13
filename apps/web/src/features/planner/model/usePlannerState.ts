import { generateUuidV7, type TaskRecord } from '@planner/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  NewProjectInput,
  Project,
  ProjectUpdateInput,
} from '@/entities/project'
import type {
  NewTaskInput,
  TaskScheduleInput,
  TaskStatus,
  TaskUpdateInput,
} from '@/entities/task'
import { sortTasks } from '@/entities/task'
import type {
  NewTaskTemplateInput,
  TaskTemplate,
} from '@/entities/task-template'
import {
  isUnauthorizedSessionApiError,
  usePlannerSession,
  useSessionAuth,
} from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'

import { enqueuePlannerOfflineMutation } from '../lib/offline-planner-store'
import {
  createPlannerApiClient,
  isUnauthorizedPlannerApiError,
  PlannerApiError,
} from '../lib/planner-api'
import { useTaskCompletionConfetti } from '../lib/task-completion-confetti'
import type { PlannerState } from './planner.types'
import {
  getErrorMessage,
  shouldKeepOptimisticMutation,
} from './planner-error-policy'
import { usePlannerMutations } from './planner-mutations'
import { usePlannerOfflineSync } from './planner-offline'
import { usePlannerQueries } from './planner-queries'
import {
  getTaskRecord,
  sortProjects,
  sortTaskTemplates,
  toggleTaskId,
  toPlannerTask,
  toPlannerTaskTemplate,
} from './planner-records'

export function usePlannerState(): PlannerState {
  const { accessToken, isAuthEnabled, recoverSession } = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const isPlannerApiReady =
    Boolean(session) && (!isAuthEnabled || Boolean(accessToken))
  const actorUserId = session?.actorUserId
  const fireTaskCompletionConfetti = useTaskCompletionConfetti()
  const isTaskCompletionConfettiEnabled =
    session?.workspaceSettings.taskCompletionConfettiEnabled ?? true
  const workspaceId = session?.workspaceId
  const queryClient = useQueryClient()
  const [mutationErrorMessage, setMutationErrorMessage] = useState<
    string | null
  >(null)
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(
    () => new Set(),
  )
  const pendingTaskIdsRef = useRef<Set<string>>(new Set())
  const plannerApi = useMemo(() => {
    if (!session || !isPlannerApiReady) {
      return null
    }

    return createPlannerApiClient({
      ...(accessToken ? { accessToken } : {}),
      actorUserId: session.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId: session.workspaceId,
    })
  }, [accessToken, isPlannerApiReady, session])
  const {
    invalidatePlannerQueries,
    projectQueryKey,
    projectsQuery,
    taskQueryKey,
    taskTemplateQueryKey,
    taskTemplatesQuery,
    tasksQuery,
  } = usePlannerQueries({
    plannerApi,
    queryClient,
    workspaceId,
  })
  const {
    conflictedMutationCount,
    isDrainingOfflineQueue,
    persistCurrentProjectRecords,
    persistCurrentTaskRecords,
    persistCurrentTaskTemplateRecords,
    queuedMutationCount,
    refreshQueuedMutationCount,
  } = usePlannerOfflineSync({
    invalidatePlannerQueries,
    plannerApi,
    projectQueryKey,
    projects: projectsQuery.data,
    queryClient,
    recoverSession,
    setMutationErrorMessage,
    taskQueryKey,
    taskTemplateQueryKey,
    taskTemplates: taskTemplatesQuery.data,
    tasks: tasksQuery.data,
    workspaceId,
  })
  const {
    createProjectMutation,
    createTaskMutation,
    createTaskTemplateMutation,
    removeProjectMutation,
    removeTaskMutation,
    removeTaskTemplateMutation,
    setTaskScheduleMutation,
    setTaskStatusMutation,
    updateProjectMutation,
    updateTaskMutation,
  } = usePlannerMutations({
    plannerApi,
    projectQueryKey,
    queryClient,
    session,
    setMutationErrorMessage,
    taskQueryKey,
    taskTemplateQueryKey,
  })
  const authError =
    sessionQuery.error ??
    projectsQuery.error ??
    taskTemplatesQuery.error ??
    tasksQuery.error ??
    createProjectMutation.error ??
    createTaskTemplateMutation.error ??
    updateProjectMutation.error ??
    removeProjectMutation.error ??
    createTaskMutation.error ??
    updateTaskMutation.error ??
    removeTaskTemplateMutation.error ??
    setTaskStatusMutation.error ??
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

  const projects = useMemo<Project[]>(
    () => sortProjects(projectsQuery.data ?? []),
    [projectsQuery.data],
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
  const hasTaskRecords = tasksQuery.data !== undefined
  const hasProjectRecords = projectsQuery.data !== undefined
  const hasTaskTemplateRecords = taskTemplatesQuery.data !== undefined

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

      if (
        error instanceof PlannerApiError &&
        (error.code === 'project_version_conflict' ||
          error.code === 'life_sphere_version_conflict')
      ) {
        await queryClient.invalidateQueries({ queryKey: projectQueryKey })
        setMutationErrorMessage(
          'Сфера уже изменилась на сервере. Обновили данные, повторите действие.',
        )

        return false
      }

      setMutationErrorMessage(getErrorMessage(error))

      return false
    }
  }

  async function addProject(input: NewProjectInput): Promise<boolean> {
    const projectId = input.id ?? generateUuidV7()
    const inputWithId = {
      ...input,
      id: projectId,
    }

    return runMutation(
      () => createProjectMutation.mutateAsync(inputWithId),
      async () => {
        if (!actorUserId || !workspaceId) {
          throw new Error('Planner session is not ready.')
        }

        await enqueuePlannerOfflineMutation({
          actorUserId,
          input: inputWithId,
          projectId,
          type: 'project.create',
          workspaceId,
        })
      },
      persistCurrentProjectRecords,
    )
  }

  async function updateProject(
    projectId: string,
    input: ProjectUpdateInput,
  ): Promise<boolean> {
    return runMutation(
      () =>
        updateProjectMutation.mutateAsync({
          input,
          projectId,
        }),
      async () => {
        if (!actorUserId || !workspaceId) {
          throw new Error('Planner session is not ready.')
        }

        await enqueuePlannerOfflineMutation({
          actorUserId,
          input,
          projectId,
          type: 'project.update',
          workspaceId,
        })
      },
      persistCurrentProjectRecords,
    )
  }

  async function removeProject(projectId: string): Promise<boolean> {
    return runMutation(() => removeProjectMutation.mutateAsync(projectId))
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
      const didCompleteTask = task.status !== 'done' && status === 'done'
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

  return {
    addProject,
    addTask,
    addTaskTemplate,
    conflictedMutationCount,
    errorMessage:
      mutationErrorMessage ??
      (sessionQuery.error ? getErrorMessage(sessionQuery.error) : null) ??
      (projectsQuery.error ? getErrorMessage(projectsQuery.error) : null) ??
      (taskTemplatesQuery.error
        ? getErrorMessage(taskTemplatesQuery.error)
        : null) ??
      (tasksQuery.error ? getErrorMessage(tasksQuery.error) : null),
    isLoading:
      sessionQuery.isPending ||
      (sessionQuery.isSuccess &&
        projectsQuery.isPending &&
        !hasProjectRecords) ||
      (sessionQuery.isSuccess &&
        taskTemplatesQuery.isPending &&
        !hasTaskTemplateRecords) ||
      (sessionQuery.isSuccess && tasksQuery.isPending && !hasTaskRecords),
    isSyncing:
      sessionQuery.isFetching ||
      projectsQuery.isFetching ||
      taskTemplatesQuery.isFetching ||
      tasksQuery.isFetching ||
      isDrainingOfflineQueue ||
      queuedMutationCount > 0 ||
      createProjectMutation.isPending ||
      updateProjectMutation.isPending ||
      removeProjectMutation.isPending ||
      createTaskMutation.isPending ||
      updateTaskMutation.isPending ||
      createTaskTemplateMutation.isPending ||
      removeTaskTemplateMutation.isPending ||
      setTaskStatusMutation.isPending ||
      setTaskScheduleMutation.isPending ||
      removeTaskMutation.isPending,
    isTaskPending,
    projects,
    queuedMutationCount,
    refresh,
    removeProject,
    removeTask,
    removeTaskTemplate,
    setTaskPlannedDate,
    setTaskSchedule,
    setTaskStatus,
    tasks,
    taskTemplates,
    updateProject,
    updateTask,
  }
}
