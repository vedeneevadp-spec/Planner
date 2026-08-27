import type {
  CleaningListResponse,
  CleaningTaskWithState,
  CleaningTodayResponse,
  CleaningZoneRecord,
} from '@planner/contracts'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CleaningPage, CleaningSettingsPage } from './CleaningPage'
import styles from './CleaningPage.module.css'
import { TaskSection } from './CleaningPage.sections'

interface CleaningOfflineQueueStub {
  canQueueWrites: boolean
  canWriteFromSession: boolean
  conflicted: number
  discardConflicts: ReturnType<typeof vi.fn>
  failed: number
  isDraining: boolean
  pending: number
  refreshAndRetryConflicts: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  completeTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  createTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  createZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  postponeTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  removeTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  removeZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  planRefetch: vi.fn<() => Promise<unknown>>(),
  retrySession: vi.fn<() => Promise<unknown>>(),
  seed: vi.fn<(input: unknown) => Promise<unknown>>(),
  skipTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  todayRefetch: vi.fn<() => Promise<unknown>>(),
  updateTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  updateZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  useCleaningPlan: vi.fn<
    () => {
      data: CleaningListResponse | undefined
      error: Error | null
      isCacheHydrating?: boolean
      isLoading: boolean
      lastSuccessfulSyncAt?: string | null
      offlineQueue?: CleaningOfflineQueueStub
      readiness?: ReturnType<typeof createReadiness>
      refetch?: () => Promise<unknown>
      retrySession?: () => Promise<unknown>
      sessionError?: Error | null
    }
  >(),
  useCleaningToday: vi.fn<
    () => {
      data: CleaningTodayResponse | null | undefined
      error: Error | null
      isCacheHydrating?: boolean
      isLoading: boolean
      lastSuccessfulSyncAt?: string | null
      readiness?: ReturnType<typeof createReadiness>
      refetch?: () => Promise<unknown>
      retrySession?: () => Promise<unknown>
      sessionError?: Error | null
    }
  >(),
}))

vi.mock('@/features/cleaning', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  function createMutationStub(
    mutateAsync: (input: unknown) => Promise<unknown>,
  ) {
    return {
      error: null,
      isPending: false,
      mutateAsync,
    }
  }

  function createOfflineQueueStub() {
    return {
      canQueueWrites: true,
      canWriteFromSession: true,
      conflicted: 0,
      discardConflicts: vi.fn(),
      failed: 0,
      isDraining: false,
      pending: 0,
      refreshAndRetryConflicts: vi.fn(),
      retry: vi.fn(),
    }
  }

  return {
    ...actual,
    getCleaningErrorMessage: (error: unknown) =>
      error instanceof Error && /Cleaning API is not ready/i.test(error.message)
        ? 'Нет соединения. Уборка загрузится после восстановления подключения.'
        : error instanceof Error
          ? error.message
          : 'Не удалось сохранить уборку.',
    useCleaningPlan: () => ({
      offlineQueue: createOfflineQueueStub(),
      ...mocks.useCleaningPlan(),
    }),
    useCleaningToday: () => mocks.useCleaningToday(),
    useCompleteCleaningTask: () => createMutationStub(mocks.completeTask),
    useCreateCleaningTask: () => createMutationStub(mocks.createTask),
    useCreateCleaningZone: () => createMutationStub(mocks.createZone),
    usePostponeCleaningTask: () => createMutationStub(mocks.postponeTask),
    useRemoveCleaningTask: () => createMutationStub(mocks.removeTask),
    useRemoveCleaningZone: () => createMutationStub(mocks.removeZone),
    useSeedCleaningTemplates: () => createMutationStub(mocks.seed),
    useSkipCleaningTask: () => createMutationStub(mocks.skipTask),
    useUpdateCleaningTask: () => createMutationStub(mocks.updateTask),
    useUpdateCleaningZone: () => createMutationStub(mocks.updateZone),
  }
})

vi.mock('@/features/session', () => ({
  usePlannerTimeZone: () => 'Europe/Astrakhan',
}))

function createZone(): CleaningZoneRecord {
  return {
    createdAt: '2026-05-12T00:00:00.000Z',
    dayOfWeek: 4,
    deletedAt: null,
    description: 'Игрушки, одежда, рабочее место и вещи',
    id: 'zone-1',
    isActive: true,
    sortOrder: 0,
    title: 'Комната Кирилла',
    updatedAt: '2026-05-12T00:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
  }
}

function createPlan(zone = createZone()): CleaningListResponse {
  return {
    history: [],
    states: [],
    tasks: [],
    zones: [zone],
  }
}

