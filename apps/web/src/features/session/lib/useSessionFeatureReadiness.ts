import type { SessionResponse } from '@planner/contracts'
import { useMemo } from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { isUnauthorizedSessionApiError } from './session-api'
import {
  resolveSessionFeatureReadiness,
  type SessionReadiness,
} from './session-readiness'
import { usePlannerSession } from './usePlannerSession'
import { useSessionAuth } from './useSessionAuth'

export interface SessionFeatureApiConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface UseSessionFeatureReadinessOptions {
  enabled?: boolean | undefined
  hasCachedData?: boolean | undefined
}

export interface SessionFeatureReadinessResult {
  apiConfig: SessionFeatureApiConfig | null
  isApiEnabled: boolean
  readiness: SessionReadiness
  session: SessionResponse | undefined
  workspaceId: string
}

export function useSessionFeatureReadiness(
  options: UseSessionFeatureReadinessOptions = {},
): SessionFeatureReadinessResult {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const { isApiEnabled, readiness } = resolveSessionFeatureReadiness({
    auth,
    hasCachedData: options.hasCachedData,
    hasPlannerSession: Boolean(session),
    hasPlannerSessionError: Boolean(sessionQuery.error),
    hasUnauthorizedPlannerSessionError: isUnauthorizedSessionApiError(
      sessionQuery.error,
    ),
    isFeatureEnabled: options.enabled,
    isPlannerSessionPending: sessionQuery.isPending,
  })
  const apiConfig = useMemo<SessionFeatureApiConfig | null>(() => {
    if (!session || !isApiEnabled) {
      return null
    }

    return {
      ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
      actorUserId: session.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId: session.workspaceId,
    }
  }, [auth.accessToken, isApiEnabled, session])

  return {
    apiConfig,
    isApiEnabled,
    readiness,
    session,
    workspaceId: session?.workspaceId ?? 'pending',
  }
}
