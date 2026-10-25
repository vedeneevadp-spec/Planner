import type { SessionResponse } from '@planner/contracts'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface PlannerSessionQueryStub {
  data: SessionResponse | undefined
  error: unknown
  isPending: boolean
  refetch: () => Promise<void>
}

const mocks = vi.hoisted(() => ({
  getDeviceTimeZone: vi.fn<() => string | null>(),
  updatePreferences: vi.fn(),
  usePlannerSession: vi.fn<() => PlannerSessionQueryStub>(),
}))

vi.mock('@/shared/time/time.service', async (importOriginal) => ({
  ...(await importOriginal()),
  getDeviceTimeZone: () => mocks.getDeviceTimeZone(),
}))

vi.mock('../lib/usePlannerSession', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
}))

vi.mock('../lib/useUserPreferences', () => ({
  useUpdateUserPreferences: () => ({
    mutate: mocks.updatePreferences,
  }),
}))

import { TimeZoneChangeBanner } from './TimeZoneChangeBanner'

describe('TimeZoneChangeBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    mocks.getDeviceTimeZone.mockReturnValue('Europe/Moscow')
    mocks.usePlannerSession.mockReturnValue({
      data: createSessionResponse({
        lastSeenTimeZone: 'Europe/Samara',
      }),
      error: null,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('stores the current time zone silently when no previous zone exists', async () => {
    mocks.usePlannerSession.mockReturnValue({
      data: createSessionResponse({ lastSeenTimeZone: null }),
      error: null,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    })

    render(<TimeZoneChangeBanner />)

    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledWith({
        lastSeenTimeZone: 'Europe/Moscow',
      })
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a choice when the device time zone changes', async () => {
    render(<TimeZoneChangeBanner />)

    expect(
      await screen.findByRole('status', {
        name: 'Часовой пояс изменился',
      }),
    ).toHaveTextContent('Europe/Samara -> Europe/Moscow')
  })

  it.each([
    ['Asia/Novosibirsk', 'Asia/Krasnoyarsk'],
    ['Asia/Krasnoyarsk', 'Asia/Novosibirsk'],
    ['Asia/Novosibirsk', 'Asia/Novosibirsk'],
    ['Asia/Kolkata', 'Asia/Colombo'],
    ['Europe/London', 'UTC'],
  ])(
    'stays silent for matching current offsets: %s -> %s',
    (previousTimeZone, currentTimeZone) => {
      mocks.usePlannerSession.mockReturnValue({
        data: createSessionResponse({ lastSeenTimeZone: previousTimeZone }),
        error: null,
        isPending: false,
        refetch: vi.fn(() => Promise.resolve()),
      })
      mocks.getDeviceTimeZone.mockReturnValue(currentTimeZone)

      render(<TimeZoneChangeBanner />)
      fireEvent.focus(window)
      fireEvent(document, new Event('visibilitychange'))

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(mocks.updatePreferences).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['Asia/Kolkata', 'Asia/Kathmandu'],
    ['Pacific/Honolulu', 'Pacific/Kiritimati'],
    ['Invalid/TimeZone', 'Europe/Moscow'],
  ])(
    'keeps the choice for different or unknown offsets: %s -> %s',
    async (previousTimeZone, currentTimeZone) => {
      mocks.usePlannerSession.mockReturnValue({
        data: createSessionResponse({ lastSeenTimeZone: previousTimeZone }),
        error: null,
        isPending: false,
        refetch: vi.fn(() => Promise.resolve()),
      })
      mocks.getDeviceTimeZone.mockReturnValue(currentTimeZone)

      render(<TimeZoneChangeBanner />)

      expect(await screen.findByRole('status')).toHaveTextContent(
        `${previousTimeZone} -> ${currentTimeZone}`,
      )
    },
  )

  it('rechecks seasonal offsets when the app regains focus', () => {
    mocks.usePlannerSession.mockReturnValue({
      data: createSessionResponse({ lastSeenTimeZone: 'Europe/London' }),
      error: null,
      isPending: false,
      refetch: vi.fn(() => Promise.resolve()),
    })
    mocks.getDeviceTimeZone.mockReturnValue('UTC')

    render(<TimeZoneChangeBanner />)
    fireEvent.focus(window)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    fireEvent.focus(window)
    expect(screen.getByRole('status')).toHaveTextContent('Europe/London -> UTC')

    vi.setSystemTime(new Date('2026-12-15T12:00:00Z'))
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.updatePreferences).not.toHaveBeenCalled()
  })

  it.each(['Europe/Samara', 'Europe/Astrakhan'])(
    'clears a pending choice after returning to the previous offset in %s',
    async (currentTimeZone) => {
      render(<TimeZoneChangeBanner />)
      expect(await screen.findByRole('status')).toBeInTheDocument()

      mocks.getDeviceTimeZone.mockReturnValue(currentTimeZone)
      fireEvent.focus(window)

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(mocks.updatePreferences).not.toHaveBeenCalled()
    },
  )

  it('uses the current city and hides the banner', async () => {
    render(<TimeZoneChangeBanner />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Использовать текущий город',
      }),
    )

    expect(mocks.updatePreferences).toHaveBeenCalledWith({
      lastSeenTimeZone: 'Europe/Moscow',
      timeZoneMode: 'device',
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the home time zone in manual mode', async () => {
    render(<TimeZoneChangeBanner />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Оставить домашний часовой пояс',
      }),
    )

    expect(mocks.updatePreferences).toHaveBeenCalledWith({
      defaultTimeZone: 'Europe/Samara',
      lastSeenTimeZone: 'Europe/Moscow',
      timeZoneMode: 'manual',
    })
  })
})

function createSessionResponse(
  userPreferences: Partial<SessionResponse['userPreferences']> = {},
): SessionResponse {
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
      ...userPreferences,
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
    },
    workspaces: [],
  }
}
