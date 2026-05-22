import type { SessionAuthLifecycleStatus } from '../model/session-auth-context'

export type AuthGateStatusPanel =
  | 'disabled_auth_configuration'
  | 'planner_loading'
  | 'planner_session_error'
  | 'restore_required'
  | 'restoring_saved_sign_in'
  | 'session_ended'
  | 'unauthenticated_runtime_unavailable'

export type AuthGateView =
  | {
      type: 'auth_form'
    }
  | {
      type: 'children'
    }
  | {
      panel: AuthGateStatusPanel
      type: 'status_panel'
    }

export interface ResolveAuthGateViewInput {
  accessToken: string | null
  canResolvePlannerSession: boolean
  canUseProtectedApi: boolean
  hasAuthNotice: boolean
  hasPlannerSession: boolean
  hasPlannerSessionError: boolean
  hasUnauthorizedPlannerSessionError: boolean
  isAuthEnabled: boolean
  isLoading: boolean
  isNativeSessionRuntime: boolean
  isPasswordRecovery: boolean
  isPlannerSessionPending: boolean
  isRecovering: boolean
  lifecycleStatus: SessionAuthLifecycleStatus
}

export function resolveAuthGateView(
  input: ResolveAuthGateViewInput,
): AuthGateView {
  if (!input.isAuthEnabled && !input.canResolvePlannerSession) {
    return statusPanel('disabled_auth_configuration')
  }

  if (
    !input.isPasswordRecovery &&
    input.isAuthEnabled &&
    input.lifecycleStatus === 'restoring' &&
    input.hasPlannerSession &&
    !input.hasAuthNotice &&
    input.isNativeSessionRuntime
  ) {
    return children()
  }

  if (input.lifecycleStatus === 'restoring' || input.isLoading) {
    return statusPanel('restoring_saved_sign_in')
  }

  if (
    !input.isPasswordRecovery &&
    input.hasPlannerSession &&
    !input.hasAuthNotice &&
    input.canUseProtectedApi
  ) {
    return children()
  }

  if (
    !input.isPasswordRecovery &&
    input.hasPlannerSession &&
    !input.hasAuthNotice &&
    input.lifecycleStatus === 'deferred' &&
    input.isNativeSessionRuntime
  ) {
    return children()
  }

  if (
    !input.isPasswordRecovery &&
    input.hasPlannerSession &&
    !input.hasAuthNotice &&
    input.isAuthEnabled &&
    !input.accessToken
  ) {
    return statusPanel('restore_required')
  }

  if (!input.isPasswordRecovery && input.canResolvePlannerSession) {
    if (input.hasUnauthorizedPlannerSessionError) {
      if (input.isAuthEnabled) {
        return input.isRecovering
          ? statusPanel('restoring_saved_sign_in')
          : statusPanel('session_ended')
      }

      return statusPanel('unauthenticated_runtime_unavailable')
    }

    if (input.isPlannerSessionPending) {
      return statusPanel('planner_loading')
    }

    if (input.hasPlannerSessionError && !input.hasPlannerSession) {
      return statusPanel('planner_session_error')
    }

    if (input.hasPlannerSession) {
      return children()
    }

    return statusPanel('planner_loading')
  }

  return {
    type: 'auth_form',
  }
}

function children(): AuthGateView {
  return {
    type: 'children',
  }
}

function statusPanel(panel: AuthGateStatusPanel): AuthGateView {
  return {
    panel,
    type: 'status_panel',
  }
}
