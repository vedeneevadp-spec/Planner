import { useMemo } from 'react'

import {
  isUnauthorizedSessionApiError,
  resolveSessionReadiness,
  usePlannerSession,
  useSessionAuth,
} from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'

import { createPlannerApiClient, type PlannerApiClient } from './planner-api'

export function usePlannerApiClient(): PlannerApiClient | null {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const readiness = resolveSessionReadiness({
    auth,
    hasPlannerSession: Boolean(session),
    hasPlannerSessionError: Boolean(sessionQuery.error),
    hasUnauthorizedPlannerSessionError: isUnauthorizedSessionApiError(
      sessionQuery.error,
    ),
    isPlannerSessionPending: sessionQuery.isPending,
  })

  return useMemo(() => {
    if (!session || !readiness.canUseProtectedApi) {
      return null
    }

    return createPlannerApiClient({
      ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
      actorUserId: session.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId: session.workspaceId,
    })
  }, [auth.accessToken, readiness.canUseProtectedApi, session])
}
