import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/shared/lib/theme'

import { Sidebar } from './Sidebar'

type WorkspaceKind = 'personal' | 'shared'
type AppRole = 'admin' | 'member' | 'owner'
type WorkspaceRole = 'admin' | 'member' | 'owner'

interface SidebarSessionStub {
  actor: {
    avatarUrl: string | null
    displayName: string
    email: string
    id: string
  }
  actorUserId: string
  appRole: AppRole
  role: WorkspaceRole
  workspace: {
    id: string
    kind: WorkspaceKind
    name: string
  }
  workspaceId: string
  workspaces: Array<{
    id: string
    kind: WorkspaceKind
    name: string
  }>
}

interface MutationStub {
  error: null
  isPending: boolean
  mutateAsync: (input?: unknown) => Promise<unknown>
  reset: () => void
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
  spheres: Array<{
    id: string
    name: string
  }>
  refresh: () => void
  tasks: []
}

interface SessionAuthStub {
  accessToken: string | null
  canUseProtectedApi: boolean
  email: string
  isAuthEnabled: boolean
  isLoading: boolean
  lifecycleStatus:
    | 'authenticated'
    | 'deferred'
    | 'disabled'
    | 'restoring'
    | 'signed_out'
  signOut: () => Promise<void>
  userId: string
}

const mocks = vi.hoisted(() => ({
  setSelectedWorkspaceIdForActors: vi.fn(),
  signOut: vi.fn<() => Promise<void>>(),
  useAcceptWorkspaceInvitation: vi.fn<() => MutationStub>(),
  useCreateSharedWorkspace: vi.fn<() => MutationStub>(),
  useDeclineWorkspaceInvitation: vi.fn<() => MutationStub>(),
  useDeleteSharedWorkspace: vi.fn<() => MutationStub>(),
  useCleaningSummary: vi.fn<() => { dueCount: number; urgentCount: number }>(),
  useLeaveSharedWorkspace: vi.fn<() => MutationStub>(),
  usePlanner: vi.fn<() => PlannerStub>(),
  usePlannerSession: vi.fn<() => { data: SidebarSessionStub }>(),
  useReceivedWorkspaceInvitations:
    vi.fn<() => { data: { invitations: unknown[] } }>(),
  useSessionAuth: vi.fn<() => SessionAuthStub>(),
  useSelfCareDashboard:
    vi.fn<
      () => { data: { flexibleGoals: unknown[]; todayItems: unknown[] } }
    >(),
  useShoppingListSummary: vi.fn<() => { activeItemCount: number }>(),
  useUpdateSharedWorkspace: vi.fn<() => MutationStub>(),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => mocks.usePlanner(),
}))

vi.mock('@/features/cleaning', () => ({
  useCleaningSummary: () => mocks.useCleaningSummary(),
}))

vi.mock('@/features/self-care', () => ({
  useSelfCareDashboard: () => mocks.useSelfCareDashboard(),
}))

vi.mock('@/features/shopping-list', () => ({
  useShoppingListSummary: () => mocks.useShoppingListSummary(),
}))

vi.mock('@/features/session', () => ({
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
  getCreateSharedWorkspaceErrorMessage: () =>
    'Не удалось создать пространство.',
  getDeleteSharedWorkspaceErrorMessage: () =>
    'Не удалось удалить пространство.',
  getLeaveSharedWorkspaceErrorMessage: () =>
    'Не удалось выйти из пространства.',
  getUpdateSharedWorkspaceErrorMessage: () =>
    'Не удалось обновить пространство.',
  getWorkspaceParticipantsErrorMessage: () => 'Не удалось обновить участников.',
  ProfileDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">Профиль</div> : null,
  setSelectedWorkspaceIdForActors: mocks.setSelectedWorkspaceIdForActors,
  useAcceptWorkspaceInvitation: () => mocks.useAcceptWorkspaceInvitation(),
  useCreateSharedWorkspace: () => mocks.useCreateSharedWorkspace(),
  useDeclineWorkspaceInvitation: () => mocks.useDeclineWorkspaceInvitation(),
  useDeleteSharedWorkspace: () => mocks.useDeleteSharedWorkspace(),
  useLeaveSharedWorkspace: () => mocks.useLeaveSharedWorkspace(),
  usePlannerSession: () => mocks.usePlannerSession(),
  usePlannerTimeZone: () => 'Europe/Astrakhan',
  useReceivedWorkspaceInvitations: () =>
    mocks.useReceivedWorkspaceInvitations(),
  UserAvatar: ({ displayName }: { displayName: string }) => (
    <span>{displayName.slice(0, 2)}</span>
  ),
  useSessionAuth: () => mocks.useSessionAuth(),
  useUpdateSharedWorkspace: () => mocks.useUpdateSharedWorkspace(),
  WorkspaceParticipantsDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">Участники</div> : null,
}))

