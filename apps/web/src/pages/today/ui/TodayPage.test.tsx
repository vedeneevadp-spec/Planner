import type {
  ChaosInboxItemRecord,
  CleaningTaskWithState,
  CleaningTodayResponse,
  CleaningZoneRecord,
  SelfCareDashboardResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'
import { addDays, getDateKey } from '@/shared/lib/date'
import { setStoredTodayTaskView } from '@/shared/lib/today-task-view'

import { TodayPage } from './TodayPage'

type WorkspaceKind = 'personal' | 'shared'

interface PlannerSessionStub {
  actorUserId: string
  groupRole: null
  role: 'owner'
  userPreferences: {
    energyMode: 'normal'
    voiceAssistantEnabled: true
  }
  workspace: {
    id: string
    kind: WorkspaceKind
    name: string
  }
}

const mocks = vi.hoisted(() => {
  const selfCareDashboards: Record<
    string,
    SelfCareDashboardResponse | undefined
  > = {}
  const cleaningTodayResponses: Record<
    string,
    CleaningTodayResponse | undefined
  > = {}

  return {
    cleaningTodayRequest: vi.fn(),
    cleaningTodayResponses,
    copyTaskToPersonal: vi.fn(),
    createNextTaskStage: vi.fn(),
    detachTaskFromChain: vi.fn(),
    moveTaskToPersonal: vi.fn(),
    removeTask: vi.fn(),
    selfCareDashboards,
    selfCareDashboardRequest: vi.fn(),
    setTaskPlannedDate: vi.fn(),
    setTaskStatus: vi.fn(),
    shoppingActiveItems: [] as ChaosInboxItemRecord[],
    shoppingItemPending: false,
    shoppingItemUpdate: vi.fn(),
    taskComposer: vi.fn(),
    updateTask: vi.fn(),
    updateUserPreferences: vi.fn(),
    usePlannerSession: vi.fn<() => { data: PlannerSessionStub }>(),
  }
})

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({ uploadedIcons: [] }),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    copyTaskToPersonal: mocks.copyTaskToPersonal,
    createNextTaskStage: mocks.createNextTaskStage,
    detachTaskFromChain: mocks.detachTaskFromChain,
    isTaskPending: () => false,
    moveTaskToPersonal: mocks.moveTaskToPersonal,
    removeTask: mocks.removeTask,
    setTaskPlannedDate: mocks.setTaskPlannedDate,
    setTaskStatus: mocks.setTaskStatus,
    spheres: [],
    tasks: plannerTasks,
    updateTask: mocks.updateTask,
  }),
}))

vi.mock('@/features/cleaning', () => ({
  useCleaningToday: (date: string) => {
    mocks.cleaningTodayRequest(date)

    return {
      data: mocks.cleaningTodayResponses[date],
    }
  },
}))

vi.mock('@/features/shopping-list', () => ({
  useShoppingListSummary: () => ({
    activeItemCount: mocks.shoppingActiveItems.length,
    activeItems: mocks.shoppingActiveItems,
    completedItemCount: 0,
    completedItems: [],
    totalItemCount: mocks.shoppingActiveItems.length,
  }),
  useUpdateShoppingListItem: () => ({
    isPending: mocks.shoppingItemPending,
    mutate: mocks.shoppingItemUpdate,
  }),
}))

vi.mock('@/features/self-care', () => ({
  useSelfCareDashboard: (date: string) => {
    mocks.selfCareDashboardRequest(date)

    return {
      data: mocks.selfCareDashboards[date],
    }
  },
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
  usePlannerTimeZone: () => 'UTC',
  useUpdateUserPreferences: () => ({
    mutate: mocks.updateUserPreferences,
  }),
  useWorkspaceUsers: () => ({ data: { users: [] } }),
}))

vi.mock('@/features/task-create', () => ({
  TaskComposer: (props: unknown) => {
    mocks.taskComposer(props)
    return null
  },
}))

let plannerTasks: Task[] = []

