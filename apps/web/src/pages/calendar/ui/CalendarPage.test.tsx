import type {
  CalendarViewMode,
  SelfCareSettings,
  SelfCareTodayItem,
} from '@planner/contracts'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildSelfCareCalendarTasks } from '../lib/calendar-load'
import { CalendarPage } from './CalendarPage'

interface SessionStub {
  actorUserId: string
  groupRole: null
  role: 'owner'
  userPreferences: {
    calendarViewMode: CalendarViewMode
    energyMode: 'normal'
    voiceAssistantEnabled: true
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

vi.mock('@/features/self-care', () => ({
  useSelfCarePlan: () => ({ data: { occurrences: [] } }),
  useSelfCareSettings: () => ({ data: undefined }),
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
    vi.useRealTimers()
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

  it('opens task creation with time fields from the calendar query trigger and clears it', async () => {
    renderCalendarPage('/calendar?foo=bar&createTask=request-1')

    await waitFor(() => {
      const triggerCall = mocks.taskComposer.mock.calls.find(
        ([props]) => props.openDraft?.requestId === 'request-1',
      )
      const props = triggerCall?.[0]

      expect(props?.desktopOpenButtonHidden).toBe(true)
      expect(typeof props?.openDraft?.plannedDate).toBe('string')
      expect(props?.openButtonLabel).toBe('Задача')
      expect(props?.showTimeFields).toBe(true)
    })

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/calendar?foo=bar',
      )
    })
  })

  it('shows the current time marker in today day view', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T14:15:00'))
    currentSession = createSession('day')

    renderCalendarPage('/calendar?calendarView=day')

    const marker = within(screen.getByLabelText('День')).getByTestId(
      'calendar-current-time-marker',
    )

    expect(marker).toHaveStyle({ top: '59.375%' })
  })

  it('shows the current time marker only in the current week day column', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T14:15:00'))

    renderCalendarPage('/calendar?calendarView=week')

    const markers = within(screen.getByLabelText('Неделя')).getAllByTestId(
      'calendar-current-time-marker',
    )

    expect(markers).toHaveLength(1)
    expect(markers[0]).toHaveStyle({ top: '59.375%' })
  })

  it('hides planning-only after-completion self-care repeats from the calendar', () => {
    const tasks = buildSelfCareCalendarTasks(
      [
        createSelfCareCalendarEntry({
          appointment: createSelfCareAppointmentDetails({
            occurrenceId: null,
          }),
        }),
      ],
      createSelfCareSettings(),
    )

    expect(tasks).toHaveLength(0)
  })

  it('shows a manually scheduled after-completion self-care appointment in the calendar', () => {
    const tasks = buildSelfCareCalendarTasks(
      [
        createSelfCareCalendarEntry({
          appointment: createSelfCareAppointmentDetails({
            occurrenceId: 'occurrence-1',
          }),
        }),
      ],
      createSelfCareSettings(),
    )

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'self-care:occurrence-1',
      plannedDate: '2026-06-25',
      plannedStartTime: '18:00',
      title: 'Массаж',
    })
  })

  it.each([
    {
      afterNext: '13 июня',
      initialEntry: '/calendar?calendarView=day',
      label: 'День',
      persistedViewMode: 'day' as const,
    },
    {
      afterNext: '15 июн',
      initialEntry: '/calendar?calendarView=week',
      label: 'Неделя',
      persistedViewMode: 'week' as const,
    },
    {
      afterNext: 'Июль',
      initialEntry: '/calendar?calendarView=month',
      label: 'Месяц',
      persistedViewMode: 'month' as const,
    },
  ])(
    'changes the $label period with horizontal swipes',
    ({ afterNext, initialEntry, label, persistedViewMode }) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-12T10:00:00'))
      currentSession = createSession(persistedViewMode)

      renderCalendarPage(initialEntry)

      swipeCalendarSurface(label, 'left')
      expect(screen.getByTestId('calendar-period-title')).toHaveTextContent(
        afterNext,
      )
    },
  )
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

