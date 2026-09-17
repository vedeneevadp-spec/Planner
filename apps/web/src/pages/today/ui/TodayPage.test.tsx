import type {
  ChaosInboxItemRecord,
  CleaningTaskWithState,
  CleaningTodayResponse,
  CleaningZoneRecord,
  SelfCareDashboardResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'
import type { SessionReadiness } from '@/features/session'
import { addDays, getDateKey } from '@/shared/lib/date'
import { setStoredTodayTaskView } from '@/shared/lib/today-task-view'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

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

interface PlannerSessionQueryStub {
  data: PlannerSessionStub
  refetch: () => Promise<unknown>
}

interface SourceQueryStub {
  data?: unknown
  error?: unknown
  readError?: unknown
  isFetching?: boolean
  isPending?: boolean
  isCacheHydrating?: boolean
  isShowingCachedData?: boolean
  lastSuccessfulSyncAt?: string | null
  readiness?: SessionReadiness
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
  const cleaningQueryOverrides: Record<string, SourceQueryStub> = {}
  const selfCareQueryOverrides: Record<string, SourceQueryStub> = {}
  const shoppingQueryOverrides: SourceQueryStub = {}
  const shoppingItemError: unknown = null

  return {
    browserOffline: false,
    isRecoveringSession: false,
    sessionIsFetching: false,
    cleaningTodayRequest: vi.fn(),
    cleaningTodayResponses,
    cleaningQueryOverrides,
    cleaningRefetch: vi.fn<(date: string) => Promise<unknown>>(),
    copyTaskToPersonal: vi.fn(),
    createNextTaskStage: vi.fn(),
    detachTaskFromChain: vi.fn(),
    moveTaskToPersonal: vi.fn(),
    fetchNextTaskPage: vi.fn(),
    plannerState: {
      errorMessage: null as string | null,
      hasTaskReadError: false,
      hasTaskRecords: true,
      isLoading: false,
      isTaskCacheHydrating: false,
      isTaskOffline: false,
      isTaskReadFetching: false,
      readiness: {
        canReadCachedData: true,
        canRenderAppContent: true,
        canUseProtectedApi: true,
        canWriteProtectedData: true,
        reason: 'ready',
        status: 'ready',
      },
      taskReadModelCoverage: null as null | {
        historyNextCursor: string | null
        returnedCount: number
        sources: {
          dailyLoad?: {
            date: string
            timeZone: string
            returnedCount: number
            totalCount: number
            truncated: boolean
          }
          active: {
            returnedCount: number
            totalCount: number
            truncated: boolean
          }
          history: {
            returnedCount: number
            totalCount: number
            truncated: boolean
          }
          range: {
            returnedCount: number
            totalCount: number
            truncated: boolean
          }
        }
        totalCount: number
        truncated: boolean
      },
      taskLastSuccessfulSyncAt: null as string | null,
    },
    refresh: vi.fn(),
    removeTask: vi.fn(),
    selfCareDashboards,
    selfCareDashboardRequest: vi.fn(),
    selfCareQueryOverrides,
    selfCareRefetch: vi.fn<(date: string) => Promise<unknown>>(),
    setTaskPlannedDate: vi.fn(),
    setTaskStatus: vi.fn(),
    sessionRefetch: vi.fn(),
    shoppingActiveItems: [] as ChaosInboxItemRecord[],
    shoppingItemPending: false,
    shoppingItemUpdate: vi.fn(),
    shoppingItemError,
    shoppingItemVariables: undefined as
      | { itemId: string; patch: { priority: null; status: 'archived' } }
      | undefined,
    shoppingQueryOverrides,
    shoppingRefetch: vi.fn<() => Promise<unknown>>(),
    taskComposer: vi.fn(),
    taskCursorRefetch: vi.fn(),
    updateTask: vi.fn(),
    updateUserPreferences: vi.fn(),
    usePlannerTaskInfiniteCursor: vi.fn(),
    usePlannerSession: vi.fn<() => PlannerSessionQueryStub>(),
  }
})

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({ uploadedIcons: [] }),
}))

vi.mock('@/features/planner', () => ({
  toPlannerTask: (task: Task) => task,
  usePlanner: () => ({
    ...mocks.plannerState,
    copyTaskToPersonal: mocks.copyTaskToPersonal,
    createNextTaskStage: mocks.createNextTaskStage,
    detachTaskFromChain: mocks.detachTaskFromChain,
    isTaskPending: () => false,
    moveTaskToPersonal: mocks.moveTaskToPersonal,
    removeTask: mocks.removeTask,
    refresh: mocks.refresh,
    setTaskPlannedDate: mocks.setTaskPlannedDate,
    setTaskStatus: mocks.setTaskStatus,
    spheres: [],
    tasks: plannerTasks,
    updateTask: mocks.updateTask,
  }),
  usePlannerTaskInfiniteCursor: (...args: unknown[]) => {
    mocks.usePlannerTaskInfiniteCursor(...args)

    return {
      data: undefined,
      fetchNextPage: mocks.fetchNextTaskPage,
      hasNextPage: undefined,
      isError: false,
      isFetching: false,
      refetch: mocks.taskCursorRefetch,
    }
  },
}))

vi.mock('@/shared/lib/offline-sync', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    useBrowserOffline: () => mocks.browserOffline,
  }
})

vi.mock('@/features/cleaning', () => ({
  useCleaningToday: (date: string) => {
    mocks.cleaningTodayRequest(date)

    return {
      data:
        mocks.cleaningTodayResponses[date] ??
        createCleaningTodayResponse({ date }),
      error: null,
      isFetching: false,
      isPending: false,
      refetch: () => mocks.cleaningRefetch(date),
      ...mocks.cleaningQueryOverrides[date],
    }
  },
}))

