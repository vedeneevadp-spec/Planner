import type {
  SessionAuthLifecycleStatus,
  SessionAuthState,
} from '../model/session-auth-context'

export type SessionReadinessStatus =
  | 'blockedAuth'
  | 'offlineWithCache'
  | 'ready'
  | 'restoringWithCache'
  | 'serverError'

export type SessionReadinessReason =
  | 'auth_deferred'
  | 'auth_restoring'
  | 'no_session'
  | 'planner_error'
  | 'planner_pending'
  | 'ready'
  | 'unauthorized'

export interface SessionReadiness {
  canReadCachedData: boolean
  canRenderAppContent: boolean
  canUseProtectedApi: boolean
  canWriteProtectedData: boolean
  reason: SessionReadinessReason
  status: SessionReadinessStatus
}

export interface ResolveSessionReadinessInput {
  auth: Pick<
    SessionAuthState,
    'canUseProtectedApi' | 'isAuthEnabled' | 'isLoading' | 'lifecycleStatus'
  >
  hasCachedData?: boolean | undefined
  hasPlannerSession: boolean
  hasPlannerSessionError?: boolean | undefined
  hasUnauthorizedPlannerSessionError?: boolean | undefined
  isPlannerSessionPending: boolean
}

export interface ResolveSessionFeatureReadinessInput extends ResolveSessionReadinessInput {
  isFeatureEnabled?: boolean | undefined
}

export interface SessionReadinessConnectionView {
  errorMessage: string | null
  label: 'Connected' | 'Connection issue' | 'Loading' | 'Syncing'
}

export interface SessionFeatureReadiness {
  isApiEnabled: boolean
  readiness: SessionReadiness
}

export function resolveSessionReadiness(
  input: ResolveSessionReadinessInput,
): SessionReadiness {
  const hasReadableCache =
    input.hasPlannerSession || Boolean(input.hasCachedData)
  const authLifecycleStatus = input.auth.lifecycleStatus
  const authIsRestoring =
    authLifecycleStatus === 'restoring' || input.auth.isLoading

  if (authIsRestoring) {
    return createReadiness({
      canReadCachedData: hasReadableCache,
      canUseProtectedApi: false,
      reason: 'auth_restoring',
      status: hasReadableCache ? 'restoringWithCache' : 'blockedAuth',
    })
  }

  if (authLifecycleStatus === 'deferred') {
    return createReadiness({
      canReadCachedData: hasReadableCache,
      canUseProtectedApi: false,
      reason: 'auth_deferred',
      status: hasReadableCache ? 'offlineWithCache' : 'blockedAuth',
    })
  }

  if (input.hasUnauthorizedPlannerSessionError) {
    return createReadiness({
      canReadCachedData: hasReadableCache,
      canUseProtectedApi: false,
      reason: 'unauthorized',
      status: hasReadableCache ? 'offlineWithCache' : 'blockedAuth',
    })
  }

  if (input.auth.canUseProtectedApi && input.hasPlannerSession) {
    return createReadiness({
      canReadCachedData: true,
      canUseProtectedApi: true,
      reason: 'ready',
      status: 'ready',
    })
  }

  if (input.hasPlannerSessionError) {
    return createReadiness({
      canReadCachedData: hasReadableCache,
      canUseProtectedApi: input.auth.canUseProtectedApi,
      reason: 'planner_error',
      status: hasReadableCache ? 'offlineWithCache' : 'serverError',
    })
  }

  if (input.isPlannerSessionPending) {
    return createReadiness({
      canReadCachedData: hasReadableCache,
      canUseProtectedApi: input.auth.canUseProtectedApi,
      reason: 'planner_pending',
      status: hasReadableCache ? 'restoringWithCache' : 'blockedAuth',
    })
  }

  if (hasReadableCache) {
    return createReadiness({
      canReadCachedData: true,
      canUseProtectedApi: input.auth.canUseProtectedApi,
      reason: input.auth.canUseProtectedApi ? 'ready' : 'no_session',
      status: input.auth.canUseProtectedApi ? 'ready' : 'offlineWithCache',
    })
  }

  return createReadiness({
    canReadCachedData: false,
    canUseProtectedApi: input.auth.canUseProtectedApi,
    reason: 'no_session',
    status: input.auth.canUseProtectedApi ? 'serverError' : 'blockedAuth',
  })
}

export function resolveSessionFeatureReadiness(
  input: ResolveSessionFeatureReadinessInput,
): SessionFeatureReadiness {
  const readiness = resolveSessionReadiness(input)

  return {
    isApiEnabled:
      input.isFeatureEnabled !== false &&
      input.hasPlannerSession &&
      readiness.canWriteProtectedData,
    readiness,
  }
}

export function getSessionReadinessConnectionView(
  readiness: SessionReadiness,
  input: {
    featureErrorMessage?: string | null | undefined
    isFeatureLoading?: boolean | undefined
    isFeatureSyncing?: boolean | undefined
  } = {},
): SessionReadinessConnectionView {
  if (input.featureErrorMessage) {
    return {
      errorMessage: input.featureErrorMessage,
      label: 'Connection issue',
    }
  }

  if (
    readiness.status === 'blockedAuth' &&
    readiness.reason === 'auth_restoring'
  ) {
    return {
      errorMessage: null,
      label: 'Loading',
    }
  }

  if (
    readiness.status === 'blockedAuth' ||
    readiness.status === 'offlineWithCache' ||
    readiness.status === 'serverError'
  ) {
    return {
      errorMessage: getSessionReadinessErrorMessage(readiness),
      label: 'Connection issue',
    }
  }

  if (
    readiness.status === 'restoringWithCache' ||
    input.isFeatureLoading === true
  ) {
    return {
      errorMessage: null,
      label: 'Loading',
    }
  }

  if (input.isFeatureSyncing) {
    return {
      errorMessage: null,
      label: 'Syncing',
    }
  }

  return {
    errorMessage: null,
    label: 'Connected',
  }
}

export function getSessionReadinessErrorMessage(
  readiness: Pick<SessionReadiness, 'reason' | 'status'>,
): string | null {
  switch (readiness.reason) {
    case 'auth_deferred':
    case 'unauthorized':
      return 'Auth session unavailable'

    case 'planner_error':
      return readiness.status === 'offlineWithCache'
        ? 'Using cached data'
        : 'Planner session unavailable'

    case 'no_session':
      return readiness.status === 'blockedAuth'
        ? 'Auth session unavailable'
        : 'Planner session unavailable'

    case 'auth_restoring':
    case 'planner_pending':
    case 'ready':
      return null
  }
}

export function isSessionAuthLifecycleStatus(
  value: unknown,
): value is SessionAuthLifecycleStatus {
  return (
    value === 'authenticated' ||
    value === 'deferred' ||
    value === 'disabled' ||
    value === 'restoring' ||
    value === 'signed_out'
  )
}

function createReadiness(input: {
  canReadCachedData: boolean
  canUseProtectedApi: boolean
  reason: SessionReadinessReason
  status: SessionReadinessStatus
}): SessionReadiness {
  return {
    canReadCachedData: input.canReadCachedData,
    canRenderAppContent:
      input.status === 'ready' ||
      input.status === 'restoringWithCache' ||
      input.status === 'offlineWithCache',
    canUseProtectedApi: input.canUseProtectedApi,
    canWriteProtectedData: input.status === 'ready' && input.canUseProtectedApi,
    reason: input.reason,
    status: input.status,
  }
}
