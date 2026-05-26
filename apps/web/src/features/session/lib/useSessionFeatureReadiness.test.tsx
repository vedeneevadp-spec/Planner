import type { SessionResponse } from '@planner/contracts'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionAuthState } from '../model/session-auth-context'

interface PlannerSessionQueryStub {
  data: SessionResponse | undefined
  error: unknown
  isPending: boolean
  refetch: () => Promise<void>
}

const mocks = vi.hoisted(() => ({
  usePlannerSession: vi.fn<() => PlannerSessionQueryStub>(),
  useSessionAuth: vi.fn<() => SessionAuthState>(),
}))

vi.mock('@/shared/config/planner-api', () => ({
  plannerApiConfig: {
    apiBaseUrl: 'https://api.chaotika.test',
    authProvider: 'planner',
  },
}))

vi.mock('./usePlannerSession', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
}))

vi.mock('./useSessionAuth', () => ({
  useSessionAuth: () => mocks.useSessionAuth(),
}))

import { useSessionFeatureReadiness } from './useSessionFeatureReadiness'

describe('useSessionFeatureReadiness', () => {
  let auth: SessionAuthState
  let sessionQuery: PlannerSessionQueryStub

  beforeEach(() => {
    auth = createAuthState()
    sessionQuery = {
      data: createSessionResponse(),
      error: null,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    }

    mocks.useSessionAuth.mockReturnValue(auth)
    mocks.usePlannerSession.mockReturnValue(sessionQuery)
  })

  it('builds protected API config when auth and planner session are ready', () => {
    const { result } = renderHook(() => useSessionFeatureReadiness())

    expect(result.current.readiness.status).toBe('ready')
    expect(result.current.isApiEnabled).toBe(true)
    expect(result.current.workspaceId).toBe('workspace-1')
    expect(result.current.apiConfig).toEqual({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      apiBaseUrl: 'https://api.chaotika.test',
      workspaceId: 'workspace-1',
    })
  })

  it('keeps readiness visible but disables API config when the feature is off', () => {
    const { result } = renderHook(() =>
      useSessionFeatureReadiness({ enabled: false }),
    )

    expect(result.current.readiness.status).toBe('ready')
    expect(result.current.isApiEnabled).toBe(false)
    expect(result.current.apiConfig).toBeNull()
  })

  it('allows cached rendering while auth is restoring without exposing writes', () => {
    auth = createAuthState({
      accessToken: null,
      canUseProtectedApi: false,
      isLoading: true,
      lifecycleStatus: 'restoring',
    })
    sessionQuery = {
      data: undefined,
      error: null,
      isPending: true,
      refetch: vi.fn(() => Promise.resolve()),
    }
    mocks.useSessionAuth.mockReturnValue(auth)
    mocks.usePlannerSession.mockReturnValue(sessionQuery)

    const { result } = renderHook(() =>
      useSessionFeatureReadiness({ hasCachedData: true }),
    )

    expect(result.current.workspaceId).toBe('pending')
    expect(result.current.readiness).toMatchObject({
      canReadCachedData: true,
      canWriteProtectedData: false,
      reason: 'auth_restoring',
      status: 'restoringWithCache',
    })
    expect(result.current.isApiEnabled).toBe(false)
    expect(result.current.apiConfig).toBeNull()
  })
})

function createAuthState(
  overrides: Partial<SessionAuthState> = {},
): SessionAuthState {
  return {
    accessToken: 'access-token',
    authNotice: null,
    canUseProtectedApi: true,
    clearAuthNotice: vi.fn(),
    email: 'user@example.test',
    expireSession: vi.fn(() => Promise.resolve()),
    isAuthEnabled: true,
    isLoading: false,
    isPasswordRecovery: false,
    lifecycleStatus: 'authenticated',
    recoverSession: vi.fn(() => Promise.resolve('recovered' as const)),
    requestPasswordReset: vi.fn(() => Promise.resolve()),
    sessionVersion: 1,
    signInWithPassword: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    signUpWithPassword: vi.fn(() =>
      Promise.resolve({ requiresEmailConfirmation: false }),
    ),
    updatePassword: vi.fn(() => Promise.resolve()),
    userId: 'user-1',
    ...overrides,
  }
}

function createSessionResponse(): SessionResponse {
  return {
    actor: {
      avatarUrl: null,
      displayName: 'Planner User',
      email: 'user@example.test',
      id: 'user-1',
    },
    actorUserId: 'user-1',
    appRole: 'user',
    groupRole: null,
    role: 'owner',
    source: 'access_token',
    userPreferences: {
      calendarViewMode: 'week',
      energyMode: 'normal',
    },
    workspace: {
      id: 'workspace-1',
      kind: 'personal',
      name: 'Planner Workspace',
      slug: 'planner-workspace',
    },
    workspaceId: 'workspace-1',
    workspaceSettings: {
      taskCompletionConfettiEnabled: true,
    },
    workspaces: [
      {
        groupRole: null,
        id: 'workspace-1',
        kind: 'personal',
        name: 'Planner Workspace',
        role: 'owner',
        slug: 'planner-workspace',
      },
    ],
  }
}
