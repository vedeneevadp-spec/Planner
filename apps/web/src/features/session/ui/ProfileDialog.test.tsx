import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

vi.mock('@/features/planner', () => ({
  getNativePlannerWidgetBackgroundOpacity: vi.fn(() => Promise.resolve(100)),
  isAndroidPlannerWidgetRuntime: vi.fn(() => false),
  NATIVE_PLANNER_WIDGET_BACKGROUND_OPACITY_OPTIONS: [40, 55, 70, 85, 100],
  setNativePlannerWidgetBackgroundOpacity: vi.fn((opacity: number) =>
    Promise.resolve(opacity),
  ),
}))

vi.mock('../lib/usePlannerSession', () => ({
  usePlannerSession: () => mockUsePlannerSession(),
}))

vi.mock('../lib/useUserProfile', () => ({
  getUpdateUserProfileErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'profile update failed',
  useUpdateUserProfile: () => mockUseUpdateUserProfile(),
}))

describe('ProfileDialog', () => {
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
})