function createSession(kind: WorkspaceKind): PlannerSessionStub {
  return {
    actorUserId: 'user-1',
    groupRole: null,
    role: 'owner',
    userPreferences: {
      energyMode: 'normal',
      voiceAssistantEnabled: true,
    },
    workspace: {
      id: `${kind}-workspace`,
      kind,
      name: kind === 'shared' ? 'Shared workspace' : 'Personal workspace',
    },
  }
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-05-19T08:00:00.000Z',
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    necessity: 'desired',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    requiresConfirmation: false,
    resource: null,
    sphereId: null,
    status: 'todo',
    title: 'Неразложенная задача',
    urgency: 'not_urgent',
    ...overrides,
  }
}

function createRoutineTask(overrides: Partial<Task> = {}): Task {
  return createTask({
    routine: {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      frequency: 'daily',
      seriesId: 'routine-series-1',
      targetType: 'check',
      targetValue: 1,
      unit: '',
    },
    ...overrides,
  })
}

function createShoppingItem(
  overrides: Partial<ChaosInboxItemRecord> = {},
): ChaosInboxItemRecord {
  return {
    activatedAt: null,
    completedAt: null,
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: '2026-05-19T08:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id: 'shopping-1',
    isFavorite: false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: null,
    shoppingCategory: 'groceries',
    source: 'manual',
    sphereId: null,
    status: 'new',
    text: 'Молоко',
    updatedAt: '2026-05-19T08:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'personal-workspace',
    ...overrides,
  }
}

function createCleaningZone(
  overrides: Partial<CleaningZoneRecord> = {},
): CleaningZoneRecord {
  return {
    createdAt: '2026-05-19T08:00:00.000Z',
    dayOfWeek: 2,
    deletedAt: null,
    description: '',
    id: 'cleaning-zone-1',
    isActive: true,
    sortOrder: 0,
    title: 'Кухня',
    updatedAt: '2026-05-19T08:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'personal-workspace',
    ...overrides,
  }
}

function createCleaningTaskWithState(
  zone: CleaningZoneRecord | null,
  overrides: Partial<CleaningTaskWithState> = {},
): CleaningTaskWithState {
  const taskId = overrides.task?.id ?? 'cleaning-task-1'

  return {
    isDue: true,
    isOverdue: false,
    score: 3,
    state: {
      lastCompletedAt: null,
      lastPostponedAt: null,
      lastSkippedAt: null,
      nextDueAt: null,
      postponeCount: 0,
      taskId,
      updatedAt: '2026-05-19T08:00:00.000Z',
      version: 1,
      workspaceId: 'personal-workspace',
    },
    task: {
      assignee: 'anyone',
      createdAt: '2026-05-19T08:00:00.000Z',
      customIntervalDays: null,
      deletedAt: null,
      depth: 'regular',
      description: '',
      energy: 'normal',
      estimatedMinutes: 15,
      frequencyInterval: 1,
      frequencyType: 'weekly',
      id: taskId,
      impactScore: 3,
      isActive: true,
      isSeasonal: false,
      priority: 'normal',
      scope: zone ? 'zone' : 'general',
      seasonMonths: [],
      sortOrder: 0,
      tags: [],
      title: 'Протереть поверхности',
      updatedAt: '2026-05-19T08:00:00.000Z',
      userId: 'user-1',
      version: 1,
      workspaceId: 'personal-workspace',
      zoneId: zone?.id ?? null,
    },
    zone,
    ...overrides,
  }
}

function createCleaningTodayResponse(
  options: {
    date?: string
    generalItems?: CleaningTaskWithState[]
    items?: CleaningTaskWithState[]
  } = {},
): CleaningTodayResponse {
  const items = options.items ?? []
  const generalItems = options.generalItems ?? []
  const zones = Array.from(
    new Map(
      items.flatMap((item) =>
        item.zone ? [[item.zone.id, item.zone] as const] : [],
      ),
    ).values(),
  )

  return {
    accumulatedItems: [],
    date: options.date ?? getDateKey(new Date()),
    dayOfWeek: 2,
    generalItems,
    history: [],
    items,
    quickItems: [],
    seasonalItems: [],
    summary: {
      accumulatedCount: 0,
      activeZoneCount: zones.length,
      completedTodayCount: 0,
      dueCount: items.length + generalItems.length,
      generalCount: generalItems.length,
      quickCount: 0,
      seasonalCount: 0,
      urgentCount: 0,
    },
    urgentItems: [],
    zones,
  }
}

