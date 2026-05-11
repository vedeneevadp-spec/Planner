import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authApiMocks = vi.hoisted(() => ({
  confirmPasswordReset: vi.fn(),
  isUnauthorizedAuthApiError: vi.fn(),
  refreshAuthSession: vi.fn(),
  requestPasswordReset: vi.fn(),
  signInWithPassword: vi.fn(),
  signOutAuthSession: vi.fn(),
  signUpWithPassword: vi.fn(),
  updatePassword: vi.fn(),
}))

const authStorageMocks = vi.hoisted(() => ({
  clearStoredAuthSession: vi.fn(),
  readStoredAuthSession: vi.fn(),
  writeStoredAuthSession: vi.fn(),
}))

const nativeSessionMocks = vi.hoisted(() => ({
  addNativeAppStateChangeListener: vi.fn(),
  getNativeAppIsActive: vi.fn(),
  isNativeSessionPersistenceRuntime: vi.fn(),
}))

const nativePushMocks = vi.hoisted(() => ({
  unregisterStoredNativePushDevice: vi.fn(),
}))

vi.mock('@/shared/config/planner-api', () => ({
  plannerApiConfig: {
    apiBaseUrl: 'https://api.chaotika.test',
    authProvider: 'planner',
  },
}))

vi.mock('../lib/auth-api', () => ({
  confirmPasswordReset: authApiMocks.confirmPasswordReset,
  isUnauthorizedAuthApiError: authApiMocks.isUnauthorizedAuthApiError,
  refreshAuthSession: authApiMocks.refreshAuthSession,
  requestPasswordReset: authApiMocks.requestPasswordReset,
  signInWithPassword: authApiMocks.signInWithPassword,
  signOutAuthSession: authApiMocks.signOutAuthSession,
  signUpWithPassword: authApiMocks.signUpWithPassword,
  updatePassword: authApiMocks.updatePassword,
}))

vi.mock('../lib/auth-session-storage', () => ({
  clearStoredAuthSession: authStorageMocks.clearStoredAuthSession,
  getRememberSessionPreference: () => true,
  readStoredAuthSession: authStorageMocks.readStoredAuthSession,
  setRememberSessionPreference: vi.fn(),
  writeStoredAuthSession: authStorageMocks.writeStoredAuthSession,
}))

vi.mock('../lib/native-push-notifications', () => ({
  unregisterStoredNativePushDevice:
    nativePushMocks.unregisterStoredNativePushDevice,
}))

vi.mock('../lib/native-session-storage', () => ({
  addNativeAppStateChangeListener:
    nativeSessionMocks.addNativeAppStateChangeListener,
  getNativeAppIsActive: nativeSessionMocks.getNativeAppIsActive,
  isNativeSessionPersistenceRuntime:
    nativeSessionMocks.isNativeSessionPersistenceRuntime,
}))

import { useSessionAuth } from '../lib/useSessionAuth'
import { SessionProvider } from './SessionProvider'

interface StoredAuthSession {
  accessToken: string
  email: string
  expiresAt: string
  refreshToken?: string
  userId: string
}

interface AuthTokenResponse {
  accessToken: string
  expiresAt: string
  refreshToken: string
  user: {
    email: string
    id: string
  }
}

