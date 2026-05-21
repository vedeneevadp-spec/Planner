import { describe, expect, it } from 'vitest'

import type { StoredAuthSession } from './auth-session-storage'
import {
  createInitialSessionAuthState,
  isAccessTokenUsable,
  sessionAuthReducer,
} from './session-auth-reducer'

describe('session auth reducer', () => {
  it('starts in restoring state when auth bootstrap is enabled', () => {
    const state = createInitialSessionAuthState(true)

    expect(state.snapshot.isLoading).toBe(true)
    expect(state.snapshot.sessionAccessToken).toBeNull()
    expect(state.sessionVersion).toBe(0)
  })

  it('restores a usable native session and bumps the session version', () => {
    const state = sessionAuthReducer(createInitialSessionAuthState(true), {
      includeRefreshToken: true,
      session: createStoredSession({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
      type: 'auth.session_restored',
    })

    expect(state.snapshot.email).toBe('mobile@example.com')
    expect(state.snapshot.sessionAccessToken).toBe('access-token')
    expect(state.snapshot.refreshToken).toBe('refresh-token')
    expect(state.snapshot.isLoading).toBe(false)
    expect(state.sessionVersion).toBe(1)
  })

  it('keeps an expired native device session without exposing an access token', () => {
    const state = sessionAuthReducer(createInitialSessionAuthState(true), {
      includeRefreshToken: true,
      session: createStoredSession({
        accessToken: 'expired-access-token',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        refreshToken: 'refresh-token',
      }),
      type: 'auth.device_session_kept',
    })

    expect(state.snapshot.email).toBe('mobile@example.com')
    expect(state.snapshot.sessionAccessToken).toBeNull()
    expect(state.snapshot.refreshToken).toBe('refresh-token')
    expect(state.sessionVersion).toBe(1)
  })

  it('keeps the current snapshot when native storage is temporarily empty', () => {
    const restoredState = sessionAuthReducer(
      createInitialSessionAuthState(true),
      {
        includeRefreshToken: true,
        session: createStoredSession({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        }),
        type: 'auth.session_restored',
      },
    )
    const keptState = sessionAuthReducer(restoredState, {
      includeRefreshToken: true,
      session: null,
      type: 'auth.device_session_kept',
    })

    expect(keptState.snapshot.email).toBe('mobile@example.com')
    expect(keptState.snapshot.sessionAccessToken).toBe('access-token')
    expect(keptState.snapshot.refreshToken).toBe('refresh-token')
    expect(keptState.sessionVersion).toBe(2)
  })

  it('clears auth state only through the explicit sign-out transition', () => {
    const restoredState = sessionAuthReducer(
      createInitialSessionAuthState(true),
      {
        includeRefreshToken: true,
        session: createStoredSession({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        }),
        type: 'auth.session_restored',
      },
    )
    const clearedState = sessionAuthReducer(restoredState, {
      type: 'auth.session_cleared',
    })

    expect(clearedState.snapshot.userId).toBeNull()
    expect(clearedState.snapshot.sessionAccessToken).toBeNull()
    expect(clearedState.snapshot.refreshToken).toBeNull()
    expect(clearedState.sessionVersion).toBe(2)
  })

  it('treats tokens inside the expiry grace window as unusable', () => {
    expect(
      isAccessTokenUsable(new Date(Date.now() + 5_000).toISOString()),
    ).toBe(false)
    expect(
      isAccessTokenUsable(new Date(Date.now() + 60_000).toISOString()),
    ).toBe(true)
  })
})

function createStoredSession(
  overrides: Partial<StoredAuthSession> = {},
): StoredAuthSession {
  return {
    accessToken: 'access-token',
    email: 'mobile@example.com',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    userId: 'user-1',
    ...overrides,
  }
}
