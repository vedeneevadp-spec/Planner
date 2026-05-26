import type { SessionResponse } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  getPlannerSessionOverrideHeaders: (options: {
    accessToken?: string
    actorUserId?: string
    workspaceId?: string
  }) => {
    const headers: Record<string, string> = {}

    if (options.accessToken) {
      headers.authorization = `Bearer ${options.accessToken}`
    }

    if (options.workspaceId) {
      headers['x-workspace-id'] = options.workspaceId
    }

    if (!options.accessToken && options.actorUserId && options.workspaceId) {
      headers['x-actor-user-id'] = options.actorUserId
    }

    return Object.keys(headers).length > 0 ? headers : undefined
  },
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

import { useAdminUsers, useUpdateAdminUserRole } from './useAdminUsers'
import { useUpdateUserPreferences } from './useUserPreferences'
import { useUpdateUserProfile } from './useUserProfile'
import { useUpdateWorkspaceSettings } from './useWorkspaceSettings'

describe('session admin hooks', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    mocks.useSessionAuth.mockReturnValue(createAuthState())
    mocks.usePlannerSession.mockReturnValue({
      data: createSessionResponse(),
      error: null,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    mocks.usePlannerSession.mockReset()
    mocks.useSessionAuth.mockReset()
  })

  it('loads admin users through the protected API config', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [createAdminUserRecord()],
      }),
    )

    const { result } = renderHook(() => useAdminUsers(), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data?.users[0]?.email).toBe('admin@example.test')
    })

    const [url, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)

    expect(getRequestUrl(url)).toBe(
      'https://api.chaotika.test/api/v1/admin/users',
    )
    expect(headers.get('authorization')).toBe('Bearer access-token')
    expect(headers.get('x-workspace-id')).toBe('workspace-1')
  })

  it('updates admin roles and invalidates admin/session queries', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...createAdminUserRecord(),
        appRole: 'guest',
        id: 'user-2',
      }),
    )

    const { queryClient, wrapper } = createQueryWrapperWithClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateAdminUserRole(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          role: 'guest',
          userId: 'user-2',
        }),
      ).resolves.toMatchObject({
        appRole: 'guest',
        id: 'user-2',
      })
    })

    const [url, init] = fetchMock.mock.calls[0]!
    const body = parseRequestBody<{ role: string }>(init)
    const headers = new Headers(init?.headers)

    expect(getRequestUrl(url)).toBe(
      'https://api.chaotika.test/api/v1/admin/users/user-2/role',
    )
    expect(init?.method).toBe('PATCH')
    expect(body.role).toBe('guest')
    expect(headers.get('authorization')).toBe('Bearer access-token')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin-users', 'workspace-1'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['planner', 'session'],
    })
  })

  it('optimistically updates user preferences and stores the server result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        calendarViewMode: 'month',
        energyMode: 'maximum',
      }),
    )

    const session = createSessionResponse()
    const { queryClient, wrapper } = createQueryWrapperWithClient()
    queryClient.setQueryData(['planner', 'session'], session)
    const { result } = renderHook(() => useUpdateUserPreferences(), {
      wrapper,
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          energyMode: 'maximum',
        }),
      ).resolves.toEqual({
        calendarViewMode: 'month',
        energyMode: 'maximum',
      })
    })

    const cachedSession = queryClient.getQueryData<SessionResponse>([
      'planner',
      'session',
    ])
    const [, init] = fetchMock.mock.calls[0]!
    const body = parseRequestBody<{ energyMode: string }>(init)

    expect(body.energyMode).toBe('maximum')
    expect(cachedSession?.userPreferences).toEqual({
      calendarViewMode: 'month',
      energyMode: 'maximum',
    })
  })

  it('updates profile data in the cached planner session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        avatarUrl: '/api/v1/profile-assets/user-1-new.webp',
        displayName: 'Planner Captain',
        email: 'captain@example.test',
        id: 'user-1',
        updatedAt: '2026-05-26T12:00:00.000Z',
      }),
    )

    const { queryClient, wrapper } = createQueryWrapperWithClient()
    queryClient.setQueryData(['planner', 'session'], createSessionResponse())
    const { result } = renderHook(() => useUpdateUserProfile(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          displayName: 'Planner Captain',
        }),
      ).resolves.toMatchObject({
        displayName: 'Planner Captain',
        email: 'captain@example.test',
      })
    })

    const cachedSession = queryClient.getQueryData<SessionResponse>([
      'planner',
      'session',
    ])
    const [url, init] = fetchMock.mock.calls[0]!
    const body = parseRequestBody<{ displayName: string }>(init)

    expect(getRequestUrl(url)).toBe('https://api.chaotika.test/api/v1/profile')
    expect(body.displayName).toBe('Planner Captain')
    expect(cachedSession?.actor).toEqual({
      avatarUrl:
        'https://api.chaotika.test/api/v1/profile-assets/user-1-new.webp',
      displayName: 'Planner Captain',
      email: 'captain@example.test',
      id: 'user-1',
    })
  })

  it('rolls back workspace settings when the mutation fails', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'workspace_settings_update_forbidden',
            message: 'Forbidden.',
          },
        },
        403,
      ),
    )

    const { queryClient, wrapper } = createQueryWrapperWithClient()
    queryClient.setQueryData(['planner', 'session'], createSessionResponse())
    const { result } = renderHook(() => useUpdateWorkspaceSettings(), {
      wrapper,
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          taskCompletionConfettiEnabled: false,
        }),
      ).rejects.toThrow('Forbidden.')
    })

    const cachedSession = queryClient.getQueryData<SessionResponse>([
      'planner',
      'session',
    ])

    expect(cachedSession?.workspaceSettings).toEqual({
      taskCompletionConfettiEnabled: true,
    })
  })
})

function createQueryWrapper() {
  return createQueryWrapperWithClient().wrapper
}

function createQueryWrapperWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })

  function TestQueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  return {
    queryClient,
    wrapper: TestQueryWrapper,
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  })
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

function parseRequestBody<T>(init: RequestInit | undefined): T {
  const body = init?.body

  if (typeof body !== 'string') {
    throw new Error('Expected string request body.')
  }

  return JSON.parse(body) as T
}

function createAdminUserRecord() {
  return {
    appRole: 'admin',
    displayName: 'Admin User',
    email: 'admin@example.test',
    id: 'admin-1',
    lastSeenAt: '2026-05-26T12:00:00.000Z',
    taskCount: 3,
    updatedAt: '2026-05-26T12:00:00.000Z',
  }
}

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
    appRole: 'owner',
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
