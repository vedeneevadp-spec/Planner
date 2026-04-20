import type { Session } from '@supabase/supabase-js'
import { type PropsWithChildren, useEffect, useMemo, useState } from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { getSupabaseBrowserClient } from '../lib/supabase-browser'
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

export function SessionProvider({ children }: PropsWithChildren) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const isAuthEnabled = supabase !== null
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    () =>
      typeof window !== 'undefined' && hasRecoveryUrlParams(window.location),
  )
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
        setIsPasswordRecovery(true)
        clearSupabaseAuthUrlFragment()
      } else if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setIsPasswordRecovery(false)
      }

      setSnapshot(toAuthSnapshot(session, false))
    })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [supabase])

  const value: SessionAuthState = {
    accessToken:
      snapshot.sessionAccessToken ?? plannerApiConfig.apiAccessToken ?? null,
    email: snapshot.email,
    isAuthEnabled,
    isLoading: isAuthEnabled && snapshot.isLoading,
    isPasswordRecovery,
    requestPasswordReset: async (email) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })

      if (error) {
        throw error
      }
    },
    signInWithPassword: async (email, password) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        throw error
      }
    },
    signInWithOtp: async (email) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

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
    signUpWithPassword: async (input) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

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
    signOut: async () => {
      if (!supabase) {
        return
      }

      const { error } = await supabase.auth.signOut()

      if (error) {
        throw error
      }
    },
    updatePassword: async (password) => {
      if (!supabase) {
        throw new Error('Supabase browser auth is not configured.')
      }

      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        throw error
      }
    },
    userId: snapshot.userId,
  }

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
