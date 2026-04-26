import {
  generateUuidV7,
  type ProjectRecord,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  NewProjectInput,
  Project,
  ProjectUpdateInput,
} from '@/entities/project'
import type {
  NewTaskInput,
  Task,
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
  getSupabaseBrowserClient,
  isUnauthorizedSessionApiError,
  usePlannerSession,
  useSessionAuth,
} from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  countConflictedPlannerOfflineMutations,
  countRetryablePlannerOfflineMutations,
  enqueuePlannerOfflineMutation,
  getLastTaskEventId,
  isPlannerOfflineStorageAvailable,
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
  createPlannerApiClient,
  isUnauthorizedPlannerApiError,
  type PlannerApiClient,
  PlannerApiError,
} from '../lib/planner-api'
import type { PlannerState } from './planner.types'

interface PlannerMutationContext {
  optimisticTaskId: string | undefined
  previousTaskRecords: TaskRecord[] | undefined
}

interface ProjectMutationContext {
  optimisticProjectId: string | undefined
  previousProjectRecords: ProjectRecord[] | undefined
}

interface TaskTemplateMutationContext {
  optimisticTemplateId: string | undefined
  previousTemplateRecords: TaskTemplateRecord[] | undefined
}

interface UpdateProjectMutationVariables {
  input: ProjectUpdateInput
  projectId: string
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

interface UpdateTaskMutationVariables {
  expectedVersion: number
  input: TaskUpdateInput
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
    icon: task.icon,
    importance: task.importance,
    note: task.note,
    plannedDate: task.plannedDate,
    plannedEndTime: task.plannedEndTime,
    plannedStartTime: task.plannedStartTime,
    project: task.project,
    projectId: task.projectId,
    resource: task.resource,
    sphereId: task.sphereId,
    status: task.status,
    title: task.title,
    urgency: task.urgency,
  }
}

function toPlannerTaskTemplate(template: TaskTemplateRecord): TaskTemplate {
  return {
    createdAt: template.createdAt,
    dueDate: template.dueDate,
    id: template.id,
    icon: template.icon,
    importance: template.importance,
    note: template.note,
    plannedDate: template.plannedDate,
    plannedEndTime: template.plannedEndTime,
    plannedStartTime: template.plannedStartTime,
    project: template.project,
    projectId: template.projectId,
    title: template.title,
    urgency: template.urgency,
  }
}

function sortProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((left, right) => {
    if (left.title !== right.title) {
      return left.title.localeCompare(right.title)
    }

    if (left.createdAt === right.createdAt) {
      return 0
    }

    return left.createdAt < right.createdAt ? -1 : 1
  })
}

function sortTaskTemplates(
  templates: TaskTemplateRecord[],
): TaskTemplateRecord[] {
  return [...templates].sort((left, right) => {
    if (left.title !== right.title) {
      return left.title.localeCompare(right.title)
    }

    if (left.createdAt === right.createdAt) {
      return 0
    }

    return left.createdAt < right.createdAt ? -1 : 1
  })
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
    icon: (input.icon ?? '').trim(),
    importance: input.importance ?? 'not_important',
    note: input.note.trim(),
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: input.project.trim(),
    projectId: input.projectId,
    resource: input.resource,
    sphereId: input.sphereId,
    status: 'todo',
    title: input.title.trim(),
    urgency: input.urgency ?? 'not_urgent',
    updatedAt: now,
    version: 1,
    workspaceId,
  }
}

function createOptimisticTaskTemplateRecord(
  input: NewTaskTemplateInput,
  workspaceId: string,
): TaskTemplateRecord {
  const now = new Date().toISOString()
  const schedule = normalizeSchedule({
    plannedDate: input.plannedDate,
    plannedEndTime: input.plannedEndTime,
    plannedStartTime: input.plannedStartTime,
  })

  return {
    createdAt: now,
    deletedAt: null,
    dueDate: input.dueDate,
    id: input.id ?? generateUuidV7(),
    icon: (input.icon ?? '').trim(),
    importance: input.importance ?? 'not_important',
    note: input.note.trim(),
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: input.project.trim(),
    projectId: input.projectId,
    title: input.title.trim(),
    urgency: input.urgency ?? 'not_urgent',
    updatedAt: now,
    version: 1,
    workspaceId,
  }
}

