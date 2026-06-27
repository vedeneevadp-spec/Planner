import { describe, expect, it } from 'vitest'

import {
  getAuthErrorStatus,
  getDeviceSessionKeepCategory,
  getRefreshFailureCategory,
  getRefreshStorageDecisionCategory,
} from './session-auth-diagnostics'
import type { SessionAuthMachineCommand } from './session-auth-machine'

describe('session auth diagnostics', () => {
  it('classifies refresh failures for observability', () => {
    expect(getRefreshFailureCategory(new TypeError('Failed to fetch'))).toBe(
      'retryable',
    )
    expect(getRefreshFailureCategory({ status: 401 })).toBe('revoked_or_denied')
    expect(getRefreshFailureCategory({ status: 403 })).toBe('revoked_or_denied')
    expect(getRefreshFailureCategory({ status: 418 })).toBe('http_error')
    expect(getRefreshFailureCategory(new Error('bad token'))).toBe('unknown')
  })

  it('keeps native device-session categories stable', () => {
    expect(getDeviceSessionKeepCategory('retryable_refresh_error')).toBe(
      'retryable',
    )
    expect(getDeviceSessionKeepCategory('server_denied_refresh')).toBe(
      'revoked_or_denied',
    )
    expect(getDeviceSessionKeepCategory('storage_empty_on_resume')).toBe(
      'storage_unavailable',
    )
    expect(getDeviceSessionKeepCategory('blocked_refresh_token')).toBe(
      'blocked',
    )
    expect(getDeviceSessionKeepCategory('missing_refresh_token')).toBe(
      'missing_refresh_token',
    )
  })

  it('classifies refresh storage decisions from machine commands', () => {
    expect(
      getRefreshStorageDecisionCategory({
        result: 'recovered',
        storedSession: {
          accessToken: 'access-token',
          email: 'user@example.com',
          expiresAt: '2026-06-27T12:00:00.000Z',
          refreshToken: 'refresh-token',
          userId: 'user-id',
        },
        type: 'restore_latest_stored_session',
      }),
    ).toBe('stale_refresh_replay')
    expect(
      getRefreshStorageDecisionCategory({
        error: new Error('denied'),
        logMessage: 'keep',
        reason: 'server_denied_refresh',
        result: 'deferred',
        storedSession: null,
        type: 'keep_device_session',
      }),
    ).toBe('revoked_or_denied')
    expect(
      getRefreshStorageDecisionCategory({
        notice: 'expired',
        result: 'signed_out',
        type: 'clear_expired_session',
      }),
    ).toBe('expired_or_unrecoverable')
    expect(
      getRefreshStorageDecisionCategory({
        refreshToken: null,
        type: 'request_refresh',
      } satisfies SessionAuthMachineCommand),
    ).toBe('request_refresh')
  })

  it('extracts numeric auth error status only when present', () => {
    expect(getAuthErrorStatus({ status: 403 })).toBe(403)
    expect(getAuthErrorStatus({ status: '403' })).toBeNull()
    expect(getAuthErrorStatus(null)).toBeNull()
  })
})
