import {
  type ClientDiagnosticDetails,
  type ClientDiagnosticEventLevel,
  type ClientDiagnosticEventName,
  recordClientEvent,
} from '@/shared/lib/observability'

import {
  getAuthErrorKind,
  isRetryableAuthError,
  type NativeDeviceSessionKeepReason,
  type SessionAuthMachineCommand,
} from './session-auth-machine'

type AuthDecisionEventName = Extract<
  ClientDiagnosticEventName,
  | 'auth_recovery_decision'
  | 'auth_refresh_storage_decision'
  | 'auth_restore_decision'
>

export function recordAuthDecisionEvent(
  name: AuthDecisionEventName,
  command: SessionAuthMachineCommand,
  details: ClientDiagnosticDetails,
): void {
  recordClientEvent(
    name,
    {
      ...details,
      ...getAuthCommandDiagnosticDetails(command),
    },
    { level: getAuthCommandDiagnosticLevel(command) },
  )
}

function getAuthCommandDiagnosticDetails(
  command: SessionAuthMachineCommand,
): ClientDiagnosticDetails {
  const details: ClientDiagnosticDetails = {
    command: command.type,
  }

  if ('result' in command && command.result) {
    details.result = command.result
  }

  switch (command.type) {
    case 'keep_device_session':
      details.category = getDeviceSessionKeepCategory(command.reason)
      details.errorKind = getAuthErrorKind(command.error)
      details.hasStoredSession = Boolean(command.storedSession)
      details.reason = command.reason
      return details

    case 'read_latest_native_session':
      details.hasPreviousRefreshToken = true
      return details

    case 'request_refresh':
      details.hasBodyRefreshToken = Boolean(command.refreshToken)
      details.tokenTransport = command.refreshToken ? 'body' : 'cookie'
      return details

    case 'restore_latest_stored_session':
      details.category = 'stale_refresh_replay'
      return details

    case 'schedule_refresh':
      details.delayMs = command.delayMs
      return details

    default:
      return details
  }
}

function getAuthCommandDiagnosticLevel(
  command: SessionAuthMachineCommand,
): ClientDiagnosticEventLevel {
  switch (command.type) {
    case 'clear_expired_session':
    case 'clear_session':
    case 'keep_device_session':
      return 'warn'

    default:
      return 'info'
  }
}

export function getDeviceSessionKeepCategory(
  reason: NativeDeviceSessionKeepReason,
): string {
  switch (reason) {
    case 'retryable_refresh_error':
      return 'retryable'

    case 'server_denied_refresh':
      return 'revoked_or_denied'

    case 'storage_empty_on_resume':
      return 'storage_unavailable'

    case 'blocked_refresh_token':
      return 'blocked'

    case 'missing_refresh_token':
      return 'missing_refresh_token'
  }
}

export function getRefreshFailureCategory(error: unknown): string {
  if (isRetryableAuthError(error)) {
    return 'retryable'
  }

  const status = getAuthErrorStatus(error)

  if (status === 401 || status === 403) {
    return 'revoked_or_denied'
  }

  if (status !== null) {
    return 'http_error'
  }

  return 'unknown'
}

export function getRefreshStorageDecisionCategory(
  command: SessionAuthMachineCommand,
): string {
  switch (command.type) {
    case 'restore_latest_stored_session':
      return 'stale_refresh_replay'

    case 'keep_device_session':
      return getDeviceSessionKeepCategory(command.reason)

    case 'clear_expired_session':
      return 'expired_or_unrecoverable'

    default:
      return command.type
  }
}

export function getAuthErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null
  }

  const { status } = error

  return typeof status === 'number' ? status : null
}
