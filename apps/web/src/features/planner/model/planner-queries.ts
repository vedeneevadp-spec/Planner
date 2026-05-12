import {
  type ProjectRecord,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'
import {
  type QueryClient,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import {
  isUnauthorizedPlannerApiError,
  type PlannerApiClient,
} from '../lib/planner-api'
import { requirePlannerApi } from './planner-error-policy'

export const TASK_EVENT_POLL_INTERVAL_MS = 15_000

export type PlannerTaskQueryKey = readonly ['planner', 'tasks', string]
export type PlannerProjectQueryKey = readonly ['planner', 'projects', string]
export type PlannerTaskTemplateQueryKey = readonly [
  'planner',
  'task-templates',
  string,
]

interface PlannerQueriesParams {
  plannerApi: PlannerApiClient | null
  queryClient: QueryClient
  workspaceId: string | undefined
}

interface PlannerQueries {
  invalidatePlannerQueries: () => Promise<void>
  projectQueryKey: PlannerProjectQueryKey
  projectsQuery: UseQueryResult<ProjectRecord[], Error>
  taskQueryKey: PlannerTaskQueryKey
  taskTemplateQueryKey: PlannerTaskTemplateQueryKey
  taskTemplatesQuery: UseQueryResult<TaskTemplateRecord[], Error>
  tasksQuery: UseQueryResult<TaskRecord[], Error>
}

export function getPlannerTaskQueryKey(
  workspaceId: string | undefined,
): PlannerTaskQueryKey {
  return ['planner', 'tasks', workspaceId ?? 'pending']
}

export function getPlannerProjectQueryKey(
  workspaceId: string | undefined,
): PlannerProjectQueryKey {
  return ['planner', 'projects', workspaceId ?? 'pending']
}

export function getPlannerTaskTemplateQueryKey(
  workspaceId: string | undefined,
): PlannerTaskTemplateQueryKey {
  return ['planner', 'task-templates', workspaceId ?? 'pending']
}

export function usePlannerQueries({
  plannerApi,
  queryClient,
  workspaceId,
}: PlannerQueriesParams): PlannerQueries {
  const taskQueryKey = useMemo(
    () => getPlannerTaskQueryKey(workspaceId),
    [workspaceId],
  )
  const projectQueryKey = useMemo(
    () => getPlannerProjectQueryKey(workspaceId),
    [workspaceId],
  )
  const taskTemplateQueryKey = useMemo(
    () => getPlannerTaskTemplateQueryKey(workspaceId),
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

  const tasksQuery = useQuery<TaskRecord[], Error>({
    enabled: plannerApi !== null,
    queryFn: ({ signal }) =>
      requirePlannerApi(plannerApi).listTasks({}, signal),
    queryKey: taskQueryKey,
    retry: (failureCount, error) =>
      !isUnauthorizedPlannerApiError(error) && failureCount < 2,
  })
  const projectsQuery = useQuery<ProjectRecord[], Error>({
    enabled: plannerApi !== null,
    queryFn: ({ signal }) => requirePlannerApi(plannerApi).listProjects(signal),
    queryKey: projectQueryKey,
    retry: (failureCount, error) =>
      !isUnauthorizedPlannerApiError(error) && failureCount < 2,
  })
  const taskTemplatesQuery = useQuery<TaskTemplateRecord[], Error>({
    enabled: plannerApi !== null,
    queryFn: ({ signal }) =>
      requirePlannerApi(plannerApi).listTaskTemplates(signal),
    queryKey: taskTemplateQueryKey,
    retry: (failureCount, error) =>
      !isUnauthorizedPlannerApiError(error) && failureCount < 2,
  })

  return {
    invalidatePlannerQueries,
    projectQueryKey,
    projectsQuery,
    taskQueryKey,
    taskTemplateQueryKey,
    taskTemplatesQuery,
    tasksQuery,
  }
}
