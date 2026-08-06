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
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'
import type { SessionReadiness } from '@/features/session'

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
    kind: 'personal' | 'shared'
  }
  workspaceId: string
}

interface TaskComposerMockProps {
  desktopOpenButtonHidden?: boolean
  hideOpenButton?: boolean
  initialPlannedDate: string | null
  openDraft?: { plannedDate?: string | null; requestId: string } | null
  openButtonLabel?: string
  showTimeFields?: boolean
}

function createSelfCarePlanData():
  { occurrences: SelfCareTodayItem[] } | undefined {
  return { occurrences: [] }
}

const mocks = vi.hoisted(() => ({
  hasTaskReadError: false,
  hasTaskRecords: true,
  isTaskOffline: false,
  isTaskCacheHydrating: false,
  isLoading: false,
  taskLastSuccessfulSyncAt: '2026-06-03T10:00:00.000Z',
  mutatePreferences:
    vi.fn<(input: { calendarViewMode: CalendarViewMode }) => void>(),
  readiness: createReadiness(),
  refresh: vi.fn(() => Promise.resolve()),
  selfCarePlanQuery: {
    data: createSelfCarePlanData(),
    error: null as Error | null,
    isPending: false,
    isCacheLoading: false,
    lastSuccessfulSyncAt: '2026-06-03T10:00:00.000Z',
    refetch: vi.fn(() => Promise.resolve()),
  },
  selfCareSettingsQuery: {
    data: undefined as { settings: SelfCareSettings } | undefined,
    error: null as Error | null,
    isPending: false,
    isCacheLoading: false,
    lastSuccessfulSyncAt: null as string | null,
    refetch: vi.fn(() => Promise.resolve()),
  },
  tasks: [] as Task[],
  taskComposer: vi.fn<(props: TaskComposerMockProps) => void>(),
  usePlannerSession: vi.fn<() => { data: SessionStub }>(),
}))

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({ uploadedIcons: [] }),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    copyTaskToPersonal: vi.fn(),
    hasTaskReadError: mocks.hasTaskReadError,
    hasTaskRecords: mocks.hasTaskRecords,
    isLoading: mocks.isLoading,
    isTaskPending: () => false,
    isTaskOffline: mocks.isTaskOffline,
    isTaskCacheHydrating: mocks.isTaskCacheHydrating,
    moveTaskToPersonal: vi.fn(),
    readiness: mocks.readiness,
    refresh: mocks.refresh,
    removeTask: vi.fn(),
    setTaskPlannedDate: vi.fn(),
    setTaskSchedule: vi.fn(),
    setTaskStatus: vi.fn(),
    spheres: [],
    taskLastSuccessfulSyncAt: mocks.taskLastSuccessfulSyncAt,
    tasks: mocks.tasks,
    updateTask: vi.fn(),
  }),
}))

vi.mock('@/features/self-care', () => ({
  useSelfCarePlan: () => mocks.selfCarePlanQuery,
  useSelfCareSettings: () => mocks.selfCareSettingsQuery,
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
  usePlannerTimeZone: () => 'Europe/Astrakhan',
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

    return props.hideOpenButton ? null : <button type="button">Задача</button>
  },
}))