function createSession(
  kind: WorkspaceKind,
  overrides: Partial<SidebarSessionStub> = {},
): SidebarSessionStub {
  const workspace = {
    id: `${kind}-workspace`,
    kind,
    name: kind === 'shared' ? 'Family Workspace' : 'Personal Workspace',
  }

  return {
    actor: {
      avatarUrl: null,
      displayName: 'Tikondra',
      email: 'vedeneeva.d.p@gmail.com',
      id: 'actor-1',
    },
    actorUserId: 'actor-user-1',
    appRole: 'owner',
    role: kind === 'shared' ? 'member' : 'owner',
    workspace,
    workspaceId: workspace.id,
    workspaces: [workspace],
    ...overrides,
  }
}

function createMutationStub(): MutationStub {
  return {
    error: null,
    isPending: false,
    mutateAsync: vi.fn(() => Promise.resolve(undefined)),
    reset: vi.fn(),
  }
}

function renderSidebar(
  session: SidebarSessionStub,
  options: {
    auth?: Partial<SessionAuthStub>
    includeNativeBackButton?: boolean
    initialEntries?: string[]
    initialIndex?: number
    navigationMode?: 'full' | 'service'
    planner?: Partial<PlannerStub>
  } = {},
) {
  const auth = {
    accessToken: 'token',
    canUseProtectedApi: true,
    email: session.actor.email,
    isAuthEnabled: true,
    isLoading: false,
    lifecycleStatus: 'authenticated' as const,
    signOut: mocks.signOut,
    userId: session.actorUserId,
    ...options.auth,
  }
  const readiness =
    auth.lifecycleStatus === 'deferred'
      ? {
          canReadCachedData: true,
          canRenderAppContent: true,
          canUseProtectedApi: false,
          canWriteProtectedData: false,
          reason: 'auth_deferred',
          status: 'offlineWithCache',
        }
      : {
          canReadCachedData: true,
          canRenderAppContent: true,
          canUseProtectedApi: auth.canUseProtectedApi,
          canWriteProtectedData: auth.canUseProtectedApi,
          reason: 'ready',
          status: 'ready',
        }

  mocks.usePlanner.mockReturnValue({
    conflictedMutationCount: 0,
    debugErrorDetails: null,
    errorMessage: null,
    isLoading: false,
    isSyncing: false,
    queuedMutationCount: 0,
    readiness,
    spheres: [
      { id: 'sphere-1', name: 'Работа' },
      { id: 'sphere-2', name: 'Здоровье' },
    ],
    refresh: vi.fn(),
    tasks: [],
    ...options.planner,
  })
  mocks.useShoppingListSummary.mockReturnValue({
    activeItemCount: 0,
  })
  mocks.useCleaningSummary.mockReturnValue({
    dueCount: 0,
    urgentCount: 0,
  })
  mocks.useSelfCareDashboard.mockReturnValue({
    data: {
      flexibleGoals: [],
      todayItems: [],
    },
  })
  mocks.usePlannerSession.mockReturnValue({
    data: session,
  })
  mocks.useSessionAuth.mockReturnValue({
    ...auth,
  })
  mocks.useCreateSharedWorkspace.mockReturnValue(createMutationStub())
  mocks.useDeleteSharedWorkspace.mockReturnValue(createMutationStub())
  mocks.useLeaveSharedWorkspace.mockReturnValue(createMutationStub())
  mocks.useReceivedWorkspaceInvitations.mockReturnValue({
    data: {
      invitations: [],
    },
  })
  mocks.useAcceptWorkspaceInvitation.mockReturnValue(createMutationStub())
  mocks.useDeclineWorkspaceInvitation.mockReturnValue(createMutationStub())
  mocks.useUpdateSharedWorkspace.mockReturnValue(createMutationStub())

  return render(
    <ThemeProvider>
      <MemoryRouter
        initialEntries={options.initialEntries ?? ['/today']}
        {...(options.initialIndex !== undefined
          ? { initialIndex: options.initialIndex }
          : {})}
      >
        <Sidebar navigationMode={options.navigationMode ?? 'full'} />
        {options.includeNativeBackButton ? <NativeBackButton /> : null}
      </MemoryRouter>
    </ThemeProvider>,
  )
}

