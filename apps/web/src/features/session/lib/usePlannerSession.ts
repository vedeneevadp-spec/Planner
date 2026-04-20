import { useQuery } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { resolvePlannerSession } from './session-api'
import { useSessionAuth } from './useSessionAuth'

export function usePlannerSession() {
  const auth = useSessionAuth()

  return useQuery({
    enabled: !auth.isAuthEnabled || Boolean(auth.accessToken),
    queryFn: ({ signal }) =>
      resolvePlannerSession({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        signal,
      }),
    queryKey: [
      'planner',
      'session',
      auth.userId ?? 'anonymous',
      plannerApiConfig.actorUserIdOverride ?? 'default',
      plannerApiConfig.workspaceIdOverride ?? 'default',
    ] as const,
    staleTime: 5 * 60_000,
  })
}
