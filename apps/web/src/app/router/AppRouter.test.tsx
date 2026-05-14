import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRouter } from './AppRouter'

interface PlannerSessionStub {
  data: {
    workspace: {
      kind: 'personal' | 'shared'
    }
  }
}

const mockUsePlannerSession = vi.fn<() => PlannerSessionStub>()

vi.mock('@/features/session', () => ({
  usePlannerSession: () => mockUsePlannerSession(),
}))

vi.mock('@/pages/today', () => ({
  TodayPage: () => <div>Today page</div>,
}))

vi.mock('@/pages/admin', () => ({
  AdminPage: () => <div>Admin page</div>,
}))

vi.mock('@/pages/calendar', () => ({
  CalendarPage: () => <div>Calendar page</div>,
}))

vi.mock('@/pages/habits', () => ({
  HabitsPage: () => <div>Habits page</div>,
}))

vi.mock('@/pages/profile', () => ({
  ProfilePage: () => <div>Profile page</div>,
}))

vi.mock('@/pages/shopping', () => ({
  ShoppingPage: () => <div>Shopping page</div>,
}))

vi.mock('@/pages/spheres', () => ({
  SpherePage: () => <div>Sphere page</div>,
  SpheresPage: () => <div>Spheres page</div>,
}))

vi.mock('@/pages/timeline', () => ({
  TimelinePage: () => <div>Timeline page</div>,
}))

describe('AppRouter', () => {
  beforeEach(() => {
    mockUsePlannerSession.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('redirects shared workspaces away from habits', async () => {
    mockUsePlannerSession.mockReturnValue({
      data: {
        workspace: {
          kind: 'shared',
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/habits']}>
        <AppRouter />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Today page')).toBeVisible()
    expect(screen.queryByText('Habits page')).not.toBeInTheDocument()
  })

  it('keeps habits available in personal workspaces', async () => {
    mockUsePlannerSession.mockReturnValue({
      data: {
        workspace: {
          kind: 'personal',
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/habits']}>
        <AppRouter />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Habits page')).toBeVisible()
  })

  it('keeps calendar available in shared workspaces', async () => {
    mockUsePlannerSession.mockReturnValue({
      data: {
        workspace: {
          kind: 'shared',
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <AppRouter />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Calendar page')).toBeVisible()
  })

  it('redirects shared workspaces away from profile', async () => {
    mockUsePlannerSession.mockReturnValue({
      data: {
        workspace: {
          kind: 'shared',
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <AppRouter />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Today page')).toBeVisible()
    expect(screen.queryByText('Profile page')).not.toBeInTheDocument()
  })

  it('keeps profile available in personal workspaces', async () => {
    mockUsePlannerSession.mockReturnValue({
      data: {
        workspace: {
          kind: 'personal',
        },
      },
    })

    render(
      <MemoryRouter initialEntries={['/profile']}>
        <AppRouter />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Profile page')).toBeVisible()
  })
})