function createCleaningItem(
  zone = createZone(),
  taskOverrides: Partial<CleaningTaskWithState['task']> = {},
): CleaningTaskWithState {
  const taskId = taskOverrides.id ?? 'task-1'

  return {
    isDue: true,
    isOverdue: false,
    score: 10,
    state: {
      lastCompletedAt: null,
      lastPostponedAt: null,
      lastSkippedAt: null,
      nextDueAt: '2026-05-16',
      postponeCount: 0,
      taskId,
      updatedAt: '2026-05-12T00:00:00.000Z',
      version: 1,
      workspaceId: 'workspace-1',
    },
    task: {
      assignee: 'anyone',
      createdAt: '2026-05-12T00:00:00.000Z',
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
      seasonMonths: [],
      sortOrder: 0,
      scope: taskOverrides.scope ?? 'zone',
      tags: [],
      title: 'Протереть пол',
      updatedAt: '2026-05-12T00:00:00.000Z',
      userId: 'user-1',
      version: 1,
      workspaceId: 'workspace-1',
      zoneId: taskOverrides.scope === 'general' ? null : zone.id,
      ...taskOverrides,
    },
    zone: taskOverrides.scope === 'general' ? null : zone,
  }
}

function createPlanWithItems(
  zone: CleaningZoneRecord,
  items: CleaningTaskWithState[],
): CleaningListResponse {
  return {
    ...createPlan(zone),
    states: items.map((item) => item.state),
    tasks: items.map((item) => item.task),
  }
}

function createEmptyPlan(): CleaningListResponse {
  return {
    history: [],
    states: [],
    tasks: [],
    zones: [],
  }
}

function createTodayResponse(
  accumulatedItems: CleaningTaskWithState[] = [],
  zone = createZone(),
  items: CleaningTaskWithState[] = [],
  generalItems: CleaningTaskWithState[] = [],
): CleaningTodayResponse {
  const dueItems = [...items, ...generalItems]

  return {
    accumulatedItems,
    date: '2026-05-19',
    dayOfWeek: 2,
    generalItems,
    history: [],
    items,
    quickItems: dueItems.filter(
      (item) =>
        (item.task.estimatedMinutes ?? 999) <= 15 ||
        item.task.energy === 'low' ||
        item.task.depth === 'minimum',
    ),
    seasonalItems: [],
    summary: {
      accumulatedCount: accumulatedItems.length,
      activeZoneCount: 1,
      completedTodayCount: 0,
      dueCount: dueItems.length,
      generalCount: generalItems.length,
      quickCount: dueItems.filter(
        (item) =>
          (item.task.estimatedMinutes ?? 999) <= 15 ||
          item.task.energy === 'low' ||
          item.task.depth === 'minimum',
      ).length,
      seasonalCount: 0,
      urgentCount: 0,
    },
    urgentItems: [],
    zones: [zone],
  }
}

