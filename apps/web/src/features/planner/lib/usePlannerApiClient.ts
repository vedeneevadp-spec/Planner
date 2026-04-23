import { useMemo } from 'react'

import { usePlannerSession, useSessionAuth } from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'

import { createPlannerApiClient, type PlannerApiClient } from './planner-api'

export function usePlannerApiClient(): PlannerApiClient | null {
  const { accessToken } = useSessionAuth()
  const { data: session } = usePlannerSession()

  return useMemo(() => {
    if (!session) {
      return null
    }

    return createPlannerApiClient({
      ...(accessToken ? { accessToken } : {}),
      actorUserId: session.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId: session.workspaceId,
    })
  }, [accessToken, session])
}
