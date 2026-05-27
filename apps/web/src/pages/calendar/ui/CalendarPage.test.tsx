import type { CalendarViewMode } from '@planner/contracts'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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

interface TaskComposerMockProps {
  desktopOpenButtonHidden?: boolean
  initialPlannedDate: string | null
  openDraft?: { plannedDate?: string | null; requestId: string } | null
  openButtonLabel?: string
  showTimeFields?: boolean
}

const mocks = vi.hoisted(() => ({
  mutatePreferences:
    vi.fn<(input: { calendarViewMode: CalendarViewMode }) => void>(),
  taskComposer: vi.fn<(props: TaskComposerMockProps) => void>(),
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
    setTaskSchedule: vi.fn(),
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
  TaskComposer: (props: TaskComposerMockProps) => {
    mocks.taskComposer(props)

    return <button type="button">Задача</button>
  },
}))

describe('CalendarPage', () => {
  let currentSession: SessionStub

  beforeEach(() => {
    currentSession = createSession('week')
    mocks.mutatePreferences.mockReset()
    mocks.taskComposer.mockReset()
    mocks.usePlannerSession.mockImplementation(() => ({ data: currentSession }))
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the query-selected view when preference sync rolls back', async () => {
    const { rerender } = renderCalendarPage('/calendar?calendarView=month')

    expect(screen.getByLabelText('Месяц')).toBeVisible()
    await waitFor(() => {
      expect(mocks.mutatePreferences).toHaveBeenCalledWith({
        calendarViewMode: 'month',
      })
    })

    currentSession = createSession('month')
    rerenderCalendarPage(rerender, '/calendar?calendarView=month')
    currentSession = createSession('week')
    rerenderCalendarPage(rerender, '/calendar?calendarView=month')

    expect(screen.getByLabelText('Месяц')).toBeVisible()
  })

  it('uses the persisted view when the query does not select one', () => {
    currentSession = createSession('schedule')

    renderCalendarPage('/calendar')

    expect(screen.getByLabelText('Расписание')).toBeVisible()
  })

  it('uses the day view from the calendar query', async () => {
    renderCalendarPage('/calendar?calendarView=day')

    expect(screen.getByLabelText('День')).toBeVisible()
    await waitFor(() => {
      expect(mocks.mutatePreferences).toHaveBeenCalledWith({
        calendarViewMode: 'day',
      })
    })
  })

  it('opens task creation from the calendar query trigger and clears it', async () => {
    renderCalendarPage('/calendar?foo=bar&createTask=request-1')

    await waitFor(() => {
      const triggerCall = mocks.taskComposer.mock.calls.find(
        ([props]) => props.openDraft?.requestId === 'request-1',
      )
      const props = triggerCall?.[0]

      expect(props?.desktopOpenButtonHidden).toBe(true)
      expect(typeof props?.openDraft?.plannedDate).toBe('string')
      expect(props?.openButtonLabel).toBe('Задача')
      expect(props?.showTimeFields).toBe(false)
    })

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/calendar?foo=bar',
      )
    })
  })
})

function LocationProbe() {
  const location = useLocation()

  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  )
}

function renderCalendarPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CalendarPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function rerenderCalendarPage(
  rerender: (ui: ReactNode) => void,
  initialEntry: string,
) {
  rerender(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CalendarPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

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
