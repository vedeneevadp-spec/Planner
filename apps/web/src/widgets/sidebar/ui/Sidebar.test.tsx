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
  errorMessage: string | null
  isLoading: boolean
  isSyncing: boolean
  spheres: Array<{
    id: string
    name: string
  }>
  refresh: () => void
  tasks: []
}

interface SessionAuthStub {
  accessToken: string
  email: string
  isAuthEnabled: boolean
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
  useHabitsToday: vi.fn<() => { data: { items: unknown[] } }>(),
  useLeaveSharedWorkspace: vi.fn<() => MutationStub>(),
  usePlanner: vi.fn<() => PlannerStub>(),
  usePlannerSession: vi.fn<() => { data: SidebarSessionStub }>(),
  useReceivedWorkspaceInvitations:
    vi.fn<() => { data: { invitations: unknown[] } }>(),
  useSessionAuth: vi.fn<() => SessionAuthStub>(),
  useShoppingListSummary: vi.fn<() => { activeItemCount: number }>(),
  useUpdateSharedWorkspace: vi.fn<() => MutationStub>(),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => mocks.usePlanner(),
}))

vi.mock('@/features/cleaning', () => ({
  useCleaningSummary: () => mocks.useCleaningSummary(),
}))

vi.mock('@/features/habits', () => ({
  useHabitsToday: () => mocks.useHabitsToday(),
}))

vi.mock('@/features/shopping-list', () => ({
  useShoppingListSummary: () => mocks.useShoppingListSummary(),
}))

vi.mock('@/features/session', () => ({
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
    includeNativeBackButton?: boolean
    initialEntries?: string[]
    initialIndex?: number
  } = {},
) {
  mocks.usePlanner.mockReturnValue({
    errorMessage: null,
    isLoading: false,
    isSyncing: false,
    spheres: [
      { id: 'sphere-1', name: 'Работа' },
      { id: 'sphere-2', name: 'Здоровье' },
    ],
    refresh: vi.fn(),
    tasks: [],
  })
  mocks.useShoppingListSummary.mockReturnValue({
    activeItemCount: 0,
  })
  mocks.useCleaningSummary.mockReturnValue({
    dueCount: 0,
    urgentCount: 0,
  })
  mocks.useHabitsToday.mockReturnValue({
    data: {
      items: [],
    },
  })
  mocks.usePlannerSession.mockReturnValue({
    data: session,
  })
  mocks.useSessionAuth.mockReturnValue({
    accessToken: 'token',
    email: session.actor.email,
    isAuthEnabled: true,
    signOut: mocks.signOut,
    userId: session.actorUserId,
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
        <Sidebar />
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

  it('moves spheres and habits into the mobile more sheet for personal workspaces', () => {
    renderSidebar(createSession('personal'))

    const mobileNavigation = screen.getByRole('navigation', {
      name: 'Mobile navigation',
    })

    expect(
      within(mobileNavigation).queryByText('Сферы'),
    ).not.toBeInTheDocument()
    expect(
      within(mobileNavigation).queryByText('Привычки'),
    ).not.toBeInTheDocument()

    const moreSheet = within(openMobileMoreSheet())

    expect(moreSheet.getByText('Сферы')).toBeVisible()
    expect(moreSheet.getByText('Привычки')).toBeVisible()
    expect(moreSheet.getByRole('link', { name: 'Профиль' })).toBeVisible()
    expect(moreSheet.getByText('Admin')).toBeVisible()
    expect(moreSheet.getByRole('button', { name: 'Выйти' })).toBeVisible()
  })

  it('keeps mobile sign out away from the bottom navigation links and requires confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderSidebar(createSession('personal'))

    const moreSheet = within(openMobileMoreSheet())
    const signOutButton = moreSheet.getByRole('button', { name: 'Выйти' })
    const spheresLink = moreSheet.getByRole('link', { name: 'Сферы' })

    expect(
      signOutButton.compareDocumentPosition(spheresLink) &
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
  })

  it('keeps habits and admin out of shared workspace navigation', () => {
    renderSidebar(createSession('shared'))

    const mainNavigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    })

    expect(
      within(mainNavigation).queryByText('Привычки'),
    ).not.toBeInTheDocument()
    expect(within(mainNavigation).queryByText('Admin')).not.toBeInTheDocument()

    const moreSheet = within(openMobileMoreSheet())

    expect(moreSheet.getByText('Сферы')).toBeVisible()
    expect(moreSheet.getByRole('button', { name: 'Выйти' })).toBeVisible()
    expect(moreSheet.queryByText('Привычки')).not.toBeInTheDocument()
    expect(moreSheet.queryByText('Профиль')).not.toBeInTheDocument()
    expect(moreSheet.queryByText('Admin')).not.toBeInTheDocument()
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