function createOptimisticProjectRecord(
  input: NewProjectInput,
  workspaceId: string,
): ProjectRecord {
  const now = new Date().toISOString()

  return {
    color: input.color.trim(),
    createdAt: now,
    deletedAt: null,
    description: input.description.trim(),
    icon: input.icon.trim(),
    id: input.id ?? generateUuidV7(),
    status: 'active',
    title: input.title.trim(),
    updatedAt: now,
    version: 1,
    workspaceId,
  }
}

function replaceProjectRecord(
  projectRecords: ProjectRecord[],
  nextProject: ProjectRecord,
): ProjectRecord[] {
  const existingIndex = projectRecords.findIndex(
    (project) => project.id === nextProject.id,
  )

  if (existingIndex === -1) {
    return sortProjects([nextProject, ...projectRecords])
  }

  return sortProjects(
    projectRecords.map((project) =>
      project.id === nextProject.id ? nextProject : project,
    ),
  )
}

function replaceOptimisticProjectRecord(
  projectRecords: ProjectRecord[],
  optimisticProjectId: string | undefined,
  nextProject: ProjectRecord,
): ProjectRecord[] {
  if (!optimisticProjectId) {
    return replaceProjectRecord(projectRecords, nextProject)
  }

  let replaced = false
  const nextProjectRecords = projectRecords.map((project) => {
    if (project.id !== optimisticProjectId) {
      return project
    }

    replaced = true

    return nextProject
  })

  return replaced
    ? sortProjects(nextProjectRecords)
    : replaceProjectRecord(nextProjectRecords, nextProject)
}

function replaceTaskTemplateRecord(
  templateRecords: TaskTemplateRecord[],
  nextTemplate: TaskTemplateRecord,
): TaskTemplateRecord[] {
  const existingIndex = templateRecords.findIndex(
    (template) => template.id === nextTemplate.id,
  )

  if (existingIndex === -1) {
    return sortTaskTemplates([nextTemplate, ...templateRecords])
  }

  return sortTaskTemplates(
    templateRecords.map((template) =>
      template.id === nextTemplate.id ? nextTemplate : template,
    ),
  )
}

