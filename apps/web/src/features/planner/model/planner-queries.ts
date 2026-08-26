import {
  type LifeSphereRecord,
  type TaskReadModelResponse,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'
import {
  type QueryClient,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import {
  getPlannerOfflineWorkspaceWriteGeneration,
  type PlannerDataSyncScope,
  replaceCachedLifeSphereRecordsFromServer,
  replaceCachedTaskRecordsFromServer,
  replaceCachedTaskTemplateRecordsFromServer,
} from '../lib/offline-planner-store'
import {
  isUnauthorizedPlannerApiError,
  type PlannerApiClient,
} from '../lib/planner-api'
import { requirePlannerApi } from './planner-error-policy'

export const TASK_EVENT_POLL_INTERVAL_MS = 15_000
export const PLANNER_TASK_SNAPSHOT_LIMITS = {
  activeLimit: 500,
  historyLimit: 100,
  rangeLimit: 250,
} as const

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
  onServerReadSuccess: (
    scope: PlannerDataSyncScope,
    lastSuccessfulSyncAt: string,
  ) => void
  plannerApi: PlannerApiClient | null
  plannerTimeZone: string
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
  taskReadModelCoverage: TaskReadModelCoverage | null
}

export type TaskReadModelCoverage = Omit<
  TaskReadModelResponse,
  'eventCursor' | 'items'
>

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

export function loadPlannerTaskSnapshot(
  plannerApi: PlannerApiClient,
  dateFrom: string,
  dateTo: string,
  signal?: AbortSignal,
) {
  return plannerApi.getTaskReadModel(
    {
      ...PLANNER_TASK_SNAPSHOT_LIMITS,
      dateFrom,
      dateTo,
    },
    signal,
  )
}

export function usePlannerQueries({
  authSessionVersion,
  onServerReadSuccess,
  plannerApi,
  plannerTimeZone,
  queryClient,
  workspaceId,
}: PlannerQueriesParams): PlannerQueries {
  const [taskReadModelState, setTaskReadModelState] = useState<{
    coverage: TaskReadModelCoverage
    workspaceId: string
  } | null>(null)
  const todayKey = getTodayDate(plannerTimeZone)
  const tomorrowKey = addDateDays(todayKey, 1)
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
    queryFn: async ({ signal }) => {
      const writeGeneration = workspaceId
        ? getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
        : 0
      const response = await loadPlannerTaskSnapshot(
        requirePlannerApi(plannerApi),
        todayKey,
        tomorrowKey,
        signal,
      )
      const records = response.items
      const lastSuccessfulSyncAt = new Date().toISOString()

      if (workspaceId) {
        setTaskReadModelState({
          coverage: {
            historyNextCursor: response.historyNextCursor,
            returnedCount: response.returnedCount,
            sources: response.sources,
            totalCount: response.totalCount,
            truncated: response.truncated,
          },
          workspaceId,
        })
      }

      if (workspaceId) {
        void replaceCachedTaskRecordsFromServer(
          workspaceId,
          records,
          lastSuccessfulSyncAt,
          writeGeneration,
          response.eventCursor,
        ).catch((error) => {
          console.warn('Failed to persist server task snapshot.', error)
        })
      }
      onServerReadSuccess('tasks', lastSuccessfulSyncAt)

      return records
    },
    queryKey: taskQueryKey,
    retry: (failureCount, error) =>
      !isUnauthorizedPlannerApiError(error) && failureCount < 2,
  })
  const spheresQuery = useQuery<LifeSphereRecord[], Error>({
    enabled: plannerApi !== null,
    queryFn: async ({ signal }) => {
      const writeGeneration = workspaceId
        ? getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
        : 0
      const records =
        await requirePlannerApi(plannerApi).listLifeSpheres(signal)
      const lastSuccessfulSyncAt = new Date().toISOString()

      if (workspaceId) {
        void replaceCachedLifeSphereRecordsFromServer(
          workspaceId,
          records,
          lastSuccessfulSyncAt,
          writeGeneration,
        ).catch((error) => {
          console.warn('Failed to persist server life-sphere snapshot.', error)
        })
      }
      onServerReadSuccess('life-spheres', lastSuccessfulSyncAt)

      return records
    },
    queryKey: sphereQueryKey,
    retry: (failureCount, error) =>
      !isUnauthorizedPlannerApiError(error) && failureCount < 2,
  })
  const taskTemplatesQuery = useQuery<TaskTemplateRecord[], Error>({
    enabled: plannerApi !== null,
    queryFn: async ({ signal }) => {
      const writeGeneration = workspaceId
        ? getPlannerOfflineWorkspaceWriteGeneration(workspaceId)
        : 0
      const records =
        await requirePlannerApi(plannerApi).listTaskTemplates(signal)
      const lastSuccessfulSyncAt = new Date().toISOString()

      if (workspaceId) {
        void replaceCachedTaskTemplateRecordsFromServer(
          workspaceId,
          records,
          lastSuccessfulSyncAt,
          writeGeneration,
        ).catch((error) => {
          console.warn(
            'Failed to persist server task-template snapshot.',
            error,
          )
        })
      }
      onServerReadSuccess('task-templates', lastSuccessfulSyncAt)

      return records
    },
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
    taskReadModelCoverage:
      taskReadModelState && taskReadModelState.workspaceId === workspaceId
        ? taskReadModelState.coverage
        : null,
    tasksQuery,
  }
}
