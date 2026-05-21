import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'
import { recordClientEvent } from '@/shared/lib/observability'

import {
  type AuthRequestOptions,
  confirmPasswordReset,
  isUnauthorizedAuthApiError,
  refreshAuthSession,
  requestPasswordReset as requestPasswordResetApi,
  signInWithPassword as signInWithPasswordApi,
  signOutAuthSession,
  signUpWithPassword as signUpWithPasswordApi,
  updatePassword as updatePasswordApi,
} from '../lib/auth-api'
import {
  clearStoredAuthSession,
  getRememberSessionPreference,
  readStoredAuthSession,
  type StoredAuthSession,
  writeStoredAuthSession,
} from '../lib/auth-session-storage'
import { unregisterStoredNativePushDevice } from '../lib/native-push-notifications'
import {
  addNativeAppStateChangeListener,
  getNativeAppIsActive,
  getNativeAuthDeviceId,
  isNativeSessionPersistenceRuntime,
} from '../lib/native-session-storage'
import { clearCachedPlannerSession } from '../lib/planner-session-cache'
import {
  canUseProtectedSessionApi,
  resolveSessionAuthLifecycleStatus,
} from '../lib/session-auth-lifecycle'
import {
  ACCESS_TOKEN_EXPIRY_GRACE_MS,
  createInitialSessionAuthState,
  isAccessTokenUsable,
  sessionAuthReducer,
} from '../lib/session-auth-reducer'
import {
  clearLastActorUserId,
  clearSelectedWorkspaceId,
  getLastActorUserId,
} from '../lib/workspace-selection'
import {
  type PasswordSignUpInput,
  SessionAuthContext,
  type SessionAuthState,
  type SessionRecoveryResult,
} from '../model/session-auth-context'

const DEFAULT_EXPIRED_SESSION_MESSAGE =
  'Сессия истекла или больше не принимается сервером. Войдите заново.'

type NativeDeviceSessionKeepReason =
  | 'blocked_refresh_token'
  | 'missing_refresh_token'
  | 'retryable_refresh_error'
  | 'server_denied_refresh'
  | 'storage_empty_on_resume'

