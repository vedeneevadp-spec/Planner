import {
  type PropsWithChildren,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'

import {
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
  isNativeSessionPersistenceRuntime,
} from '../lib/native-session-storage'
import { clearCachedPlannerSession } from '../lib/planner-session-cache'
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

interface AuthSnapshot {
  email: string | null
  expiresAt: string | null
  isLoading: boolean
  refreshToken: string | null
  sessionAccessToken: string | null
  userId: string | null
}

const INITIAL_AUTH_SNAPSHOT: AuthSnapshot = {
  email: null,
  expiresAt: null,
  isLoading: false,
  refreshToken: null,
  sessionAccessToken: null,
  userId: null,
}

const DEFAULT_EXPIRED_SESSION_MESSAGE =
  'Сессия истекла или больше не принимается сервером. Войдите заново.'
const ACCESS_TOKEN_EXPIRY_GRACE_MS = 30_000

export function SessionProvider({ children }: PropsWithChildren) {
  const isAuthEnabled = plannerApiConfig.authProvider === 'planner'
  const isNativeSessionRuntime = isNativeSessionPersistenceRuntime()
  const pendingSignOutNoticeRef = useRef<string | false | null>(null)
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
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    ...INITIAL_AUTH_SNAPSHOT,
    isLoading: isAuthEnabled,
  })
  const [sessionVersion, setSessionVersion] = useState(0)
  const isPasswordRecovery = passwordResetToken !== null

  const commitAuthSnapshot = useCallback(
    (nextSnapshot: SetStateAction<AuthSnapshot>) => {
      setSnapshot(nextSnapshot)
      setSessionVersion((currentVersion) => currentVersion + 1)
    },
    [],
  )

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current === null) {
      return
    }

    window.clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = null
  }, [])

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
      setPasswordResetToken(null)
      clearPasswordResetUrlParams()
      setAuthNotice(null)
      commitAuthSnapshot(
        toAuthSnapshot(storedSession, false, isNativeSessionRuntime),
      )
    },
    [commitAuthSnapshot, isNativeSessionRuntime],
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
      setAuthNotice(notice === false ? null : notice)
      setPasswordResetToken(null)
      clearCachedPlannerSession(actorUserId)
      clearSelectedWorkspaceId(actorUserId)
      clearLastActorUserId()
      await clearStoredAuthSession()
      commitAuthSnapshot({
        ...INITIAL_AUTH_SNAPSHOT,
        isLoading: false,
      })

      if (!isNativeSessionRuntime || refreshToken) {
        await signOutAuthSession(refreshToken ? { refreshToken } : {}, {
          tokenTransport: isNativeSessionRuntime ? 'body' : 'cookie',
        }).catch((error) => {
          if (!isUnauthorizedAuthApiError(error)) {
            console.error('Failed to revoke auth session.', error)
          }
        })
      }

      pendingSignOutNoticeRef.current = null
    },
    [
      clearRefreshTimer,
      commitAuthSnapshot,
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
      storedSession: StoredAuthSession | null,
    ) => {
      console.warn(logMessage, error)
      setAuthNotice(null)
      commitAuthSnapshot((currentSnapshot) =>
        storedSession
          ? toAuthSnapshot(storedSession, false, isNativeSessionRuntime)
          : {
              ...currentSnapshot,
              isLoading: false,
            },
      )

      return 'deferred' as const
    },
    [commitAuthSnapshot, isNativeSessionRuntime],
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
          return 'signed_out' as const
        }

        try {
          const refreshedSession = await refreshAuthSession(
            refreshToken ? { refreshToken } : {},
            {
              rememberSession: getRememberSessionPreference(),
              tokenTransport: isNativeSessionRuntime ? 'body' : 'cookie',
            },
          )
          await persistAuthSession(refreshedSession)

          return 'recovered' as const
        } catch (error) {
          if (isNativeSessionRuntime && isRetryableAuthError(error)) {
            return keepDeviceSession(
              error,
              'Auth session refresh deferred to device session.',
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
              commitAuthSnapshot(
                toAuthSnapshot(
                  latestStoredSession,
                  false,
                  isNativeSessionRuntime,
                ),
              )

              return isAccessTokenUsable(latestStoredSession.expiresAt)
                ? ('recovered' as const)
                : ('deferred' as const)
            }
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
      commitAuthSnapshot,
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
        commitAuthSnapshot({
          ...INITIAL_AUTH_SNAPSHOT,
          isLoading: false,
        })
        return 'signed_out'
      }

      if (!isNativeSessionRuntime && storedSession.refreshToken) {
        return recoverSession()
      }

      if (isAccessTokenUsable(storedSession.expiresAt)) {
        setAuthNotice(null)
        commitAuthSnapshot(
          toAuthSnapshot(storedSession, false, isNativeSessionRuntime),
        )
        return 'recovered'
      }

      return recoverSession()
    }, [
      commitAuthSnapshot,
      isAuthEnabled,
      isNativeSessionRuntime,
      recoverSession,
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
          commitAuthSnapshot((currentSnapshot) => ({
            ...currentSnapshot,
            isLoading: false,
          }))
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
  }, [commitAuthSnapshot, isAuthEnabled, isNativeSessionRuntime])

  useEffect(() => {
    clearRefreshTimer()

    if (
      !isAuthEnabled ||
      !snapshot.expiresAt ||
      (isNativeSessionRuntime && !snapshot.refreshToken)
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
        {
          rememberSession: getRememberSessionPreference(),
          tokenTransport: isNativeSessionRuntime ? 'body' : 'cookie',
        },
      )
      await persistAuthSession(session)
    },
    [isNativeSessionRuntime, persistAuthSession],
  )

  const signUpWithPassword = useCallback(
    async (input: PasswordSignUpInput) => {
      setAuthNotice(null)

      const session = await signUpWithPasswordApi(input, {
        rememberSession: getRememberSessionPreference(),
        tokenTransport: isNativeSessionRuntime ? 'body' : 'cookie',
      })
      await persistAuthSession(session)

      return {
        requiresEmailConfirmation: false,
      }
    },
    [isNativeSessionRuntime, persistAuthSession],
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
          {
            rememberSession: getRememberSessionPreference(),
            tokenTransport: isNativeSessionRuntime ? 'body' : 'cookie',
          },
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
        {
          rememberSession: getRememberSessionPreference(),
          tokenTransport: isNativeSessionRuntime ? 'body' : 'cookie',
        },
      )
      await persistAuthSession(session)
    },
    [
      isNativeSessionRuntime,
      passwordResetToken,
      persistAuthSession,
      snapshot.sessionAccessToken,
    ],
  )

  const value: SessionAuthState = useMemo(
    () => ({
      accessToken:
        snapshot.sessionAccessToken ??
        (isAuthEnabled ? null : (plannerApiConfig.apiAccessToken ?? null)),
      authNotice,
      clearAuthNotice,
      email: snapshot.email,
      expireSession,
      isAuthEnabled,
      isLoading: isAuthEnabled && snapshot.isLoading,
      isPasswordRecovery,
      recoverSession,
      requestPasswordReset,
      sessionVersion,
      signInWithPassword,
      signOut,
      signUpWithPassword,
      updatePassword,
      userId: snapshot.userId,
    }),
    [
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
    ],
  )

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

function toAuthSnapshot(
  session: StoredAuthSession | null,
  isLoading: boolean,
  includeRefreshToken: boolean,
): AuthSnapshot {
  if (!session) {
    return {
      ...INITIAL_AUTH_SNAPSHOT,
      isLoading,
    }
  }

  return {
    email: session.email,
    expiresAt: session.expiresAt,
    isLoading,
    refreshToken: includeRefreshToken ? (session.refreshToken ?? null) : null,
    sessionAccessToken: isAccessTokenUsable(session.expiresAt)
      ? session.accessToken
      : null,
    userId: session.userId,
  }
}

function isAccessTokenUsable(expiresAt: string): boolean {
  return (
    new Date(expiresAt).getTime() > Date.now() + ACCESS_TOKEN_EXPIRY_GRACE_MS
  )
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