function renderCleaningSettingsPage() {
  return render(
    <MemoryRouter initialEntries={['/cleaning/settings/zones/zone-1']}>
      <Routes>
        <Route
          path="/cleaning/settings/zones/:zoneId"
          element={<CleaningSettingsPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function renderCleaningGeneralSettingsPage() {
  return render(
    <MemoryRouter initialEntries={['/cleaning/settings/general']}>
      <Routes>
        <Route
          path="/cleaning/settings/general"
          element={<CleaningSettingsPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function renderCleaningPage(initialEntry = '/cleaning') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CleaningPage />
    </MemoryRouter>,
  )
}

function createReadiness(
  overrides: Partial<{
    canReadCachedData: boolean
    canRenderAppContent: boolean
    canUseProtectedApi: boolean
    canWriteProtectedData: boolean
    reason:
      | 'auth_deferred'
      | 'auth_restoring'
      | 'no_session'
      | 'planner_error'
      | 'planner_pending'
      | 'ready'
      | 'unauthorized'
    status:
      | 'blockedAuth'
      | 'offlineWithCache'
      | 'ready'
      | 'restoringWithCache'
      | 'serverError'
  }> = {},
) {
  return {
    canReadCachedData: true,
    canRenderAppContent: true,
    canUseProtectedApi: true,
    canWriteProtectedData: true,
    reason: 'ready' as const,
    status: 'ready' as const,
    ...overrides,
  }
}

function createOfflineQueueStub(
  overrides: Partial<CleaningOfflineQueueStub> = {},
): CleaningOfflineQueueStub {
  return {
    canQueueWrites: true,
    canWriteFromSession: true,
    conflicted: 0,
    discardConflicts: vi.fn(),
    failed: 0,
    isDraining: false,
    pending: 0,
    refreshAndRetryConflicts: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

function expectNextCycleActionCall(action: unknown, taskId: string) {
  if (typeof action !== 'object' || action === null) {
    throw new Error('Cleaning action call was not an object.')
  }

  const payload = action as Record<string, unknown>
  const inputValue = payload.input

  if (typeof inputValue !== 'object' || inputValue === null) {
    throw new Error('Cleaning action input was not an object.')
  }

  const input = inputValue as Record<string, unknown>

  expect(payload.taskId).toBe(taskId)
  expect(typeof input.date).toBe('string')
  expect(input.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(input.mode).toBe('next_cycle')
  expect(input.note).toBe('')
  expect(input.targetDate).toBeNull()
}

function getZoneStatsElement() {
  const statsElement =
    screen.getByText('выполнение').parentElement?.parentElement

  if (!statsElement) {
    throw new Error('Zone stats element was not found.')
  }

  return statsElement
}

function getZoneStatsMobileHiddenClass() {
  const className = styles.zoneStatsMobileHidden

  if (!className) {
    throw new Error('Zone stats mobile hidden class was not found.')
  }

  return className
}

describe('CleaningSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTask.mockResolvedValue(undefined)
    mocks.createZone.mockResolvedValue(createZone())
    mocks.removeTask.mockResolvedValue(undefined)
    mocks.removeZone.mockResolvedValue(undefined)
    mocks.updateTask.mockResolvedValue(undefined)
    mocks.updateZone.mockResolvedValue(createZone())
    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(),
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('closes zone editing after saving zone settings', async () => {
    renderCleaningSettingsPage()

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать зону' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить зону' }))

    await waitFor(() => {
      expect(mocks.updateZone).toHaveBeenCalledWith({
        input: {
          dayOfWeek: 4,
          description: 'Игрушки, одежда, рабочее место и вещи',
          title: 'Комната Кирилла',
        },
        zoneId: 'zone-1',
      })
    })

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Сохранить зону' }),
      ).not.toBeInTheDocument()
    })
  })

  it('hides volume, energy and assignee controls from task creation', () => {
    renderCleaningSettingsPage()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))

    expect(screen.queryByText(/Об[ъь][её]м/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Энергия')).not.toBeInTheDocument()
    expect(screen.queryByText('Кто')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Объём уборки')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Энергия')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Исполнитель')).not.toBeInTheDocument()
  })

  it('creates cleaning tasks with hidden default volume, energy and assignee', async () => {
    renderCleaningSettingsPage()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    fireEvent.change(
      screen.getByPlaceholderText('Например: помыть холодильник'),
      {
        target: { value: 'Протереть пол' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() => {
      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          assignee: 'anyone',
          depth: 'regular',
          energy: 'normal',
          scope: 'zone',
          title: 'Протереть пол',
          zoneId: 'zone-1',
        }),
      )
    })
  })

  it('edits cleaning task title and custom frequency', async () => {
    const zone = createZone()
    const item = createCleaningItem(zone, {
      frequencyInterval: 1,
      frequencyType: 'weekly',
      title: 'Протереть пол',
    })

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlanWithItems(zone, [item]),
      error: null,
      isLoading: false,
    })

    renderCleaningSettingsPage()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Редактировать задачу «Протереть пол»',
      }),
    )
    fireEvent.change(screen.getByLabelText('Название задачи'), {
      target: { value: 'Помыть пол' },
    })
    fireEvent.change(screen.getByLabelText('Интервал повторения уборки'), {
      target: { value: '9' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Единица повторения уборки' }),
    )
    fireEvent.click(screen.getByRole('option', { name: 'дней' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить задачу' }))

    await waitFor(() => {
      expect(mocks.updateTask).toHaveBeenCalledWith({
        input: {
          customIntervalDays: 9,
          frequencyInterval: 9,
          frequencyType: 'custom',
          scope: 'zone',
          title: 'Помыть пол',
          zoneId: 'zone-1',
        },
        taskId: 'task-1',
      })
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Сохранить задачу' }),
      ).not.toBeInTheDocument()
    })
  })

  it('hides zone stats on mobile while editing or adding and restores after save', async () => {
    renderCleaningSettingsPage()
    const mobileHiddenClass = getZoneStatsMobileHiddenClass()

    expect(getZoneStatsElement()).not.toHaveClass(mobileHiddenClass)

    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    expect(getZoneStatsElement()).toHaveClass(mobileHiddenClass)
    fireEvent.change(
      screen.getByPlaceholderText('Например: помыть холодильник'),
      {
        target: { value: 'Протереть пол' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() => {
      expect(getZoneStatsElement()).not.toHaveClass(mobileHiddenClass)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать зону' }))
    expect(getZoneStatsElement()).toHaveClass(mobileHiddenClass)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить зону' }))

    await waitFor(() => {
      expect(getZoneStatsElement()).not.toHaveClass(mobileHiddenClass)
    })
  })

  it('shows the general cleaning entry in settings', () => {
    renderCleaningSettingsPage()

    fireEvent.click(screen.getByRole('button', { name: /Комната Кирилла/ }))

    expect(screen.getByRole('option', { name: /Прочая уборка/ })).toBeVisible()
  })

  it('creates general cleaning tasks without a zone', async () => {
    renderCleaningGeneralSettingsPage()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    fireEvent.change(
      screen.getByPlaceholderText('Например: помыть холодильник'),
      {
        target: { value: 'Помыть окна' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() => {
      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'general',
          title: 'Помыть окна',
          zoneId: null,
        }),
      )
    })
  })

  it('shows the general cleaning empty state in settings', () => {
    renderCleaningGeneralSettingsPage()

    expect(
      screen.getAllByText(
        /Сюда можно добавлять задачи по уборке, которые не относятся/i,
      )[0],
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeVisible()
  })

  it('keeps cached settings editable through the offline queue after a connection failure', () => {
    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(),
      error: new TypeError('Failed to fetch'),
      isLoading: false,
      readiness: createReadiness(),
      refetch: mocks.planRefetch,
      retrySession: mocks.retrySession,
    })

    renderCleaningSettingsPage()

    expect(
      screen.getByText('Настройки открыты из сохранённых данных'),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Редактировать зону' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Добавить задачу' }),
    ).toBeEnabled()
  })

  it('keeps cached settings read-only offline when durable storage is unavailable', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(),
      error: null,
      isLoading: false,
      offlineQueue: createOfflineQueueStub({ canQueueWrites: false }),
      readiness: createReadiness(),
      refetch: mocks.planRefetch,
      retrySession: mocks.retrySession,
    })

    renderCleaningSettingsPage()

    expect(
      screen.getByRole('button', { name: 'Редактировать зону' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Добавить задачу' }),
    ).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Для изменений нужно восстановить доступ',
    )
    expect(screen.getByRole('status')).not.toHaveTextContent(
      'Изменения сохранятся на этом устройстве',
    )
  })

  it('states when the last settings sync time is unknown offline', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    mocks.useCleaningPlan.mockReturnValue({
      data: undefined,
      error: null,
      isCacheHydrating: false,
      isLoading: true,
      lastSuccessfulSyncAt: null,
      readiness: createReadiness({
        canUseProtectedApi: false,
        canWriteProtectedData: false,
        reason: 'planner_pending',
        status: 'blockedAuth',
      }),
    })

    renderCleaningSettingsPage()

    expect(
      screen.getByRole('heading', {
        name: 'Настройки доступны после подключения',
      }),
    ).toBeVisible()
    expect(
      screen.getByText('Время последней синхронизации неизвестно'),
    ).toBeVisible()
  })
})

