import { describe, expect, it } from 'vitest'

import type { StoredAuthSession } from './auth-session-storage'
import {
  getAuthErrorKind,
  type SessionAuthMachineCommand,
  type SessionAuthMachineEvent,
  transitionSessionAuthMachine,
} from './session-auth-machine'

describe('session auth machine', () => {
  it.each([
    {
      event: {
        isAuthEnabled: false,
        nativeAppIsActive: true,
        nativeRuntime: true,
        type: 'auth.bootstrap_requested',
      },
      expected: {
        result: 'signed_out',
        type: 'none',
      },
      name: 'skips bootstrap when auth is disabled',
    },
    {
      event: {
        isAuthEnabled: true,
        nativeAppIsActive: false,
        nativeRuntime: true,
        type: 'auth.bootstrap_requested',
      },
      expected: {
        type: 'finish_loading',
      },
      name: 'finishes loading while native app is inactive',
    },
    {
      event: {
        isAuthEnabled: true,
        nativeAppIsActive: true,
        nativeRuntime: true,
        type: 'auth.bootstrap_requested',
      },
      expected: {
        type: 'restore_session',
      },
      name: 'restores on active native bootstrap',
    },
    {
      event: {
        nativeAppIsActive: true,
        nativeRuntime: true,
        type: 'auth.native_app_state_changed',
      },
      expected: {
        type: 'restore_session',
      },
      name: 'restores on native resume',
    },
    {
      event: {
        nativeAppIsActive: false,
        nativeRuntime: true,
        type: 'auth.native_app_state_changed',
      },
      expected: {
        type: 'none',
      },
      name: 'ignores native background transition',
    },
  ] satisfies MachineCase[])('$name', ({ event, expected }) => {
    expect(toCommandSummary(transitionSessionAuthMachine(event))).toEqual(
      expected,
    )
  })

  it.each([
    {
      event: {
        currentHasAccessToken: true,
        isAuthEnabled: false,
        nativeRuntime: true,
        storedSession: null,
        type: 'auth.restore_requested',
      },
      expected: {
        result: 'signed_out',
        type: 'none',
      },
      name: 'skips restore when auth is disabled',
    },
    {
      event: {
        currentHasAccessToken: true,
        isAuthEnabled: true,
        nativeRuntime: true,
        storedSession: null,
        type: 'auth.restore_requested',
      },
      expected: {
        reason: 'storage_empty_on_resume',
        result: 'deferred',
        type: 'keep_device_session',
      },
      name: 'keeps current native session when storage is temporarily empty',
    },
    {
      event: {
        currentHasAccessToken: false,
        isAuthEnabled: true,
        nativeRuntime: true,
        storedSession: null,
        type: 'auth.restore_requested',
      },
      expected: {
        result: 'signed_out',
        type: 'clear_session',
      },
      name: 'clears restore when storage is empty without an active snapshot',
    },
    {
      event: {
        currentHasAccessToken: false,
        isAuthEnabled: true,
        nativeRuntime: false,
        storedSession: createUsableStoredSession({
          refreshToken: 'browser-refresh-token',
        }),
        type: 'auth.restore_requested',
      },
      expected: {
        type: 'recover_session',
      },
      name: 'recovers browser sessions that still have a refresh token',
    },
    {
      event: {
        currentHasAccessToken: false,
        isAuthEnabled: true,
        nativeRuntime: true,
        storedSession: createUsableStoredSession(),
        type: 'auth.restore_requested',
      },
      expected: {
        result: 'recovered',
        storedAccessToken: 'access-token',
        type: 'commit_stored_session',
      },
      name: 'commits a usable stored session',
    },
    {
      event: {
        currentHasAccessToken: false,
        isAuthEnabled: true,
        nativeRuntime: true,
        storedSession: createExpiredStoredSession(),
        type: 'auth.restore_requested',
      },
      expected: {
        type: 'recover_session',
      },
      name: 'recovers an expired stored session',
    },
  ] satisfies MachineCase[])('$name', ({ event, expected }) => {
    expect(toCommandSummary(transitionSessionAuthMachine(event))).toEqual(
      expected,
    )
  })

  it.each([
    {
      event: {
        blockedRefreshToken: null,
        currentRefreshToken: null,
        isAuthEnabled: false,
        nativeRuntime: true,
        storedSession: null,
        type: 'auth.recovery_requested',
      },
      expected: {
        result: 'signed_out',
        type: 'none',
      },
      name: 'skips recovery when auth is disabled',
    },
    {
      event: {
        blockedRefreshToken: null,
        currentRefreshToken: null,
        isAuthEnabled: true,
        nativeRuntime: true,
        storedSession: createStoredSession({ refreshToken: undefined }),
        type: 'auth.recovery_requested',
      },
      expected: {
        reason: 'missing_refresh_token',
        result: 'deferred',
        type: 'keep_device_session',
      },
      name: 'keeps native session when refresh token is missing',
    },
    {
      event: {
        blockedRefreshToken: null,
        currentRefreshToken: null,
        isAuthEnabled: true,
        nativeRuntime: true,
        storedSession: null,
        type: 'auth.recovery_requested',
      },
      expected: {
        result: 'signed_out',
        type: 'clear_session',
      },
      name: 'clears native recovery without any refresh token source',
    },
    {
      event: {
        blockedRefreshToken: 'refresh-token',
        currentRefreshToken: 'refresh-token',
        isAuthEnabled: true,
        nativeRuntime: true,
        storedSession: null,
        type: 'auth.recovery_requested',
      },
      expected: {
        reason: 'blocked_refresh_token',
        result: 'deferred',
        type: 'keep_device_session',
      },
      name: 'keeps native session when token is blocked',
    },
    {
      event: {
        blockedRefreshToken: null,
        currentRefreshToken: 'current-refresh-token',
        isAuthEnabled: true,
        nativeRuntime: true,
        storedSession: null,
        type: 'auth.recovery_requested',
      },
      expected: {
        refreshToken: 'current-refresh-token',
        type: 'request_refresh',
      },
      name: 'uses current native refresh token when storage is unavailable',
    },
    {
      event: {
        blockedRefreshToken: null,
        currentRefreshToken: null,
        isAuthEnabled: true,
        nativeRuntime: false,
        storedSession: null,
        type: 'auth.recovery_requested',
      },
      expected: {
        refreshToken: null,
        type: 'request_refresh',
      },
      name: 'lets browser cookie transport refresh without a body token',
    },
  ] satisfies MachineCase[])('$name', ({ event, expected }) => {
    expect(toCommandSummary(transitionSessionAuthMachine(event))).toEqual(
      expected,
    )
  })

  it.each([
    {
      event: {
        error: new TypeError('Network request failed'),
        nativeRuntime: true,
        refreshToken: 'refresh-token',
        storedSession: createExpiredStoredSession(),
        type: 'auth.refresh_failed',
      },
      expected: {
        reason: 'retryable_refresh_error',
        result: 'deferred',
        type: 'keep_device_session',
      },
      name: 'defers native refresh on retryable failure',
    },
    {
      event: {
        error: {
          status: 401,
        },
        nativeRuntime: true,
        refreshToken: 'refresh-token',
        storedSession: createExpiredStoredSession(),
        type: 'auth.refresh_failed',
      },
      expected: {
        previousRefreshToken: 'refresh-token',
        type: 'read_latest_native_session',
      },
      name: 'checks native storage after non-retryable refresh failure',
    },
    {
      event: {
        error: {
          status: 401,
        },
        nativeRuntime: false,
        refreshToken: null,
        storedSession: null,
        type: 'auth.refresh_failed',
      },
      expected: {
        result: 'signed_out',
        type: 'clear_expired_session',
      },
      name: 'expires browser session after refresh failure',
    },
    {
      event: {
        error: {
          status: 401,
        },
        latestStoredSession: createUsableStoredSession({
          refreshToken: 'new-refresh-token',
        }),
        previousRefreshToken: 'old-refresh-token',
        storedSession: createExpiredStoredSession({
          refreshToken: 'old-refresh-token',
        }),
        type: 'auth.refresh_storage_checked',
      },
      expected: {
        result: 'recovered',
        storedAccessToken: 'access-token',
        type: 'restore_latest_stored_session',
      },
      name: 'uses newer native storage snapshot after stale refresh failure',
    },
    {
      event: {
        error: {
          status: 401,
        },
        latestStoredSession: null,
        previousRefreshToken: 'old-refresh-token',
        storedSession: createExpiredStoredSession({
          refreshToken: 'old-refresh-token',
        }),
        type: 'auth.refresh_storage_checked',
      },
      expected: {
        blockRefreshToken: 'old-refresh-token',
        reason: 'server_denied_refresh',
        result: 'deferred',
        type: 'keep_device_session',
      },
      name: 'blocks denied native refresh token and keeps device session',
    },
    {
      event: {
        error: {
          status: 401,
        },
        latestStoredSession: null,
        previousRefreshToken: 'old-refresh-token',
        storedSession: null,
        type: 'auth.refresh_storage_checked',
      },
      expected: {
        result: 'signed_out',
        type: 'clear_expired_session',
      },
      name: 'expires native session when nothing remains to keep',
    },
  ] satisfies MachineCase[])('$name', ({ event, expected }) => {
    expect(toCommandSummary(transitionSessionAuthMachine(event))).toEqual(
      expected,
    )
  })

  it.each([
    {
      event: {
        blockedRefreshToken: null,
        expiresAt: null,
        isAuthEnabled: true,
        nativeRuntime: false,
        nowMs: BASE_TIME_MS,
        refreshToken: null,
        type: 'auth.refresh_timer_changed',
      },
      expected: {
        type: 'none',
      },
      name: 'does not schedule without an expiry',
    },
    {
      event: {
        blockedRefreshToken: 'refresh-token',
        expiresAt: new Date(BASE_TIME_MS + 300_000).toISOString(),
        isAuthEnabled: true,
        nativeRuntime: true,
        nowMs: BASE_TIME_MS,
        refreshToken: 'refresh-token',
        type: 'auth.refresh_timer_changed',
      },
      expected: {
        type: 'none',
      },
      name: 'does not schedule native refresh for a blocked token',
    },
    {
      event: {
        blockedRefreshToken: null,
        expiresAt: new Date(BASE_TIME_MS + 120_000).toISOString(),
        isAuthEnabled: true,
        nativeRuntime: true,
        nowMs: BASE_TIME_MS,
        refreshToken: 'refresh-token',
        type: 'auth.refresh_timer_changed',
      },
      expected: {
        delayMs: 90_000,
        type: 'schedule_refresh',
      },
      name: 'schedules refresh before expiry grace window',
    },
    {
      event: {
        blockedRefreshToken: null,
        expiresAt: new Date(BASE_TIME_MS + 10_000).toISOString(),
        isAuthEnabled: true,
        nativeRuntime: false,
        nowMs: BASE_TIME_MS,
        refreshToken: null,
        type: 'auth.refresh_timer_changed',
      },
      expected: {
        delayMs: 5_000,
        type: 'schedule_refresh',
      },
      name: 'uses minimum refresh delay when already inside grace window',
    },
  ] satisfies MachineCase[])('$name', ({ event, expected }) => {
    expect(toCommandSummary(transitionSessionAuthMachine(event))).toEqual(
      expected,
    )
  })

  it.each([
    {
      error: new DOMException('Storage unavailable'),
      expected: 'dom_exception',
      name: 'DOMException',
    },
    {
      error: new TypeError('Network request failed'),
      expected: 'network',
      name: 'TypeError',
    },
    {
      error: {
        status: 503,
      },
      expected: 'http_503',
      name: 'HTTP status',
    },
    {
      error: new Error('Request timeout'),
      expected: 'timeout',
      name: 'timeout error',
    },
  ])('classifies $name auth errors', ({ error, expected }) => {
    expect(getAuthErrorKind(error)).toBe(expected)
  })
})

