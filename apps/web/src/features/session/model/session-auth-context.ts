import { createContext } from 'react'

export interface PasswordSignUpInput {
  displayName?: string
  email: string
  password: string
}

export interface PasswordSignUpResult {
  requiresEmailConfirmation: boolean
}

export type SessionRecoveryResult = 'deferred' | 'recovered' | 'signed_out'
export type SessionAuthLifecycleStatus =
  'authenticated' | 'deferred' | 'disabled' | 'restoring' | 'signed_out'

export interface SessionAuthState {
  accessToken: string | null
  authNotice: string | null
  canUseProtectedApi: boolean
  clearAuthNotice: () => void
  email: string | null
  expireSession: (message?: string) => Promise<void>
  isAuthEnabled: boolean
  isLoading: boolean
  isPasswordRecovery: boolean
  lifecycleStatus: SessionAuthLifecycleStatus
  recoverSession: () => Promise<SessionRecoveryResult>
  requestPasswordReset: (email: string) => Promise<void>
  sessionVersion: number
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (
    input: PasswordSignUpInput,
  ) => Promise<PasswordSignUpResult>
  signOut: () => Promise<void>
  updatePassword: (password: string, currentPassword?: string) => Promise<void>
  userId: string | null
}

export const SessionAuthContext = createContext<SessionAuthState | null>(null)
