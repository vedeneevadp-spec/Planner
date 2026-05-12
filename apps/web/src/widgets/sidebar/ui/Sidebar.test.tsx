import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  projects: Array<{
    id: string
    title: string
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
  useCreateSharedWorkspace: vi.fn<() => MutationStub>(),
  useDeleteSharedWorkspace: vi.fn<() => MutationStub>(),
  usePlanner: vi.fn<() => PlannerStub>(),
  usePlannerSession: vi.fn<() => { data: SidebarSessionStub }>(),
  useSessionAuth: vi.fn<() => SessionAuthStub>(),
  useShoppingListSummary: vi.fn<() => { activeItemCount: number }>(),
  useUpdateSharedWorkspace: vi.fn<() => MutationStub>(),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => mocks.usePlanner(),
}))

vi.mock('@/features/shopping-list', () => ({
  useShoppingListSummary: () => mocks.useShoppingListSummary(),
}))

vi.mock('@/features/session', () => ({
  getCreateSharedWorkspaceErrorMessage: () =>
    'Не удалось создать пространство.',
  getDeleteSharedWorkspaceErrorMessage: () =>
    'Не удалось удалить пространство.',
  getUpdateSharedWorkspaceErrorMessage: () =>
    'Не удалось обновить пространство.',
  ProfileDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">Профиль</div> : null,
  setSelectedWorkspaceIdForActors: mocks.setSelectedWorkspaceIdForActors,
  useCreateSharedWorkspace: () => mocks.useCreateSharedWorkspace(),
  useDeleteSharedWorkspace: () => mocks.useDeleteSharedWorkspace(),
  usePlannerSession: () => mocks.usePlannerSession(),
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

function renderSidebar(session: SidebarSessionStub) {
  mocks.usePlanner.mockReturnValue({
    errorMessage: null,
    isLoading: false,
    isSyncing: false,
    projects: [
      { id: 'project-1', title: 'Работа' },
      { id: 'project-2', title: 'Здоровье' },
    ],
    refresh: vi.fn(),
    tasks: [],
  })
  mocks.useShoppingListSummary.mockReturnValue({
    activeItemCount: 0,
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
  mocks.useUpdateSharedWorkspace.mockReturnValue(createMutationStub())

  return render(
    <MemoryRouter initialEntries={['/today']}>
      <Sidebar />
    </MemoryRouter>,
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
})