describe('CalendarPage', () => {
  let currentSession: SessionStub

  beforeEach(() => {
    currentSession = createSession('week')
    mocks.mutatePreferences.mockReset()
    mocks.hasTaskReadError = false
    mocks.hasTaskRecords = true
    mocks.isTaskOffline = false
    mocks.isTaskCacheHydrating = false
    mocks.isLoading = false
    mocks.taskLastSuccessfulSyncAt = '2026-06-03T10:00:00.000Z'
    mocks.readiness = createReadiness()
    mocks.refresh.mockReset()
    mocks.refresh.mockResolvedValue(undefined)
    mocks.selfCarePlanQuery.data = { occurrences: [] }
    mocks.selfCarePlanQuery.error = null
    mocks.selfCarePlanQuery.isPending = false
    mocks.selfCarePlanQuery.isCacheLoading = false
    mocks.selfCarePlanQuery.lastSuccessfulSyncAt = '2026-06-03T10:00:00.000Z'
    mocks.selfCarePlanQuery.refetch.mockReset()
    mocks.selfCarePlanQuery.refetch.mockResolvedValue(undefined)
    mocks.selfCareSettingsQuery.data = {
      settings: createSelfCareSettings(),
    }
    mocks.selfCareSettingsQuery.error = null
    mocks.selfCareSettingsQuery.isPending = false
    mocks.selfCareSettingsQuery.isCacheLoading = false
    mocks.selfCareSettingsQuery.lastSuccessfulSyncAt = null
    mocks.selfCareSettingsQuery.refetch.mockReset()
    mocks.selfCareSettingsQuery.refetch.mockResolvedValue(undefined)
    mocks.tasks = []
    mocks.taskComposer.mockReset()
    mocks.usePlannerSession.mockImplementation(() => ({ data: currentSession }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
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

  it('marks week view for its scoped responsive layout', () => {
    renderCalendarPage('/calendar?calendarView=week')

    expect(
      screen.getByLabelText('Неделя').closest('[data-calendar-view]'),
    ).toHaveAttribute('data-calendar-view', 'week')
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

  it.each([
    {
      name: 'loading',
      setup: () => {
        mocks.hasTaskRecords = false
        mocks.isLoading = true
        mocks.readiness = createReadiness({
          reason: 'planner_pending',
          status: 'blockedAuth',
        })
      },
    },
    {
      name: 'offline',
      setup: () => {
        mocks.hasTaskRecords = false
        mocks.isTaskOffline = true
      },
    },
    {
      name: 'unavailable access',
      setup: () => {
        mocks.hasTaskRecords = false
        mocks.isLoading = true
        mocks.readiness = createReadiness({
          canUseProtectedApi: false,
          canWriteProtectedData: false,
          reason: 'auth_deferred',
          status: 'blockedAuth',
        })
      },
    },
  ])(
    'defers a task creation deep link during $name and opens it after recovery',
    async ({ setup }) => {
      setup()
      const view = renderCalendarPage(
        '/calendar?calendarView=schedule&createTask=request-blocked',
      )

      await waitFor(() => {
        expect(mocks.taskComposer).toHaveBeenLastCalledWith(
          expect.objectContaining({
            hideOpenButton: true,
            openDraft: null,
          }),
        )
      })
      expect(screen.getByTestId('location')).toHaveTextContent(
        'createTask=request-blocked',
      )

      mocks.hasTaskRecords = true
      mocks.isLoading = false
      mocks.isTaskOffline = false
      mocks.readiness = createReadiness()
      view.rerender(
        <MemoryRouter
          initialEntries={[
            '/calendar?calendarView=schedule&createTask=request-blocked',
          ]}
        >
          <CalendarPage />
          <LocationProbe />
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(
          mocks.taskComposer.mock.calls.some(
            ([props]) => props.openDraft?.requestId === 'request-blocked',
          ),
        ).toBe(true)
      })
      await waitFor(() => {
        expect(screen.getByTestId('location')).not.toHaveTextContent(
          'createTask=request-blocked',
        )
      })
    },
  )

  it('shows a meaningful schedule empty state with one next action', () => {
    currentSession = createSession('schedule')

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(
      screen.getByRole('heading', {
        name: 'На выбранные дни задач нет',
      }),
    ).toBeVisible()
    expect(
      screen.getByText(/Добавьте задачу на один из выбранных дней/),
    ).toBeVisible()
    expect(screen.getByLabelText('Расписание').className).toContain(
      'scheduleSurfaceState',
    )
    expect(screen.getByLabelText('Расписание')).not.toHaveAttribute('tabindex')
    expect(
      within(screen.getByLabelText('Расписание')).getByRole('button', {
        name: 'Добавить задачу',
      }),
    ).toBeVisible()
  })

  it('opens the existing task composer from the schedule empty state', async () => {
    currentSession = createSession('schedule')

    renderCalendarPage('/calendar?calendarView=schedule&foo=bar')

    fireEvent.click(
      within(screen.getByLabelText('Расписание')).getByRole('button', {
        name: 'Добавить задачу',
      }),
    )

    await waitFor(() => {
      expect(
        mocks.taskComposer.mock.calls.some(
          ([props]) =>
            props.openDraft?.requestId.startsWith('calendar-empty-') === true,
        ),
      ).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/calendar?calendarView=schedule&foo=bar',
      )
    })
  })

  it('shows a calendar skeleton during the initial schedule load', () => {
    currentSession = createSession('schedule')
    mocks.hasTaskRecords = false
    mocks.isLoading = true
    mocks.readiness = createReadiness({
      reason: 'planner_pending',
      status: 'blockedAuth',
    })

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(screen.getByText('Загружаем календарь')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        name: 'На выбранные дни задач нет',
      }),
    ).not.toBeInTheDocument()
  })

  it.each<CalendarViewMode>(['day', 'week', 'month'])(
    'shows the shared loading state in %s view',
    (viewMode) => {
      currentSession = createSession(viewMode)
      mocks.hasTaskRecords = false
      mocks.isLoading = true
      mocks.readiness = createReadiness({
        reason: 'planner_pending',
        status: 'blockedAuth',
      })

      renderCalendarPage(`/calendar?calendarView=${viewMode}`)

      expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
      expect(screen.getByText('Загружаем календарь')).toBeVisible()
      expect(screen.queryByLabelText('День')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Неделя')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Месяц')).not.toBeInTheDocument()
    },
  )

  it('shows an explicit schedule error and retries all data sources', async () => {
    currentSession = createSession('schedule')
    mocks.hasTaskReadError = true
    mocks.hasTaskRecords = false

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(
      screen.getByRole('heading', {
        name: 'Не удалось загрузить календарь',
      }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalledTimes(1)
      expect(mocks.selfCarePlanQuery.refetch).toHaveBeenCalledTimes(1)
      expect(mocks.selfCareSettingsQuery.refetch).toHaveBeenCalledTimes(1)
    })
  })

  it('does not describe an unavailable auth session as offline', () => {
    currentSession = createSession('schedule')
    mocks.hasTaskRecords = false
    mocks.isLoading = true
    mocks.readiness = createReadiness({
      reason: 'auth_deferred',
      status: 'offlineWithCache',
    })

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(screen.getByText(/Не удалось подтвердить доступ/)).toBeVisible()
    expect(screen.queryByText('Нет подключения')).not.toBeInTheDocument()
  })

  it('shows offline with retry when the schedule has no local task cache', () => {
    currentSession = createSession('schedule')
    mocks.hasTaskRecords = false
    mocks.isTaskOffline = true

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(
      screen.getByRole('heading', {
        name: 'Календарь недоступен без подключения',
      }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
    expect(
      screen.getByText('Время последней синхронизации неизвестно'),
    ).toBeVisible()
  })

  it('shows offline immediately when browser queries are paused without cache', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    currentSession = createSession('schedule')
    mocks.hasTaskRecords = false
    mocks.isLoading = true
    mocks.readiness = createReadiness({
      reason: 'planner_pending',
      status: 'blockedAuth',
    })

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(
      screen.getByRole('heading', {
        name: 'Календарь недоступен без подключения',
      }),
    ).toBeVisible()
    expect(screen.queryByTestId('page-state-skeleton')).not.toBeInTheDocument()
  })

  it('checks the local task cache before declaring a cold start offline', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    currentSession = createSession('schedule')
    mocks.hasTaskRecords = false
    mocks.isTaskCacheHydrating = true
    mocks.isLoading = true

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(screen.getByText('Проверяем сохранённый календарь')).toBeVisible()
    expect(
      screen.queryByRole('heading', {
        name: 'Календарь недоступен без подключения',
      }),
    ).not.toBeInTheDocument()
  })

  it('explains restoring access in every cached calendar view', () => {
    currentSession = createSession('month')
    currentSession.workspace.kind = 'shared'
    mocks.readiness = createReadiness({
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'auth_restoring',
      status: 'blockedAuth',
    })

    renderCalendarPage('/calendar?calendarView=month')

    expect(screen.getByText('Восстанавливаем доступ')).toBeVisible()
    expect(screen.getByLabelText('Месяц')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps cached schedule visible when the browser goes offline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T08:00:00.000Z'))
    let isOnline = true
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(
      () => isOnline,
    )
    currentSession = createSession('schedule')
    currentSession.workspace.kind = 'shared'
    mocks.tasks = [
      createTask({ plannedDate: '2026-06-03', title: 'Сохранённая задача' }),
    ]
    renderCalendarPage('/calendar?calendarView=schedule')

    isOnline = false
    fireEvent(window, new Event('offline'))

    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(screen.getByText('Сохранённая задача')).toBeVisible()
    expect(screen.getByLabelText('Расписание')).toHaveAttribute('tabindex', '0')
  })

  it('keeps cached schedule content visible offline with freshness', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T14:15:00'))
    currentSession = createSession('schedule')
    currentSession.workspace.kind = 'shared'
    mocks.hasTaskReadError = true
    mocks.isTaskOffline = true
    mocks.tasks = [
      createTask({
        plannedDate: '2026-06-03',
        title: 'Сохранённая задача',
      }),
    ]

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(screen.getByText(/Последняя синхронизация:/)).toHaveAttribute(
      'datetime',
      '2026-06-03T10:00:00.000Z',
    )
    expect(screen.getByText('Сохранённая задача')).toBeVisible()
  })

  it('shows a non-blocking error when cached tasks survive an online read failure', () => {
    currentSession = createSession('schedule')
    currentSession.workspace.kind = 'shared'
    mocks.hasTaskReadError = true

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(screen.getByText('Календарь обновился не полностью')).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'На выбранные дни задач нет',
      }),
    ).toBeVisible()
  })

  it('keeps an empty planner cache usable when self-care data is unavailable offline', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    currentSession = createSession('schedule')
    mocks.selfCareSettingsQuery.data = undefined
    mocks.selfCarePlanQuery.data = undefined

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(screen.getByText(/Последняя синхронизация:/)).toHaveAttribute(
      'datetime',
      '2026-06-03T10:00:00.000Z',
    )
    expect(
      screen.getByRole('heading', {
        name: 'В сохранённых задачах на выбранные дни ничего нет',
      }),
    ).toBeVisible()
    expect(
      within(screen.getByLabelText('Расписание')).getByText(
        /Записи заботы о себе появятся после восстановления/,
      ),
    ).toBeVisible()
    expect(
      within(screen.getByLabelText('Расписание')).getByRole('button', {
        name: 'Добавить задачу',
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', {
        name: 'Календарь недоступен без подключения',
      }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Расписание')).not.toHaveAttribute('tabindex')
  })

  it('shows a non-blocking qualified empty state when self-care refresh fails', () => {
    currentSession = createSession('schedule')
    mocks.selfCarePlanQuery.data = undefined
    mocks.selfCarePlanQuery.error = new Error('Self-care failed')

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(screen.getByText('Календарь обновился не полностью')).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'В сохранённых задачах на выбранные дни ничего нет',
      }),
    ).toBeVisible()
    expect(
      within(screen.getByLabelText('Расписание')).getByRole('button', {
        name: 'Добавить задачу',
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', {
        name: 'Не удалось загрузить календарь полностью',
      }),
    ).not.toBeInTheDocument()
  })

  it('keeps cached self-care schedule data visible after a refresh error', () => {
    currentSession = createSession('schedule')
    mocks.selfCareSettingsQuery.data = {
      settings: createSelfCareSettings(),
    }
    mocks.selfCareSettingsQuery.lastSuccessfulSyncAt =
      '2026-06-03T09:00:00.000Z'
    mocks.selfCarePlanQuery.error = new Error('Refresh failed')

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(screen.getByText('Календарь обновился не полностью')).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'На выбранные дни задач нет',
      }),
    ).toBeVisible()
  })

  it('does not block the calendar on a plan that settings exclude', () => {
    currentSession = createSession('schedule')
    mocks.selfCareSettingsQuery.data = {
      settings: createSelfCareSettings({
        showAppointmentsInCalendar: false,
      }),
    }
    mocks.selfCarePlanQuery.data = undefined
    mocks.selfCarePlanQuery.error = new Error('Excluded plan failed')

    renderCalendarPage('/calendar?calendarView=schedule')

    expect(
      screen.getByRole('heading', {
        name: 'На выбранные дни задач нет',
      }),
    ).toBeVisible()
    expect(
      screen.queryByText('Расписание обновилось не полностью'),
    ).not.toBeInTheDocument()
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

  it('does not show untimed tasks in week view', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T14:15:00'))
    mocks.tasks = [
      createTask({
        plannedDate: '2026-06-03',
        title: 'Недельная задача без времени',
      }),
    ]

    renderCalendarPage('/calendar?calendarView=week')

    const week = within(screen.getByLabelText('Неделя'))

    expect(week.queryByText('Без времени')).not.toBeInTheDocument()
    expect(
      week.queryByText('Недельная задача без времени'),
    ).not.toBeInTheDocument()
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

function createReadiness(
  overrides: Partial<SessionReadiness> = {},
): SessionReadiness {
  return {
    canReadCachedData: true,
    canRenderAppContent: true,
    canUseProtectedApi: true,
    canWriteProtectedData: true,
    reason: 'ready',
    status: 'ready',
    ...overrides,
  }
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-06-03T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: '2026-06-03',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: 'Задача без времени',
    urgency: 'not_urgent',
    ...overrides,
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
    version: 1,
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
    exercise: null,
    lastExercise: null,
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
      reminderOffsetsMinutes: [],
      reminderTimeZone: null,
      scheduledFor: '2026-06-25',
      scheduleRuleId: 'rule-1',
      status: 'scheduled',
      updatedAt: '2026-06-01T00:00:00.000Z',
      userId: 'user-1',
      version: 1,
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
