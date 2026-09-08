import type {
  TaskCursorListFilters,
  TaskCursorListResponse,
  TaskRecord,
} from '@planner/contracts'
import {
  type InfiniteData,
  notifyManager,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'

import { useSessionAuth, useSessionFeatureReadiness } from '@/features/session'

import {
  getPlannerTaskQueryKey,
  type PlannerTaskQueryKey,
} from '../model/planner-queries'
import { mergeTaskPageWithSnapshot } from '../model/planner-task-cache'
import { usePlannerApiClient } from './usePlannerApiClient'

function useTaskSnapshot(taskQueryKey: PlannerTaskQueryKey) {
  const queryClient = useQueryClient()
  // Subscribe without installing another queryFn/options on the snapshot query.
  return useSyncExternalStore(
    useCallback(
      (notify) =>
        queryClient.getQueryCache().subscribe(notifyManager.batchCalls(notify)),
      [queryClient],
    ),
    () => queryClient.getQueryData<TaskRecord[]>(taskQueryKey),
  )
}

export function usePlannerTaskCursor(
  filters: TaskCursorListFilters,
  options: { enabled?: boolean } = {},
): UseQueryResult<TaskCursorListResponse, Error> {
  const plannerApi = usePlannerApiClient()
  const { apiConfig } = useSessionFeatureReadiness()
  const { sessionVersion } = useSessionAuth()
  const taskQueryKey = getPlannerTaskQueryKey(
    apiConfig?.workspaceId,
    sessionVersion,
  )
  const snapshot = useTaskSnapshot(taskQueryKey)

  return useQuery({
    enabled: options.enabled !== false && plannerApi !== null,
    queryFn: ({ signal }) => {
      if (!plannerApi) {
        throw new Error('Planner API is unavailable.')
      }

      return plannerApi.listTasksCursor(filters, signal)
    },
    queryKey: [...taskQueryKey, 'cursor', filters],
    select: (page) => mergeTaskPageWithSnapshot(page, snapshot ?? []),
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
  const { sessionVersion } = useSessionAuth()
  const taskQueryKey = getPlannerTaskQueryKey(
    apiConfig?.workspaceId,
    sessionVersion,
  )
  const snapshot = useTaskSnapshot(taskQueryKey)

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
      ...taskQueryKey,
      'cursor',
      'infinite',
      filters,
      options.initialCursor,
    ],
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) =>
        mergeTaskPageWithSnapshot(page, snapshot ?? []),
      ),
    }),
  })
}
