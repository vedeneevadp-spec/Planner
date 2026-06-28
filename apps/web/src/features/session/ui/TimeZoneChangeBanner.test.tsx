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

vi.mock('@/shared/time/time.service', () => ({
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
      voiceAssistantEnabled: true,
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
      wakeWordTrainingModeEnabled: false,
    },
    workspaces: [],
  }
}