function NativeBackButton() {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => {
        void navigate(-1)
      }}
    >
      Native back
    </button>
  )
}

function openMobileMoreSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Ещё' }))

  return screen.getByRole('dialog', { name: 'Ещё' })
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps side tab sections out of the mobile more sheet for personal workspaces', () => {
    renderSidebar(createSession('personal'))

    const mobileNavigation = screen.getByRole('navigation', {
      name: 'Mobile navigation',
    })

    expect(
      within(mobileNavigation).queryByText('Сферы'),
    ).not.toBeInTheDocument()
    expect(
      within(mobileNavigation).queryByText('Забота'),
    ).not.toBeInTheDocument()

    const moreSheet = within(openMobileMoreSheet())

    expect(moreSheet.queryByText('Таймлайн')).not.toBeInTheDocument()
    expect(moreSheet.queryByText('Сферы')).not.toBeInTheDocument()
    expect(moreSheet.queryByText('Забота')).not.toBeInTheDocument()
    expect(moreSheet.getByRole('link', { name: 'Профиль' })).toBeVisible()
    expect(moreSheet.getByText('Admin')).toBeVisible()
    expect(moreSheet.getByRole('button', { name: 'Выйти' })).toBeVisible()
  })

  it('keeps mobile sign out away from the bottom navigation links and requires confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderSidebar(createSession('personal'))

    const moreSheet = within(openMobileMoreSheet())
    const signOutButton = moreSheet.getByRole('button', { name: 'Выйти' })
    const profileLink = moreSheet.getByRole('link', { name: 'Профиль' })

    expect(
      signOutButton.compareDocumentPosition(profileLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(signOutButton)

    expect(confirmSpy).toHaveBeenCalledWith(
      'Выйти из аккаунта? Текущая сессия на этом устройстве будет завершена.',
    )
    expect(mocks.signOut).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(signOutButton)

    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    confirmSpy.mockRestore()
  })

  it('shows contacts as a section link inside the mobile more sheet', () => {
    renderSidebar(createSession('personal'))

    const moreSheet = within(openMobileMoreSheet())

    expect(moreSheet.getByRole('link', { name: 'Контакты' })).toHaveAttribute(
      'href',
      '/contacts',
    )
  })

  it('requires confirmation before desktop account sign out', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderSidebar(createSession('personal'))

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Выйти из аккаунта? Текущая сессия на этом устройстве будет завершена.',
    )
    expect(mocks.signOut).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    confirmSpy.mockRestore()
  })

  it('does not show Connected when the auth token is unavailable', () => {
    renderSidebar(createSession('personal'), {
      auth: {
        accessToken: null,
        canUseProtectedApi: false,
        lifecycleStatus: 'deferred',
      },
    })

    expect(screen.getAllByText('Connection issue')).not.toHaveLength(0)
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })

  it('keeps retry available for readiness connection issues without a planner feature error', () => {
    const refresh = vi.fn()

    renderSidebar(createSession('personal'), {
      auth: {
        accessToken: null,
        canUseProtectedApi: false,
        lifecycleStatus: 'deferred',
      },
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

  it('shows retry inside the mobile sheet for readiness connection issues', () => {
    renderSidebar(createSession('personal'), {
      auth: {
        accessToken: null,
        canUseProtectedApi: false,
        lifecycleStatus: 'deferred',
      },
    })

    const moreSheet = within(openMobileMoreSheet())

    expect(moreSheet.getByText('Auth session unavailable')).toBeVisible()
    expect(
      moreSheet.getByRole('button', { name: 'Повторить синхронизацию' }),
    ).toBeVisible()
  })

  it('shows connection debug details only to the global owner', () => {
    renderSidebar(createSession('personal'), {
      auth: {
        accessToken: null,
        canUseProtectedApi: false,
        lifecycleStatus: 'deferred',
      },
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
    renderSidebar(createSession('personal', { appRole: 'admin' }), {
      auth: {
        accessToken: null,
        canUseProtectedApi: false,
        lifecycleStatus: 'deferred',
      },
      planner: {
        debugErrorDetails: '[tasksQuery.error]\nmessage=secret details',
      },
    })

    expect(screen.queryByText('Детали ошибки')).not.toBeInTheDocument()
    expect(screen.queryByText(/secret details/)).not.toBeInTheDocument()
  })

  it('keeps self-care and admin out of shared workspace navigation', () => {
    renderSidebar(createSession('shared'))

    const mainNavigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    })

    expect(within(mainNavigation).queryByText('Забота')).not.toBeInTheDocument()
    expect(within(mainNavigation).queryByText('Admin')).not.toBeInTheDocument()

    const moreSheet = within(openMobileMoreSheet())

    expect(moreSheet.queryByText('Таймлайн')).not.toBeInTheDocument()
    expect(moreSheet.queryByText('Сферы')).not.toBeInTheDocument()
    expect(moreSheet.getByRole('button', { name: 'Выйти' })).toBeVisible()
    expect(moreSheet.queryByText('Забота')).not.toBeInTheDocument()
    expect(moreSheet.queryByText('Профиль')).not.toBeInTheDocument()
    expect(moreSheet.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('uses planner side tabs instead of duplicated navigation in service mode', () => {
    renderSidebar(createSession('personal'), {
      initialEntries: ['/cleaning/settings/zones/zone-1'],
      navigationMode: 'service',
    })

    expect(
      screen.queryByRole('navigation', { name: 'Mobile navigation' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Main navigation' }),
    ).not.toBeInTheDocument()

    const plannerNavigation = screen.getByRole('navigation', {
      name: 'Разделы планера',
    })

    expect(
      within(plannerNavigation).getByRole('link', { name: 'Уборка' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(plannerNavigation).getByRole('link', { name: /Сферы/ }),
    ).toBeVisible()

    expect(
      within(plannerNavigation).queryByRole('button', { name: 'Ещё' }),
    ).not.toBeInTheDocument()
    expect(
      within(plannerNavigation).getAllByRole('link', { name: 'Ещё' })[0],
    ).toHaveAttribute('href', '/more')
  })

  it('keeps cleaning zone settings out of service side tabs on cleaning', () => {
    renderSidebar(createSession('personal'), {
      initialEntries: ['/cleaning'],
      navigationMode: 'service',
    })

    const plannerNavigation = screen.getByRole('navigation', {
      name: 'Разделы планера',
    })

    expect(
      within(plannerNavigation).queryByRole('link', {
        name: 'Настройки зон',
      }),
    ).not.toBeInTheDocument()
  })

  it('hides desktop workspace actions behind the settings button', () => {
    renderSidebar(createSession('shared', { role: 'owner' }))

    expect(
      screen.queryByRole('button', { name: 'Переименовать' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Удалить' }),
    ).not.toBeInTheDocument()

    const workspaceActionsButton = screen.getByRole('button', {
      name: 'Действия с workspace',
    })

    expect(workspaceActionsButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(workspaceActionsButton)

    expect(workspaceActionsButton).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: 'Переименовать' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Участники' }),
    ).toBeInTheDocument()
  })

  it('hides mobile workspace actions behind the sheet settings button', () => {
    renderSidebar(createSession('shared', { role: 'owner' }))

    const moreSheet = within(openMobileMoreSheet())

    expect(
      moreSheet.queryByRole('button', { name: 'Переименовать' }),
    ).not.toBeInTheDocument()
    expect(
      moreSheet.queryByRole('button', { name: 'Удалить' }),
    ).not.toBeInTheDocument()

    const workspaceActionsButton = moreSheet.getByRole('button', {
      name: 'Действия с workspace в мобильном меню',
    })

    fireEvent.click(workspaceActionsButton)

    expect(
      moreSheet.getByRole('button', { name: 'Переименовать' }),
    ).toBeInTheDocument()
    expect(
      moreSheet.getByRole('button', { name: 'Удалить' }),
    ).toBeInTheDocument()
    expect(
      moreSheet.getByRole('button', { name: 'Участники' }),
    ).toBeInTheDocument()
  })

  it('closes the mobile more sheet from the sheet header', () => {
    renderSidebar(createSession('personal'))

    const moreSheet = openMobileMoreSheet()

    fireEvent.click(
      within(moreSheet).getByRole('button', { name: 'Закрыть меню' }),
    )

    expect(
      screen.queryByRole('dialog', { name: 'Ещё' }),
    ).not.toBeInTheDocument()
  })

  it('does not reopen the mobile more sheet after route history navigation', () => {
    renderSidebar(createSession('personal'), {
      includeNativeBackButton: true,
      initialEntries: ['/shopping', '/today'],
      initialIndex: 1,
    })

    openMobileMoreSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Native back' }))

    expect(
      screen.queryByRole('dialog', { name: 'Ещё' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Сегодня' }))

    expect(
      screen.queryByRole('dialog', { name: 'Ещё' }),
    ).not.toBeInTheDocument()
  })
})
