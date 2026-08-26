import type {
  TaskCursorListFilters,
  TaskCursorListResponse,
} from '@planner/contracts'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

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
