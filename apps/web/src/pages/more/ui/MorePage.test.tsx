import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/shared/lib/theme'

import { MorePage } from './MorePage'

type AppRole = 'admin' | 'guest' | 'owner' | 'test' | 'user'

interface MoreSessionStub {
  actor: {
    avatarUrl: string | null
    displayName: string
    email: string
    id: string
  }
  actorUserId: string
  appRole: AppRole
  role: 'owner'
  workspace: {
    id: string
    kind: 'personal'
    name: string
  }
  workspaceId: string
  workspaces: Array<{
    id: string
    kind: 'personal'
    name: string
  }>
}

interface PlannerStub {
  conflictedMutationCount: number
  debugErrorDetails: string | null
  errorMessage: string | null
  isLoading: boolean
  isSyncing: boolean
  queuedMutationCount: number
  readiness: {
    canReadCachedData: boolean
    canRenderAppContent: boolean
    canUseProtectedApi: boolean
    canWriteProtectedData: boolean
    reason: string
    status: string
  }
  refresh: () => void
}

const mocks = vi.hoisted(() => ({
  createSharedWorkspace: {
    isPending: false,
    mutateAsync: vi.fn(() => Promise.resolve(undefined)),
    reset: vi.fn(),
  },
  signOut: vi.fn<() => Promise<void>>(),
  usePlanner: vi.fn<() => PlannerStub>(),
  usePlannerSession: vi.fn<() => { data: MoreSessionStub }>(),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => mocks.usePlanner(),
}))

vi.mock('@/features/voice-assistant', () => ({
  VoiceAssistantSettingsPanel: () => (
    <section aria-label="Голосовой помощник" />
  ),
}))

vi.mock('@/features/session', () => ({
  getCreateSharedWorkspaceErrorMessage: () =>
    'Не удалось создать пространство.',
  getSessionReadinessConnectionView: (
    readiness: PlannerStub['readiness'],
    input: {
      featureErrorMessage?: string | null
      isFeatureLoading?: boolean
      isFeatureSyncing?: boolean
    },
  ) => {
    if (input.featureErrorMessage) {
      return {
        errorMessage: input.featureErrorMessage,
        label: 'Connection issue',
      }
    }

    if (readiness.status === 'offlineWithCache') {
      return {
        errorMessage: 'Auth session unavailable',
        label: 'Connection issue',
      }
    }

    if (input.isFeatureLoading) {
      return {
        errorMessage: null,
        label: 'Loading',
      }
    }

    if (input.isFeatureSyncing) {
      return {
        errorMessage: null,
        label: 'Syncing',
      }
    }

    return {
      errorMessage: null,
      label: 'Connected',
    }
  },
  useCreateSharedWorkspace: () => mocks.createSharedWorkspace,
  usePlannerSession: () => mocks.usePlannerSession(),
  UserAvatar: ({ displayName }: { displayName: string }) => (
    <span>{displayName.slice(0, 2)}</span>
  ),
  useSessionAuth: () => ({
    accessToken: null,
    canUseProtectedApi: false,
    email: 'vedeneeva.d.p@gmail.com',
    isAuthEnabled: true,
    signOut: mocks.signOut,
  }),
}))

function renderMorePage(
  options: {
    appRole?: AppRole
    planner?: Partial<PlannerStub>
  } = {},
) {
  const session: MoreSessionStub = {
    actor: {
      avatarUrl: null,
      displayName: 'Tikondra',
      email: 'vedeneeva.d.p@gmail.com',
      id: 'actor-1',
    },
    actorUserId: 'actor-1',
    appRole: options.appRole ?? 'owner',
    role: 'owner',
    workspace: {
      id: 'personal-workspace',
      kind: 'personal',
      name: 'Personal Workspace',
    },
    workspaceId: 'personal-workspace',
    workspaces: [
      {
        id: 'personal-workspace',
        kind: 'personal',
        name: 'Personal Workspace',
      },
    ],
  }

  mocks.usePlannerSession.mockReturnValue({ data: session })
  mocks.usePlanner.mockReturnValue({
    conflictedMutationCount: 0,
    debugErrorDetails: null,
    errorMessage: null,
    isLoading: false,
    isSyncing: false,
    queuedMutationCount: 0,
    readiness: {
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'auth_deferred',
      status: 'offlineWithCache',
    },
    refresh: vi.fn(),
    ...options.planner,
  })

  return render(
    <ThemeProvider>
      <MemoryRouter>
        <MorePage />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('MorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows retry for readiness connection issues without a planner feature error', () => {
    const refresh = vi.fn()

    renderMorePage({
      planner: {
        refresh,
      },
    })

    expect(screen.getByText('Auth session unavailable')).toBeVisible()

    fireEvent.click(
      screen.getByRole('button', { name: 'Повторить синхронизацию' }),
    )

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows connection debug details only to the global owner', () => {
    renderMorePage({
      planner: {
        conflictedMutationCount: 1,
        debugErrorDetails: '[tasksQuery.error]\nname=TypeError',
        queuedMutationCount: 2,
      },
    })

    expect(screen.getByText('Детали ошибки')).toBeVisible()
    expect(
      screen.getByText(/readiness\.status=offlineWithCache/),
    ).toBeInTheDocument()
    expect(screen.getByText(/queuedMutations=2/)).toBeInTheDocument()
    expect(screen.getByText(/\[tasksQuery\.error\]/)).toBeInTheDocument()
  })

  it('hides connection debug details from non-owner admins', () => {
    renderMorePage({
      appRole: 'admin',
      planner: {
        debugErrorDetails: '[tasksQuery.error]\nmessage=secret details',
      },
    })

    expect(screen.queryByText('Детали ошибки')).not.toBeInTheDocument()
    expect(screen.queryByText(/secret details/)).not.toBeInTheDocument()
  })
})
