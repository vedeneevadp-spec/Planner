import type { SessionRecoveryResult } from '../model/session-auth-context'
import type { StoredAuthSession } from './auth-session-storage'
import {
  ACCESS_TOKEN_EXPIRY_GRACE_MS,
  isAccessTokenUsable,
} from './session-auth-reducer'

export const DEFAULT_EXPIRED_SESSION_MESSAGE =
  'Сессия истекла или больше не принимается сервером. Войдите заново.'

export type NativeDeviceSessionKeepReason =
  | 'blocked_refresh_token'
  | 'missing_refresh_token'
  | 'retryable_refresh_error'
  | 'server_denied_refresh'
  | 'storage_empty_on_resume'

export type SessionAuthMachineEvent =
  | {
      type: 'auth.bootstrap_requested'
      isAuthEnabled: boolean
      nativeAppIsActive: boolean
      nativeRuntime: boolean
    }
  | {
      type: 'auth.native_app_state_changed'
      nativeAppIsActive: boolean
      nativeRuntime: boolean
    }
  | {
      type: 'auth.recovery_requested'
      blockedRefreshToken: string | null
      currentRefreshToken: string | null
      isAuthEnabled: boolean
      nativeRuntime: boolean
      storedSession: StoredAuthSession | null
    }
  | {
      type: 'auth.refresh_failed'
      error: unknown
      nativeRuntime: boolean
      refreshToken: string | null
      storedSession: StoredAuthSession | null
    }
  | {
      type: 'auth.refresh_storage_checked'
      error: unknown
      latestStoredSession: StoredAuthSession | null
      previousRefreshToken: string | null
      storedSession: StoredAuthSession | null
    }
  | {
      type: 'auth.refresh_timer_changed'
      blockedRefreshToken: string | null
      expiresAt: string | null
      isAuthEnabled: boolean
      nativeRuntime: boolean
      nowMs: number
      refreshToken: string | null
    }
  | {
      type: 'auth.restore_requested'
      currentHasAccessToken: boolean
      isAuthEnabled: boolean
      nativeRuntime: boolean
      storedSession: StoredAuthSession | null
    }

export type SessionAuthMachineCommand =
  | {
      type: 'clear_expired_session'
      notice: string
      result: Extract<SessionRecoveryResult, 'signed_out'>
    }
  | {
      type: 'clear_session'
      result: Extract<SessionRecoveryResult, 'signed_out'>
    }
  | {
      type: 'commit_stored_session'
      result: Extract<SessionRecoveryResult, 'recovered'>
      storedSession: StoredAuthSession
    }
  | {
      type: 'finish_loading'
    }
  | {
      type: 'keep_device_session'
      blockRefreshToken?: string | null | undefined
      error: unknown
      logMessage: string
      reason: NativeDeviceSessionKeepReason
      result: Extract<SessionRecoveryResult, 'deferred'>
      storedSession: StoredAuthSession | null
    }
  | {
      type: 'none'
      result?: SessionRecoveryResult | undefined
    }
  | {
      type: 'read_latest_native_session'
      error: unknown
      previousRefreshToken: string
      storedSession: StoredAuthSession | null
    }
  | {
      type: 'recover_session'
    }
  | {
      type: 'request_refresh'
      refreshToken: string | null
    }
  | {
      type: 'restore_latest_stored_session'
      result: Extract<SessionRecoveryResult, 'deferred' | 'recovered'>
      storedSession: StoredAuthSession
    }
  | {
      type: 'restore_session'
    }
  | {
      type: 'schedule_refresh'
      delayMs: number
    }

