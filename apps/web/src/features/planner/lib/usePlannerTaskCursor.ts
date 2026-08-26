import type {
  TaskCursorListFilters,
  TaskCursorListResponse,
} from '@planner/contracts'
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useSessionFeatureReadiness } from '@/features/session'

import { usePlannerApiClient } from './usePlannerApiClient'

export function usePlannerTaskCursor(
  filters: TaskCursorListFilters,
  options: { enabled?: boolean } = {},
): UseQueryResult<TaskCursorListResponse, Error> {
  const plannerApi = usePlannerApiClient()
  const { apiConfig } = useSessionFeatureReadiness()

  return useQuery({
    enabled: options.enabled !== false && plannerApi !== null,
    queryFn: ({ signal }) => {
      if (!plannerApi) {
        throw new Error('Planner API is unavailable.')
      }

      return plannerApi.listTasksCursor(filters, signal)
    },
    queryKey: [
      'planner',
      'tasks',
      'cursor',
      apiConfig?.workspaceId ?? 'pending',
      filters,
    ],
  })
}
export function usePlannerTaskInfiniteCursor(
  filters: Omit<TaskCursorListFilters, 'cursor'>,
  options: {
    enabled?: boolean
    initialCursor: string | null
  },
) {
  const plannerApi = usePlannerApiClient()
  const { apiConfig } = useSessionFeatureReadiness()

  return useInfiniteQuery<
    TaskCursorListResponse,
    Error,
    InfiniteData<TaskCursorListResponse, string | null>,
    readonly unknown[],
    string | null
  >({
    enabled: options.enabled !== false && plannerApi !== null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: options.initialCursor,
    queryFn: ({ pageParam, signal }) => {
      if (!plannerApi) {
        throw new Error('Planner API is unavailable.')
      }

      return plannerApi.listTasksCursor(
        { ...filters, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      )
    },
    queryKey: [
      'planner',
      'tasks',
      'cursor',
      'infinite',
      apiConfig?.workspaceId ?? 'pending',
      filters,
      options.initialCursor,
    ],
  })
}
