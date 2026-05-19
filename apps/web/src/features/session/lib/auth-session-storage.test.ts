import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearStoredAuthSession,
  getRememberSessionPreference,
  readStoredAuthSession,
  setRememberSessionPreference,
  type StoredAuthSession,
  writeStoredAuthSession,
} from './auth-session-storage'

const AUTH_SESSION_STORAGE_KEY = 'planner.auth.session'
const REMEMBER_SESSION_STORAGE_KEY = 'planner.rememberSession'

const session: StoredAuthSession = {
  accessToken: 'access-token',
  email: 'user@example.test',
  expiresAt: '2026-05-16T12:00:00.000Z',
  refreshToken: 'refresh-token',
  userId: 'user-1',
}

describe('auth-session-storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores remembered browser sessions in localStorage', async () => {
    setRememberSessionPreference(true)

    await writeStoredAuthSession(session)

    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toEqual(
      JSON.stringify(session),
    )
    await expect(readStoredAuthSession()).resolves.toEqual(session)
  })

  it('stores non-remembered browser sessions in sessionStorage', async () => {
    setRememberSessionPreference(false)

    await writeStoredAuthSession(session)

    expect(getRememberSessionPreference()).toBe(false)
    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toEqual(
      JSON.stringify(session),
    )
    await expect(readStoredAuthSession()).resolves.toEqual(session)
  })

  it('clears both browser storage scopes', async () => {
    window.localStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify(session),
    )
    window.sessionStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify(session),
    )

    await clearStoredAuthSession()

    expect(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('ignores malformed stored sessions', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    window.localStorage.setItem(REMEMBER_SESSION_STORAGE_KEY, 'true')
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, '{')

    await expect(readStoredAuthSession()).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalled()
  })
})