export function SessionProvider({ children }: PropsWithChildren) {
  const isAuthEnabled = plannerApiConfig.authProvider === 'planner'
  const isNativeSessionRuntime = isNativeSessionPersistenceRuntime()
  const pendingSignOutNoticeRef = useRef<string | false | null>(null)
  const blockedNativeRefreshTokenRef = useRef<string | null>(null)
  const nativeAuthDeviceIdRef = useRef<Promise<string | null> | null>(null)
  const sessionRecoveryRef = useRef<Promise<SessionRecoveryResult> | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const restoreSessionRef = useRef<() => Promise<SessionRecoveryResult>>(() =>
    Promise.resolve('signed_out'),
  )
  const [passwordResetToken, setPasswordResetToken] = useState<string | null>(
    () =>
      typeof window === 'undefined'
        ? null
        : readPasswordResetToken(window.location),
  )
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [{ sessionVersion, snapshot }, dispatchAuthState] = useReducer(
    sessionAuthReducer,
    isAuthEnabled,
    createInitialSessionAuthState,
  )
  const isPasswordRecovery = passwordResetToken !== null

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current === null) {
      return
    }

    window.clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = null
  }, [])

  const resolveNativeAuthDeviceId = useCallback(async (): Promise<
    string | null
  > => {
    if (!isNativeSessionRuntime) {
      return null
    }

    nativeAuthDeviceIdRef.current ??= getNativeAuthDeviceId().catch((error) => {
      nativeAuthDeviceIdRef.current = null
      console.warn('Failed to resolve native auth device id.', error)

      return null
    })

    return nativeAuthDeviceIdRef.current
  }, [isNativeSessionRuntime])

  const createAuthRequestOptions = useCallback(
    async (options?: {
      requireNativeDeviceId?: boolean | undefined
    }): Promise<AuthRequestOptions> => {
      const deviceId = await resolveNativeAuthDeviceId()

      if (
        isNativeSessionRuntime &&
        options?.requireNativeDeviceId !== false &&
        !deviceId
      ) {
        throw new TypeError('Native auth device id is unavailable.')
      }

      return {
        ...(deviceId ? { deviceId } : {}),
        rememberSession: getRememberSessionPreference(),
        tokenTransport: isNativeSessionRuntime ? 'body' : 'cookie',
      }
    },
    [isNativeSessionRuntime, resolveNativeAuthDeviceId],
  )

  const persistAuthSession = useCallback(
    async (session: {
      accessToken: string
      expiresAt: string
      refreshToken?: string | undefined
      user: {
        email: string
        id: string
      }
    }): Promise<void> => {
      const storedSession = toStoredAuthSession(session, {
        includeRefreshToken: isNativeSessionRuntime,
      })

      await writeStoredAuthSession(storedSession)
      blockedNativeRefreshTokenRef.current = null
      setPasswordResetToken(null)
      clearPasswordResetUrlParams()
      setAuthNotice(null)
      dispatchAuthState({
        includeRefreshToken: isNativeSessionRuntime,
        session: storedSession,
        type: 'auth.session_restored',
      })
    },
    [isNativeSessionRuntime],
  )

  const clearAuthSession = useCallback(
    async (notice: string | false | null) => {
      const actorUserId = snapshot.userId ?? getLastActorUserId()
      const refreshToken = isNativeSessionRuntime
        ? snapshot.refreshToken
        : undefined

      clearRefreshTimer()
      await unregisterStoredNativePushDevice({
        accessToken: snapshot.sessionAccessToken,
        actorUserId,
        apiBaseUrl: plannerApiConfig.apiBaseUrl,
      })

      pendingSignOutNoticeRef.current = notice
      blockedNativeRefreshTokenRef.current = null
      setAuthNotice(notice === false ? null : notice)
      setPasswordResetToken(null)
      clearCachedPlannerSession(actorUserId)
      clearSelectedWorkspaceId(actorUserId)
      clearLastActorUserId()
      await clearStoredAuthSession()
      dispatchAuthState({ type: 'auth.session_cleared' })
      recordClientEvent(
        'auth_session_cleared',
        {
          hadAccessToken: Boolean(snapshot.sessionAccessToken),
          hadRefreshToken: Boolean(refreshToken),
          nativeRuntime: isNativeSessionRuntime,
          reason: notice === false ? 'user_sign_out' : 'system',
        },
        { level: notice === false ? 'info' : 'warn' },
      )

      if (!isNativeSessionRuntime || refreshToken) {
        await signOutAuthSession(
          refreshToken ? { refreshToken } : {},
          await createAuthRequestOptions({
            requireNativeDeviceId: false,
          }),
        ).catch((error) => {
          if (!isUnauthorizedAuthApiError(error)) {
            console.error('Failed to revoke auth session.', error)
          }
        })
      }

      pendingSignOutNoticeRef.current = null
    },
    [
      clearRefreshTimer,
      createAuthRequestOptions,
      isNativeSessionRuntime,
      snapshot.refreshToken,
      snapshot.sessionAccessToken,
      snapshot.userId,
    ],
  )

  const keepDeviceSession = useCallback(
    (
      error: unknown,
      logMessage: string,
      reason: NativeDeviceSessionKeepReason,
      storedSession: StoredAuthSession | null,
    ) => {
      console.warn(logMessage, error)
      setAuthNotice(null)
      dispatchAuthState({
        includeRefreshToken: isNativeSessionRuntime,
        session: storedSession,
        type: 'auth.device_session_kept',
      })
      recordClientEvent(
        'auth_device_session_kept',
        {
          hasStoredAccessToken: Boolean(storedSession?.accessToken),
          hasStoredRefreshToken: Boolean(storedSession?.refreshToken),
          hasStoredSession: Boolean(storedSession),
          reason,
        },
        { level: 'warn' },
      )

      return 'deferred' as const
    },
    [isNativeSessionRuntime],
  )

  const recoverSession =
    useCallback(async (): Promise<SessionRecoveryResult> => {
      if (!isAuthEnabled) {
        return 'signed_out'
      }

      if (sessionRecoveryRef.current) {
        return sessionRecoveryRef.current
      }

      const recovery = (async () => {
        setAuthNotice(null)

        const storedSession = await readStoredAuthSession()
        const refreshToken = isNativeSessionRuntime
          ? (storedSession?.refreshToken ?? snapshot.refreshToken)
          : storedSession?.refreshToken

        if (isNativeSessionRuntime && !refreshToken) {
          if (storedSession) {
            return keepDeviceSession(
              new Error('Native auth session has no refresh token.'),
              'Native auth session refresh skipped.',
              'missing_refresh_token',
              storedSession,
            )
          }

          dispatchAuthState({ type: 'auth.session_cleared' })
          return 'signed_out' as const
        }

        if (
          isNativeSessionRuntime &&
          refreshToken &&
          blockedNativeRefreshTokenRef.current === refreshToken
        ) {
          return keepDeviceSession(
            new Error('Native auth refresh is blocked for this token.'),
            'Native auth session refresh skipped for a blocked token.',
            'blocked_refresh_token',
            storedSession,
          )
        }

        try {
          const refreshedSession = await refreshAuthSession(
            refreshToken ? { refreshToken } : {},
            await createAuthRequestOptions(),
          )
          await persistAuthSession(refreshedSession)

          return 'recovered' as const
        } catch (error) {
          if (isNativeSessionRuntime && isRetryableAuthError(error)) {
            recordClientEvent(
              'auth_refresh_deferred',
              {
                errorKind: getAuthErrorKind(error),
                hasStoredSession: Boolean(storedSession),
              },
              { level: 'warn' },
            )

            return keepDeviceSession(
              error,
              'Auth session refresh deferred to device session.',
              'retryable_refresh_error',
              storedSession,
            )
          }

          if (isNativeSessionRuntime && refreshToken) {
            const latestStoredSession = await readStoredAuthSession().catch(
              (storageError) => {
                console.warn(
                  'Failed to re-read native auth session after refresh error.',
                  storageError,
                )
                return null
              },
            )

            if (
              latestStoredSession?.refreshToken &&
              latestStoredSession.refreshToken !== refreshToken
            ) {
              setAuthNotice(null)
              dispatchAuthState({
                includeRefreshToken: isNativeSessionRuntime,
                session: latestStoredSession,
                type: 'auth.session_restored',
              })

              return isAccessTokenUsable(latestStoredSession.expiresAt)
                ? ('recovered' as const)
                : ('deferred' as const)
            }
          }

          if (
            isNativeSessionRuntime &&
            shouldKeepNativeDeviceSessionAfterRefreshError(error, storedSession)
          ) {
            blockedNativeRefreshTokenRef.current = refreshToken ?? null

            return keepDeviceSession(
              error,
              'Auth session refresh denied; keeping local device session.',
              'server_denied_refresh',
              storedSession,
            )
          }

          await clearAuthSession(DEFAULT_EXPIRED_SESSION_MESSAGE)
          return 'signed_out' as const
        }
      })().finally(() => {
        sessionRecoveryRef.current = null
      })

      sessionRecoveryRef.current = recovery

      return recovery
    }, [
      clearAuthSession,
      createAuthRequestOptions,
      isAuthEnabled,
      isNativeSessionRuntime,
      keepDeviceSession,
      persistAuthSession,
      snapshot.refreshToken,
    ])

  const restoreSession =
    useCallback(async (): Promise<SessionRecoveryResult> => {
      if (!isAuthEnabled) {
        return 'signed_out'
      }

      const storedSession = await readStoredAuthSession()

      if (!storedSession) {
        if (isNativeSessionRuntime && snapshot.sessionAccessToken) {
          return keepDeviceSession(
            new Error('Native auth storage returned no session.'),
            'Native auth session restore skipped.',
            'storage_empty_on_resume',
            null,
          )
        }

        dispatchAuthState({ type: 'auth.session_cleared' })
        return 'signed_out'
      }

      if (!isNativeSessionRuntime && storedSession.refreshToken) {
        return recoverSession()
      }

      if (isAccessTokenUsable(storedSession.expiresAt)) {
        setAuthNotice(null)
        dispatchAuthState({
          includeRefreshToken: isNativeSessionRuntime,
          session: storedSession,
          type: 'auth.session_restored',
        })
        return 'recovered'
      }

      return recoverSession()
    }, [
      isAuthEnabled,
      isNativeSessionRuntime,
      keepDeviceSession,
      recoverSession,
      snapshot,
    ])

  useEffect(() => {
    restoreSessionRef.current = restoreSession
  }, [restoreSession])

  const clearAuthNotice = useCallback(() => {
    setAuthNotice(null)
  }, [])

  const expireSession = useCallback(
    async (message = DEFAULT_EXPIRED_SESSION_MESSAGE) => {
      await clearAuthSession(message)
    },
    [clearAuthSession],
  )

  useEffect(() => {
    if (!isAuthEnabled) {
      return
    }

    let isActive = true
    let removeAppStateListener: (() => Promise<void>) | null = null

    async function syncNativeAppState(nextIsActive: boolean) {
      if (!isNativeSessionRuntime || !nextIsActive) {
        return
      }

      await restoreSessionRef.current()
    }

    async function bootstrapAuthSession() {
      if (isNativeSessionRuntime) {
        const appIsActive = await getNativeAppIsActive().catch((error) => {
          console.warn('Failed to resolve native app state.', error)
          return true
        })

        if (!isActive || !appIsActive) {
          dispatchAuthState({ type: 'auth.loading_finished' })
          return
        }
      }

      await restoreSessionRef.current()
    }

    void bootstrapAuthSession()

    if (isNativeSessionRuntime) {
      void addNativeAppStateChangeListener((nextIsActive) => {
        if (!isActive) {
          return
        }

        void syncNativeAppState(nextIsActive)
      }).then((listenerHandle) => {
        if (!isActive) {
          void listenerHandle.remove()
          return
        }

        removeAppStateListener = () => listenerHandle.remove()
      })
    }

    return () => {
      isActive = false

      if (removeAppStateListener) {
        void removeAppStateListener()
      }
    }
  }, [isAuthEnabled, isNativeSessionRuntime])

  useEffect(() => {
    clearRefreshTimer()

    if (
      !isAuthEnabled ||
      !snapshot.expiresAt ||
      (isNativeSessionRuntime &&
        (!snapshot.refreshToken ||
          blockedNativeRefreshTokenRef.current === snapshot.refreshToken))
    ) {
      return
    }

    const refreshDelayMs = Math.max(
      new Date(snapshot.expiresAt).getTime() -
        Date.now() -
        ACCESS_TOKEN_EXPIRY_GRACE_MS,
      5_000,
    )

    refreshTimerRef.current = window.setTimeout(() => {
      void recoverSession()
    }, refreshDelayMs)

    return clearRefreshTimer
  }, [
    clearRefreshTimer,
    isAuthEnabled,
    isNativeSessionRuntime,
    recoverSession,
    snapshot.expiresAt,
    snapshot.refreshToken,
  ])

  const requestPasswordReset = useCallback(async (email: string) => {
    setAuthNotice(null)
    await requestPasswordResetApi({ email })
  }, [])

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      setAuthNotice(null)

      const session = await signInWithPasswordApi(
        { email, password },
        await createAuthRequestOptions(),
      )
      await persistAuthSession(session)
    },
    [createAuthRequestOptions, persistAuthSession],
  )

  const signUpWithPassword = useCallback(
    async (input: PasswordSignUpInput) => {
      setAuthNotice(null)

      const session = await signUpWithPasswordApi(
        input,
        await createAuthRequestOptions(),
      )
      await persistAuthSession(session)

      return {
        requiresEmailConfirmation: false,
      }
    },
    [createAuthRequestOptions, persistAuthSession],
  )

  const signOut = useCallback(async () => {
    await clearAuthSession(false)
  }, [clearAuthSession])

  const updatePassword = useCallback(
    async (password: string, currentPassword?: string) => {
      setAuthNotice(null)

      if (passwordResetToken) {
        const session = await confirmPasswordReset(
          {
            password,
            token: passwordResetToken,
          },
          await createAuthRequestOptions(),
        )
        await persistAuthSession(session)
        return
      }

      if (!snapshot.sessionAccessToken || !currentPassword) {
        throw new Error('Current password is required.')
      }

      const session = await updatePasswordApi(
        {
          currentPassword,
          password,
        },
        snapshot.sessionAccessToken,
        await createAuthRequestOptions(),
      )
      await persistAuthSession(session)
    },
    [
      createAuthRequestOptions,
      passwordResetToken,
      persistAuthSession,
      snapshot.sessionAccessToken,
    ],
  )

  const value: SessionAuthState = useMemo(() => {
    const accessToken =
      snapshot.sessionAccessToken ??
      (isAuthEnabled ? null : (plannerApiConfig.apiAccessToken ?? null))
    const lifecycleStatus = resolveSessionAuthLifecycleStatus({
      accessToken: snapshot.sessionAccessToken,
      email: snapshot.email,
      isAuthEnabled,
      isLoading: isAuthEnabled && snapshot.isLoading,
      userId: snapshot.userId,
    })

    return {
      accessToken,
      authNotice,
      canUseProtectedApi: canUseProtectedSessionApi({
        accessToken,
        isAuthEnabled,
      }),
      clearAuthNotice,
      email: snapshot.email,
      expireSession,
      isAuthEnabled,
      isLoading: isAuthEnabled && snapshot.isLoading,
      isPasswordRecovery,
      lifecycleStatus,
      recoverSession,
      requestPasswordReset,
      sessionVersion,
      signInWithPassword,
      signOut,
      signUpWithPassword,
      updatePassword,
      userId: snapshot.userId,
    }
  }, [
    authNotice,
    clearAuthNotice,
    expireSession,
    isAuthEnabled,
    isPasswordRecovery,
    recoverSession,
    requestPasswordReset,
    sessionVersion,
    signInWithPassword,
    signOut,
    signUpWithPassword,
    snapshot.email,
    snapshot.isLoading,
    snapshot.sessionAccessToken,
    snapshot.userId,
    updatePassword,
  ])

  return (
    <SessionAuthContext.Provider value={value}>
      {children}
    </SessionAuthContext.Provider>
  )
}

