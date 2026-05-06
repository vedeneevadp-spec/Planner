import type { Session } from '@supabase/supabase-js'
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { unregisterStoredNativePushDevice } from '../lib/native-push-notifications'
import {
  addNativeAppStateChangeListener,
  getNativeAppIsActive,
  isNativeSessionPersistenceRuntime,
} from '../lib/native-session-storage'
import { clearCachedPlannerSession } from '../lib/planner-session-cache'
import {
  clearSupabaseBrowserAuthStorage,
  getSupabaseBrowserClient,
  readSupabaseStoredSession,
} from '../lib/supabase-browser'
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
  isLoading: boolean
  sessionAccessToken: string | null
  userId: string | null
}

const INITIAL_AUTH_SNAPSHOT: AuthSnapshot = {
  email: null,
  isLoading: false,
  sessionAccessToken: null,
  userId: null,
}

const DEFAULT_EXPIRED_SESSION_MESSAGE =
  'Сессия истекла или больше не принимается сервером. Войдите заново.'
const ACCESS_TOKEN_EXPIRY_GRACE_MS = 30_000

export function SessionProvider({ children }: PropsWithChildren) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const isAuthEnabled = supabase !== null
  const isNativeSessionRuntime = isNativeSessionPersistenceRuntime()
  const pendingSignOutNoticeRef = useRef<string | false | null>(null)
  const sessionRecoveryRef = useRef<Promise<SessionRecoveryResult> | null>(null)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    () =>
      typeof window !== 'undefined' && hasRecoveryUrlParams(window.location),
  )
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    ...INITIAL_AUTH_SNAPSHOT,
    isLoading: isAuthEnabled,
  })

  const clearAuthSession = useCallback(
    async (notice: string | false | null) => {
      const actorUserId = snapshot.userId ?? getLastActorUserId()

      await unregisterStoredNativePushDevice({
        accessToken: snapshot.sessionAccessToken,
        actorUserId,
        apiBaseUrl: plannerApiConfig.apiBaseUrl,
      })

      pendingSignOutNoticeRef.current = notice
      setAuthNotice(notice === false ? null : notice)
      setIsPasswordRecovery(false)
      clearCachedPlannerSession(actorUserId)
      clearSelectedWorkspaceId(actorUserId)
      clearLastActorUserId()
      setSnapshot({
        ...INITIAL_AUTH_SNAPSHOT,
        isLoading: false,
      })

      if (!supabase) {
        return
      }

      const { error } = await supabase.auth.signOut()

      if (error) {
        console.error('Failed to clear Supabase session.', error)
        await clearSupabaseBrowserAuthStorage()
        pendingSignOutNoticeRef.current = null
      }
    },
    [snapshot.sessionAccessToken, snapshot.userId, supabase],
  )

  const keepDeviceSession = useCallback(
    (error: unknown, logMessage: string) => {
      console.warn(logMessage, error)
      setAuthNotice(null)
      setSnapshot({
        ...INITIAL_AUTH_SNAPSHOT,
        isLoading: false,
      })

      return 'deferred' as const
    },
    [],
  )

  const keepStoredSession = useCallback(
    async (error: unknown, logMessage: string) => {
      if (!isRetryableSupabaseAuthError(error)) {
        return null
      }

      const storedSession = await readSupabaseStoredSession()

      if (!storedSession) {
        return null
      }

      console.warn(logMessage, error)
      setAuthNotice(null)
      setSnapshot(toAuthSnapshot(storedSession, false))

      return 'deferred' as const
    },
    [],
  )

  const restoreSession =
    useCallback(async (): Promise<SessionRecoveryResult> => {
      if (!supabase) {
        return 'signed_out'
      }

      const { data, error } = await supabase.auth.getSession()

      if (error) {
        const deferredSession = await keepStoredSession(
          error,
          'Supabase session restore deferred.',
        )

        if (deferredSession) {
          return deferredSession
        }

        return keepDeviceSession(
          error,
          'Supabase session restore deferred to device session.',
        )
      }

      setAuthNotice(null)
      setSnapshot(toAuthSnapshot(data.session, false))

      return data.session ? 'recovered' : 'signed_out'
    }, [keepDeviceSession, keepStoredSession, supabase])

  const clearAuthNotice = useCallback(() => {
    setAuthNotice(null)
  }, [])

  const expireSession = useCallback(
    async (message = DEFAULT_EXPIRED_SESSION_MESSAGE) => {
      await clearAuthSession(message)
    },
    [clearAuthSession],
  )

  const recoverSession =
    useCallback(async (): Promise<SessionRecoveryResult> => {
      if (!supabase) {
        return 'signed_out'
      }

      if (sessionRecoveryRef.current) {
        return sessionRecoveryRef.current
      }

      const recovery = (async () => {
        setAuthNotice(null)

        const { data, error } = await supabase.auth.refreshSession()

        if (error) {
          const deferredSession = await keepStoredSession(
            error,
            'Supabase session refresh deferred.',
          )

          if (deferredSession) {
            return deferredSession
          }

          return keepDeviceSession(
            error,
            'Supabase session refresh deferred to device session.',
          )
        }

        if (!data.session) {
          return keepDeviceSession(
            new Error('Supabase refresh did not return a session.'),
            'Supabase session refresh deferred to device session.',
          )
        }

        setSnapshot(toAuthSnapshot(data.session, false))
        return 'recovered' as const
      })().finally(() => {
        sessionRecoveryRef.current = null
      })

      sessionRecoveryRef.current = recovery

      return recovery
    }, [keepDeviceSession, keepStoredSession, supabase])

  useEffect(() => {
    if (!supabase) {
      return
    }

    const authClient = supabase
    let isActive = true
    let removeAppStateListener: (() => Promise<void>) | null = null

    async function syncNativeAppState(nextIsActive: boolean) {
      if (!isNativeSessionRuntime) {
        return
      }

      if (nextIsActive) {
        await authClient.auth.startAutoRefresh()
        await restoreSession()
        return
      }

      await authClient.auth.stopAutoRefresh()
    }

    async function bootstrapAuthSession() {
      const storedSession = await readSupabaseStoredSession()

      if (isActive && storedSession) {
        setAuthNotice(null)
        setSnapshot(toAuthSnapshot(storedSession, false))
      }

      if (isNativeSessionRuntime) {
        const appIsActive = await getNativeAppIsActive().catch((error) => {
          console.warn('Failed to resolve native app state.', error)
          return true
        })

        if (!isActive) {
          return
        }

        if (appIsActive) {
          await authClient.auth.startAutoRefresh()
        } else {
          await authClient.auth.stopAutoRefresh()
        }
      }

      await restoreSession()
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

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((event, session) => {
      if (!isActive) {
        return
      }

      if (event === 'PASSWORD_RECOVERY') {
        setAuthNotice(null)
        setIsPasswordRecovery(true)
        clearSupabaseAuthUrlFragment()
      } else if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setIsPasswordRecovery(false)
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setAuthNotice(null)
      }

      if (event === 'SIGNED_OUT') {
        const pendingNotice = pendingSignOutNoticeRef.current
        pendingSignOutNoticeRef.current = null
        setAuthNotice(pendingNotice === false ? null : pendingNotice)
      }

      setSnapshot(toAuthSnapshot(session, false))
    })

    return () => {
      isActive = false
      subscription.unsubscribe()

      if (removeAppStateListener) {
        void removeAppStateListener()
      }

      if (isNativeSessionRuntime) {
        void authClient.auth.stopAutoRefresh()
      }
    }
  }, [isNativeSessionRuntime, restoreSession, supabase])

  const requestPasswordReset = useCallback(
    async (email: string) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

      setAuthNotice(null)

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })

      if (error) {
        throw error
      }
    },
    [supabase],
  )

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

      setAuthNotice(null)

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        throw error
      }
    },
    [supabase],
  )

  const signInWithOtp = useCallback(
    async (email: string) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

      setAuthNotice(null)

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      })

      if (error) {
        throw error
      }
    },
    [supabase],
  )

  const signUpWithPassword = useCallback(
    async (input: PasswordSignUpInput) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

      setAuthNotice(null)

      const signUpOptions = createEmailSignUpOptions(input)
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        options: signUpOptions,
        password: input.password,
      })

      if (error) {
        throw error
      }

      return {
        requiresEmailConfirmation: data.session === null,
      }
    },
    [supabase],
  )

  const signOut = useCallback(async () => {
    await clearAuthSession(false)
  }, [clearAuthSession])

  const updatePassword = useCallback(
    async (password: string) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

      setAuthNotice(null)

      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        throw error
      }
    },
    [supabase],
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
      signInWithOtp,
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
      signInWithOtp,
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

