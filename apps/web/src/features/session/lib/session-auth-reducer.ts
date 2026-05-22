import type { SessionAuthLifecycleStatus } from '../model/session-auth-context'
import type { StoredAuthSession } from './auth-session-storage'
import { resolveSessionAuthLifecycleStatus } from './session-auth-lifecycle'

export interface SessionAuthSnapshot {
  email: string | null
  expiresAt: string | null
  isLoading: boolean
  refreshToken: string | null
  sessionAccessToken: string | null
  userId: string | null
}

export interface SessionAuthReducerState {
  isAuthEnabled: boolean
  lifecycleStatus: SessionAuthLifecycleStatus
  sessionVersion: number
  snapshot: SessionAuthSnapshot
}

export type SessionAuthReducerAction =
  | {
      type: 'auth.device_session_kept'
      includeRefreshToken: boolean
      session: StoredAuthSession | null
    }
  | {
      type: 'auth.loading_finished'
    }
  | {
      type: 'auth.session_cleared'
    }
  | {
      type: 'auth.session_restored'
      includeRefreshToken: boolean
      session: StoredAuthSession
    }

export const INITIAL_AUTH_SNAPSHOT: SessionAuthSnapshot = {
  email: null,
  expiresAt: null,
  isLoading: false,
  refreshToken: null,
  sessionAccessToken: null,
  userId: null,
}

export const ACCESS_TOKEN_EXPIRY_GRACE_MS = 30_000

export function createInitialSessionAuthState(
  isAuthEnabled: boolean,
): SessionAuthReducerState {
  const snapshot = {
    ...INITIAL_AUTH_SNAPSHOT,
    isLoading: isAuthEnabled,
  }

  return {
    isAuthEnabled,
    lifecycleStatus: resolveLifecycleStatus(snapshot, isAuthEnabled),
    sessionVersion: 0,
    snapshot,
  }
}

export function sessionAuthReducer(
  state: SessionAuthReducerState,
  action: SessionAuthReducerAction,
): SessionAuthReducerState {
  switch (action.type) {
    case 'auth.device_session_kept':
      return commitAuthSnapshot(
        state,
        action.session
          ? toAuthSnapshot(action.session, false, action.includeRefreshToken)
          : {
              ...state.snapshot,
              isLoading: false,
            },
      )

    case 'auth.loading_finished':
      return commitAuthSnapshot(state, {
        ...state.snapshot,
        isLoading: false,
      })

    case 'auth.session_cleared':
      return commitAuthSnapshot(state, {
        ...INITIAL_AUTH_SNAPSHOT,
        isLoading: false,
      })

    case 'auth.session_restored':
      return commitAuthSnapshot(
        state,
        toAuthSnapshot(action.session, false, action.includeRefreshToken),
      )
  }
}

export function toAuthSnapshot(
  session: StoredAuthSession | null,
  isLoading: boolean,
  includeRefreshToken: boolean,
): SessionAuthSnapshot {
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

export function isAccessTokenUsable(expiresAt: string): boolean {
  return (
    new Date(expiresAt).getTime() > Date.now() + ACCESS_TOKEN_EXPIRY_GRACE_MS
  )
}

function commitAuthSnapshot(
  state: SessionAuthReducerState,
  snapshot: SessionAuthSnapshot,
): SessionAuthReducerState {
  return {
    isAuthEnabled: state.isAuthEnabled,
    lifecycleStatus: resolveLifecycleStatus(snapshot, state.isAuthEnabled),
    sessionVersion: state.sessionVersion + 1,
    snapshot,
  }
}

function resolveLifecycleStatus(
  snapshot: SessionAuthSnapshot,
  isAuthEnabled: boolean,
): SessionAuthLifecycleStatus {
  return resolveSessionAuthLifecycleStatus({
    accessToken: snapshot.sessionAccessToken,
    email: snapshot.email,
    isAuthEnabled,
    isLoading: snapshot.isLoading,
    userId: snapshot.userId,
  })
}
