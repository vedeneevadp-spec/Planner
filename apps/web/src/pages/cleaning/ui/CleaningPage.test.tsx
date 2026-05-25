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
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CleaningPage, CleaningSettingsPage } from './CleaningPage'
import styles from './CleaningPage.module.css'
import { TaskSection } from './CleaningPage.sections'

const mocks = vi.hoisted(() => ({
  completeTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  createTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  createZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  postponeTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  removeTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  removeZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  skipTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  updateTask: vi.fn<(input: unknown) => Promise<unknown>>(),
  updateZone: vi.fn<(input: unknown) => Promise<unknown>>(),
  useCleaningPlan: vi.fn<
    () => {
      data: CleaningListResponse | undefined
      error: Error | null
      isLoading: boolean
    }
  >(),
  useCleaningToday: vi.fn<
    () => {
      data: CleaningTodayResponse | null
      error: null
      isLoading: boolean
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

  return {
    ...actual,
    getCleaningErrorMessage: (error: unknown) =>
      error instanceof Error && /Cleaning API is not ready/i.test(error.message)
        ? 'Нет соединения. Уборка загрузится после восстановления подключения.'
        : error instanceof Error
          ? error.message
          : 'Не удалось сохранить уборку.',
    useCleaningPlan: () => mocks.useCleaningPlan(),
    useCleaningToday: () => mocks.useCleaningToday(),
    useCompleteCleaningTask: () => createMutationStub(mocks.completeTask),
    useCreateCleaningTask: () => createMutationStub(mocks.createTask),
    useCreateCleaningZone: () => createMutationStub(mocks.createZone),
    usePostponeCleaningTask: () => createMutationStub(mocks.postponeTask),
    useRemoveCleaningTask: () => createMutationStub(mocks.removeTask),
    useRemoveCleaningZone: () => createMutationStub(mocks.removeZone),
    useSkipCleaningTask: () => createMutationStub(mocks.skipTask),
    useUpdateCleaningTask: () => createMutationStub(mocks.updateTask),
    useUpdateCleaningZone: () => createMutationStub(mocks.updateZone),
  }
})

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
      tags: [],
      title: 'Протереть пол',
      updatedAt: '2026-05-12T00:00:00.000Z',
      userId: 'user-1',
      version: 1,
      workspaceId: 'workspace-1',
      zoneId: zone.id,
      ...taskOverrides,
    },
    zone,
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
): CleaningTodayResponse {
  return {
    accumulatedItems,
    date: '2026-05-19',
    dayOfWeek: 2,
    history: [],
    items,
    quickItems: items.filter(
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
      dueCount: items.length,
      quickCount: items.filter(
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

function renderCleaningPage(initialEntry = '/cleaning') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CleaningPage />
    </MemoryRouter>,
  )
}

function expectNextCycleActionCall(action: unknown) {
  if (typeof action !== 'object' || action === null) {
    throw new Error('Cleaning action call was not an object.')
  }

  const payload = action as Record<string, unknown>
  const inputValue = payload.input

  if (typeof inputValue !== 'object' || inputValue === null) {
    throw new Error('Cleaning action input was not an object.')
  }

  const input = inputValue as Record<string, unknown>

  expect(payload.taskId).toBe('task-1')
  expect(typeof input.date).toBe('string')
  expect(input).toMatchObject({
    mode: 'next_cycle',
    note: '',
    targetDate: null,
  })
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
          title: 'Протереть пол',
          zoneId: 'zone-1',
        }),
      )
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
})

describe('TaskSection', () => {
  afterEach(() => {
    cleanup()
  })

  it('hides volume, energy and assignee metadata on cleaning cards', () => {
    render(
      <TaskSection
        title="Все задачи зоны"
        items={[createCleaningItem()]}
        isBusy={false}
        postponeTargets={{}}
        onComplete={vi.fn()}
        onPostpone={vi.fn()}
        onSkip={vi.fn()}
        onTargetChange={vi.fn()}
      />,
    )

    expect(screen.getByText('15 мин')).toBeInTheDocument()
    expect(screen.queryByText('обычная')).not.toBeInTheDocument()
    expect(screen.queryByText('нормально')).not.toBeInTheDocument()
    expect(screen.queryByText('любой')).not.toBeInTheDocument()
  })
})

describe('CleaningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.completeTask.mockResolvedValue(undefined)
    mocks.createTask.mockResolvedValue(undefined)
    mocks.createZone.mockResolvedValue(createZone())
    mocks.postponeTask.mockResolvedValue(undefined)
    mocks.skipTask.mockResolvedValue(undefined)
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

  it('lets accumulated cleaning tasks be completed or postponed to the next cycle', async () => {
    const zone = createZone()
    const accumulatedItem = createCleaningItem(zone)

    mocks.useCleaningPlan.mockReturnValue({
      data: createPlan(zone),
      error: null,
      isLoading: false,
    })
    mocks.useCleaningToday.mockReturnValue({
      data: createTodayResponse([accumulatedItem], zone),
      error: null,
      isLoading: false,
    })

    renderCleaningPage()

    fireEvent.click(screen.getByRole('button', { name: 'Отложить' }))

    await waitFor(() => {
      expect(mocks.postponeTask).toHaveBeenCalledTimes(1)
    })
    expectNextCycleActionCall(mocks.postponeTask.mock.calls[0]?.[0])

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Отметить «Протереть пол» выполненной',
      }),
    )

    await waitFor(() => {
      expect(mocks.completeTask).toHaveBeenCalledTimes(1)
    })
    expectNextCycleActionCall(mocks.completeTask.mock.calls[0]?.[0])
  })
})
