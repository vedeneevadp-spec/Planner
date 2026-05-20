import type { CalendarViewMode } from '@planner/contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CalendarPage } from './CalendarPage'

interface SessionStub {
  actorUserId: string
  groupRole: null
  role: 'owner'
  userPreferences: {
    calendarViewMode: CalendarViewMode
    energyMode: 'normal'
  }
  workspace: {
    kind: 'personal'
  }
  workspaceId: string
}

const mocks = vi.hoisted(() => ({
  mutatePreferences:
    vi.fn<(input: { calendarViewMode: CalendarViewMode }) => void>(),
  usePlannerSession: vi.fn<() => { data: SessionStub }>(),
}))

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({ uploadedIcons: [] }),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    copyTaskToPersonal: vi.fn(),
    isTaskPending: () => false,
    moveTaskToPersonal: vi.fn(),
    removeTask: vi.fn(),
    setTaskPlannedDate: vi.fn(),
    setTaskStatus: vi.fn(),
    spheres: [],
    tasks: [],
    updateTask: vi.fn(),
  }),
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
  useUpdateUserPreferences: () => ({
    mutate: mocks.mutatePreferences,
  }),
  useWorkspaceUsers: () => ({
    data: { users: [] },
  }),
}))

vi.mock('@/features/task-create', () => ({
  TaskComposer: () => <button type="button">Задача</button>,
}))

describe('CalendarPage', () => {
  let currentSession: SessionStub

  beforeEach(() => {
    currentSession = createSession('week')
    mocks.mutatePreferences.mockReset()
    mocks.usePlannerSession.mockImplementation(() => ({ data: currentSession }))
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the locally selected view when preference sync rolls back', () => {
    const { rerender } = render(<CalendarPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Месяц' }))

    expect(screen.getByRole('button', { name: 'Месяц' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(mocks.mutatePreferences).toHaveBeenCalledWith({
      calendarViewMode: 'month',
    })

    currentSession = createSession('month')
    rerender(<CalendarPage />)
    currentSession = createSession('week')
    rerender(<CalendarPage />)

    expect(screen.getByRole('button', { name: 'Неделя' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Месяц' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

function createSession(calendarViewMode: CalendarViewMode): SessionStub {
  return {
    actorUserId: 'user-1',
    groupRole: null,
    role: 'owner',
    userPreferences: {
      calendarViewMode,
      energyMode: 'normal',
    },
    workspace: {
      kind: 'personal',
    },
    workspaceId: 'workspace-1',
  }
}