function swipeCalendarSurface(label: string, direction: 'left' | 'right') {
  const surface = screen.getByLabelText(label)
  const startX = direction === 'left' ? 260 : 120
  const endX = direction === 'left' ? 120 : 260

  fireEvent.pointerDown(surface, {
    button: 0,
    clientX: startX,
    clientY: 220,
    pointerId: 1,
    pointerType: 'touch',
  })
  fireEvent.pointerUp(surface, {
    clientX: endX,
    clientY: 226,
    pointerId: 1,
    pointerType: 'touch',
  })
}

function createSession(calendarViewMode: CalendarViewMode): SessionStub {
  return {
    actorUserId: 'user-1',
    groupRole: null,
    role: 'owner',
    userPreferences: {
      calendarViewMode,
      energyMode: 'normal',
      voiceAssistantEnabled: true,
    },
    workspace: {
      kind: 'personal',
    },
    workspaceId: 'workspace-1',
  }
}

function createSelfCareSettings(
  overrides: Partial<SelfCareSettings> = {},
): SelfCareSettings {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    currency: 'RUB',
    defaultReminderTone: 'soft',
    gentleModeDate: null,
    gentleModeEnabledToday: false,
    id: 'settings-1',
    quietHoursEnd: '08:00',
    quietHoursStart: '22:00',
    showAppointmentsInCalendar: true,
    showSelfCareInMainTasks: true,
    updatedAt: '2026-06-01T00:00:00.000Z',
    userId: 'user-1',
    ...overrides,
  }
}

function createSelfCareCalendarEntry(
  overrides: Partial<SelfCareTodayItem> = {},
): SelfCareTodayItem {
  return {
    appointment: createSelfCareAppointmentDetails(),
    completion: null,
    courseDetails: null,
    flexibleProgress: null,
    item: {
      category: 'relax',
      color: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      createdFromTemplateId: null,
      customCategoryId: null,
      defaultDurationMinutes: 60,
      deletedAt: null,
      description: 'Массаж для жизни',
      icon: '💆',
      id: 'item-1',
      importance: 'recommended',
      isActive: true,
      isArchived: false,
      isPrivate: true,
      migratedFromHabitId: null,
      minimumVersionDescription: null,
      minimumVersionDurationMinutes: null,
      minimumVersionTitle: null,
      preferredTimeOfDay: 'afternoon',
      title: 'Массаж',
      type: 'appointment',
      updatedAt: '2026-06-01T00:00:00.000Z',
      userId: 'user-1',
      version: 1,
      workspaceId: 'workspace-1',
    },
    lastMeasurement: null,
    measurement: null,
    occurrence: {
      completedAt: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      dueAt: null,
      generatedAt: '2026-06-01T00:00:00.000Z',
      id: 'occurrence-1',
      itemId: 'item-1',
      movedTo: null,
      scheduledFor: '2026-06-25',
      scheduleRuleId: 'rule-1',
      status: 'scheduled',
      updatedAt: '2026-06-01T00:00:00.000Z',
      userId: 'user-1',
    },
    procedure: null,
    scheduleRule: {
      allowMultiplePerDay: false,
      createdAt: '2026-06-01T00:00:00.000Z',
      dayOfMonth: null,
      daysOfWeek: [],
      endDate: null,
      flexiblePeriod: null,
      flexibleTargetCount: null,
      generateInCalendar: false,
      generateInTaskList: true,
      id: 'rule-1',
      intervalUnit: 'day',
      intervalValue: 5,
      itemId: 'item-1',
      monthOfYear: null,
      preferredTime: null,
      reminderOffsetsMinutes: [],
      repeatKind: 'after_completion',
      startDate: '2026-06-20',
      timezone: null,
      updatedAt: '2026-06-01T00:00:00.000Z',
      weekOfMonth: null,
    },
    steps: [],
    timeGroup: 'afternoon',
    ...overrides,
  }
}

function createSelfCareAppointmentDetails(
  overrides: Partial<NonNullable<SelfCareTodayItem['appointment']>> = {},
): NonNullable<SelfCareTodayItem['appointment']> {
  return {
    createdAt: '2026-06-01T00:00:00.000Z',
    currency: 'RUB',
    endsAt: null,
    id: 'appointment-details-1',
    itemId: 'item-1',
    occurrenceId: 'occurrence-1',
    place: null,
    preparationNote: null,
    price: 4600,
    resultNote: null,
    specialistContact: null,
    specialistName: 'Федор',
    startsAt: '2026-06-25T18:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}
