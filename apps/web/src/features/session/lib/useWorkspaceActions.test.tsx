import type { SessionResponse } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
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
  clearSelectedWorkspaceId: vi.fn(),
  createSharedWorkspace: vi.fn(),
  deleteSharedWorkspace: vi.fn(),
  leaveSharedWorkspace: vi.fn(),
  setSelectedWorkspaceIdForActors: vi.fn(),
  updateSharedWorkspace: vi.fn(),
  usePlannerSession: vi.fn<() => PlannerSessionQueryStub>(),
  useSessionAuth: vi.fn<() => SessionAuthState>(),
}))

vi.mock('./session-api', () => ({
  createSharedWorkspace: mocks.createSharedWorkspace,
  deleteSharedWorkspace: mocks.deleteSharedWorkspace,
  leaveSharedWorkspace: mocks.leaveSharedWorkspace,
  updateSharedWorkspace: mocks.updateSharedWorkspace,
}))

vi.mock('./usePlannerSession', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
}))

vi.mock('./useSessionAuth', () => ({
  useSessionAuth: () => mocks.useSessionAuth(),
}))

vi.mock('./workspace-selection', () => ({
  clearSelectedWorkspaceId: mocks.clearSelectedWorkspaceId,
  setSelectedWorkspaceIdForActors: mocks.setSelectedWorkspaceIdForActors,
}))

import {
  getCreateSharedWorkspaceErrorMessage,
  getDeleteSharedWorkspaceErrorMessage,
  getLeaveSharedWorkspaceErrorMessage,
  getUpdateSharedWorkspaceErrorMessage,
  useCreateSharedWorkspace,
  useDeleteSharedWorkspace,
  useLeaveSharedWorkspace,
  useUpdateSharedWorkspace,
} from './useWorkspaceActions'

describe('workspace action hooks', () => {
  beforeEach(() => {
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
    vi.clearAllMocks()
  })

  it('creates a shared workspace and selects it for known actors', async () => {
    mocks.createSharedWorkspace.mockResolvedValueOnce(
      createWorkspaceMembership('shared-1'),
    )

    const { queryClient, wrapper } = createQueryWrapperWithClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateSharedWorkspace(), {
      wrapper,
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'Shared Home' }),
      ).resolves.toMatchObject({ id: 'shared-1' })
    })

    expect(mocks.createSharedWorkspace).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      input: { name: 'Shared Home' },
      workspaceId: 'workspace-1',
    })
    expect(mocks.setSelectedWorkspaceIdForActors).toHaveBeenCalledWith(
      'shared-1',
      ['user-1', 'user-1'],
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['planner', 'session'],
    })
  })

  it('updates a shared workspace through the current session context', async () => {
    mocks.updateSharedWorkspace.mockResolvedValueOnce(
      createWorkspaceMembership('workspace-1'),
    )

    const { wrapper } = createQueryWrapperWithClient()
    const { result } = renderHook(() => useUpdateSharedWorkspace(), {
      wrapper,
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'Renamed Home' }),
      ).resolves.toMatchObject({ id: 'workspace-1' })
    })

    expect(mocks.updateSharedWorkspace).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      input: { name: 'Renamed Home' },
      workspaceId: 'workspace-1',
    })
  })

  it('clears selected workspaces after destructive workspace actions', async () => {
    mocks.deleteSharedWorkspace.mockResolvedValueOnce(undefined)
    mocks.leaveSharedWorkspace.mockResolvedValueOnce(undefined)

    const { wrapper } = createQueryWrapperWithClient()
    const deleteHook = renderHook(() => useDeleteSharedWorkspace(), { wrapper })
    const leaveHook = renderHook(() => useLeaveSharedWorkspace(), { wrapper })

    await act(async () => {
      await deleteHook.result.current.mutateAsync()
      await leaveHook.result.current.mutateAsync()
    })

    expect(mocks.deleteSharedWorkspace).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.leaveSharedWorkspace).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.clearSelectedWorkspaceId).toHaveBeenCalledTimes(4)
    expect(mocks.clearSelectedWorkspaceId).toHaveBeenCalledWith('user-1')
  })

  it('blocks protected workspace writes until auth is ready', async () => {
    mocks.useSessionAuth.mockReturnValue(
      createAuthState({
        accessToken: null,
        canUseProtectedApi: false,
        lifecycleStatus: 'restoring',
      }),
    )

    const { wrapper } = createQueryWrapperWithClient()
    const { result } = renderHook(() => useCreateSharedWorkspace(), {
      wrapper,
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'Shared Home' }),
      ).rejects.toThrow('Auth session is not ready.')
    })

    expect(mocks.createSharedWorkspace).not.toHaveBeenCalled()
  })
})

describe('workspace action error messages', () => {
  it('maps known API errors to user-facing copy', () => {
    expect(
      getCreateSharedWorkspaceErrorMessage({
        code: 'shared_workspace_limit_reached',
      }),
    ).toBe('Можно создать не больше трёх общих пространств.')
    expect(
      getUpdateSharedWorkspaceErrorMessage({
        code: 'shared_workspace_creator_required',
      }),
    ).toBe('Переименовывать и удалять пространство может только его создатель.')
    expect(
      getDeleteSharedWorkspaceErrorMessage({
        code: 'shared_workspace_required',
      }),
    ).toBe('Эта операция доступна только для общего пространства.')
    expect(
      getLeaveSharedWorkspaceErrorMessage({
        code: 'workspace_owner_leave_forbidden',
      }),
    ).toBe(
      'Owner не может выйти из собственного пространства. Его можно удалить или сначала передать владение.',
    )
  })

  it('falls back to error messages or operation defaults', () => {
    expect(
      getCreateSharedWorkspaceErrorMessage(new Error('Network down.')),
    ).toBe('Network down.')
    expect(getDeleteSharedWorkspaceErrorMessage(null)).toBe(
      'Не удалось удалить пространство.',
    )
  })
})

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
      wakeWordTrainingModeEnabled: false,
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

function createWorkspaceMembership(id: string) {
  return {
    groupRole: 'group_admin',
    id,
    kind: 'shared',
    name: 'Shared Home',
    role: 'owner',
    slug: 'shared-home',
  }
}
