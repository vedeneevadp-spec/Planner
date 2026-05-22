import {
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
  type PasswordSignUpInput,
  type SessionAuthState,
  type SessionRecoveryResult,
} from '../model/session-auth-context'
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
} from './auth-api'
import {
  clearStoredAuthSession,
  getRememberSessionPreference,
  readStoredAuthSession,
  type StoredAuthSession,
  writeStoredAuthSession,
} from './auth-session-storage'
import { unregisterStoredNativePushDevice } from './native-push-notifications'
import {
  addNativeAppStateChangeListener,
  getNativeAppIsActive,
  getNativeAuthDeviceId,
  isNativeSessionPersistenceRuntime,
} from './native-session-storage'
import { clearCachedPlannerSession } from './planner-session-cache'
import { canUseProtectedSessionApi } from './session-auth-lifecycle'
import {
  DEFAULT_EXPIRED_SESSION_MESSAGE,
  getAuthErrorKind,
  type SessionAuthMachineCommand,
  transitionSessionAuthMachine,
} from './session-auth-machine'
import {
  createInitialSessionAuthState,
  sessionAuthReducer,
} from './session-auth-reducer'
import {
  clearLastActorUserId,
  clearSelectedWorkspaceId,
  getLastActorUserId,
} from './workspace-selection'

