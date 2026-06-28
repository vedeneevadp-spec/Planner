import type { SessionResponse } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionAuthState } from '../model/session-auth-context'
import type { WorkspaceParticipantsApiClient } from './workspace-participants-api'

interface PlannerSessionQueryStub {
  data: SessionResponse | undefined
  error: unknown
  isPending: boolean
  refetch: () => Promise<void>
}

interface SessionFeatureReadinessStub {
  apiConfig: {
    accessToken: string
    actorUserId: string
    apiBaseUrl: string
    workspaceId: string
  } | null
  isApiEnabled: boolean
  session:
    | {
        actorUserId: string
        workspaceId: string
      }
    | undefined
  workspaceId: string
}

const mocks = vi.hoisted(() => ({
  createWorkspaceParticipantsApiClient: vi.fn(),
  setSelectedWorkspaceIdForActors: vi.fn(),
  usePlannerSession: vi.fn<() => PlannerSessionQueryStub>(),
  useSessionAuth: vi.fn<() => SessionAuthState>(),
  useSessionFeatureReadiness: vi.fn<() => SessionFeatureReadinessStub>(),
}))

vi.mock('./workspace-participants-api', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...(actual as object),
    createWorkspaceParticipantsApiClient:
      mocks.createWorkspaceParticipantsApiClient,
  }
})

vi.mock('./workspace-selection', () => ({
  setSelectedWorkspaceIdForActors: mocks.setSelectedWorkspaceIdForActors,
}))

vi.mock('./usePlannerSession', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
}))

vi.mock('./useSessionAuth', () => ({
  useSessionAuth: () => mocks.useSessionAuth(),
}))

vi.mock('./useSessionFeatureReadiness', () => ({
  useSessionFeatureReadiness: () => mocks.useSessionFeatureReadiness(),
}))

import {
  getWorkspaceParticipantsErrorMessage,
  useAcceptWorkspaceInvitation,
  useCreateWorkspaceInvitation,
  useWorkspaceUsers,
} from './useWorkspaceParticipants'

describe('workspace participant hooks', () => {
  let apiClient: WorkspaceParticipantsApiClient

  beforeEach(() => {
    apiClient = createWorkspaceParticipantsApiClientStub()
    mocks.createWorkspaceParticipantsApiClient.mockReturnValue(apiClient)
    mocks.useSessionAuth.mockReturnValue(createAuthState())
    mocks.usePlannerSession.mockReturnValue({
      data: createSessionResponse(),
      error: null,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    })
    mocks.useSessionFeatureReadiness.mockReturnValue(createReadinessStub())
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('loads workspace users through session feature readiness', async () => {
    vi.mocked(apiClient.listWorkspaceUsers).mockResolvedValueOnce({
      users: [
        {
          displayName: 'Dasha',
          email: 'dasha@example.test',
          groupRole: 'group_admin',
          id: 'user-1',
          isOwner: true,
          joinedAt: '2026-06-28T10:00:00.000Z',
          membershipId: 'membership-1',
          updatedAt: '2026-06-28T10:00:00.000Z',
        },
      ],
    })

    const { result } = renderHook(() => useWorkspaceUsers(), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data?.users[0]?.email).toBe('dasha@example.test')
    })

    expect(mocks.createWorkspaceParticipantsApiClient).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      apiBaseUrl: 'https://api.chaotika.test',
      workspaceId: 'workspace-1',
    })
    expect(apiClient.listWorkspaceUsers).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    )
  })

  it('creates invitations and invalidates workspace invitation state', async () => {
    vi.mocked(apiClient.createWorkspaceInvitation).mockResolvedValueOnce({
      email: 'friend@example.test',
      invitedAt: '2026-06-28T10:00:00.000Z',
      groupRole: 'member',
      id: 'invitation-1',
      status: 'pending',
      updatedAt: '2026-06-28T10:00:00.000Z',
    })

    const { queryClient, wrapper } = createQueryWrapperWithClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateWorkspaceInvitation(), {
      wrapper,
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          email: 'friend@example.test',
          groupRole: 'member',
        }),
      ).resolves.toMatchObject({ id: 'invitation-1' })
    })

    expect(apiClient.createWorkspaceInvitation).toHaveBeenCalledWith({
      email: 'friend@example.test',
      groupRole: 'member',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['workspace-invitations', 'workspace-1'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['planner', 'session'],
    })
  })

  it('accepts invitations, selects the new workspace, and refreshes session', async () => {
    vi.mocked(apiClient.acceptWorkspaceInvitation).mockResolvedValueOnce(
      undefined,
    )

    const { queryClient, wrapper } = createQueryWrapperWithClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useAcceptWorkspaceInvitation(), {
      wrapper,
    })

    await act(async () => {
      await result.current.mutateAsync({
        invitationId: 'invitation-1',
        workspaceId: 'shared-workspace-1',
      })
    })

    expect(apiClient.acceptWorkspaceInvitation).toHaveBeenCalledWith(
      'invitation-1',
    )
    expect(mocks.setSelectedWorkspaceIdForActors).toHaveBeenCalledWith(
      'shared-workspace-1',
      ['user-1', 'user-1'],
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['workspace-invitations', 'received', 'user-1'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['planner', 'session'],
    })
  })

  it('maps workspace participant errors to user-facing messages', () => {
    expect(
      getWorkspaceParticipantsErrorMessage({
        code: 'workspace_owner_removal_forbidden',
      }),
    ).toBe('Owner нельзя удалить из workspace.')
    expect(
      getWorkspaceParticipantsErrorMessage(new Error('Network down.')),
    ).toBe('Network down.')
    expect(getWorkspaceParticipantsErrorMessage(null)).toBe(
      'Не удалось обновить участников workspace.',
    )
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

function createReadinessStub(): SessionFeatureReadinessStub {
  return {
    apiConfig: {
      accessToken: 'access-token',
      actorUserId: 'user-1',
      apiBaseUrl: 'https://api.chaotika.test',
      workspaceId: 'workspace-1',
    },
    isApiEnabled: true,
    session: {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    },
    workspaceId: 'workspace-1',
  }
}

function createWorkspaceParticipantsApiClientStub(): WorkspaceParticipantsApiClient {
  return {
    acceptWorkspaceInvitation: vi.fn(),
    createWorkspaceInvitation: vi.fn(),
    declineWorkspaceInvitation: vi.fn(),
    listReceivedWorkspaceInvitations: vi.fn(),
    listWorkspaceInvitations: vi.fn(),
    listWorkspaceUsers: vi.fn(),
    removeWorkspaceUser: vi.fn(),
    revokeWorkspaceInvitation: vi.fn(),
    updateWorkspaceUserGroupRole: vi.fn(),
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
      defaultTimeZone: null,
      energyMode: 'normal',
      lastSeenTimeZone: null,
      timeZoneMode: 'device',
      voiceAssistantEnabled: true,
    },
    workspace: {
      id: 'workspace-1',
      kind: 'personal',
      name: 'Planner Workspace',
      slug: 'planner-workspace',
    },
    workspaceId: 'workspace-1',
    workspaceSettings: {
      defaultTimeZone: null,
      taskCompletionConfettiEnabled: true,
      wakeWordTrainingModeEnabled: false,
    },
    workspaces: [],
  }
}
