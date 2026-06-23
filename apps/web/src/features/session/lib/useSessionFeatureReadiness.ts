import type { SessionResponse } from '@planner/contracts'
import { useCallback, useMemo } from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'
import {
  getDeviceTimeZone,
  getPlannerTimeZone,
} from '@/shared/time/time.service'

import { isUnauthorizedSessionApiError } from './session-api'
import {
  resolveSessionFeatureReadiness,
  resolveSessionReadiness,
  type ResolveSessionReadinessInput,
  type SessionReadiness,
} from './session-readiness'
import { usePlannerSession } from './usePlannerSession'
import { useSessionAuth } from './useSessionAuth'

export interface SessionFeatureApiConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  clientTimeZone: string
  workspaceId: string
}

export interface UseSessionFeatureReadinessOptions {
  enabled?: boolean | undefined
  hasCachedData?: boolean | undefined
}

export type SessionFeatureReadinessSnapshotOptions = Pick<
  UseSessionFeatureReadinessOptions,
  'hasCachedData'
>

export interface SessionFeatureReadinessResult {
  apiConfig: SessionFeatureApiConfig | null
  getReadiness: (
    options?: SessionFeatureReadinessSnapshotOptions,
  ) => SessionReadiness
  isApiEnabled: boolean
  readiness: SessionReadiness
  session: SessionResponse | undefined
  sessionQuery: ReturnType<typeof usePlannerSession>
  workspaceId: string
}

export function useSessionFeatureReadiness(
  options: UseSessionFeatureReadinessOptions = {},
): SessionFeatureReadinessResult {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const readinessInput = useMemo<ResolveSessionReadinessInput>(
    () => ({
      auth,
      hasCachedData: options.hasCachedData,
      hasPlannerSession: Boolean(session),
      hasPlannerSessionError: Boolean(sessionQuery.error),
      hasUnauthorizedPlannerSessionError: isUnauthorizedSessionApiError(
        sessionQuery.error,
      ),
      isPlannerSessionPending: sessionQuery.isPending,
    }),
    [
      auth,
      options.hasCachedData,
      session,
      sessionQuery.error,
      sessionQuery.isPending,
    ],
  )
  const { isApiEnabled, readiness } = resolveSessionFeatureReadiness({
    ...readinessInput,
    isFeatureEnabled: options.enabled,
  })
  const getReadiness = useCallback(
    (nextOptions: SessionFeatureReadinessSnapshotOptions = {}) =>
      resolveSessionReadiness({
        ...readinessInput,
        hasCachedData: nextOptions.hasCachedData ?? options.hasCachedData,
      }),
    [options.hasCachedData, readinessInput],
  )
  const apiConfig = useMemo<SessionFeatureApiConfig | null>(() => {
    if (!session || !isApiEnabled) {
      return null
    }

    return {
      ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
      actorUserId: session.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      clientTimeZone: getPlannerTimeZone({
        deviceTimeZone: getDeviceTimeZone(),
        timeZoneMode: session.userPreferences.timeZoneMode,
        userTimeZone: session.userPreferences.defaultTimeZone,
        workspaceTimeZone: session.workspaceSettings.defaultTimeZone,
      }),
      workspaceId: session.workspaceId,
    }
  }, [auth.accessToken, isApiEnabled, session])

  return {
    apiConfig,
    getReadiness,
    isApiEnabled,
    readiness,
    session,
    sessionQuery,
    workspaceId: session?.workspaceId ?? 'pending',
  }
}