export function transitionSessionAuthMachine(
  event: SessionAuthMachineEvent,
): SessionAuthMachineCommand {
  switch (event.type) {
    case 'auth.bootstrap_requested':
      if (!event.isAuthEnabled) {
        return none('signed_out')
      }

      if (event.nativeRuntime && !event.nativeAppIsActive) {
        return {
          type: 'finish_loading',
        }
      }

      return {
        type: 'restore_session',
      }

    case 'auth.native_app_state_changed':
      if (!event.nativeRuntime || !event.nativeAppIsActive) {
        return none()
      }

      return {
        type: 'restore_session',
      }

    case 'auth.restore_requested':
      if (!event.isAuthEnabled) {
        return none('signed_out')
      }

      if (!event.storedSession) {
        if (event.nativeRuntime && event.currentHasAccessToken) {
          return keepDeviceSession({
            error: new Error('Native auth storage returned no session.'),
            logMessage: 'Native auth session restore skipped.',
            reason: 'storage_empty_on_resume',
            storedSession: null,
          })
        }

        return clearSession()
      }

      if (!event.nativeRuntime && event.storedSession.refreshToken) {
        return {
          type: 'recover_session',
        }
      }

      if (isAccessTokenUsable(event.storedSession.expiresAt)) {
        return {
          result: 'recovered',
          storedSession: event.storedSession,
          type: 'commit_stored_session',
        }
      }

      return {
        type: 'recover_session',
      }

    case 'auth.recovery_requested': {
      if (!event.isAuthEnabled) {
        return none('signed_out')
      }

      const refreshToken = event.nativeRuntime
        ? (event.storedSession?.refreshToken ?? event.currentRefreshToken)
        : (event.storedSession?.refreshToken ?? null)

      if (event.nativeRuntime && !refreshToken) {
        if (event.storedSession) {
          return keepDeviceSession({
            error: new Error('Native auth session has no refresh token.'),
            logMessage: 'Native auth session refresh skipped.',
            reason: 'missing_refresh_token',
            storedSession: event.storedSession,
          })
        }

        return clearSession()
      }

      if (
        event.nativeRuntime &&
        refreshToken &&
        event.blockedRefreshToken === refreshToken
      ) {
        return keepDeviceSession({
          error: new Error('Native auth refresh is blocked for this token.'),
          logMessage:
            'Native auth session refresh skipped for a blocked token.',
          reason: 'blocked_refresh_token',
          storedSession: event.storedSession,
        })
      }

      return {
        refreshToken,
        type: 'request_refresh',
      }
    }

    case 'auth.refresh_failed':
      if (event.nativeRuntime && isRetryableAuthError(event.error)) {
        return keepDeviceSession({
          error: event.error,
          logMessage: 'Auth session refresh deferred to device session.',
          reason: 'retryable_refresh_error',
          storedSession: event.storedSession,
        })
      }

      if (event.nativeRuntime && event.refreshToken) {
        return {
          error: event.error,
          previousRefreshToken: event.refreshToken,
          storedSession: event.storedSession,
          type: 'read_latest_native_session',
        }
      }

      return clearExpiredSession()

    case 'auth.refresh_storage_checked':
      if (
        event.latestStoredSession?.refreshToken &&
        event.latestStoredSession.refreshToken !== event.previousRefreshToken
      ) {
        return {
          result: isAccessTokenUsable(event.latestStoredSession.expiresAt)
            ? 'recovered'
            : 'deferred',
          storedSession: event.latestStoredSession,
          type: 'restore_latest_stored_session',
        }
      }

      if (
        shouldKeepNativeDeviceSessionAfterRefreshError(
          event.error,
          event.storedSession,
        )
      ) {
        return keepDeviceSession({
          blockRefreshToken: event.previousRefreshToken,
          error: event.error,
          logMessage:
            'Auth session refresh denied; keeping local device session.',
          reason: 'server_denied_refresh',
          storedSession: event.storedSession,
        })
      }

      return clearExpiredSession()

    case 'auth.refresh_timer_changed':
      if (
        !event.isAuthEnabled ||
        !event.expiresAt ||
        (event.nativeRuntime &&
          (!event.refreshToken ||
            event.blockedRefreshToken === event.refreshToken))
      ) {
        return none()
      }

      return {
        delayMs: Math.max(
          new Date(event.expiresAt).getTime() -
            event.nowMs -
            ACCESS_TOKEN_EXPIRY_GRACE_MS,
          5_000,
        ),
        type: 'schedule_refresh',
      }
  }
}

export function isRetryableAuthError(error: unknown): boolean {
  if (error instanceof DOMException || error instanceof TypeError) {
    return true
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status
    return (
      typeof status === 'number' &&
      (status === 0 || status === 408 || status === 429 || status >= 500)
    )
  }

  if (error instanceof Error) {
    return /failed to fetch|network|timeout/i.test(error.message)
  }

  return false
}

export function getAuthErrorKind(error: unknown): string {
  if (error instanceof DOMException) {
    return 'dom_exception'
  }

  if (error instanceof TypeError) {
    return 'network'
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status

    if (typeof status === 'number') {
      return `http_${status}`
    }
  }

  if (error instanceof Error && /timeout/i.test(error.message)) {
    return 'timeout'
  }

  return 'unknown'
}

function clearExpiredSession(): SessionAuthMachineCommand {
  return {
    notice: DEFAULT_EXPIRED_SESSION_MESSAGE,
    result: 'signed_out',
    type: 'clear_expired_session',
  }
}

function clearSession(): SessionAuthMachineCommand {
  return {
    result: 'signed_out',
    type: 'clear_session',
  }
}

function keepDeviceSession(input: {
  blockRefreshToken?: string | null | undefined
  error: unknown
  logMessage: string
  reason: NativeDeviceSessionKeepReason
  storedSession: StoredAuthSession | null
}): SessionAuthMachineCommand {
  return {
    ...input,
    result: 'deferred',
    type: 'keep_device_session',
  }
}

function none(result?: SessionRecoveryResult): SessionAuthMachineCommand {
  return {
    ...(result ? { result } : {}),
    type: 'none',
  }
}

function shouldKeepNativeDeviceSessionAfterRefreshError(
  error: unknown,
  storedSession: StoredAuthSession | null,
): boolean {
  return Boolean(storedSession) || isRetryableAuthError(error)
}
