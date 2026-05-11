import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProfileDialog } from './ProfileDialog'

interface MockSessionResult {
  data: {
    actor: {
      avatarUrl: string | null
      displayName: string
      email: string
      id: string
    }
  }
}

interface MockUpdateUserProfileResult {
  isPending: boolean
  mutateAsync: (input: unknown) => Promise<unknown>
}

const mockUsePlannerSession = vi.fn<() => MockSessionResult>()
const mockUseUpdateUserProfile = vi.fn<() => MockUpdateUserProfileResult>()
const mockUpdatePassword =
  vi.fn<(password: string, currentPassword?: string) => Promise<void>>()

vi.mock('../lib/usePlannerSession', () => ({
  usePlannerSession: () => mockUsePlannerSession(),
}))

vi.mock('../lib/useSessionAuth', () => ({
  useSessionAuth: () => ({
    isAuthEnabled: true,
    updatePassword: mockUpdatePassword,
  }),
}))

vi.mock('../lib/useUserProfile', () => ({
  getUpdateUserProfileErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'profile update failed',
  useUpdateUserProfile: () => mockUseUpdateUserProfile(),
}))

describe('ProfileDialog', () => {
  beforeEach(() => {
    mockUpdatePassword.mockReset()
    mockUpdatePassword.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('restores the session profile values after reopening the dialog', () => {
    const mutateAsync = vi.fn(() => Promise.resolve(undefined))

    mockUsePlannerSession.mockReturnValue({
      data: {
        actor: {
          avatarUrl: null,
          displayName: 'Profile User',
          email: 'profile@example.com',
          id: 'user-1',
        },
      },
    })
    mockUseUpdateUserProfile.mockImplementation(() => ({
      isPending: false,
      mutateAsync,
    }))

    const { rerender } = render(<ProfileDialog isOpen onClose={vi.fn()} />)

    const displayNameInput = screen.getByRole('textbox', { name: 'Никнейм' })
    fireEvent.change(displayNameInput, { target: { value: 'Changed User' } })
    expect(displayNameInput).toHaveValue('Changed User')

    rerender(<ProfileDialog isOpen={false} onClose={vi.fn()} />)
    rerender(<ProfileDialog isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('textbox', { name: 'Никнейм' })).toHaveValue(
      'Profile User',
    )
  })

  it('updates the account password from the profile dialog', async () => {
    const mutateAsync = vi.fn(() => Promise.resolve(undefined))
    const onClose = vi.fn()

    mockUsePlannerSession.mockReturnValue({
      data: {
        actor: {
          avatarUrl: null,
          displayName: 'Profile User',
          email: 'profile@example.com',
          id: 'user-1',
        },
      },
    })
    mockUseUpdateUserProfile.mockImplementation(() => ({
      isPending: false,
      mutateAsync,
    }))

    render(<ProfileDialog isOpen onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Текущий пароль'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('Новый пароль'), {
      target: { value: 'new-password' },
    })
    fireEvent.change(screen.getByLabelText('Повторите новый пароль'), {
      target: { value: 'new-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => {
      expect(mockUpdatePassword).toHaveBeenCalledWith(
        'new-password',
        'old-password',
      )
    })
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('validates password confirmation before saving profile changes', async () => {
    const mutateAsync = vi.fn(() => Promise.resolve(undefined))

    mockUsePlannerSession.mockReturnValue({
      data: {
        actor: {
          avatarUrl: null,
          displayName: 'Profile User',
          email: 'profile@example.com',
          id: 'user-1',
        },
      },
    })
    mockUseUpdateUserProfile.mockImplementation(() => ({
      isPending: false,
      mutateAsync,
    }))

    render(<ProfileDialog isOpen onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Текущий пароль'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('Новый пароль'), {
      target: { value: 'new-password' },
    })
    fireEvent.change(screen.getByLabelText('Повторите новый пароль'), {
      target: { value: 'different-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Пароли не совпадают.')).toBeVisible()
    expect(mockUpdatePassword).not.toHaveBeenCalled()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
