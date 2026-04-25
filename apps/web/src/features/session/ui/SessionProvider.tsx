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

import {
  clearSupabaseBrowserAuthStorage,
  getSupabaseBrowserClient,
} from '../lib/supabase-browser'
import {
  type PasswordSignUpInput,
  SessionAuthContext,
  type SessionAuthState,
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

export function SessionProvider({ children }: PropsWithChildren) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const isAuthEnabled = supabase !== null
  const pendingSignOutNoticeRef = useRef<string | false | null>(null)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    () =>
      typeof window !== 'undefined' && hasRecoveryUrlParams(window.location),
  )
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    ...INITIAL_AUTH_SNAPSHOT,
    isLoading: isAuthEnabled,
  })

  useEffect(() => {
    if (!supabase) {
      return
    }

    const authClient = supabase
    let isActive = true

    async function bootstrapSession() {
      const { data, error } = await authClient.auth.getSession()

      if (!isActive) {
        return
      }

      if (error) {
        console.error('Failed to restore Supabase session.', error)
        setAuthNotice(DEFAULT_EXPIRED_SESSION_MESSAGE)
        clearSupabaseBrowserAuthStorage()
        setSnapshot({
          ...INITIAL_AUTH_SNAPSHOT,
          isLoading: false,
        })

        return
      }

      setSnapshot(toAuthSnapshot(data.session, false))
    }

    void bootstrapSession()

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
        setAuthNotice(
          pendingNotice === false
            ? null
            : (pendingNotice ?? DEFAULT_EXPIRED_SESSION_MESSAGE),
        )
      }

      setSnapshot(toAuthSnapshot(session, false))
    })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [supabase])

  const clearAuthSession = useCallback(
    async (notice: string | false | null) => {
      pendingSignOutNoticeRef.current = notice
      setAuthNotice(notice === false ? null : notice)
      setIsPasswordRecovery(false)
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
        clearSupabaseBrowserAuthStorage()
        pendingSignOutNoticeRef.current = null
      }
    },
    [supabase],
  )

  const clearAuthNotice = useCallback(() => {
    setAuthNotice(null)
  }, [])

  const expireSession = useCallback(
    async (message = DEFAULT_EXPIRED_SESSION_MESSAGE) => {
      await clearAuthSession(message)
    },
    [clearAuthSession],
  )

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

  return {
    email: session.user.email ?? null,
    isLoading,
    sessionAccessToken: session.access_token,
    userId: session.user.id,
  }
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
