import {
  type ProjectRecord,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'
import { type QueryClient, useMutation } from '@tanstack/react-query'

import type { NewProjectInput, ProjectUpdateInput } from '@/entities/project'
import type {
  NewTaskInput,
  TaskScheduleInput,
  TaskStatus,
  TaskUpdateInput,
} from '@/entities/task'
import type { NewTaskTemplateInput } from '@/entities/task-template'

import type { PlannerApiClient } from '../lib/planner-api'
import {
  requirePlannerApi,
  shouldKeepOptimisticMutation,
} from './planner-error-policy'
import type {
  PlannerProjectQueryKey,
  PlannerTaskQueryKey,
  PlannerTaskTemplateQueryKey,
} from './planner-queries'
import {
  createOptimisticProjectRecord,
  createOptimisticTaskRecord,
  createOptimisticTaskTemplateRecord,
  detachProjectFromTaskRecords,
  detachProjectFromTaskTemplateRecords,
  normalizeSchedule,
  removeProjectRecord,
  removeTaskRecord,
  removeTaskTemplateRecord,
  replaceOptimisticProjectRecord,
  replaceOptimisticTaskRecord,
  replaceOptimisticTaskTemplateRecord,
  replaceProjectRecord,
  replaceTaskRecord,
  sortProjects,
  sortTaskTemplates,
  updateTaskProjectRecords,
  updateTaskRecord,
  updateTaskTemplateProjectRecords,
} from './planner-records'

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

export interface ScheduleMutationVariables {
  expectedVersion: number
  schedule: TaskScheduleInput
  taskId: string
}

export interface StatusMutationVariables {
  expectedVersion: number
  status: TaskStatus
  taskId: string
}

export interface UpdateTaskMutationVariables {
  expectedVersion: number
  input: TaskUpdateInput
  taskId: string
}

export interface RemoveTaskMutationVariables {
  expectedVersion: number
  taskId: string
}

interface PlannerMutationSession {
  actor: {
    displayName: string
  }
  actorUserId: string
  workspaceId: string
}

interface PlannerMutationsParams {
  plannerApi: PlannerApiClient | null
  projectQueryKey: PlannerProjectQueryKey
  queryClient: QueryClient
  session: PlannerMutationSession | undefined
  setMutationErrorMessage: (message: string | null) => void
  taskQueryKey: PlannerTaskQueryKey
  taskTemplateQueryKey: PlannerTaskTemplateQueryKey
}

export function usePlannerMutations({
  plannerApi,
  projectQueryKey,
  queryClient,
  session,
  setMutationErrorMessage,
  taskQueryKey,
  taskTemplateQueryKey,
}: PlannerMutationsParams) {
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

  const removeProjectMutation = useMutation({
    mutationFn: (projectId: string) =>
      requirePlannerApi(plannerApi).removeLifeSphere(projectId),
    onSuccess: (_result, projectId) => {
      queryClient.setQueryData<ProjectRecord[]>(
        projectQueryKey,
        (current = []) => removeProjectRecord(current, projectId),
      )
      queryClient.setQueryData<TaskRecord[]>(taskQueryKey, (current = []) =>
        detachProjectFromTaskRecords(current, projectId),
      )
      queryClient.setQueryData<TaskTemplateRecord[]>(
        taskTemplateQueryKey,
        (current = []) =>
          detachProjectFromTaskTemplateRecords(current, projectId),
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
      const optimisticTask = createOptimisticTaskRecord(input, {
        authorDisplayName: session?.actor.displayName ?? null,
        authorUserId: session?.actorUserId ?? null,
        workspaceId: session?.workspaceId ?? 'pending',
      })

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
          assigneeDisplayName: null,
          assigneeUserId: input.assigneeUserId ?? null,
          dueDate: input.dueDate,
          icon: (input.icon ?? '').trim(),
          importance: input.importance ?? 'not_important',
          note: input.note.trim(),
          plannedDate: normalizedSchedule.plannedDate,
          plannedEndTime: normalizedSchedule.plannedEndTime,
          plannedStartTime: normalizedSchedule.plannedStartTime,
          project: input.project.trim(),
          projectId: input.projectId,
          recurrence: input.recurrence ?? null,
          remindBeforeStart: input.remindBeforeStart ? true : undefined,
          resource: input.resource,
          requiresConfirmation: input.requiresConfirmation ?? false,
          routine: input.routine ?? null,
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
          remindBeforeStart:
            normalizedSchedule.plannedDate &&
            normalizedSchedule.plannedStartTime
              ? task.remindBeforeStart
              : undefined,
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

  return {
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
  }
}
