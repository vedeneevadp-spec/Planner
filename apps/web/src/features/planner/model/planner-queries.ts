import {
  type LifeSphereRecord,
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

export type PlannerTaskQueryKey = readonly ['planner', 'tasks', string, number]
export type PlannerSphereQueryKey = readonly [
  'planner',
  'spheres',
  string,
  number,
]
export type PlannerTaskTemplateQueryKey = readonly [
  'planner',
  'task-templates',
  string,
  number,
]

interface PlannerQueriesParams {
  authSessionVersion: number
  plannerApi: PlannerApiClient | null
  queryClient: QueryClient
  workspaceId: string | undefined
}

interface PlannerQueries {
  invalidatePlannerQueries: () => Promise<void>
  sphereQueryKey: PlannerSphereQueryKey
  spheresQuery: UseQueryResult<LifeSphereRecord[], Error>
  taskQueryKey: PlannerTaskQueryKey
  taskTemplateQueryKey: PlannerTaskTemplateQueryKey
  taskTemplatesQuery: UseQueryResult<TaskTemplateRecord[], Error>
  tasksQuery: UseQueryResult<TaskRecord[], Error>
}

export function getPlannerTaskQueryKey(
  workspaceId: string | undefined,
  authSessionVersion: number,
): PlannerTaskQueryKey {
  return ['planner', 'tasks', workspaceId ?? 'pending', authSessionVersion]
}

export function getPlannerSphereQueryKey(
  workspaceId: string | undefined,
  authSessionVersion: number,
): PlannerSphereQueryKey {
  return ['planner', 'spheres', workspaceId ?? 'pending', authSessionVersion]
}

export function getPlannerTaskTemplateQueryKey(
  workspaceId: string | undefined,
  authSessionVersion: number,
): PlannerTaskTemplateQueryKey {
  return [
    'planner',
    'task-templates',
    workspaceId ?? 'pending',
    authSessionVersion,
  ]
}

export function usePlannerQueries({
  authSessionVersion,
  plannerApi,
  queryClient,
  workspaceId,
}: PlannerQueriesParams): PlannerQueries {
  const taskQueryKey = useMemo(
    () => getPlannerTaskQueryKey(workspaceId, authSessionVersion),
    [authSessionVersion, workspaceId],
  )
  const sphereQueryKey = useMemo(
    () => getPlannerSphereQueryKey(workspaceId, authSessionVersion),
    [authSessionVersion, workspaceId],
  )
  const taskTemplateQueryKey = useMemo(
    () => getPlannerTaskTemplateQueryKey(workspaceId, authSessionVersion),
    [authSessionVersion, workspaceId],
  )
  const invalidatePlannerQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['planner', 'session'] }),
      queryClient.invalidateQueries({ queryKey: ['planner', 'spheres'] }),
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
  const spheresQuery = useQuery<LifeSphereRecord[], Error>({
    enabled: plannerApi !== null,
    queryFn: ({ signal }) =>
      requirePlannerApi(plannerApi).listLifeSpheres(signal),
    queryKey: sphereQueryKey,
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
    sphereQueryKey,
    spheresQuery,
    taskQueryKey,
    taskTemplateQueryKey,
    taskTemplatesQuery,
    tasksQuery,
  }
}
