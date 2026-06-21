import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

interface PlannerSessionQueryStub {
  data: unknown
  error: unknown
  isPending: boolean
  refetch: () => Promise<void>
}

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
  readStoredAuthSession: vi.fn<() => Promise<StoredAuthSession | null>>(),
  writeStoredAuthSession:
    vi.fn<(session: StoredAuthSession) => Promise<void>>(),
}))

const nativeSessionMocks = vi.hoisted(() => ({
  addNativeAppStateChangeListener: vi.fn(),
  getNativeAuthDeviceId: vi.fn(),
  getNativeAppIsActive: vi.fn(),
  isNativeSessionPersistenceRuntime: vi.fn(),
}))

const nativePushMocks = vi.hoisted(() => ({
  unregisterStoredNativePushDevice: vi.fn(),
}))

const plannerSessionMocks = vi.hoisted(() => ({
  usePlannerSession: vi.fn<() => PlannerSessionQueryStub>(),
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
  getNativeAuthDeviceId: nativeSessionMocks.getNativeAuthDeviceId,
  getNativeAppIsActive: nativeSessionMocks.getNativeAppIsActive,
  isNativeSessionPersistenceRuntime:
    nativeSessionMocks.isNativeSessionPersistenceRuntime,
}))

vi.mock('../lib/usePlannerSession', () => ({
  usePlannerSession: () => plannerSessionMocks.usePlannerSession(),
}))

import { readClientEvents } from '@/shared/lib/observability'

import { useSessionAuth } from '../lib/useSessionAuth'
import { AuthGate } from './AuthGate'
import { SessionProvider } from './SessionProvider'

describe('mobile auth regression gate', () => {
  let appStateListener: ((isActive: boolean) => void) | null = null

  beforeEach(() => {
    appStateListener = null
    window.__CHAOTIKA_DIAGNOSTICS__?.clear()

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
    nativeSessionMocks.getNativeAuthDeviceId.mockReset()
    nativeSessionMocks.getNativeAppIsActive.mockReset()
    nativeSessionMocks.isNativeSessionPersistenceRuntime.mockReset()
    plannerSessionMocks.usePlannerSession.mockReset()

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
    nativeSessionMocks.getNativeAuthDeviceId.mockResolvedValue(
      'native-device-1',
    )
    nativeSessionMocks.getNativeAppIsActive.mockResolvedValue(true)
    nativeSessionMocks.isNativeSessionPersistenceRuntime.mockReturnValue(true)
    nativeSessionMocks.addNativeAppStateChangeListener.mockImplementation(
      (listener: (isActive: boolean) => void) => {
        appStateListener = listener

        return Promise.resolve({ remove: vi.fn() })
      },
    )
    plannerSessionMocks.usePlannerSession.mockReturnValue({
      data: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      error: null,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps content visible on startup and resume when native storage is temporarily empty', async () => {
    let storageEmptyOnResume = false

    authStorageMocks.readStoredAuthSession.mockImplementation(() =>
      Promise.resolve(
        storageEmptyOnResume ? null : createUsableNativeStoredSession(),
      ),
    )

    renderMobileApp()

    expect(screen.getByText('Planner content')).toBeVisible()
    expect(
      screen.queryByText('Проверяем сохраненный вход'),
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(appStateListener).not.toBeNull()
      expect(screen.getByTestId('auth-access-token')).toHaveTextContent(
        'newer-access-token',
      )
    })

    storageEmptyOnResume = true

    await act(async () => {
      appStateListener?.(false)
      appStateListener?.(true)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(
        readClientEvents().some(
          (event) =>
            event.name === 'auth_device_session_kept' &&
            event.details.reason === 'storage_empty_on_resume',
        ),
      ).toBe(true)
    })

    expect(screen.getByText('Planner content')).toBeVisible()
    expect(authStorageMocks.clearStoredAuthSession).not.toHaveBeenCalled()
    expect(authApiMocks.signOutAuthSession).not.toHaveBeenCalled()
  })

  it('keeps content visible offline and does not sign out the native device session', async () => {
    authStorageMocks.readStoredAuthSession.mockResolvedValue(
      createExpiredStoredSession(),
    )
    authApiMocks.refreshAuthSession.mockRejectedValue(
      new TypeError('Network request failed'),
    )

    renderMobileApp()

    expect(screen.getByText('Planner content')).toBeVisible()

    await waitFor(() => {
      expect(authApiMocks.refreshAuthSession).toHaveBeenCalledWith(
        { refreshToken: 'old-refresh-token' },
        {
          deviceId: 'native-device-1',
          rememberSession: true,
          tokenTransport: 'body',
        },
      )
    })
    expect(screen.getByText('Planner content')).toBeVisible()
    expect(authStorageMocks.clearStoredAuthSession).not.toHaveBeenCalled()
    expect(authApiMocks.signOutAuthSession).not.toHaveBeenCalled()
    expect(
      readClientEvents().some(
        (event) => event.name === 'auth_refresh_deferred',
      ),
    ).toBe(true)
    expect(
      readClientEvents().some(
        (event) =>
          event.name === 'auth_device_session_kept' &&
          event.details.reason === 'retryable_refresh_error',
      ),
    ).toBe(true)
  })

  it('reuses a single native refresh during startup and resume replay', async () => {
    let resolveRefresh!: (response: AuthTokenResponse) => void
    const refreshPromise = new Promise<AuthTokenResponse>((resolve) => {
      resolveRefresh = resolve
    })

    authStorageMocks.readStoredAuthSession.mockResolvedValue(
      createExpiredStoredSession(),
    )
    authApiMocks.refreshAuthSession.mockReturnValue(refreshPromise)

    renderMobileApp()

    await waitFor(() => {
      expect(authApiMocks.refreshAuthSession).toHaveBeenCalledTimes(1)
      expect(appStateListener).not.toBeNull()
    })

    await act(async () => {
      appStateListener?.(false)
      appStateListener?.(true)
      await Promise.resolve()
    })

    expect(authApiMocks.refreshAuthSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRefresh(createTokenResponse())
      await refreshPromise
    })

    await waitFor(() => {
      expect(authStorageMocks.writeStoredAuthSession).toHaveBeenCalled()
    })

    const storedSession =
      authStorageMocks.writeStoredAuthSession.mock.calls.at(-1)?.[0]

    expect(storedSession).toMatchObject({
      accessToken: 'new-access-token',
      email: 'mobile@example.com',
      refreshToken: 'new-refresh-token',
      userId: 'user-1',
    })
    expect(typeof storedSession?.expiresAt).toBe('string')
    expect(authStorageMocks.clearStoredAuthSession).not.toHaveBeenCalled()
  })
})

function renderMobileApp() {
  return render(
    <SessionProvider>
      <AuthGate>
        <main>
          Planner content
          <AuthProbe />
        </main>
      </AuthGate>
    </SessionProvider>,
  )
}

function AuthProbe() {
  const auth = useSessionAuth()

  return (
    <output data-testid="auth-access-token">
      {auth.accessToken ?? 'none'}
    </output>
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

function createUsableNativeStoredSession(): StoredAuthSession {
  return {
    accessToken: 'newer-access-token',
    email: 'mobile@example.com',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    refreshToken: 'newer-refresh-token',
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