function toAuthSnapshot(
  session: Session | null,
  isLoading: boolean,
): AuthSnapshot {
  if (!session) {
    return {
      ...INITIAL_AUTH_SNAPSHOT,
      isLoading,
    }
  }

  const sessionUser = session.user ?? null

  return {
    email: sessionUser?.email ?? null,
    isLoading,
    sessionAccessToken: getUsableSessionAccessToken(session),
    userId: sessionUser?.id ?? null,
  }
}

function getUsableSessionAccessToken(session: Session): string | null {
  if (!session.expires_at) {
    return session.access_token
  }

  const expiresAtMs = session.expires_at * 1000

  if (expiresAtMs <= Date.now() + ACCESS_TOKEN_EXPIRY_GRACE_MS) {
    return null
  }

  return session.access_token
}

function createEmailSignUpOptions(input: PasswordSignUpInput) {
  const normalizedDisplayName = input.displayName?.trim()

  return {
    ...(normalizedDisplayName
      ? {
          data: {
            display_name: normalizedDisplayName,
            name: normalizedDisplayName,
          },
        }
      : {}),
    emailRedirectTo: window.location.origin,
  }
}

function hasRecoveryUrlParams(location: Location): boolean {
  return (
    location.hash.includes('type=recovery') ||
    location.search.includes('type=recovery')
  )
}

function clearSupabaseAuthUrlFragment() {
  if (typeof window === 'undefined') {
    return
  }

  if (!window.location.hash.includes('access_token')) {
    return
  }

  window.history.replaceState(
    {},
    document.title,
    `${window.location.pathname}${window.location.search}`,
  )
}

function isRetryableSupabaseAuthError(error: unknown): boolean {
  if (error instanceof DOMException || error instanceof TypeError) {
    return true
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'AuthRetryableFetchError' ||
      error.name === 'NetworkError' ||
      error.name === 'TimeoutError')
  ) {
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
