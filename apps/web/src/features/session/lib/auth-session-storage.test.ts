import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readClientEvents } from '@/shared/lib/observability'

const capacitorMocks = vi.hoisted(() => ({
  commitRefresh: vi.fn(),
  durableGet: vi.fn(),
  durableRemove: vi.fn(),
  durableSet: vi.fn(),
  get: vi.fn(),
  getPlatform: vi.fn(),
  isNativePlatform: vi.fn(),
  prepareRefresh: vi.fn(),
  remove: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(),
    getState: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: capacitorMocks.getPlatform,
    isNativePlatform: capacitorMocks.isNativePlatform,
  },
  registerPlugin: () => ({
    commitRefresh: capacitorMocks.commitRefresh,
    get: capacitorMocks.durableGet,
    prepareRefresh: capacitorMocks.prepareRefresh,
    remove: capacitorMocks.durableRemove,
    set: capacitorMocks.durableSet,
  }),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: capacitorMocks.get,
    remove: capacitorMocks.remove,
    set: capacitorMocks.set,
  },
}))

import {
  AuthSessionStorageError,
  clearStoredAuthSession,
  commitStoredAuthSessionRefresh,
  getRememberSessionPreference,
  prepareStoredAuthSessionRefresh,
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
    capacitorMocks.commitRefresh.mockReset()
    capacitorMocks.commitRefresh.mockImplementation(
      (options: { refreshedSession: string }) =>
        Promise.resolve({ value: options.refreshedSession }),
    )
    capacitorMocks.durableRemove.mockReset()
    capacitorMocks.durableRemove.mockResolvedValue(undefined)
    capacitorMocks.durableSet.mockReset()
    capacitorMocks.durableSet.mockResolvedValue(undefined)
    capacitorMocks.get.mockReset()
    capacitorMocks.getPlatform.mockReset()
    capacitorMocks.getPlatform.mockReturnValue('android')
    capacitorMocks.isNativePlatform.mockReset()
    capacitorMocks.isNativePlatform.mockReturnValue(false)
    capacitorMocks.prepareRefresh.mockReset()
    capacitorMocks.prepareRefresh.mockImplementation(
      (options: { expectedSession: string }) => {
        const expectedSession = JSON.parse(
          options.expectedSession,
        ) as StoredAuthSession

        return Promise.resolve({
          value: JSON.stringify({
            ...expectedSession,
            refreshRotationRequestId:
              expectedSession.refreshRotationRequestId ??
              '0198f5f2-01d0-7a3f-88cb-9cb66f8f8585',
          }),
        })
      },
    )
    capacitorMocks.remove.mockReset()
    capacitorMocks.set.mockReset()
    capacitorMocks.set.mockResolvedValue(undefined)
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.__CHAOTIKA_DIAGNOSTICS__?.clear()
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

  it('records diagnostics when browser storage is unavailable', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled.', 'SecurityError')
    })

    await expect(readStoredAuthSession()).resolves.toBeNull()

    expect(
      readClientEvents().some(
        (event) =>
          event.name === 'auth_storage_failed' &&
          event.details.errorKind === 'dom_exception' &&
          event.details.fallback === 'memory' &&
          event.details.operation === 'read',
      ),
    ).toBe(true)

    errorSpy.mockRestore()
  })

  it('durably stores a rotation request before native refresh', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)

    const preparedSession = await prepareStoredAuthSessionRefresh(session)

    expect(preparedSession.refreshRotationRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(capacitorMocks.prepareRefresh).toHaveBeenCalledWith({
      expectedSession: JSON.stringify(session),
    })
    expect(capacitorMocks.durableSet).not.toHaveBeenCalled()
  })

  it('reuses a durable native rotation request without rewriting it', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    const preparedSession: StoredAuthSession = {
      ...session,
      refreshRotationRequestId: '0198f5f2-01d0-7a3f-88cb-9cb66f8f8585',
    }

    await expect(
      prepareStoredAuthSessionRefresh(preparedSession),
    ).resolves.toEqual(preparedSession)
    expect(capacitorMocks.prepareRefresh).toHaveBeenCalledWith({
      expectedSession: JSON.stringify(preparedSession),
    })
    expect(capacitorMocks.durableSet).not.toHaveBeenCalled()
  })

  it('atomically commits a native refresh without overwriting newer state', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    const attemptedSession: StoredAuthSession = {
      ...session,
      refreshRotationRequestId: '0198f5f2-01d0-7a3f-88cb-9cb66f8f8585',
    }
    const refreshedSession: StoredAuthSession = {
      ...session,
      accessToken: 'fresh-access-token',
      refreshRotationRequestId: '0198f5f3-01d0-7a3f-88cb-9cb66f8f8585',
      refreshToken: 'fresh-refresh-token',
    }

    await expect(
      commitStoredAuthSessionRefresh(attemptedSession, refreshedSession),
    ).resolves.toEqual(refreshedSession)
    expect(capacitorMocks.commitRefresh).toHaveBeenCalledWith({
      attemptedSession: JSON.stringify(attemptedSession),
      refreshedSession: JSON.stringify(refreshedSession),
    })
    expect(capacitorMocks.durableSet).not.toHaveBeenCalled()
  })

  it('fails closed when the native rotation request cannot be persisted', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    capacitorMocks.prepareRefresh.mockRejectedValue(
      new Error('Preferences unavailable'),
    )

    await expect(
      prepareStoredAuthSessionRefresh(session),
    ).rejects.toBeInstanceOf(AuthSessionStorageError)
    expect(
      readClientEvents().some(
        (event) =>
          event.name === 'auth_storage_failed' &&
          event.details.fallback === 'none' &&
          event.details.operation === 'prepare_refresh',
      ),
    ).toBe(true)

    errorSpy.mockRestore()
  })
})
