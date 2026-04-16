import { useQuery } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { resolvePlannerSession } from './session-api'

export const PLANNER_SESSION_QUERY_KEY = [
  'planner',
  'session',
  plannerApiConfig.actorUserIdOverride ?? 'default',
  plannerApiConfig.workspaceIdOverride ?? 'default',
] as const

export function usePlannerSession() {
  return useQuery({
    queryFn: ({ signal }) => resolvePlannerSession(signal),
    queryKey: PLANNER_SESSION_QUERY_KEY,
    staleTime: 5 * 60_000,
  })
}
