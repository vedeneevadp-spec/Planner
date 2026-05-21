import type {
  SessionAuthLifecycleStatus,
  SessionAuthState,
} from '../model/session-auth-context'

export interface SessionAuthLifecycleInput {
  accessToken: string | null
  email: string | null
  isAuthEnabled: boolean
  isLoading: boolean
  userId: string | null
}

export function resolveSessionAuthLifecycleStatus(
  input: SessionAuthLifecycleInput,
): SessionAuthLifecycleStatus {
  if (!input.isAuthEnabled) {
    return 'disabled'
  }

  if (input.isLoading) {
    return 'restoring'
  }

  if (input.accessToken) {
    return 'authenticated'
  }

  if (input.userId || input.email) {
    return 'deferred'
  }

  return 'signed_out'
}

export function canUseProtectedSessionApi(input: {
  accessToken: string | null
  isAuthEnabled: boolean
}): boolean {
  return !input.isAuthEnabled || Boolean(input.accessToken)
}

export function assertCanUseProtectedSessionApi(
  auth: Pick<SessionAuthState, 'canUseProtectedApi'>,
): void {
  if (!auth.canUseProtectedApi) {
    throw new Error('Auth session is not ready.')
  }
}