function toStoredAuthSession(
  session: {
    accessToken: string
    expiresAt: string
    refreshToken?: string | undefined
    user: {
      email: string
      id: string
    }
  },
  options: {
    includeRefreshToken: boolean
  },
): StoredAuthSession {
  return {
    accessToken: session.accessToken,
    email: session.user.email,
    expiresAt: session.expiresAt,
    ...(options.includeRefreshToken && session.refreshToken
      ? { refreshToken: session.refreshToken }
      : {}),
    userId: session.user.id,
  }
}

function readPasswordResetToken(location: Location): string | null {
  const searchToken = new URLSearchParams(location.search).get('reset_token')

  if (searchToken) {
    return searchToken
  }

  return new URLSearchParams(location.hash.replace(/^#/, '')).get('reset_token')
}

function clearPasswordResetUrlParams() {
  if (typeof window === 'undefined') {
    return
  }

  if (
    !window.location.search.includes('reset_token') &&
    !window.location.hash.includes('reset_token')
  ) {
    return
  }

  window.history.replaceState({}, document.title, window.location.pathname)
}

function isRetryableAuthError(error: unknown): boolean {
  if (error instanceof DOMException || error instanceof TypeError) {
    return true
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status
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

function getAuthErrorKind(error: unknown): string {
  if (error instanceof DOMException) {
    return 'dom_exception'
  }

  if (error instanceof TypeError) {
    return 'network'
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status

    if (typeof status === 'number') {
      return `http_${status}`
    }
  }

  if (error instanceof Error && /timeout/i.test(error.message)) {
    return 'timeout'
  }

  return 'unknown'
}

function shouldKeepNativeDeviceSessionAfterRefreshError(
  error: unknown,
  storedSession: StoredAuthSession | null,
): boolean {
  return Boolean(storedSession) || isRetryableAuthError(error)
}