const BASE_TIME_MS = Date.UTC(2026, 0, 1, 12)

type MachineCase = {
  event: SessionAuthMachineEvent
  expected: CommandSummary
  name: string
}

type CommandSummary = {
  blockRefreshToken?: string | null | undefined
  delayMs?: number | undefined
  previousRefreshToken?: string | undefined
  reason?: string | undefined
  refreshToken?: string | null | undefined
  result?: string | undefined
  storedAccessToken?: string | undefined
  type: SessionAuthMachineCommand['type']
}

function toCommandSummary(command: SessionAuthMachineCommand): CommandSummary {
  switch (command.type) {
    case 'clear_expired_session':
    case 'clear_session':
    case 'none':
      return {
        ...(command.result ? { result: command.result } : {}),
        type: command.type,
      }

    case 'commit_stored_session':
    case 'restore_latest_stored_session':
      return {
        result: command.result,
        storedAccessToken: command.storedSession.accessToken,
        type: command.type,
      }

    case 'finish_loading':
    case 'recover_session':
    case 'restore_session':
      return {
        type: command.type,
      }

    case 'keep_device_session':
      return {
        ...(command.blockRefreshToken !== undefined
          ? { blockRefreshToken: command.blockRefreshToken }
          : {}),
        reason: command.reason,
        result: command.result,
        type: command.type,
      }

    case 'read_latest_native_session':
      return {
        previousRefreshToken: command.previousRefreshToken,
        type: command.type,
      }

    case 'request_refresh':
      return {
        refreshToken: command.refreshToken,
        type: command.type,
      }

    case 'schedule_refresh':
      return {
        delayMs: command.delayMs,
        type: command.type,
      }
  }
}

function createExpiredStoredSession(
  overrides: Partial<StoredAuthSession> = {},
): StoredAuthSession {
  return createStoredSession({
    expiresAt: new Date(BASE_TIME_MS - 60_000).toISOString(),
    ...overrides,
  })
}

function createUsableStoredSession(
  overrides: Partial<StoredAuthSession> = {},
): StoredAuthSession {
  return createStoredSession({
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ...overrides,
  })
}

function createStoredSession(
  overrides: Partial<StoredAuthSession> = {},
): StoredAuthSession {
  return {
    accessToken: 'access-token',
    email: 'mobile@example.com',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    refreshToken: 'refresh-token',
    userId: 'user-1',
    ...overrides,
  }
}
