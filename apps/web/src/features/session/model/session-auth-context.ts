import { createContext } from 'react'

export interface PasswordSignUpInput {
  displayName?: string
  email: string
  password: string
}

export interface PasswordSignUpResult {
  requiresEmailConfirmation: boolean
}

export interface SessionAuthState {
  accessToken: string | null
  email: string | null
  isAuthEnabled: boolean
  isLoading: boolean
  isPasswordRecovery: boolean
  requestPasswordReset: (email: string) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signInWithOtp: (email: string) => Promise<void>
  signUpWithPassword: (
    input: PasswordSignUpInput,
  ) => Promise<PasswordSignUpResult>
  signOut: () => Promise<void>
  updatePassword: (password: string) => Promise<void>
  userId: string | null
}

export const SessionAuthContext = createContext<SessionAuthState | null>(null)