describe('TaskSection', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('keeps task metadata compact and hides a zero postpone count', () => {
    const postponedItem = createCleaningItem(createZone(), {
      id: 'task-postponed',
      title: 'Помыть окно',
    })
    postponedItem.state.postponeCount = 2

    const { container } = render(
      <TaskSection
        title="Все задачи зоны"
        items={[createCleaningItem(), postponedItem]}
        isBusy={false}
        onComplete={vi.fn()}
        onPostpone={vi.fn()}
        onSkip={vi.fn()}
      />,
    )

    expect(screen.getAllByText('15 мин')).toHaveLength(2)
    expect(screen.queryByText('обычная')).not.toBeInTheDocument()
    expect(screen.queryByText('нормально')).not.toBeInTheDocument()
    expect(screen.queryByText('любой')).not.toBeInTheDocument()
    expect(screen.queryByText('Отложено: 0 раз')).not.toBeInTheDocument()
    expect(screen.getByText('Отложено: 2 раза')).toBeVisible()
    expect(screen.queryByText('Дата переноса')).not.toBeInTheDocument()
    expect(container.querySelector('input[type="date"]')).toBeNull()
  })
})

describe('CleaningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.completeTask.mockResolvedValue(undefined)
    mocks.createTask.mockResolvedValue(undefined)
    mocks.createZone.mockResolvedValue(createZone())
    mocks.postponeTask.mockResolvedValue(undefined)
    mocks.planRefetch.mockResolvedValue(undefined)
    mocks.retrySession.mockResolvedValue(undefined)
    mocks.skipTask.mockResolvedValue(undefined)
    mocks.todayRefetch.mockResolvedValue(undefined)
    mocks.useCleaningPlan.mockReturnValue({
      data: createEmptyPlan(),
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a stable skeleton while both cleaning read models are loading', () => {
    mocks.useCleaningPlan.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    })

    renderCleaningPage()

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(
      screen.queryByText(/Восстанавливаем подключение/i),
    ).not.toBeInTheDocument()
  })

  it('checks the local cache before declaring a cold start offline', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const restoringReadiness = createReadiness({
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'planner_pending',
      status: 'blockedAuth',
    })
    mocks.useCleaningPlan.mockReturnValue({
      data: undefined,
      error: null,
      isCacheHydrating: true,
      isLoading: true,
      readiness: restoringReadiness,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: undefined,
      error: null,
      isCacheHydrating: true,
      isLoading: true,
      readiness: restoringReadiness,
    })

    const view = renderCleaningPage()

    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(
      screen.queryByRole('heading', {
        name: 'Уборка доступна после подключения',
      }),
    ).not.toBeInTheDocument()

    mocks.useCleaningPlan.mockReturnValue({
      data: undefined,
      error: null,
      isCacheHydrating: false,
      isLoading: true,
      readiness: restoringReadiness,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: undefined,
      error: null,
      isCacheHydrating: false,
      isLoading: true,
      readiness: restoringReadiness,
    })
    view.rerender(
      <MemoryRouter initialEntries={['/cleaning']}>
        <CleaningPage />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', {
        name: 'Уборка доступна после подключения',
      }),
    ).toBeVisible()
  })

  it('shows a load error with a working retry action', async () => {
    mocks.useCleaningPlan.mockReturnValue({
      data: undefined,
      error: new Error('Сервис временно недоступен.'),
      isLoading: false,
      readiness: createReadiness(),
      refetch: mocks.planRefetch,
      retrySession: mocks.retrySession,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
      readiness: createReadiness(),
      refetch: mocks.todayRefetch,
      retrySession: mocks.retrySession,
    })

    renderCleaningPage()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Не удалось загрузить уборку',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() => {
      expect(mocks.planRefetch).toHaveBeenCalledTimes(1)
      expect(mocks.todayRefetch).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps cached cleaning visible offline with the last server sync time', () => {
    const offlineReadiness = createReadiness({
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'planner_error',
      status: 'offlineWithCache',
    })

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(),
      error: null,
      isLoading: false,
      lastSuccessfulSyncAt: '2026-08-06T08:30:00.000Z',
      readiness: offlineReadiness,
      refetch: mocks.planRefetch,
      retrySession: mocks.retrySession,
      sessionError: new TypeError('Failed to fetch'),
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse(),
      error: null,
      isLoading: false,
      lastSuccessfulSyncAt: '2026-08-06T08:31:00.000Z',
      readiness: offlineReadiness,
      refetch: mocks.todayRefetch,
      retrySession: mocks.retrySession,
      sessionError: new TypeError('Failed to fetch'),
    })

    renderCleaningPage()

    expect(screen.getByRole('status')).toHaveTextContent(
      'Работаем с сохранёнными данными',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Последняя синхронизация:',
    )
    expect(screen.getByText('Комната Кирилла')).toBeVisible()
  })

  it('keeps cached cleaning actions available through the offline queue after a connection failure', () => {
    const zone = createZone()
    const item = createCleaningItem(zone)

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlanWithItems(zone, [item]),
      error: new TypeError('Failed to fetch'),
      isLoading: false,
      readiness: createReadiness(),
      refetch: mocks.planRefetch,
      retrySession: mocks.retrySession,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse([], zone, [item]),
      error: null,
      isLoading: false,
      readiness: createReadiness(),
      refetch: mocks.todayRefetch,
      retrySession: mocks.retrySession,
    })

    renderCleaningPage()

    expect(screen.getByText('Работаем с сохранёнными данными')).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: 'Отметить «Протереть пол» выполненной',
      }),
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Отложить' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Пропустить' })).toBeEnabled()
  })

  it('reacts to browser offline events and keeps durable write actions available', () => {
    let isOnline = true
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(
      () => isOnline,
    )
    renderCleaningPage()

    expect(
      screen.getByRole('button', { name: 'Добавить базовый набор' }),
    ).toBeVisible()

    isOnline = false
    fireEvent(window, new Event('offline'))

    expect(screen.getByText('Работаем с сохранёнными данными')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Добавить базовый набор' }),
    ).toBeEnabled()
  })

  it('does not show a transient device-save banner for online changes', () => {
    const zone = createZone()

    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(zone),
      error: null,
      isLoading: false,
      offlineQueue: createOfflineQueueStub({ pending: 1 }),
      readiness: createReadiness(),
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse([], zone),
      error: null,
      isLoading: false,
      readiness: createReadiness(),
    })

    renderCleaningPage()

    expect(
      screen.queryByText('Изменения сохранены на устройстве'),
    ).not.toBeInTheDocument()
  })

  it('keeps a previously failed queued change visible after going offline', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    mocks.useCleaningPlan.mockReturnValue({
      data: createEmptyPlan(),
      error: null,
      isLoading: false,
      offlineQueue: createOfflineQueueStub({ failed: 1, pending: 1 }),
      readiness: createReadiness(),
    })
    mocks.useCleaningToday.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      readiness: createReadiness(),
    })

    renderCleaningPage()

    expect(screen.getByText('Изменения сохранены на устройстве')).toBeVisible()
    expect(
      screen.getByText(
        '2 изменения будут отправлены после восстановления связи.',
      ),
    ).toBeVisible()
  })

  it('does not promise or enable offline writes when durable storage is unavailable', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    mocks.useCleaningPlan.mockReturnValue({
      data: createEmptyPlan(),
      error: null,
      isLoading: false,
      offlineQueue: createOfflineQueueStub({ canQueueWrites: false }),
      readiness: createReadiness(),
    })
    mocks.useCleaningToday.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      readiness: createReadiness(),
    })

    renderCleaningPage()

    expect(
      screen.queryByRole('button', { name: 'Добавить базовый набор' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Показываем сохранённые данные. Для изменений нужно восстановить доступ.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByText(/Изменения сохранятся на этом устройстве/),
    ).not.toBeInTheDocument()
  })

  it('does not label a partial page cache with a full-page sync time', () => {
    const offlineReadiness = createReadiness({
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'planner_error',
      status: 'offlineWithCache',
    })
    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(),
      error: null,
      isLoading: false,
      lastSuccessfulSyncAt: '2026-08-06T08:30:00.000Z',
      readiness: offlineReadiness,
      refetch: mocks.planRefetch,
      retrySession: mocks.retrySession,
      sessionError: new TypeError('Failed to fetch'),
    })
    mocks.useCleaningToday.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
      lastSuccessfulSyncAt: null,
      readiness: offlineReadiness,
      refetch: mocks.todayRefetch,
      retrySession: mocks.retrySession,
      sessionError: new TypeError('Failed to fetch'),
    })

    renderCleaningPage()

    expect(
      screen.getByRole('heading', {
        name: 'Уборка доступна после подключения',
      }),
    ).toBeVisible()
    expect(
      screen.queryByText(/Последняя синхронизация:/),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Время последней синхронизации неизвестно'),
    ).toBeVisible()
  })

  it('keeps the empty cleaning seed action inside the empty state card', () => {
    renderCleaningPage()

    expect(
      screen.queryByRole('button', { name: 'Добавить шаблоны' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Добавить базовый набор' }),
    ).toBeVisible()
  })

  it('keeps a completely empty cleaning page focused on one next action', () => {
    const emptyToday = createTodayResponse()
    mocks.useCleaningToday.mockReturnValue({
      data: {
        ...emptyToday,
        summary: { ...emptyToday.summary, activeZoneCount: 0 },
        zones: [],
      },
      error: null,
      isLoading: false,
    })

    renderCleaningPage()

    const emptyState = screen
      .getByRole('heading', { name: 'Зоны ещё не настроены' })
      .closest<HTMLElement>('[role="status"]')

    if (!emptyState) {
      throw new Error('Cleaning empty state was not found.')
    }

    expect(
      within(emptyState).getByRole('button', {
        name: 'Добавить базовый набор',
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Прочая уборка' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Отложенные задачи' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Сезонные' }),
    ).not.toBeInTheDocument()
  })

  it('disables the empty-state action while the base plan is being added', async () => {
    let resolveSeed!: (plan: CleaningListResponse) => void
    mocks.seed.mockReturnValueOnce(
      new Promise<CleaningListResponse>((resolve) => {
        resolveSeed = resolve
      }),
    )
    renderCleaningPage()

    fireEvent.click(
      screen.getByRole('button', { name: 'Добавить базовый набор' }),
    )

    const busyAction = await screen.findByRole('button', {
      name: 'Добавляем...',
    })
    expect(busyAction).toBeDisabled()
    expect(busyAction).toHaveAttribute('aria-busy', 'true')

    resolveSeed(createPlan())

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Добавить базовый набор' }),
      ).toBeEnabled()
    })
  })

  it('does not show an empty setup state while the cleaning plan is unavailable', () => {
    mocks.useCleaningPlan.mockReturnValue({
      data: undefined,
      error: new Error('Cleaning API is not ready.'),
      isLoading: false,
    })

    renderCleaningPage()

    expect(
      screen.getByText(
        'Нет соединения. Уборка загрузится после восстановления подключения.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Добавить базовый набор' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Зоны ещё не настроены')).not.toBeInTheDocument()
    expect(screen.queryByText('Накопилось')).not.toBeInTheDocument()
  })

  it('filters cleaning tasks from query parameters', () => {
    const zone = createZone()
    const lowPriorityItem = createCleaningItem(zone, {
      estimatedMinutes: 10,
      id: 'task-low',
      priority: 'low',
      title: 'Протереть пол',
    })
    const highPriorityItem = createCleaningItem(zone, {
      energy: 'high',
      estimatedMinutes: 45,
      id: 'task-high',
      priority: 'high',
      title: 'Помыть окно',
    })

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(zone),
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse([], zone, [lowPriorityItem, highPriorityItem]),
      error: null,
      isLoading: false,
    })

    renderCleaningPage('/cleaning?cleaningMode=low')

    expect(screen.getByText('Протереть пол')).toBeVisible()
    expect(screen.queryByText('Помыть окно')).not.toBeInTheDocument()
  })

  it('shows overdue tasks from other zones without duplicating current tasks', () => {
    const zone = createZone()
    const otherZone: CleaningZoneRecord = {
      ...createZone(),
      dayOfWeek: 5,
      id: 'zone-2',
      title: 'Кухня',
    }
    const dueItem = createCleaningItem(zone, {
      id: 'task-due',
      title: 'Протереть пол',
    })
    dueItem.isOverdue = true

    const overdueItem = createCleaningItem(otherZone, {
      id: 'task-accumulated',
      title: 'Помыть плинтусы',
    })
    overdueItem.isOverdue = true

    const accumulatedNotOverdueItem = createCleaningItem(otherZone, {
      id: 'task-accumulated-not-overdue',
      title: 'Протереть двери',
    })
    const seasonalItem = createCleaningItem(zone, {
      id: 'task-seasonal',
      isSeasonal: true,
      scope: 'general',
      seasonMonths: [5],
      title: 'Полив',
      zoneId: null,
    })
    const today = createTodayResponse(
      [dueItem, overdueItem, accumulatedNotOverdueItem],
      zone,
      [dueItem],
      [seasonalItem],
    )

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(zone),
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: {
        ...today,
        seasonalItems: [seasonalItem],
        summary: { ...today.summary, seasonalCount: 1, urgentCount: 1 },
        urgentItems: [dueItem],
      },
      error: null,
      isLoading: false,
    })

    renderCleaningPage()

    expect(
      screen.queryByRole('heading', { name: 'Рекомендуется сегодня' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Отложенные задачи' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Сезонные' }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('Протереть пол')).toHaveLength(1)

    const overdueSection = screen
      .getByRole('heading', { name: 'Просрочено' })
      .closest('section')

    if (!overdueSection) {
      throw new Error('Overdue cleaning section was not found.')
    }

    expect(within(overdueSection).getByText('Помыть плинтусы')).toBeVisible()
    expect(within(overdueSection).getByText('Кухня')).toBeVisible()
    expect(
      within(overdueSection).getByRole('button', {
        name: 'Отметить «Помыть плинтусы» выполненной',
      }),
    ).toBeVisible()
    expect(
      within(overdueSection).getByRole('button', { name: 'Отложить' }),
    ).toBeVisible()
    expect(
      within(overdueSection).getByRole('button', { name: 'Пропустить' }),
    ).toBeVisible()
    expect(screen.queryByText('Протереть двери')).not.toBeInTheDocument()
    expect(screen.getAllByText('Полив')).toHaveLength(1)
  })

  it('does not repeat scope labels inside zone and general task sections', () => {
    const zone = createZone()
    const zoneItem = createCleaningItem(zone, {
      id: 'task-zone',
      title: 'Протереть пол',
    })
    const generalItem = createCleaningItem(zone, {
      id: 'task-general',
      scope: 'general',
      title: 'Помыть окна',
      zoneId: null,
    })

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlanWithItems(zone, [zoneItem, generalItem]),
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse([], zone, [zoneItem], [generalItem]),
      error: null,
      isLoading: false,
    })

    renderCleaningPage()

    const zoneSection = screen
      .getByRole('heading', { name: 'Все задачи зоны' })
      .closest('section')
    const generalSection = screen
      .getByRole('heading', { name: 'Прочая уборка' })
      .closest('section')

    if (!zoneSection || !generalSection) {
      throw new Error('Cleaning task sections were not found.')
    }

    expect(within(zoneSection).getByText('Протереть пол')).toBeVisible()
    expect(within(zoneSection).queryByText('Комната Кирилла')).toBeNull()
    expect(within(generalSection).getByText('Помыть окна')).toBeVisible()
    expect(within(generalSection).queryByText('Прочее')).toBeNull()
    expect(within(generalSection).queryByText('Комната Кирилла')).toBeNull()
  })

  it('keeps postponed tasks outside current zones in a collapsed section at the bottom', async () => {
    const zone = createZone()
    const otherZone: CleaningZoneRecord = {
      ...createZone(),
      dayOfWeek: 5,
      id: 'zone-2',
      title: 'Кухня',
    }
    const currentItem = createCleaningItem(zone, {
      id: 'task-current',
      title: 'Разобрать одежду',
    })
    currentItem.state.lastPostponedAt = '2026-05-18T08:00:00.000Z'
    currentItem.state.postponeCount = 1

    const postponedItem = createCleaningItem(otherZone, {
      id: 'task-postponed',
      title: 'Помыть холодильник',
    })
    postponedItem.state.lastPostponedAt = '2026-05-19T08:00:00.000Z'
    postponedItem.state.nextDueAt = '2026-05-26'
    postponedItem.state.postponeCount = 2

    const completedItem = createCleaningItem(otherZone, {
      id: 'task-completed',
      title: 'Протереть двери',
    })
    completedItem.state.lastPostponedAt = '2026-05-17T08:00:00.000Z'
    completedItem.state.postponeCount = 0

    mocks.useCleaningPlan.mockReturnValue({
      data: {
        ...createPlanWithItems(zone, [
          currentItem,
          postponedItem,
          completedItem,
        ]),
        zones: [zone, otherZone],
      },
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse([], zone),
      error: null,
      isLoading: false,
    })

    const { container } = renderCleaningPage()
    const summary = screen.getByText('Отложено').closest('summary')
    const details = summary?.closest('details')

    if (!summary || !details) {
      throw new Error('Postponed cleaning section was not found.')
    }

    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('Помыть холодильник')).not.toBeVisible()
    expect(within(details).queryByText('Разобрать одежду')).toBeNull()
    expect(within(details).queryByText('Протереть двери')).toBeNull()
    expect(within(details).getByText('1')).toBeInTheDocument()
    const taskSections = container.querySelectorAll(`.${styles.taskSection}`)

    expect(details).toBe(taskSections.item(taskSections.length - 1))

    fireEvent.click(summary)

    expect(details).toHaveAttribute('open')
    expect(within(details).getByText('Помыть холодильник')).toBeVisible()
    expect(within(details).getByText('Кухня')).toBeVisible()
    expect(
      within(details).queryByRole('button', { name: 'Отложить' }),
    ).not.toBeInTheDocument()
    expect(
      within(details).queryByRole('button', { name: 'Пропустить' }),
    ).not.toBeInTheDocument()

    const completeButton = within(details).getByRole('button', {
      name: 'Отметить «Помыть холодильник» выполненной',
    })

    const postponedTopRow = completeButton.closest(
      `.${styles.postponedTaskTopRow}`,
    )

    if (!(postponedTopRow instanceof HTMLElement)) {
      throw new Error('Postponed task top row was not found.')
    }

    expect(within(postponedTopRow).getByText('Кухня')).toBeVisible()
    expect(within(postponedTopRow).getByText('обычно')).toBeVisible()
    expect(within(postponedTopRow).getByText('15 мин')).toBeVisible()
    expect(details.querySelector(`.${styles.actionRow}`)).toBeNull()

    fireEvent.click(completeButton)

    await waitFor(() => {
      expect(mocks.completeTask).toHaveBeenCalledTimes(1)
    })
    expectNextCycleActionCall(
      mocks.completeTask.mock.calls[0]?.[0],
      'task-postponed',
    )
  })

  it('hides general cleaning when no current tasks remain', () => {
    const zone = createZone()

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(zone),
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse([], zone),
      error: null,
      isLoading: false,
    })

    renderCleaningPage()

    expect(
      screen.queryByRole('heading', { name: 'Прочая уборка' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Отложено')).not.toBeInTheDocument()
  })

  it('lets general cleaning tasks be completed, postponed and skipped', async () => {
    const zone = createZone()
    const generalItem = createCleaningItem(zone, {
      id: 'task-general',
      scope: 'general',
      title: 'Помыть окна',
      zoneId: null,
    })

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlanWithItems(zone, [generalItem]),
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse([], zone, [], [generalItem]),
      error: null,
      isLoading: false,
    })

    renderCleaningPage()

    const generalSection = screen
      .getByRole('heading', { name: 'Прочая уборка' })
      .closest('section')

    if (!generalSection) {
      throw new Error('General cleaning section was not found.')
    }

    fireEvent.click(
      within(generalSection).getByRole('button', {
        name: 'Отметить «Помыть окна» выполненной',
      }),
    )
    fireEvent.click(
      within(generalSection).getByRole('button', { name: 'Отложить' }),
    )
    fireEvent.click(
      within(generalSection).getByRole('button', { name: 'Пропустить' }),
    )

    await waitFor(() => {
      expect(mocks.completeTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-general' }),
      )
      expect(mocks.postponeTask).toHaveBeenCalledTimes(1)
      expect(mocks.skipTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-general' }),
      )
    })

    expectNextCycleActionCall(
      mocks.postponeTask.mock.calls[0]?.[0],
      'task-general',
    )
  })
})