vi.mock('@/features/shopping-list', () => ({
  useShoppingListSummary: () => ({
    data: mocks.shoppingActiveItems,
    error: null,
    isFetching: false,
    isPending: false,
    refetch: mocks.shoppingRefetch,
    activeItemCount: mocks.shoppingActiveItems.length,
    activeItems: mocks.shoppingActiveItems,
    completedItemCount: 0,
    completedItems: [],
    totalItemCount: mocks.shoppingActiveItems.length,
    ...mocks.shoppingQueryOverrides,
  }),
  useUpdateShoppingListItem: () => ({
    isPending: mocks.shoppingItemPending,
    mutate: mocks.shoppingItemUpdate,
    error: mocks.shoppingItemError,
    variables: mocks.shoppingItemVariables,
  }),
}))

vi.mock('@/features/self-care', () => ({
  useSelfCareDashboard: (date: string) => {
    mocks.selfCareDashboardRequest(date)

    return {
      data:
        mocks.selfCareDashboards[date] ?? createSelfCareDashboard([], { date }),
      error: null,
      isFetching: false,
      isPending: false,
      refetch: () => mocks.selfCareRefetch(date),
      ...mocks.selfCareQueryOverrides[date],
    }
  },
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => ({
    ...mocks.usePlannerSession(),
    isFetching: mocks.sessionIsFetching,
  }),
  useSessionAuth: () => ({ isRecoveringSession: mocks.isRecoveringSession }),
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

function createCompleteTaskCoverage(taskCount = 1) {
  return {
    historyNextCursor: null,
    returnedCount: taskCount,
    sources: {
      active: {
        returnedCount: taskCount,
        totalCount: taskCount,
        truncated: false,
      },
      history: { returnedCount: 0, totalCount: 0, truncated: false },
      range: {
        returnedCount: taskCount,
        totalCount: taskCount,
        truncated: false,
      },
    },
    totalCount: taskCount,
    truncated: false,
  }
}

function createCompleteDailyLoadCoverage(taskCount = 1) {
  const coverage = createCompleteTaskCoverage(taskCount)
  return {
    ...coverage,
    sources: {
      ...coverage.sources,
      dailyLoad: {
        date: getTodayDate('UTC'),
        timeZone: 'UTC',
        returnedCount: taskCount,
        totalCount: taskCount,
        truncated: false,
      },
    },
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
  mocks.usePlannerSession.mockReturnValue({
    data: createSession(kind),
    refetch: mocks.sessionRefetch,
  })

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

const supplementarySources = [
  {
    source: 'shopping',
    label: 'Покупки',
    emptyMessage: 'Покупки: список пуст.',
  },
  {
    source: 'cleaning',
    label: 'Уборка',
    emptyMessage: 'Уборка: на сегодня задач нет.',
  },
  {
    source: 'todayCare',
    label: 'Забота на сегодня',
    emptyMessage: 'Забота на сегодня: активных задач нет.',
  },
  {
    source: 'tomorrowCare',
    label: 'Забота на завтра',
    emptyMessage: 'Забота на завтра: активных задач нет.',
  },
] as const

function setSourceQueryOverride(
  source: (typeof supplementarySources)[number]['source'],
  override: SourceQueryStub,
) {
  const today = getDateKey(new Date())
  if (source === 'shopping') {
    mocks.shoppingQueryOverrides = override
  } else if (source === 'cleaning') {
    mocks.cleaningQueryOverrides[today] = override
  } else {
    const date =
      source === 'todayCare' ? today : getDateKey(addDays(new Date(), 1))
    mocks.selfCareQueryOverrides[date] = override
  }
}

function rerenderTodayPage(rendered: ReturnType<typeof render>) {
  rendered.rerender(
    <MemoryRouter initialEntries={['/today']}>
      <TodayPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function expectReadNoticesToBeAbsent() {
  expect(
    screen
      .queryAllByRole('status')
      .filter((notice) => notice.textContent?.trim()),
  ).toHaveLength(0)
}

describe('TodayPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    plannerTasks = []
    mocks.browserOffline = false
    mocks.isRecoveringSession = false
    mocks.sessionIsFetching = false
    mocks.cleaningTodayRequest.mockReset()
    mocks.cleaningTodayResponses = {}
    mocks.cleaningQueryOverrides = {}
    mocks.cleaningRefetch.mockReset()
    mocks.cleaningRefetch.mockResolvedValue(undefined)
    mocks.copyTaskToPersonal.mockReset()
    mocks.createNextTaskStage.mockReset()
    mocks.detachTaskFromChain.mockReset()
    mocks.moveTaskToPersonal.mockReset()
    mocks.fetchNextTaskPage.mockReset()
    mocks.fetchNextTaskPage.mockResolvedValue(undefined)
    Object.assign(mocks.plannerState, {
      errorMessage: null,
      hasTaskReadError: false,
      hasTaskRecords: true,
      isLoading: false,
      isTaskCacheHydrating: false,
      isTaskOffline: false,
      isTaskReadFetching: false,
      readiness: {
        canReadCachedData: true,
        canRenderAppContent: true,
        canUseProtectedApi: true,
        canWriteProtectedData: true,
        reason: 'ready',
        status: 'ready',
      },
      taskReadModelCoverage: null,
      taskLastSuccessfulSyncAt: null,
    })
    mocks.refresh.mockReset()
    mocks.refresh.mockResolvedValue(undefined)
    mocks.removeTask.mockReset()
    mocks.selfCareDashboards = {}
    mocks.selfCareDashboardRequest.mockReset()
    mocks.selfCareQueryOverrides = {}
    mocks.selfCareRefetch.mockReset()
    mocks.selfCareRefetch.mockResolvedValue(undefined)
    mocks.setTaskPlannedDate.mockReset()
    mocks.setTaskStatus.mockReset()
    mocks.sessionRefetch.mockReset()
    mocks.sessionRefetch.mockResolvedValue(undefined)
    mocks.shoppingActiveItems = []
    mocks.shoppingItemPending = false
    mocks.shoppingItemUpdate.mockReset()
    mocks.shoppingItemError = null
    mocks.shoppingItemVariables = undefined
    mocks.shoppingQueryOverrides = {}
    mocks.shoppingRefetch.mockReset()
    mocks.shoppingRefetch.mockResolvedValue(undefined)
    mocks.taskComposer.mockReset()
    mocks.taskCursorRefetch.mockReset()
    mocks.taskCursorRefetch.mockResolvedValue(undefined)
    mocks.updateTask.mockReset()
    mocks.updateTask.mockResolvedValue(true)
    mocks.updateUserPreferences.mockReset()
    mocks.usePlannerSession.mockReset()
    mocks.usePlannerTaskInfiniteCursor.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it.each(supplementarySources)(
    'keeps tasks available through $label loading, failure, targeted retry and empty success',
    async ({ source, label, emptyMessage }) => {
      const today = getDateKey(new Date())
      const tomorrow = getDateKey(addDays(new Date(), 1))
      setSourceQueryOverride(source, {
        data: undefined,
        isFetching: true,
        isPending: true,
      })
      const rendered = renderTodayPage({
        tasks: [createTask({ plannedDate: today, title: 'Рабочая задача' })],
      })

      expectReadNoticesToBeAbsent()
      expect(screen.getByText('Рабочая задача')).toBeVisible()
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument()

      setSourceQueryOverride(source, {
        data: undefined,
        error: new Error('HTTP 500'),
      })
      rerenderTodayPage(rendered)

      expect(screen.getByText(`Не обновились: ${label}.`)).toBeVisible()
      expect(screen.getByText('Рабочая задача')).toBeVisible()
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
      })
      expect(mocks.shoppingRefetch).toHaveBeenCalledTimes(
        source === 'shopping' ? 1 : 0,
      )
      expect(mocks.cleaningRefetch).toHaveBeenCalledTimes(
        source === 'cleaning' ? 1 : 0,
      )
      expect(mocks.selfCareRefetch).toHaveBeenCalledTimes(
        source === 'todayCare' || source === 'tomorrowCare' ? 1 : 0,
      )
      if (source === 'cleaning')
        expect(mocks.cleaningRefetch).toHaveBeenCalledWith(today)
      if (source === 'todayCare')
        expect(mocks.selfCareRefetch).toHaveBeenCalledWith(today)
      if (source === 'tomorrowCare')
        expect(mocks.selfCareRefetch).toHaveBeenCalledWith(tomorrow)

      setSourceQueryOverride(source, {})
      rerenderTodayPage(rendered)
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument()
      expect(
        screen.queryByText(`Не обновились: ${label}.`),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Повторить' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('Рабочая задача')).toBeVisible()
    },
  )

  it.each(supplementarySources)(
    'keeps $label silent for cached data, readiness changes and unfinished reads',
    ({ source }) => {
      const rendered = renderTodayPage({
        tasks: [
          createTask({
            plannedDate: getDateKey(new Date()),
            title: 'Доступная задача',
          }),
        ],
      })
      const readiness: SessionReadiness = {
        canReadCachedData: true,
        canRenderAppContent: true,
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason: 'planner_error',
        status: 'offlineWithCache',
      }
      const silentStates: SourceQueryStub[] = [
        { data: undefined },
        { isShowingCachedData: true },
        { readiness },
        { readiness: { ...readiness, reason: 'auth_restoring' } },
        { readiness: { ...readiness, reason: 'planner_pending' } },
        { error: new Error('Previous request failed'), isFetching: true },
        { error: new Error('Previous request failed'), isPending: true },
        {
          readError: new Error('Previous request failed'),
          isCacheHydrating: true,
        },
      ]

      for (const state of silentStates) {
        setSourceQueryOverride(source, state)
        rerenderTodayPage(rendered)
        expectReadNoticesToBeAbsent()
        expect(screen.getByText('Доступная задача')).toBeVisible()
      }
    },
  )

  it('hides the previous source failure during a manual retry and reports only its settled result', async () => {
    let finishRetry: (() => void) | undefined
    const retryPromise = new Promise<void>((resolve) => {
      finishRetry = resolve
    })
    mocks.shoppingRefetch.mockReturnValue(retryPromise)
    setSourceQueryOverride('shopping', { error: new Error('HTTP 503') })
    const rendered = renderTodayPage({ tasks: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expectReadNoticesToBeAbsent()
    expect(mocks.shoppingRefetch).toHaveBeenCalledOnce()

    await act(async () => {
      finishRetry?.()
      await retryPromise
    })
    expect(screen.getByText('Не обновились: Покупки.')).toBeVisible()

    setSourceQueryOverride('shopping', {})
    rerenderTodayPage(rendered)
    expectReadNoticesToBeAbsent()
  })

  it.each(supplementarySources)(
    'preserves cached $label items after a failed refresh',
    ({ source, label, emptyMessage }) => {
      const today = getDateKey(new Date())
      const tomorrow = getDateKey(addDays(new Date(), 1))
      mocks.shoppingActiveItems = [createShoppingItem()]
      mocks.cleaningTodayResponses[today] = createCleaningTodayResponse({
        items: [createCleaningTaskWithState(createCleaningZone())],
      })
      setSelfCareDashboard(createSelfCareDashboard([createSelfCareTodayItem()]))
      setSelfCareDashboard(
        createSelfCareDashboard(
          [
            createSelfCareTodayItem({
              item: { id: 'tomorrow-care', title: 'Завтрашняя забота' },
            }),
          ],
          { date: tomorrow },
        ),
      )
      setSourceQueryOverride(source, {
        error: new Error('HTTP 503'),
        isShowingCachedData: true,
        lastSuccessfulSyncAt: '2026-09-16T06:00:00.000Z',
      })

      renderTodayPage({ tasks: [] })

      expect(screen.getByText(`Не обновились: ${label}.`)).toBeVisible()
      expect(
        screen.queryByText(/Последняя синхронизация:/),
      ).not.toBeInTheDocument()
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'Отметить покупку купленной: Молоко',
        }),
      ).toBeVisible()
      expect(
        screen.getByRole('link', { name: /Открыть уборку: Кухня/ }),
      ).toBeVisible()
      expect(
        screen.getByRole('link', {
          name: 'Открыть заботу: Компактная привычка',
        }),
      ).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: 'Завтра' }))
      expect(
        screen.getByRole('link', { name: 'Открыть заботу: Завтрашняя забота' }),
      ).toBeVisible()
    },
  )

  it('stays silent during source loading, then aggregates confirmed failures and disappears after recovery', async () => {
    const today = getDateKey(new Date())
    supplementarySources.forEach(({ source }) => {
      setSourceQueryOverride(source, {
        data: undefined,
        isFetching: true,
        isPending: true,
      })
    })
    const rendered = renderTodayPage({
      tasks: [createTask({ plannedDate: today, title: 'Рабочая задача' })],
    })

    expectReadNoticesToBeAbsent()
    expect(
      screen.queryByRole('button', { name: 'Повторить' }),
    ).not.toBeInTheDocument()

    setSourceQueryOverride('shopping', { error: new Error('HTTP 500') })
    setSourceQueryOverride('cleaning', {
      isShowingCachedData: true,
      readError: new Error('HTTP 503'),
    })
    setSourceQueryOverride('todayCare', {
      data: undefined,
      error: new Error('HTTP 503'),
    })
    setSourceQueryOverride('tomorrowCare', {})
    rerenderTodayPage(rendered)

    expect(
      screen.getByText('Не обновились: Покупки, Уборка, Забота на сегодня.'),
    ).toBeVisible()
    expect(screen.queryByText(/Загружаем:/)).not.toBeInTheDocument()
    expect(screen.getByText('Рабочая задача')).toBeVisible()
    expect(
      screen
        .getAllByRole('status')
        .filter((notice) => notice.textContent?.trim()),
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
    })
    expect(mocks.shoppingRefetch).toHaveBeenCalledOnce()
    expect(mocks.cleaningRefetch).toHaveBeenCalledExactlyOnceWith(today)
    expect(mocks.selfCareRefetch).toHaveBeenCalledExactlyOnceWith(today)
    expect(mocks.sessionRefetch).not.toHaveBeenCalled()

    supplementarySources.forEach(({ source }) => {
      setSourceQueryOverride(source, {})
    })
    rerenderTodayPage(rendered)

    expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Повторить' }),
    ).not.toBeInTheDocument()
    supplementarySources.forEach(({ emptyMessage }) => {
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument()
    })
    expect(screen.getByText('Рабочая задача')).toBeVisible()
  })

  it('does not show disabled self-care integration as a failed source', () => {
    const tomorrow = getDateKey(addDays(new Date(), 1))
    setSelfCareDashboard(
      createSelfCareDashboard([], { showSelfCareInMainTasks: false }),
    )
    mocks.selfCareQueryOverrides[tomorrow] = {
      data: undefined,
      error: new Error('HTTP 500'),
    }
    renderTodayPage({ tasks: [] })

    expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()
  })

  it('does not describe an empty shopping cache as fresh after an online network fallback', () => {
    mocks.shoppingQueryOverrides = {
      error: null,
      readError: new TypeError('Failed to fetch'),
      isShowingCachedData: true,
    }
    renderTodayPage({ tasks: [] })

    expect(screen.getByText('Не обновились: Покупки.')).toBeVisible()
    expect(screen.queryByText('Покупки: список пуст.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
  })

  it('preserves failed shopping actions alongside a global read notice and retries the same action', () => {
    mocks.shoppingActiveItems = [createShoppingItem()]
    const rendered = renderTodayPage({ tasks: [] })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Отметить покупку купленной: Молоко',
      }),
    )
    const input = {
      itemId: 'shopping-1',
      patch: { priority: null, status: 'archived' as const },
    }
    mocks.shoppingItemVariables = input
    mocks.shoppingItemError = new Error('HTTP 500')
    mocks.plannerState.hasTaskReadError = true
    rerenderTodayPage(rendered)

    expect(
      screen.getByText(
        'Не удалось обновить задачи · показываем сохранённые данные',
      ),
    ).toBeVisible()
    expect(
      screen.getByText('Не удалось отметить покупку купленной'),
    ).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: 'Отметить покупку купленной: Молоко',
      }),
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Повторить отметку покупки' }),
    )
    expect(mocks.shoppingItemUpdate).toHaveBeenLastCalledWith(input)
    expect(mocks.shoppingItemUpdate).toHaveBeenCalledTimes(2)

    mocks.shoppingItemPending = true
    rerenderTodayPage(rendered)
    expect(
      screen.getByRole('button', { name: 'Повторить отметку покупки' }),
    ).toBeDisabled()
    mocks.shoppingItemPending = false
    mocks.shoppingItemError = null
    mocks.shoppingActiveItems = []
    rerenderTodayPage(rendered)
    expect(
      screen.queryByText('Не удалось отметить покупку купленной'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Покупки: список пуст.')).not.toBeInTheDocument()
  })

  it('shows a skeleton while the task cache is being checked', () => {
    Object.assign(mocks.plannerState, {
      hasTaskRecords: false,
      isTaskCacheHydrating: true,
    })

    renderTodayPage({ tasks: [] })

    expect(screen.getByText('Загружаем план на сегодня')).toBeVisible()
    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(screen.queryByText('План на сегодня')).not.toBeInTheDocument()
  })

  it('shows an offline no-cache state instead of an empty plan', () => {
    mocks.browserOffline = true
    Object.assign(mocks.plannerState, {
      hasTaskRecords: false,
      isTaskCacheHydrating: false,
    })

    renderTodayPage({ tasks: [] })

    expect(
      screen.getByText('План на сегодня недоступен без подключения'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
  })

  it('keeps cached tasks visible offline with one compact notice', () => {
    mocks.browserOffline = true
    Object.assign(mocks.plannerState, {
      isTaskReadFetching: true,
      taskLastSuccessfulSyncAt: '2026-08-13T09:00:00.000Z',
    })
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      tasks: [createTask({ plannedDate: todayKey, title: 'Из кеша' })],
    })

    expect(screen.getByText('Из кеша')).toBeVisible()
    expect(
      screen.getByText('Нет подключения · показываем сохранённые данные'),
    ).toBeVisible()
    expect(
      screen
        .getAllByRole('status')
        .filter((notice) => notice.textContent?.trim()),
    ).toHaveLength(1)
    expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Последняя синхронизация:/),
    ).not.toBeInTheDocument()
  })

  it.each([
    'task loading',
    'cache hydrating',
    'task fetching',
    'session fetching',
    'session recovery',
    'cache restoring',
    'auth restoring',
    'session pending',
  ])('keeps cached content silent during %s despite stale errors', (state) => {
    mocks.plannerState.hasTaskReadError = true
    mocks.plannerState.isTaskOffline = true
    if (state === 'task loading') mocks.plannerState.isLoading = true
    if (state === 'cache hydrating')
      mocks.plannerState.isTaskCacheHydrating = true
    if (state === 'task fetching') mocks.plannerState.isTaskReadFetching = true
    if (state === 'session fetching') mocks.sessionIsFetching = true
    if (state === 'session recovery') mocks.isRecoveringSession = true
    if (state === 'cache restoring') {
      mocks.plannerState.readiness.status = 'restoringWithCache'
    }
    if (state === 'auth restoring') {
      mocks.plannerState.readiness.reason = 'auth_restoring'
    }
    if (state === 'session pending') {
      mocks.plannerState.readiness.reason = 'planner_pending'
    }
    setSourceQueryOverride('shopping', {
      error: new Error('Previous HTTP 503'),
    })
    const rendered = renderTodayPage({
      tasks: [
        createTask({ plannedDate: getDateKey(new Date()), title: 'Из кеша' }),
      ],
    })

    expect(screen.getByText('Из кеша')).toBeVisible()
    expectReadNoticesToBeAbsent()

    mocks.plannerState.isLoading = false
    mocks.plannerState.isTaskCacheHydrating = false
    mocks.plannerState.isTaskReadFetching = false
    mocks.sessionIsFetching = false
    mocks.isRecoveringSession = false
    mocks.plannerState.readiness.status = 'ready'
    mocks.plannerState.readiness.reason = 'ready'
    rerenderTodayPage(rendered)

    expect(
      screen.getByText(
        'Не удалось обновить задачи · показываем сохранённые данные',
      ),
    ).toBeVisible()
    expect(screen.queryByText(/Нет подключения/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()

    mocks.plannerState.hasTaskReadError = false
    mocks.plannerState.isTaskOffline = false
    setSourceQueryOverride('shopping', {})
    rerenderTodayPage(rendered)
    expectReadNoticesToBeAbsent()
    expect(screen.getByText('Из кеша')).toBeVisible()
  })

  it('does not infer a connection failure from cached task readiness while the browser is online', () => {
    Object.assign(mocks.plannerState.readiness, {
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'planner_error',
      status: 'offlineWithCache',
    })
    renderTodayPage({ tasks: [createTask()] })

    expectReadNoticesToBeAbsent()
    expect(screen.queryByText(/Нет подключения/)).not.toBeInTheDocument()
  })

  it.each(['auth_deferred', 'unauthorized', 'no_session'] as const)(
    'keeps a stale %s access warning hidden while the session recovers',
    (reason) => {
      mocks.isRecoveringSession = true
      Object.assign(mocks.plannerState.readiness, {
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason,
        status: 'offlineWithCache',
      })
      setSourceQueryOverride('shopping', { error: new Error('HTTP 401') })
      const rendered = renderTodayPage({ tasks: [createTask()] })

      expectReadNoticesToBeAbsent()

      mocks.isRecoveringSession = false
      rerenderTodayPage(rendered)
      expect(screen.getByText('Нужно восстановить доступ')).toBeVisible()
      expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Нет подключения/)).not.toBeInTheDocument()
    },
  )

  it('keeps manual recovery silent until its confirmed result is available', async () => {
    let finishRetry: (() => void) | undefined
    const retryPromise = new Promise<void>((resolve) => {
      finishRetry = resolve
    })
    mocks.refresh.mockReturnValue(retryPromise)
    mocks.plannerState.hasTaskReadError = true
    const rendered = renderTodayPage({ tasks: [createTask()] })

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expectReadNoticesToBeAbsent()
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
      retryDeniedAuth: true,
    })

    await act(async () => {
      finishRetry?.()
      await retryPromise
    })
    expect(
      screen.getByText(
        'Не удалось обновить задачи · показываем сохранённые данные',
      ),
    ).toBeVisible()

    mocks.plannerState.hasTaskReadError = false
    rerenderTodayPage(rendered)
    expectReadNoticesToBeAbsent()
  })

  it('keeps a failed shopping action actionable during background task refresh', () => {
    mocks.plannerState.isTaskReadFetching = true
    mocks.plannerState.hasTaskReadError = true
    mocks.shoppingActiveItems = [createShoppingItem()]
    mocks.shoppingItemVariables = {
      itemId: 'shopping-1',
      patch: { priority: null, status: 'archived' },
    }
    mocks.shoppingItemError = new Error('HTTP 500')
    renderTodayPage({ tasks: [] })

    expect(
      screen.getByText('Не удалось отметить покупку купленной'),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Повторить отметку покупки' }),
    ).toBeEnabled()
    expect(
      screen.queryByText(/Не удалось обновить задачи/),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()
  })

  it.each(['personal', 'shared'] as const)(
    'shows one access notice in the %s workspace and forces recovery for the shared auth failure',
    (kind) => {
      const readiness: SessionReadiness = {
        canReadCachedData: true,
        canRenderAppContent: true,
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason: 'auth_deferred',
        status: 'offlineWithCache',
      }
      Object.assign(mocks.plannerState, {
        readiness,
        taskLastSuccessfulSyncAt: '2026-09-17T06:46:00.000Z',
      })
      supplementarySources.forEach(({ source }) => {
        setSourceQueryOverride(source, {
          isShowingCachedData: true,
          lastSuccessfulSyncAt: '2026-09-17T06:46:00.000Z',
          readiness,
        })
      })

      renderTodayPage({
        kind,
        tasks: [
          createTask({
            plannedDate: getDateKey(new Date()),
            title: 'Сохранённая задача',
          }),
        ],
      })

      expect(screen.getByText('Нужно восстановить доступ')).toBeVisible()
      expect(screen.getByText('Сохранённая задача')).toBeVisible()
      expect(
        screen
          .getAllByRole('status')
          .filter((notice) => notice.textContent?.trim()),
      ).toHaveLength(1)
      expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()
      expect(
        screen.queryByText(/Последняя синхронизация:/),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Повторить' }),
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Обновить доступ' }))

      expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
        retryDeniedAuth: true,
      })
      expect(mocks.sessionRefetch).toHaveBeenCalledOnce()
      expect(mocks.shoppingRefetch).not.toHaveBeenCalled()
      expect(mocks.cleaningRefetch).not.toHaveBeenCalled()
      expect(mocks.selfCareRefetch).not.toHaveBeenCalled()
    },
  )

  it.each(['restoring', 'task error'] as const)(
    'suppresses supplementary read notices while the main plan is %s',
    (state) => {
      if (state === 'restoring') {
        Object.assign(mocks.plannerState.readiness, {
          canUseProtectedApi: false,
          canWriteProtectedData: false,
          reason: 'auth_restoring',
          status: 'restoringWithCache',
        })
      } else {
        mocks.plannerState.hasTaskReadError = true
      }
      setSourceQueryOverride('shopping', { error: new Error('HTTP 500') })
      setSourceQueryOverride('todayCare', { isShowingCachedData: true })

      renderTodayPage({
        tasks: [
          createTask({ plannedDate: getDateKey(new Date()), title: 'Из кеша' }),
        ],
      })

      expect(screen.getByText('Из кеша')).toBeVisible()
      expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Загружаем:/)).not.toBeInTheDocument()
      expect(
        screen
          .queryAllByRole('status')
          .filter((notice) => notice.textContent?.trim()),
      ).toHaveLength(state === 'restoring' ? 0 : 1)
    },
  )

  it('shows only actionable source errors and stays silent about partial task coverage after recovery', async () => {
    mocks.plannerState.taskReadModelCoverage = {
      ...createCompleteTaskCoverage(),
      sources: {
        ...createCompleteTaskCoverage().sources,
        active: { returnedCount: 1, totalCount: 201, truncated: true },
      },
      totalCount: 201,
      truncated: true,
    }
    setSourceQueryOverride('shopping', { error: new Error('HTTP 500') })
    const rendered = renderTodayPage({ tasks: [createTask()] })

    expect(screen.getByText('Не обновились: Покупки.')).toBeVisible()
    expect(
      screen.queryByText('Часть задач ещё не загружена'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
    })
    expect(mocks.shoppingRefetch).toHaveBeenCalledOnce()
    expect(mocks.cleaningRefetch).not.toHaveBeenCalled()
    expect(mocks.selfCareRefetch).not.toHaveBeenCalled()

    setSourceQueryOverride('shopping', {})
    rerenderTodayPage(rendered)

    expectReadNoticesToBeAbsent()
    expect(
      screen.queryByText('Часть задач ещё не загружена'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Не обновились:/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Повторить' }),
    ).not.toBeInTheDocument()
  })

  it('offers compact cursor pagination for a truncated task archive', async () => {
    Object.assign(mocks.plannerState, {
      taskReadModelCoverage: {
        historyNextCursor: 'history-cursor-100',
        returnedCount: 101,
        sources: {
          active: { returnedCount: 1, totalCount: 1, truncated: false },
          history: { returnedCount: 100, totalCount: 321, truncated: true },
          range: { returnedCount: 1, totalCount: 1, truncated: false },
        },
        totalCount: 322,
        truncated: true,
      },
    })

    renderTodayPage({ tasks: [createTask()] })

    expect(
      screen.queryByText('Большой архив загружен частично'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Показано 100 из 321 закрытых задач')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }))

    await waitFor(() => {
      expect(mocks.usePlannerTaskInfiniteCursor).toHaveBeenLastCalledWith(
        {
          dateMode: 'relevant',
          direction: 'desc',
          limit: 100,
          scope: 'closed',
        },
        {
          enabled: true,
          initialCursor: 'history-cursor-100',
        },
      )
    })
  })

  it('loads beyond the bounded archive when the deployed server has no snapshot cursor yet', async () => {
    Object.assign(mocks.plannerState, {
      taskReadModelCoverage: {
        historyNextCursor: null,
        returnedCount: 100,
        sources: {
          active: { returnedCount: 0, totalCount: 0, truncated: false },
          history: { returnedCount: 100, totalCount: 487, truncated: true },
          range: { returnedCount: 0, totalCount: 0, truncated: false },
        },
        totalCount: 487,
        truncated: true,
      },
    })

    renderTodayPage({ tasks: [] })

    expect(screen.getByText('Показано 100 из 487 закрытых задач')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }))

    await waitFor(() => {
      expect(mocks.usePlannerTaskInfiniteCursor).toHaveBeenLastCalledWith(
        {
          dateMode: 'relevant',
          direction: 'desc',
          limit: 200,
          scope: 'closed',
        },
        {
          enabled: true,
          initialCursor: null,
        },
      )
    })
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

  it('opens a task targeted by the notification deep link', async () => {
    const todayKey = getDateKey(new Date())

    renderTodayPage({
      initialEntry: '/today?taskId=target-task',
      kind: 'shared',
      tasks: [
        createTask({
          id: 'today-task',
          plannedDate: todayKey,
          title: 'Задача на сегодня',
        }),
        createTask({
          id: 'target-task',
          title: 'Задача из уведомления',
        }),
      ],
    })

    expect(
      screen.getByRole('button', { name: 'Остальные задачи' }),
    ).toHaveAttribute('aria-expanded', 'true')
    const dialog = await screen.findByRole('dialog', {
      name: 'Карточка задачи',
    })

    expect(within(dialog).getByText('Задача из уведомления')).toBeVisible()
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

  it.each(['missing coverage', 'partial history with complete range'])(
    'does not infer a complete daily load from assessed tasks with %s',
    (scenario) => {
      if (scenario === 'partial history with complete range') {
        mocks.plannerState.taskReadModelCoverage = {
          ...createCompleteTaskCoverage(),
          historyNextCursor: 'next-closed-page',
          sources: {
            ...createCompleteTaskCoverage().sources,
            history: { returnedCount: 0, totalCount: 1, truncated: true },
          },
          totalCount: 2,
          truncated: true,
        }
      }
      renderTodayPage({
        tasks: [
          createTask({ plannedDate: getDateKey(new Date()), resource: -2 }),
        ],
      })
      const panel = within(screen.getByRole('region', { name: 'Антиперегруз' }))

      expect(panel.getByText('неполная оценка')).toBeVisible()
      expect(
        panel.getByText('Оценено 1 из 1 · по загруженным задачам'),
      ).toBeVisible()
      fireEvent.click(
        panel.getByRole('button', { name: 'Открыть антиперегруз' }),
      )
      expect(panel.getByText('Оценённая часть')).toBeVisible()
      expect(panel.getByText('2 из 8 ресурса')).toBeVisible()
      expect(
        panel.queryByText(/В расчёте задачи с планом на сегодня/),
      ).not.toBeInTheDocument()
      expect(
        panel.queryByText(/Список задач может быть неполным или устаревшим/),
      ).not.toBeInTheDocument()
      expect(panel.queryByText('спокойно')).not.toBeInTheDocument()
      expect(
        panel.queryByText(/План задач укладывается|План выглядит реалистично/),
      ).not.toBeInTheDocument()
    },
  )

  it('uses complete today coverage despite truncated active tasks and a large archive', () => {
    const coverage = createCompleteDailyLoadCoverage(8)
    mocks.plannerState.taskReadModelCoverage = {
      ...coverage,
      historyNextCursor: 'next-closed-page',
      sources: {
        ...coverage.sources,
        active: { returnedCount: 100, totalCount: 200, truncated: true },
        history: { returnedCount: 100, totalCount: 500, truncated: true },
      },
      returnedCount: 200,
      totalCount: 700,
      truncated: true,
    }
    renderTodayPage({
      tasks: Array.from({ length: 8 }, (_, index) =>
        createTask({
          id: `assessed-${index}`,
          plannedDate: getTodayDate('UTC'),
          resource: index === 0 ? -2 : 0,
        }),
      ),
    })
    const panel = within(screen.getByRole('region', { name: 'Антиперегруз' }))

    expect(panel.getByText('Оценено 8 из 8')).toBeVisible()
    expect(panel.getByText('спокойно')).toBeVisible()
    expect(panel.queryByText('неполная оценка')).not.toBeInTheDocument()
    expect(panel.queryByText(/по загруженным задачам/)).not.toBeInTheDocument()
    fireEvent.click(panel.getByRole('button', { name: 'Открыть антиперегруз' }))
    expect(panel.getByText('Нагрузка задач')).toBeVisible()
    expect(panel.getByText('2 из 8 ресурса')).toBeVisible()
  })

  it('uses a complete global snapshot when the daily source reaches its limit', () => {
    const coverage = createCompleteDailyLoadCoverage(251)
    coverage.sources.dailyLoad.returnedCount = 250
    coverage.sources.dailyLoad.truncated = true
    coverage.sources.range.returnedCount = 250
    coverage.sources.range.truncated = true
    mocks.plannerState.taskReadModelCoverage = coverage
    renderTodayPage({
      tasks: Array.from({ length: 251 }, (_, index) =>
        createTask({
          id: `assessed-${index}`,
          plannedDate: getTodayDate('UTC'),
          resource: index === 0 ? -2 : 0,
        }),
      ),
    })
    const panel = within(screen.getByRole('region', { name: 'Антиперегруз' }))

    expect(panel.getByText('Оценено 251 из 251')).toBeVisible()
    expect(panel.getByText('спокойно')).toBeVisible()
    expect(panel.queryByText('неполная оценка')).not.toBeInTheDocument()
    expect(panel.queryByText(/по загруженным задачам/)).not.toBeInTheDocument()
  })

  it.each(['truncated sources', 'different date', 'different timezone'])(
    'keeps daily load provisional with %s',
    (scenario) => {
      const coverage = createCompleteDailyLoadCoverage()
      if (scenario === 'truncated sources') {
        coverage.sources.dailyLoad.totalCount = 2
        coverage.sources.dailyLoad.truncated = true
        coverage.sources.active.totalCount = 2
        coverage.sources.active.truncated = true
        coverage.sources.history.totalCount = 1
        coverage.sources.history.truncated = true
        coverage.sources.range.totalCount = 2
        coverage.sources.range.truncated = true
        coverage.totalCount = 3
        coverage.truncated = true
      }
      if (scenario === 'different date') {
        coverage.sources.dailyLoad.date = addDateDays(getTodayDate('UTC'), -1)
      }
      if (scenario === 'different timezone') {
        coverage.sources.dailyLoad.timeZone = 'Asia/Novosibirsk'
      }
      mocks.plannerState.taskReadModelCoverage = coverage
      renderTodayPage({
        tasks: [createTask({ plannedDate: getTodayDate('UTC'), resource: -2 })],
      })
      const panel = within(screen.getByRole('region', { name: 'Антиперегруз' }))

      expect(panel.getByText('неполная оценка')).toBeVisible()
      expect(
        panel.getByText('Оценено 1 из 1 · по загруженным задачам'),
      ).toBeVisible()
      expect(panel.queryByText('спокойно')).not.toBeInTheDocument()
    },
  )

  it.each([
    'browser offline',
    'task offline',
    'task read error',
    'restoring cache',
    'authentication expired',
    'task loading',
    'cache hydrating',
  ])('keeps cached assessed tasks provisional while %s', (scenario) => {
    mocks.plannerState.taskReadModelCoverage = createCompleteDailyLoadCoverage()
    mocks.plannerState.taskLastSuccessfulSyncAt = '2026-09-16T06:00:00.000Z'
    if (scenario === 'browser offline') mocks.browserOffline = true
    if (scenario === 'task offline') mocks.plannerState.isTaskOffline = true
    if (scenario === 'task read error')
      mocks.plannerState.hasTaskReadError = true
    if (scenario === 'restoring cache') {
      mocks.plannerState.readiness.status = 'restoringWithCache'
    }
    if (scenario === 'authentication expired') {
      mocks.plannerState.readiness.reason = 'unauthorized'
      mocks.plannerState.readiness.canUseProtectedApi = false
    }
    if (scenario === 'task loading') mocks.plannerState.isLoading = true
    if (scenario === 'cache hydrating') {
      mocks.plannerState.isTaskCacheHydrating = true
    }
    renderTodayPage({
      tasks: [
        createTask({
          plannedDate: getDateKey(new Date()),
          resource: -2,
          title: 'Оценённая задача из кеша',
        }),
      ],
    })
    const panel = within(screen.getByRole('region', { name: 'Антиперегруз' }))

    expect(screen.getByText('Оценённая задача из кеша')).toBeVisible()
    expect(
      panel.getByText('Оценено 1 из 1 · по загруженным задачам'),
    ).toBeVisible()
    expect(panel.getByText('неполная оценка')).toBeVisible()
    fireEvent.click(panel.getByRole('button', { name: 'Открыть антиперегруз' }))
    expect(panel.getByText('Оценённая часть')).toBeVisible()
    expect(panel.queryByText('спокойно')).not.toBeInTheDocument()
    expect(
      panel.queryByText(/План задач укладывается|План выглядит реалистично/),
    ).not.toBeInTheDocument()
  })

  it('restores the full assessed daily load after a successful task refresh', async () => {
    mocks.plannerState.hasTaskReadError = true
    const rendered = renderTodayPage({
      tasks: [
        createTask({ plannedDate: getDateKey(new Date()), resource: -2 }),
      ],
    })
    const panel = within(screen.getByRole('region', { name: 'Антиперегруз' }))
    expect(panel.getByText('неполная оценка')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalledWith({ retryDeniedAuth: true })
      expect(mocks.sessionRefetch).toHaveBeenCalledOnce()
    })

    mocks.plannerState.hasTaskReadError = false
    mocks.plannerState.taskReadModelCoverage = createCompleteTaskCoverage()
    rerenderTodayPage(rendered)

    expect(panel.getByText('Оценено 1 из 1')).toBeVisible()
    expect(panel.getByText('спокойно')).toBeVisible()
    expect(panel.queryByText('неполная оценка')).not.toBeInTheDocument()
    fireEvent.click(panel.getByRole('button', { name: 'Открыть антиперегруз' }))
    expect(panel.getByText('Нагрузка задач')).toBeVisible()
    expect(panel.getByText('2 из 8 ресурса')).toBeVisible()
  })

  it('keeps explicit neutral task assessment complete independently of failed care reads', () => {
    mocks.plannerState.taskReadModelCoverage = createCompleteTaskCoverage()
    setSourceQueryOverride('todayCare', {
      data: undefined,
      error: new Error('HTTP 500'),
    })
    renderTodayPage({
      tasks: [createTask({ plannedDate: getDateKey(new Date()), resource: 0 })],
    })
    const panel = within(screen.getByRole('region', { name: 'Антиперегруз' }))

    expect(screen.getByText('Не обновились: Забота на сегодня.')).toBeVisible()
    expect(panel.getByText('Оценено 1 из 1')).toBeVisible()
    expect(panel.getByText('спокойно')).toBeVisible()
    expect(panel.queryByText('неполная оценка')).not.toBeInTheDocument()
    fireEvent.click(panel.getByRole('button', { name: 'Открыть антиперегруз' }))
    expect(panel.getByText('0 из 8 ресурса')).toBeVisible()
    expect(panel.getByText('Нагрузка задач')).toBeVisible()
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
    mocks.plannerState.taskReadModelCoverage = createCompleteTaskCoverage(2)

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
              version: 1,
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