describe('SessionProvider', () => {
  let appStateListener: ((isActive: boolean) => void) | null = null

  beforeEach(() => {
    appStateListener = null

    authApiMocks.confirmPasswordReset.mockReset()
    authApiMocks.isUnauthorizedAuthApiError.mockReset()
    authApiMocks.refreshAuthSession.mockReset()
    authApiMocks.requestPasswordReset.mockReset()
    authApiMocks.signInWithPassword.mockReset()
    authApiMocks.signOutAuthSession.mockReset()
    authApiMocks.signUpWithPassword.mockReset()
    authApiMocks.updatePassword.mockReset()

    authStorageMocks.clearStoredAuthSession.mockReset()
    authStorageMocks.readStoredAuthSession.mockReset()
    authStorageMocks.writeStoredAuthSession.mockReset()

    nativePushMocks.unregisterStoredNativePushDevice.mockReset()
    nativeSessionMocks.addNativeAppStateChangeListener.mockReset()
    nativeSessionMocks.getNativeAppIsActive.mockReset()
    nativeSessionMocks.isNativeSessionPersistenceRuntime.mockReset()

    authApiMocks.isUnauthorizedAuthApiError.mockImplementation(
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 401,
    )
    authStorageMocks.clearStoredAuthSession.mockResolvedValue(undefined)
    authStorageMocks.writeStoredAuthSession.mockResolvedValue(undefined)
    nativePushMocks.unregisterStoredNativePushDevice.mockResolvedValue(
      undefined,
    )
    nativeSessionMocks.getNativeAppIsActive.mockResolvedValue(true)
    nativeSessionMocks.isNativeSessionPersistenceRuntime.mockReturnValue(true)
    nativeSessionMocks.addNativeAppStateChangeListener.mockImplementation(
      (listener: (isActive: boolean) => void) => {
        appStateListener = listener

        return Promise.resolve({ remove: vi.fn() })
      },
    )
  })

  it('reuses an in-flight refresh when native resume fires during restore', async () => {
    let resolveRefresh!: (response: AuthTokenResponse) => void
    const refreshPromise = new Promise<AuthTokenResponse>((resolve) => {
      resolveRefresh = resolve
    })

    authStorageMocks.readStoredAuthSession.mockResolvedValue(
      createExpiredStoredSession(),
    )
    authApiMocks.refreshAuthSession.mockReturnValue(refreshPromise)

    const { unmount } = render(
      <SessionProvider>
        <div />
      </SessionProvider>,
    )

    await waitFor(() => {
      expect(authApiMocks.refreshAuthSession).toHaveBeenCalledTimes(1)
      expect(appStateListener).not.toBeNull()
    })

    await act(async () => {
      appStateListener?.(true)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(
        authStorageMocks.readStoredAuthSession.mock.calls.length,
      ).toBeGreaterThanOrEqual(3)
    })
    expect(authApiMocks.refreshAuthSession).toHaveBeenCalledTimes(1)

    const refreshedSession = createTokenResponse()

    await act(async () => {
      resolveRefresh(refreshedSession)
      await refreshPromise
    })

    await waitFor(() => {
      expect(authStorageMocks.writeStoredAuthSession).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        email: 'mobile@example.com',
        expiresAt: refreshedSession.expiresAt,
        refreshToken: 'new-refresh-token',
        userId: 'user-1',
      })
    })
    expect(authStorageMocks.clearStoredAuthSession).not.toHaveBeenCalled()

    unmount()
  })

  it('does not persist refresh tokens in browser session storage', async () => {
    nativeSessionMocks.isNativeSessionPersistenceRuntime.mockReturnValue(false)
    authStorageMocks.readStoredAuthSession.mockResolvedValue(null)
    const tokenResponse = createTokenResponse()
    authApiMocks.signInWithPassword.mockResolvedValue(tokenResponse)

    render(
      <SessionProvider>
        <SignInProbe />
      </SessionProvider>,
    )

    await waitFor(() => {
      expect(authStorageMocks.readStoredAuthSession).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(authApiMocks.signInWithPassword).toHaveBeenCalledWith(
        {
          email: 'web@example.test',
          password: 'password',
        },
        {
          rememberSession: true,
          tokenTransport: 'cookie',
        },
      )
    })

    expect(authStorageMocks.writeStoredAuthSession).toHaveBeenCalledWith({
      accessToken: 'new-access-token',
      email: 'mobile@example.com',
      expiresAt: tokenResponse.expiresAt,
      userId: 'user-1',
    })
  })

  it('persists the fresh session returned after a password update', async () => {
    nativeSessionMocks.isNativeSessionPersistenceRuntime.mockReturnValue(false)
    authStorageMocks.readStoredAuthSession.mockResolvedValue(
      createUsableBrowserStoredSession(),
    )
    const tokenResponse = createTokenResponse()
    authApiMocks.updatePassword.mockResolvedValue(tokenResponse)

    render(
      <SessionProvider>
        <UpdatePasswordProbe />
      </SessionProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Update password' }),
      ).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => {
      expect(authApiMocks.updatePassword).toHaveBeenCalledWith(
        {
          currentPassword: 'old-password',
          password: 'new-password',
        },
        'old-access-token',
        {
          rememberSession: true,
          tokenTransport: 'cookie',
        },
      )
    })
    expect(authStorageMocks.writeStoredAuthSession).toHaveBeenCalledWith({
      accessToken: 'new-access-token',
      email: 'mobile@example.com',
      expiresAt: tokenResponse.expiresAt,
      userId: 'user-1',
    })
    expect(authApiMocks.refreshAuthSession).not.toHaveBeenCalled()
  })
})

function SignInProbe() {
  const auth = useSessionAuth()

  return (
    <button
      type="button"
      onClick={() => {
        void auth.signInWithPassword('web@example.test', 'password')
      }}
    >
      Sign in
    </button>
  )
}

function UpdatePasswordProbe() {
  const auth = useSessionAuth()

  return (
    <button
      disabled={!auth.accessToken}
      type="button"
      onClick={() => {
        void auth.updatePassword('new-password', 'old-password')
      }}
    >
      Update password
    </button>
  )
}

function createExpiredStoredSession(): StoredAuthSession {
  return {
    accessToken: 'old-access-token',
    email: 'mobile@example.com',
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    refreshToken: 'old-refresh-token',
    userId: 'user-1',
  }
}

function createUsableBrowserStoredSession(): StoredAuthSession {
  return {
    accessToken: 'old-access-token',
    email: 'mobile@example.com',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    userId: 'user-1',
  }
}

function createTokenResponse(): AuthTokenResponse {
  return {
    accessToken: 'new-access-token',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    refreshToken: 'new-refresh-token',
    user: {
      email: 'mobile@example.com',
      id: 'user-1',
    },
  }
}