export function useSessionAuthController(): SessionAuthState {
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
  const [{ lifecycleStatus, sessionVersion, snapshot }, dispatchAuthState] =
    useReducer(sessionAuthReducer, isAuthEnabled, createInitialSessionAuthState)
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
      command: Extract<
        SessionAuthMachineCommand,
        { type: 'keep_device_session' }
      >,
    ) => {
      if (command.reason === 'retryable_refresh_error') {
        recordClientEvent(
          'auth_refresh_deferred',
          {
            errorKind: getAuthErrorKind(command.error),
            hasStoredSession: Boolean(command.storedSession),
          },
          { level: 'warn' },
        )
      }

      if (command.blockRefreshToken !== undefined) {
        blockedNativeRefreshTokenRef.current = command.blockRefreshToken
      }

      console.warn(command.logMessage, command.error)
      setAuthNotice(null)
      dispatchAuthState({
        includeRefreshToken: isNativeSessionRuntime,
        session: command.storedSession,
        type: 'auth.device_session_kept',
      })
      recordClientEvent(
        'auth_device_session_kept',
        {
          hasStoredAccessToken: Boolean(command.storedSession?.accessToken),
          hasStoredRefreshToken: Boolean(command.storedSession?.refreshToken),
          hasStoredSession: Boolean(command.storedSession),
          reason: command.reason,
        },
        { level: 'warn' },
      )

      return command.result
    },
    [isNativeSessionRuntime],
  )

  const recoverSession =
    useCallback(async (): Promise<SessionRecoveryResult> => {
      if (sessionRecoveryRef.current) {
        return sessionRecoveryRef.current
      }

      const recovery = (async () => {
        setAuthNotice(null)

        const storedSession = await readStoredAuthSession()
        const recoveryCommand = transitionSessionAuthMachine({
          blockedRefreshToken: blockedNativeRefreshTokenRef.current,
          currentRefreshToken: snapshot.refreshToken,
          isAuthEnabled,
          nativeRuntime: isNativeSessionRuntime,
          storedSession,
          type: 'auth.recovery_requested',
        })

        switch (recoveryCommand.type) {
          case 'none':
            return recoveryCommand.result ?? 'signed_out'

          case 'clear_session':
            dispatchAuthState({ type: 'auth.session_cleared' })
            return recoveryCommand.result

          case 'keep_device_session':
            return keepDeviceSession(recoveryCommand)

          case 'request_refresh':
            try {
              const refreshedSession = await refreshAuthSession(
                recoveryCommand.refreshToken
                  ? { refreshToken: recoveryCommand.refreshToken }
                  : {},
                await createAuthRequestOptions(),
              )
              await persistAuthSession(refreshedSession)

              return 'recovered' as const
            } catch (error) {
              const refreshFailureCommand = transitionSessionAuthMachine({
                error,
                nativeRuntime: isNativeSessionRuntime,
                refreshToken: recoveryCommand.refreshToken,
                storedSession,
                type: 'auth.refresh_failed',
              })

              switch (refreshFailureCommand.type) {
                case 'keep_device_session':
                  return keepDeviceSession(refreshFailureCommand)

                case 'read_latest_native_session': {
                  const latestStoredSession =
                    await readStoredAuthSession().catch((storageError) => {
                      console.warn(
                        'Failed to re-read native auth session after refresh error.',
                        storageError,
                      )
                      return null
                    })

                  const storageCommand = transitionSessionAuthMachine({
                    error: refreshFailureCommand.error,
                    latestStoredSession,
                    previousRefreshToken:
                      refreshFailureCommand.previousRefreshToken,
                    storedSession: refreshFailureCommand.storedSession,
                    type: 'auth.refresh_storage_checked',
                  })

                  switch (storageCommand.type) {
                    case 'restore_latest_stored_session':
                      setAuthNotice(null)
                      dispatchAuthState({
                        includeRefreshToken: isNativeSessionRuntime,
                        session: storageCommand.storedSession,
                        type: 'auth.session_restored',
                      })

                      return storageCommand.result

                    case 'keep_device_session':
                      return keepDeviceSession(storageCommand)

                    case 'clear_expired_session':
                      await clearAuthSession(storageCommand.notice)
                      return storageCommand.result

                    default:
                      throw new Error(
                        `Unexpected refresh storage command: ${storageCommand.type}`,
                      )
                  }
                }

                case 'clear_expired_session':
                  await clearAuthSession(refreshFailureCommand.notice)
                  return refreshFailureCommand.result

                default:
                  throw new Error(
                    `Unexpected refresh failure command: ${refreshFailureCommand.type}`,
                  )
              }
            }

          default:
            throw new Error(
              `Unexpected recovery command: ${recoveryCommand.type}`,
            )
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
      const storedSession = await readStoredAuthSession()
      const restoreCommand = transitionSessionAuthMachine({
        currentHasAccessToken: Boolean(snapshot.sessionAccessToken),
        isAuthEnabled,
        nativeRuntime: isNativeSessionRuntime,
        storedSession,
        type: 'auth.restore_requested',
      })

      switch (restoreCommand.type) {
        case 'none':
          return restoreCommand.result ?? 'signed_out'

        case 'clear_session':
          dispatchAuthState({ type: 'auth.session_cleared' })
          return restoreCommand.result

        case 'keep_device_session':
          return keepDeviceSession(restoreCommand)

        case 'recover_session':
          return recoverSession()

        case 'commit_stored_session':
          setAuthNotice(null)
          dispatchAuthState({
            includeRefreshToken: isNativeSessionRuntime,
            session: restoreCommand.storedSession,
            type: 'auth.session_restored',
          })
          return restoreCommand.result

        default:
          throw new Error(`Unexpected restore command: ${restoreCommand.type}`)
      }
    }, [
      isAuthEnabled,
      isNativeSessionRuntime,
      keepDeviceSession,
      recoverSession,
      snapshot.sessionAccessToken,
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
      const command = transitionSessionAuthMachine({
        nativeAppIsActive: nextIsActive,
        nativeRuntime: isNativeSessionRuntime,
        type: 'auth.native_app_state_changed',
      })

      if (command.type === 'restore_session') {
        await restoreSessionRef.current()
      }
    }

    async function bootstrapAuthSession() {
      let nativeAppIsActive = true

      if (isNativeSessionRuntime) {
        nativeAppIsActive = await getNativeAppIsActive().catch((error) => {
          console.warn('Failed to resolve native app state.', error)
          return true
        })

        if (!isActive) {
          return
        }
      }

      const command = transitionSessionAuthMachine({
        isAuthEnabled,
        nativeAppIsActive,
        nativeRuntime: isNativeSessionRuntime,
        type: 'auth.bootstrap_requested',
      })

      if (command.type === 'finish_loading') {
        dispatchAuthState({ type: 'auth.loading_finished' })
        return
      }

      if (command.type === 'restore_session') {
        await restoreSessionRef.current()
      }
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

    const command = transitionSessionAuthMachine({
      blockedRefreshToken: blockedNativeRefreshTokenRef.current,
      expiresAt: snapshot.expiresAt,
      isAuthEnabled,
      nativeRuntime: isNativeSessionRuntime,
      nowMs: Date.now(),
      refreshToken: snapshot.refreshToken,
      type: 'auth.refresh_timer_changed',
    })

    if (command.type !== 'schedule_refresh') {
      return
    }

    refreshTimerRef.current = window.setTimeout(() => {
      void recoverSession()
    }, command.delayMs)

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
    lifecycleStatus,
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

  return value
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