function replaceOptimisticTaskTemplateRecord(
  templateRecords: TaskTemplateRecord[],
  optimisticTemplateId: string | undefined,
  nextTemplate: TaskTemplateRecord,
): TaskTemplateRecord[] {
  if (!optimisticTemplateId) {
    return replaceTaskTemplateRecord(templateRecords, nextTemplate)
  }

  let replaced = false
  const nextTemplateRecords = templateRecords.map((template) => {
    if (template.id !== optimisticTemplateId) {
      return template
    }

    replaced = true

    return nextTemplate
  })

  return replaced
    ? sortTaskTemplates(nextTemplateRecords)
    : replaceTaskTemplateRecord(nextTemplateRecords, nextTemplate)
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

function updateTaskProjectRecords(
  taskRecords: TaskRecord[],
  project: ProjectRecord,
): TaskRecord[] {
  return taskRecords.map((task) =>
    task.projectId === project.id
      ? {
          ...task,
          project: project.title,
        }
      : task,
  )
}

function updateTaskTemplateProjectRecords(
  templateRecords: TaskTemplateRecord[],
  project: ProjectRecord,
): TaskTemplateRecord[] {
  return templateRecords.map((template) =>
    template.projectId === project.id
      ? {
          ...template,
          project: project.title,
        }
      : template,
  )
}

function removeTaskRecord(
  taskRecords: TaskRecord[],
  taskId: string,
): TaskRecord[] {
  return taskRecords.filter((task) => task.id !== taskId)
}

function removeTaskTemplateRecord(
  templateRecords: TaskTemplateRecord[],
  templateId: string,
): TaskTemplateRecord[] {
  return templateRecords.filter((template) => template.id !== templateId)
}

function getTaskRecord(
  taskRecords: TaskRecord[],
  taskId: string,
): TaskRecord | undefined {
  return taskRecords.find((task) => task.id === taskId)
}

function getErrorMessage(error: unknown): string {
  if (
    isUnauthorizedPlannerApiError(error) ||
    isUnauthorizedSessionApiError(error)
  ) {
    return 'Сессия истекла. Войдите заново.'
  }

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
  const { accessToken, isAuthEnabled, recoverSession } = useSessionAuth()
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
  const pendingTaskIdsRef = useRef<Set<string>>(new Set())
  const taskEventCursorSyncRef = useRef<Promise<void> | null>(null)
  const [queuedMutationCount, setQueuedMutationCount] = useState(0)
  const [conflictedMutationCount, setConflictedMutationCount] = useState(0)
  const plannerApi = useMemo(() => {
    if (!session) {
      return null
    }

    return createPlannerApiClient({
      ...(accessToken ? { accessToken } : {}),
      actorUserId: session.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId: session.workspaceId,
    })
  }, [accessToken, session])
  const taskQueryKey = useMemo(
    () => ['planner', 'tasks', workspaceId ?? 'pending'] as const,
    [workspaceId],
  )
  const projectQueryKey = useMemo(
    () => ['planner', 'projects', workspaceId ?? 'pending'] as const,
    [workspaceId],
  )
  const taskTemplateQueryKey = useMemo(
    () => ['planner', 'task-templates', workspaceId ?? 'pending'] as const,
    [workspaceId],
  )
  const invalidatePlannerQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['planner', 'session'] }),
      queryClient.invalidateQueries({ queryKey: ['planner', 'projects'] }),
      queryClient.invalidateQueries({
        queryKey: ['planner', 'task-templates'],
      }),
      queryClient.invalidateQueries({ queryKey: ['planner', 'tasks'] }),
    ])
  }, [queryClient])

  const tasksQuery = useQuery({
    enabled: plannerApi !== null,
    queryFn: ({ signal }) =>
      requirePlannerApi(plannerApi).listTasks({}, signal),
    queryKey: taskQueryKey,
    retry: (failureCount, error) =>
      !isUnauthorizedPlannerApiError(error) && failureCount < 2,
  })
  const projectsQuery = useQuery({
    enabled: plannerApi !== null,
    queryFn: ({ signal }) => requirePlannerApi(plannerApi).listProjects(signal),
    queryKey: projectQueryKey,
    retry: (failureCount, error) =>
      !isUnauthorizedPlannerApiError(error) && failureCount < 2,
  })
  const taskTemplatesQuery = useQuery({
    enabled: plannerApi !== null,
    queryFn: ({ signal }) =>
      requirePlannerApi(plannerApi).listTaskTemplates(signal),
    queryKey: taskTemplateQueryKey,
    retry: (failureCount, error) =>
      !isUnauthorizedPlannerApiError(error) && failureCount < 2,
  })
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
    if (!workspaceId || !tasksQuery.data) {
      return
    }

    void replaceCachedTaskRecords(workspaceId, tasksQuery.data)
  }, [tasksQuery.data, workspaceId])

  useEffect(() => {
    if (!workspaceId || !projectsQuery.data) {
      return
    }

    void replaceCachedProjectRecords(workspaceId, projectsQuery.data)
  }, [projectsQuery.data, workspaceId])

  useEffect(() => {
    if (!workspaceId || !taskTemplatesQuery.data) {
      return
    }

    void replaceCachedTaskTemplateRecords(workspaceId, taskTemplatesQuery.data)
  }, [taskTemplatesQuery.data, workspaceId])

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
    if (!workspaceId) {
      return
    }

    const supabase = getSupabaseBrowserClient()

    if (!supabase) {
      return
    }

    const channel = supabase
      .channel(`planner-task-events-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          filter: `workspace_id=eq.${workspaceId}`,
          schema: 'app',
          table: 'task_events',
        },
        () => {
          void syncTaskEventCursor()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [syncTaskEventCursor, workspaceId])

  const createProjectMutation = useMutation({
    mutationFn: (input: NewProjectInput) =>
      requirePlannerApi(plannerApi).createProject(input),
    onMutate: async (input): Promise<ProjectMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: projectQueryKey })

      const previousProjectRecords =
        queryClient.getQueryData<ProjectRecord[]>(projectQueryKey)
      const optimisticProject = createOptimisticProjectRecord(
        input,
        session?.workspaceId ?? 'pending',
      )

      queryClient.setQueryData<ProjectRecord[]>(
        projectQueryKey,
        (current = []) => sortProjects([optimisticProject, ...current]),
      )

      return {
        optimisticProjectId: optimisticProject.id,
        previousProjectRecords,
      }
    },
    onError: (error, _input, context) => {
      if (shouldKeepOptimisticMutation(error)) {
        return
      }

      if (context?.previousProjectRecords) {
        queryClient.setQueryData(
          projectQueryKey,
          context.previousProjectRecords,
        )
      }
    },
    onSuccess: (project, _input, context) => {
      queryClient.setQueryData<ProjectRecord[]>(
        projectQueryKey,
        (current = []) =>
          replaceOptimisticProjectRecord(
            current,
            context?.optimisticProjectId,
            project,
          ),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectQueryKey })
    },
  })

  const updateProjectMutation = useMutation({
    mutationFn: ({ input, projectId }: UpdateProjectMutationVariables) =>
      requirePlannerApi(plannerApi).updateProject(projectId, input),
    onMutate: async ({ input, projectId }): Promise<ProjectMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: projectQueryKey })

      const previousProjectRecords =
        queryClient.getQueryData<ProjectRecord[]>(projectQueryKey)
      const now = new Date().toISOString()

      queryClient.setQueryData<ProjectRecord[]>(
        projectQueryKey,
        (current = []) =>
          sortProjects(
            current.map((project) =>
              project.id === projectId
                ? {
                    ...project,
                    ...(input.title !== undefined
                      ? { title: input.title.trim() }
                      : {}),
                    ...(input.description !== undefined
                      ? { description: input.description.trim() }
                      : {}),
                    ...(input.color !== undefined
                      ? { color: input.color.trim() }
                      : {}),
                    ...(input.icon !== undefined
                      ? { icon: input.icon.trim() }
                      : {}),
                    updatedAt: now,
                    version: project.version + 1,
                  }
                : project,
            ),
          ),
      )

      return {
        optimisticProjectId: undefined,
        previousProjectRecords,
      }
    },
    onError: (error, _variables, context) => {
      if (shouldKeepOptimisticMutation(error)) {
        return
      }

      if (context?.previousProjectRecords) {
        queryClient.setQueryData(
          projectQueryKey,
          context.previousProjectRecords,
        )
      }
    },
    onSuccess: (project) => {
      queryClient.setQueryData<ProjectRecord[]>(
        projectQueryKey,
        (current = []) => replaceProjectRecord(current, project),
      )
      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        updateTaskProjectRecords(current, project),
      )
      queryClient.setQueryData<TaskTemplateRecord[]>(
        taskTemplateQueryKey,
        (current = []) => updateTaskTemplateProjectRecords(current, project),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectQueryKey })
      void queryClient.invalidateQueries({ queryKey: taskTemplateQueryKey })
      void queryClient.invalidateQueries({ queryKey: taskQueryKey })
    },
  })

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

  const updateTaskMutation = useMutation({
    mutationFn: ({
      expectedVersion,
      input,
      taskId,
    }: UpdateTaskMutationVariables) =>
      requirePlannerApi(plannerApi).updateTask(taskId, {
        ...input,
        expectedVersion,
      }),
    onMutate: async ({
      input,
      taskId,
    }: UpdateTaskMutationVariables): Promise<PlannerMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: taskQueryKey })

      const previousTaskRecords =
        queryClient.getQueryData<TaskRecord[]>(taskQueryKey)
      const normalizedSchedule = normalizeSchedule({
        plannedDate: input.plannedDate,
        plannedEndTime: input.plannedEndTime,
        plannedStartTime: input.plannedStartTime,
      })
      const now = new Date().toISOString()

      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        updateTaskRecord(current, taskId, (task) => ({
          ...task,
          dueDate: input.dueDate,
          icon: (input.icon ?? '').trim(),
          importance: input.importance ?? 'not_important',
          note: input.note.trim(),
          plannedDate: normalizedSchedule.plannedDate,
          plannedEndTime: normalizedSchedule.plannedEndTime,
          plannedStartTime: normalizedSchedule.plannedStartTime,
          project: input.project.trim(),
          projectId: input.projectId,
          resource: input.resource,
          sphereId: input.sphereId,
          title: input.title.trim(),
          urgency: input.urgency ?? 'not_urgent',
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

  const createTaskTemplateMutation = useMutation({
    mutationFn: (input: NewTaskTemplateInput) =>
      requirePlannerApi(plannerApi).createTaskTemplate(input),
    onMutate: async (input): Promise<TaskTemplateMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: taskTemplateQueryKey })

      const previousTemplateRecords =
        queryClient.getQueryData<TaskTemplateRecord[]>(taskTemplateQueryKey)
      const optimisticTemplate = createOptimisticTaskTemplateRecord(
        input,
        session?.workspaceId ?? 'pending',
      )

      queryClient.setQueryData<TaskTemplateRecord[]>(
        taskTemplateQueryKey,
        (current = []) => sortTaskTemplates([optimisticTemplate, ...current]),
      )

      return {
        optimisticTemplateId: optimisticTemplate.id,
        previousTemplateRecords,
      }
    },
    onError: (_error, _input, context) => {
      if (context?.previousTemplateRecords) {
        queryClient.setQueryData(
          taskTemplateQueryKey,
          context.previousTemplateRecords,
        )
      }
    },
    onSuccess: (template, _input, context) => {
      queryClient.setQueryData<TaskTemplateRecord[]>(
        taskTemplateQueryKey,
        (current = []) =>
          replaceOptimisticTaskTemplateRecord(
            current,
            context?.optimisticTemplateId,
            template,
          ),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskTemplateQueryKey })
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

  const removeTaskTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      requirePlannerApi(plannerApi).removeTaskTemplate(templateId),
    onMutate: async (
      templateId: string,
    ): Promise<TaskTemplateMutationContext> => {
      setMutationErrorMessage(null)
      await queryClient.cancelQueries({ queryKey: taskTemplateQueryKey })

      const previousTemplateRecords =
        queryClient.getQueryData<TaskTemplateRecord[]>(taskTemplateQueryKey)

      queryClient.setQueryData<TaskTemplateRecord[]>(
        taskTemplateQueryKey,
        (current = []) => removeTaskTemplateRecord(current, templateId),
      )

      return {
        optimisticTemplateId: undefined,
        previousTemplateRecords,
      }
    },
    onError: (_error, _templateId, context) => {
      if (context?.previousTemplateRecords) {
        queryClient.setQueryData(
          taskTemplateQueryKey,
          context.previousTemplateRecords,
        )
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskTemplateQueryKey })
    },
  })

  useEffect(() => {
    const authError =
      sessionQuery.error ??
      projectsQuery.error ??
      taskTemplatesQuery.error ??
      tasksQuery.error ??
      createProjectMutation.error ??
      createTaskTemplateMutation.error ??
      updateProjectMutation.error ??
      createTaskMutation.error ??
      updateTaskMutation.error ??
      removeTaskTemplateMutation.error ??
      setTaskStatusMutation.error ??
      setTaskScheduleMutation.error ??
      removeTaskMutation.error

    if (
      !isAuthEnabled ||
      !accessToken ||
      !(
        isUnauthorizedSessionApiError(authError) ||
        isUnauthorizedPlannerApiError(authError)
      )
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
    createProjectMutation.error,
    createTaskMutation.error,
    createTaskTemplateMutation.error,
    invalidatePlannerQueries,
    isAuthEnabled,
    projectsQuery.error,
    recoverSession,
    removeTaskMutation.error,
    removeTaskTemplateMutation.error,
    sessionQuery.error,
    setTaskScheduleMutation.error,
    setTaskStatusMutation.error,
    taskTemplatesQuery.error,
    tasksQuery.error,
    updateProjectMutation.error,
    updateTaskMutation.error,
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

  async function removeTaskTemplate(templateId: string): Promise<boolean> {
    return runMutation(
      () => removeTaskTemplateMutation.mutateAsync(templateId),
      undefined,
      persistCurrentTaskTemplateRecords,
    )
  }

  async function refresh(): Promise<void> {
    setMutationErrorMessage(null)

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