type SelfCareTodayItemOverrides = Omit<Partial<SelfCareTodayItem>, 'item'> & {
  item?: Partial<SelfCareTodayItem['item']>
}

function createSelfCareTodayItem(
  overrides: SelfCareTodayItemOverrides = {},
): SelfCareTodayItem {
  const { item: itemOverrides, ...entryOverrides } = overrides

  return {
    appointment: null,
    completion: null,
    courseDetails: null,
    flexibleProgress: null,
    item: {
      category: 'daily_base',
      color: null,
      createdAt: '2026-05-19T08:00:00.000Z',
      customCategoryId: null,
      defaultDurationMinutes: null,
      deletedAt: null,
      description: '',
      icon: 'image:legacy-icon',
      id: 'self-care-1',
      importance: 'recommended',
      isActive: true,
      isArchived: false,
      isPrivate: true,
      migratedFromHabitId: 'habit-1',
      preferredTimeOfDay: 'anytime',
      title: 'Компактная привычка',
      type: 'habit',
      updatedAt: '2026-05-19T08:00:00.000Z',
      userId: 'user-1',
      version: 1,
      workspaceId: 'personal-workspace',
      ...itemOverrides,
    } as SelfCareTodayItem['item'],
    exercise: null,
    lastExercise: null,
    lastMeasurement: null,
    measurement: null,
    occurrence: null,
    procedure: null,
    scheduleRule: null,
    steps: [],
    timeGroup: 'anytime',
    ...entryOverrides,
  }
}

