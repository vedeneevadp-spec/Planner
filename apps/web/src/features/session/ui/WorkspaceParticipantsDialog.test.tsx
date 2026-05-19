import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceParticipantsDialog } from './WorkspaceParticipantsDialog'

interface MutationStub<Input = unknown> {
  isPending: boolean
  mutateAsync: (input: Input) => Promise<unknown>
  variables?: Input | undefined
}

interface QueryStub<Data> {
  data: Data | undefined
  error: unknown
  isPending: boolean
}

interface PlannerSessionQueryStub {
  data: {
    actorUserId: string
    groupRole: 'group_admin' | 'member' | 'senior_member' | null
    role: 'admin' | 'member' | 'owner'
    workspace: {
      kind: 'personal' | 'shared'
      name: string
    }
  }
}

const mocks = vi.hoisted(() => ({
  createWorkspaceInvitation: vi.fn<() => MutationStub>(),
  removeWorkspaceUser: vi.fn<() => MutationStub<string>>(),
  revokeWorkspaceInvitation: vi.fn<() => MutationStub<string>>(),
  updateWorkspaceUserGroupRole: vi.fn<() => MutationStub>(),
  usePlannerSession: vi.fn<() => PlannerSessionQueryStub>(),
  useWorkspaceInvitations: vi.fn<() => QueryStub<{ invitations: unknown[] }>>(),
  useWorkspaceUsers: vi.fn<() => QueryStub<{ users: unknown[] }>>(),
}))

vi.mock('../lib/usePlannerSession', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
}))

vi.mock('../lib/useWorkspaceParticipants', () => ({
  getWorkspaceParticipantsErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Не удалось обновить участников.',
  useCreateWorkspaceInvitation: () => mocks.createWorkspaceInvitation(),
  useRemoveWorkspaceUser: () => mocks.removeWorkspaceUser(),
  useRevokeWorkspaceInvitation: () => mocks.revokeWorkspaceInvitation(),
  useUpdateWorkspaceUserGroupRole: () => mocks.updateWorkspaceUserGroupRole(),
  useWorkspaceInvitations: () => mocks.useWorkspaceInvitations(),
  useWorkspaceUsers: () => mocks.useWorkspaceUsers(),
}))

function createMutationStub<Input = unknown>(
  mutateAsync = vi.fn<(input: Input) => Promise<unknown>>(() =>
    Promise.resolve(undefined),
  ),
): MutationStub<Input> {
  return {
    isPending: false,
    mutateAsync,
    variables: undefined,
  }
}

describe('WorkspaceParticipantsDialog', () => {
  beforeEach(() => {
    mocks.usePlannerSession.mockReturnValue({
      data: {
        actorUserId: 'user-owner',
        groupRole: 'group_admin',
        role: 'owner',
        workspace: {
          kind: 'shared',
          name: 'Family',
        },
      },
    })
    mocks.useWorkspaceUsers.mockReturnValue({
      data: {
        users: [
          {
            displayName: 'Darya',
            email: 'darya@example.com',
            groupRole: 'group_admin',
            id: 'user-owner',
            isOwner: true,
            joinedAt: '2026-05-01T08:00:00.000Z',
            membershipId: 'membership-owner',
          },
          {
            displayName: 'Alex',
            email: 'alex@example.com',
            groupRole: 'member',
            id: 'user-2',
            isOwner: false,
            joinedAt: '2026-05-02T08:00:00.000Z',
            membershipId: 'membership-2',
          },
        ],
      },
      error: null,
      isPending: false,
    })
    mocks.useWorkspaceInvitations.mockReturnValue({
      data: {
        invitations: [
          {
            email: 'guest@example.com',
            groupRole: 'senior_member',
            id: 'invitation-1',
            invitedAt: '2026-05-03T08:00:00.000Z',
            status: 'pending',
          },
        ],
      },
      error: null,
      isPending: false,
    })
    mocks.createWorkspaceInvitation.mockReturnValue(createMutationStub())
    mocks.removeWorkspaceUser.mockReturnValue(createMutationStub())
    mocks.revokeWorkspaceInvitation.mockReturnValue(createMutationStub())
    mocks.updateWorkspaceUserGroupRole.mockReturnValue(createMutationStub())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing while closed', () => {
    render(<WorkspaceParticipantsDialog isOpen={false} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders shared workspace participants and sends invitations', async () => {
    const createInvitation = vi.fn(() => Promise.resolve(undefined))
    mocks.createWorkspaceInvitation.mockReturnValue(
      createMutationStub(createInvitation),
    )

    render(<WorkspaceParticipantsDialog isOpen onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Family' })

    expect(within(dialog).getByText('Darya')).toBeVisible()
    expect(within(dialog).getByText('Alex')).toBeVisible()
    expect(within(dialog).getByText('guest@example.com')).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Пригласить' }))

    expect(await screen.findByText('Укажите email участника.')).toBeVisible()

    fireEvent.change(
      within(dialog).getByPlaceholderText('teammate@example.com'),
      {
        target: { value: 'new@example.com' },
      },
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Пригласить' }))

    await waitFor(() => {
      expect(createInvitation).toHaveBeenCalledWith({
        email: 'new@example.com',
        groupRole: 'member',
      })
    })
  })

  it('updates participant roles, removes users, revokes invites, and closes on escape', async () => {
    const onClose = vi.fn()
    const updateRole = vi.fn(() => Promise.resolve(undefined))
    const removeUser = vi.fn(() => Promise.resolve(undefined))
    const revokeInvitation = vi.fn(() => Promise.resolve(undefined))
    mocks.updateWorkspaceUserGroupRole.mockReturnValue(
      createMutationStub(updateRole),
    )
    mocks.removeWorkspaceUser.mockReturnValue(createMutationStub(removeUser))
    mocks.revokeWorkspaceInvitation.mockReturnValue(
      createMutationStub(revokeInvitation),
    )

    render(<WorkspaceParticipantsDialog isOpen onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'Family' })
    const rolePicker = within(dialog).getAllByRole('button', {
      name: 'Групповая роль',
    })[1]

    if (!rolePicker) {
      throw new Error('Expected editable participant role picker.')
    }

    fireEvent.click(rolePicker)
    fireEvent.click(
      within(dialog).getByRole('option', { name: 'Senior Member' }),
    )

    await waitFor(() => {
      expect(updateRole).toHaveBeenCalledWith({
        groupRole: 'senior_member',
        membershipId: 'membership-2',
      })
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Убрать' }))

    await waitFor(() => {
      expect(removeUser).toHaveBeenCalledWith('membership-2')
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отозвать' }))

    await waitFor(() => {
      expect(revokeInvitation).toHaveBeenCalledWith('invitation-1')
    })

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('explains that personal workspaces cannot manage participants', () => {
    mocks.usePlannerSession.mockReturnValue({
      data: {
        actorUserId: 'user-1',
        groupRole: null,
        role: 'owner',
        workspace: {
          kind: 'personal',
          name: 'Personal',
        },
      },
    })

    render(<WorkspaceParticipantsDialog isOpen onClose={vi.fn()} />)

    expect(
      screen.getByText(
        'Управление участниками доступно только в общем workspace. Сейчас открыт personal workspace.',
      ),
    ).toBeVisible()
  })
})
