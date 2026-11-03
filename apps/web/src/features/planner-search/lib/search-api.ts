import {
  type PlannerSearchQuery,
  plannerSearchResponseSchema,
} from '@planner/contracts'

import { PlannerApiError } from '@/features/planner'
import {
  type ApiClientConfig,
  createApiRequester,
} from '@/shared/lib/api-client'

export function searchPlanner(
  config: ApiClientConfig,
  query: PlannerSearchQuery,
  signal: AbortSignal,
) {
  const { request } = createApiRequester(
    config,
    (message, options) => new PlannerApiError(message, options),
  )
  return request({
    path: '/api/v1/planner-search',
    query: { ...query, includeCompleted: String(query.includeCompleted) },
    responseSchema: plannerSearchResponseSchema,
    signal,
  })
}