function createSelfCareDashboard(
  todayItems: SelfCareTodayItem[],
  options: {
    date?: string
    flexibleGoals?: SelfCareTodayItem[]
    showSelfCareInMainTasks?: boolean
  } = {},
): SelfCareDashboardResponse {
  return {
    date: options.date ?? getDateKey(new Date()),
    dailyState: null,
    flexibleGoals: options.flexibleGoals ?? [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: [],
    planningHints: [],
    settings: {
      showSelfCareInMainTasks: options.showSelfCareInMainTasks ?? true,
    } as SelfCareDashboardResponse['settings'],
    todayItems,
    upcomingImportant: [],
  }
}

function setSelfCareDashboard(
  dashboard: SelfCareDashboardResponse,
  date = dashboard.date,
) {
  mocks.selfCareDashboards[date] = dashboard
}

function renderTodayPage({
  initialEntry = '/today',
  kind = 'personal',
  tasks,
}: {
  initialEntry?: string
  kind?: WorkspaceKind
  tasks: Task[]
}) {
  plannerTasks = tasks
  mocks.usePlannerSession.mockReturnValue({ data: createSession(kind) })

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TodayPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function LocationProbe() {
  const location = useLocation()

  return <output data-testid="today-location">{location.search}</output>
}

describe('TodayPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    plannerTasks = []
    mocks.cleaningTodayRequest.mockReset()
    mocks.cleaningTodayResponses = {}
    mocks.copyTaskToPersonal.mockReset()
    mocks.createNextTaskStage.mockReset()
    mocks.detachTaskFromChain.mockReset()
    mocks.moveTaskToPersonal.mockReset()
    mocks.removeTask.mockReset()
    mocks.selfCareDashboards = {}
    mocks.selfCareDashboardRequest.mockReset()
    mocks.setTaskPlannedDate.mockReset()
    mocks.setTaskStatus.mockReset()
    mocks.shoppingActiveItems = []
    mocks.shoppingItemPending = false
    mocks.shoppingItemUpdate.mockReset()
    mocks.taskComposer.mockReset()
    mocks.updateTask.mockReset()
    mocks.updateTask.mockResolvedValue(true)
    mocks.updateUserPreferences.mockReset()
    mocks.usePlannerSession.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps today, routine and attention sections expanded by default', () => {
    const todayKey = getDateKey(new Date())
    const yesterdayKey = getDateKey(addDays(new Date(), -1))

    renderTodayPage({
      tasks: [
        createTask({
          id: 'today-task',
          plannedDate: todayKey,
          title: 'Задача на сегодня',
        }),
        createRoutineTask({
          id: 'routine-task',
          plannedDate: todayKey,
          title: 'Рутинная задача',
        }),
        createTask({
          id: 'overdue-task',
          plannedDate: yesterdayKey,
          title: 'Просроченная задача',
        }),
      ],
    })

    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Рутина' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Требуют внимания' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps other tasks expanded when no earlier task section is visible', () => {
    renderTodayPage({
      tasks: [createTask()],
    })

    expect(screen.queryByRole('button', { name: 'Завтра' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('starts other tasks collapsed when today is visible and tomorrow is empty', () => {
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      tasks: [
        createTask({
          id: 'today-task',
          plannedDate: todayKey,
          title: 'Задача на сегодня',
        }),
        createTask({
          id: 'other-task',
          title: 'Неразложенная задача',
        }),
      ],
    })

    expect(screen.queryByRole('button', { name: 'Завтра' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('starts other tasks collapsed when tomorrow is visible before it', () => {
    const tomorrowKey = getDateKey(addDays(new Date(), 1))

    renderTodayPage({
      tasks: [
        createTask({ id: 'task-1' }),
        createTask({
          id: 'task-2',
          plannedDate: tomorrowKey,
          title: 'Задача на завтра',
        }),
      ],
    })

    expect(screen.getByRole('button', { name: 'Завтра' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps completed today expanded when no earlier task section is visible', () => {
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      tasks: [
        createTask({
          completedAt: `${todayKey}T12:00:00.000`,
          id: 'done-task',
          status: 'done',
          title: 'Закрытая задача',
        }),
      ],
    })

    expect(
      screen.getByRole('button', { name: 'Выполнено сегодня' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows archived tasks only in the collapsed archive section', () => {
    renderTodayPage({
      tasks: [
        createTask({
          id: 'archived-task',
          status: 'archived',
          title: 'Когда-нибудь разобрать',
        }),
      ],
    })

    expect(
      screen.queryByRole('button', { name: 'Остальные задачи' }),
    ).toBeNull()
    expect(screen.queryByText('Когда-нибудь разобрать')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Архив' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Архив' }))

    expect(screen.getByText('Когда-нибудь разобрать')).toBeVisible()
  })

  it('keeps shared other tasks expanded when tomorrow is empty', () => {
    renderTodayPage({
      kind: 'shared',
      tasks: [createTask()],
    })

    expect(screen.queryByRole('button', { name: 'Завтра' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('uses compact task cards when task view is list', () => {
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      initialEntry: '/today?taskView=list',
      tasks: [
        createTask({
          id: 'today-task',
          note: 'Подробности не видны в компактном списке',
          plannedDate: todayKey,
          title: 'Компактная задача на сегодня',
        }),
      ],
    })

    expect(screen.getByText('Компактная задача на сегодня')).toBeVisible()
    expect(
      screen.queryByText('Подробности не видны в компактном списке'),
    ).not.toBeInTheDocument()
  })

  it('uses the stored list view without a task view query parameter', () => {
    const todayKey = getDateKey(new Date())
    setStoredTodayTaskView('list')

    renderTodayPage({
      tasks: [
        createTask({
          id: 'today-task',
          note: 'Подробности сохранённого режима не видны',
          plannedDate: todayKey,
          title: 'Задача сохранённого списка',
        }),
      ],
    })

    expect(screen.getByText('Задача сохранённого списка')).toBeVisible()
    expect(
      screen.queryByText('Подробности сохранённого режима не видны'),
    ).not.toBeInTheDocument()
  })

  it('shows resource planning only in a personal workspace', () => {
    const personal = renderTodayPage({ tasks: [] })

    expect(screen.getByText('Антиперегруз')).toBeVisible()
    expect(mocks.selfCareDashboardRequest).toHaveBeenCalledTimes(2)

    personal.unmount()
    mocks.selfCareDashboardRequest.mockClear()
    renderTodayPage({ kind: 'shared', tasks: [] })

    expect(screen.queryByText('Антиперегруз')).not.toBeInTheDocument()
    expect(mocks.selfCareDashboardRequest).not.toHaveBeenCalled()
  })

  it('persists only a newly selected energy mode', () => {
    renderTodayPage({ tasks: [] })

    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть антиперегруз' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Норм/ }))

    expect(mocks.updateUserPreferences).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Минимум/ }))

    expect(mocks.updateUserPreferences).toHaveBeenCalledWith({
      energyMode: 'minimum',
    })
  })

  it('moves the selected unload candidate to tomorrow', () => {
    const todayKey = getDateKey(new Date())
    const tomorrowKey = getDateKey(addDays(new Date(), 1))

    renderTodayPage({
      tasks: [
        createTask({
          id: 'heavy-1',
          plannedDate: todayKey,
          resource: -5,
          title: 'Тяжёлая задача 1',
        }),
        createTask({
          id: 'heavy-2',
          plannedDate: todayKey,
          resource: -5,
          title: 'Тяжёлая задача 2',
        }),
      ],
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Открыть антиперегруз' }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'На завтра' })[0]!)

    expect(mocks.setTaskPlannedDate).toHaveBeenCalledWith(
      'heavy-1',
      tomorrowKey,
    )
  })

  it('opens a widget draft once and preserves unrelated query parameters', async () => {
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      initialEntry: '/today?taskView=list&createTask=request-1&foo=bar',
      tasks: [],
    })

    expect(mocks.taskComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPlannedDate: todayKey,
        openDraft: {
          plannedDate: todayKey,
          requestId: 'request-1',
        },
      }),
    )
    await waitFor(() => {
      expect(screen.getByTestId('today-location')).toHaveTextContent(
        '?taskView=list&foo=bar',
      )
    })
  })

  it('renders migrated self-care items from the self-care dashboard in routine', () => {
    setSelfCareDashboard(createSelfCareDashboard([createSelfCareTodayItem()]))

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.getByRole('link', {
        name: 'Открыть заботу: Компактная привычка',
      }),
    ).toBeVisible()
    expect(screen.queryByText('image:legacy-icon')).not.toBeInTheDocument()
  })

  it('marks a single shopping item as bought from the routine card', () => {
    mocks.shoppingActiveItems = [createShoppingItem()]

    const rendered = renderTodayPage({ tasks: [] })
    const shoppingButton = screen.getByRole('button', {
      name: 'Отметить покупку купленной: Молоко',
    })

    expect(shoppingButton).toBeVisible()
    expect(shoppingButton).toHaveTextContent('Купить Молоко')
    expect(screen.getByRole('button', { name: 'Рутина' })).toHaveTextContent(
      '1',
    )

    fireEvent.click(shoppingButton)

    expect(mocks.shoppingItemUpdate).toHaveBeenCalledWith({
      itemId: 'shopping-1',
      patch: {
        priority: null,
        status: 'archived',
      },
    })

    mocks.shoppingActiveItems = []
    rendered.rerender(
      <MemoryRouter initialEntries={['/today']}>
        <TodayPage />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(
      screen.queryByRole('button', {
        name: 'Отметить покупку купленной: Молоко',
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Рутина' })).toBeNull()
  })

  it('disables the single shopping action while its update is pending', () => {
    mocks.shoppingActiveItems = [createShoppingItem()]
    mocks.shoppingItemPending = true

    renderTodayPage({ tasks: [] })

    expect(
      screen.getByRole('button', {
        name: 'Отметить покупку купленной: Молоко',
      }),
    ).toBeDisabled()
  })

  it('links a multi-item shopping summary to shopping in a shared workspace', () => {
    mocks.shoppingActiveItems = [
      createShoppingItem(),
      createShoppingItem({ id: 'shopping-2', text: 'Хлеб' }),
    ]

    renderTodayPage({ kind: 'shared', tasks: [] })

    expect(
      screen.getByRole('link', { name: 'Открыть покупки: 2 покупки' }),
    ).toHaveAttribute('href', '/shopping')
    expect(screen.getByText('2 покупки')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Рутина' })).toHaveTextContent(
      '1',
    )
  })

  it('links the cleaning summary with zones and task count from routine', () => {
    const todayKey = getDateKey(new Date())
    const kitchen = createCleaningZone()
    const bathroom = createCleaningZone({
      id: 'cleaning-zone-2',
      title: 'Ванная',
    })
    const generalTask = createCleaningTaskWithState(null, {
      task: {
        ...createCleaningTaskWithState(null).task,
        id: 'cleaning-task-3',
      },
    })

    mocks.cleaningTodayResponses[todayKey] = createCleaningTodayResponse({
      date: todayKey,
      generalItems: [generalTask],
      items: [
        createCleaningTaskWithState(kitchen),
        createCleaningTaskWithState(bathroom, {
          task: {
            ...createCleaningTaskWithState(bathroom).task,
            id: 'cleaning-task-2',
          },
        }),
      ],
    })

    renderTodayPage({ tasks: [] })

    expect(
      screen.getByRole('link', {
        name: 'Открыть уборку: Кухня, Ванная, Прочее, 3 задачи',
      }),
    ).toHaveAttribute('href', '/cleaning')
    expect(screen.getByText('3 задачи · Кухня, Ванная, Прочее')).toBeVisible()
  })

  it('keeps aggregate routine cards hidden without active items', () => {
    const todayKey = getDateKey(new Date())
    mocks.cleaningTodayResponses[todayKey] = createCleaningTodayResponse({
      date: todayKey,
    })

    renderTodayPage({ tasks: [] })

    expect(screen.queryByRole('button', { name: 'Рутина' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Открыть покупки/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Открыть уборку/ })).toBeNull()
  })

  it('renders daily flexible self-care goals from the self-care dashboard in routine', () => {
    setSelfCareDashboard(
      createSelfCareDashboard([], {
        flexibleGoals: [
          createSelfCareTodayItem({
            flexibleProgress: {
              completedCount: 0,
              periodEnd: getDateKey(new Date()),
              periodStart: getDateKey(new Date()),
              remainingCount: 3,
              targetCount: 3,
            },
            item: {
              id: 'self-care-water',
              title: 'Вода',
            },
            scheduleRule: {
              allowMultiplePerDay: false,
              createdAt: '2026-05-14T08:00:00.000Z',
              dayOfMonth: null,
              daysOfWeek: [],
              endDate: null,
              flexiblePeriod: 'day',
              flexibleTargetCount: 3,
              generateInCalendar: false,
              generateInTaskList: true,
              id: 'self-care-water-rule',
              intervalUnit: null,
              intervalValue: null,
              itemId: 'self-care-water',
              monthOfYear: null,
              preferredTime: null,
              reminderOffsetsMinutes: [],
              repeatKind: 'flexible_goal',
              startDate: '2026-05-14',
              timezone: null,
              updatedAt: '2026-05-14T08:00:00.000Z',
              weekOfMonth: null,
            },
          }),
        ],
      }),
    )

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.getByRole('link', {
        name: 'Открыть заботу: Вода',
      }),
    ).toBeVisible()
  })

  it('renders daily flexible self-care goals with a daily repeat rule in routine', () => {
    setSelfCareDashboard(
      createSelfCareDashboard([], {
        flexibleGoals: [
          createSelfCareTodayItem({
            flexibleProgress: {
              completedCount: 0,
              periodEnd: getDateKey(new Date()),
              periodStart: getDateKey(new Date()),
              remainingCount: 3,
              targetCount: 3,
            },
            item: {
              id: 'self-care-pushups',
              title: 'Отжимания',
              type: 'flexible_goal',
            },
            scheduleRule: {
              allowMultiplePerDay: false,
              createdAt: '2026-06-20T08:00:00.000Z',
              dayOfMonth: null,
              daysOfWeek: [],
              endDate: null,
              flexiblePeriod: 'day',
              flexibleTargetCount: 3,
              generateInCalendar: false,
              generateInTaskList: true,
              id: 'self-care-pushups-rule',
              intervalUnit: null,
              intervalValue: null,
              itemId: 'self-care-pushups',
              monthOfYear: null,
              preferredTime: null,
              reminderOffsetsMinutes: [],
              repeatKind: 'daily',
              startDate: '2026-06-20',
              timezone: null,
              updatedAt: '2026-06-20T08:00:00.000Z',
              weekOfMonth: null,
            },
          }),
        ],
      }),
    )

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.getByRole('link', {
        name: 'Открыть заботу: Отжимания',
      }),
    ).toBeVisible()
  })

  it('keeps self-care dashboard items hidden when main tasks integration is disabled', () => {
    setSelfCareDashboard({
      ...createSelfCareDashboard([createSelfCareTodayItem()]),
      settings: {
        showSelfCareInMainTasks: false,
      } as SelfCareDashboardResponse['settings'],
    })

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.queryByRole('link', {
        name: 'Открыть заботу: Компактная привычка',
      }),
    ).not.toBeInTheDocument()
  })

  it('keeps completed self-care courses out of the main today routine', () => {
    setSelfCareDashboard(
      createSelfCareDashboard([
        createSelfCareTodayItem({
          courseDetails: {
            breakDays: 0,
            completedCount: 1,
            courseType: 'days',
            createdAt: '2026-05-19T08:00:00.000Z',
            endDate: null,
            id: 'course-details-1',
            isCompleted: true,
            isPaused: false,
            itemId: 'self-care-course',
            repeatAfterCompletion: false,
            startDate: getDateKey(new Date()),
            totalCount: 1,
            updatedAt: '2026-05-19T08:00:00.000Z',
          },
          item: {
            id: 'self-care-course',
            migratedFromHabitId: null,
            title: 'Завершённый курс',
            type: 'course',
          },
        }),
      ]),
    )

    renderTodayPage({
      tasks: [],
    })

    expect(
      screen.queryByRole('link', {
        name: 'Открыть заботу: Завершённый курс',
      }),
    ).not.toBeInTheDocument()
  })

  it('renders tomorrow self-care items in the tomorrow section when main tasks integration is enabled', () => {
    const todayKey = getDateKey(new Date())
    const tomorrowKey = getDateKey(addDays(new Date(), 1))

    setSelfCareDashboard(createSelfCareDashboard([], { date: todayKey }))
    setSelfCareDashboard(
      createSelfCareDashboard(
        [
          createSelfCareTodayItem({
            appointment: {
              createdAt: '2026-05-19T08:00:00.000Z',
              currency: null,
              endsAt: `${tomorrowKey}T12:00:00.000Z`,
              id: 'appointment-1',
              itemId: 'self-care-dentist',
              occurrenceId: 'occurrence-dentist',
              place: null,
              preparationNote: null,
              price: null,
              resultNote: null,
              specialistContact: null,
              specialistName: null,
              startsAt: `${tomorrowKey}T11:30:00.000Z`,
              updatedAt: '2026-05-19T08:00:00.000Z',
            },
            item: {
              id: 'self-care-dentist',
              migratedFromHabitId: null,
              title: 'Стоматолог',
              type: 'appointment',
            },
            occurrence: {
              completedAt: null,
              createdAt: '2026-05-19T08:00:00.000Z',
              dueAt: `${tomorrowKey}T11:30:00.000Z`,
              generatedAt: '2026-05-19T08:00:00.000Z',
              id: 'occurrence-dentist',
              itemId: 'self-care-dentist',
              movedTo: null,
              reminderOffsetsMinutes: [],
              reminderTimeZone: null,
              scheduledFor: tomorrowKey,
              scheduleRuleId: null,
              status: 'scheduled',
              updatedAt: '2026-05-19T08:00:00.000Z',
              userId: 'user-1',
            },
          }),
        ],
        { date: tomorrowKey },
      ),
    )

    renderTodayPage({
      tasks: [],
    })

    expect(screen.getByRole('button', { name: 'Завтра' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('link', {
        name: 'Открыть заботу: Стоматолог',
      }),
    ).toBeVisible()
  })

  it('keeps tomorrow self-care items hidden when main tasks integration is disabled', () => {
    const todayKey = getDateKey(new Date())
    const tomorrowKey = getDateKey(addDays(new Date(), 1))

    setSelfCareDashboard(
      createSelfCareDashboard([], {
        date: todayKey,
        showSelfCareInMainTasks: false,
      }),
    )
    setSelfCareDashboard(
      createSelfCareDashboard(
        [
          createSelfCareTodayItem({
            item: {
              id: 'self-care-dentist',
              migratedFromHabitId: null,
              title: 'Стоматолог',
              type: 'appointment',
            },
          }),
        ],
        {
          date: tomorrowKey,
          showSelfCareInMainTasks: false,
        },
      ),
    )

    renderTodayPage({
      tasks: [],
    })

    expect(screen.queryByRole('button', { name: 'Завтра' })).toBeNull()
    expect(
      screen.queryByRole('link', {
        name: 'Открыть заботу: Стоматолог',
      }),
    ).not.toBeInTheDocument()
  })
})
