import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sphere } from '@/entities/sphere'
import type { SessionReadiness } from '@/features/session'

import { SpheresPage } from './SpheresPage'

const mocks = vi.hoisted(() => {
  const lifeSphereLastSuccessfulSyncAt: string | null =
    '2026-08-05T09:30:00.000Z'
  const taskLastSuccessfulSyncAt: string | null = '2026-08-05T09:35:00.000Z'

  return {
    addSphere: vi.fn(() => Promise.resolve(true)),
    hasLifeSphereRecords: true,
    hasLifeSphereReadError: false,
    hasTaskRecords: true,
    hasTaskReadError: false,
    isLifeSphereOffline: false,
    isLifeSphereCacheHydrating: false,
    isLoading: false,
    isTaskOffline: false,
    isTaskCacheHydrating: false,
    lifeSphereLastSuccessfulSyncAt,
    readiness: createReadiness(),
    refresh: vi.fn(() => Promise.resolve()),
    spheres: [] as Sphere[],
    taskLastSuccessfulSyncAt,
    taskComposer: vi.fn<(props: { hideOpenButton?: boolean }) => void>(),
  }
})

vi.mock('@/features/emoji-library', () => ({
  useUploadedIconAssets: () => ({ uploadedIcons: [] }),
}))

vi.mock('@/features/planner', () => ({
  usePlanner: () => ({
    addSphere: mocks.addSphere,
    hasLifeSphereRecords: mocks.hasLifeSphereRecords,
    hasLifeSphereReadError: mocks.hasLifeSphereReadError,
    hasTaskRecords: mocks.hasTaskRecords,
    hasTaskReadError: mocks.hasTaskReadError,
    isLifeSphereOffline: mocks.isLifeSphereOffline,
    isLifeSphereCacheHydrating: mocks.isLifeSphereCacheHydrating,
    isLoading: mocks.isLoading,
    isTaskOffline: mocks.isTaskOffline,
    isTaskCacheHydrating: mocks.isTaskCacheHydrating,
    lifeSphereLastSuccessfulSyncAt: mocks.lifeSphereLastSuccessfulSyncAt,
    readiness: mocks.readiness,
    refresh: mocks.refresh,
    spheres: mocks.spheres,
    taskLastSuccessfulSyncAt: mocks.taskLastSuccessfulSyncAt,
    tasks: [],
  }),
}))

vi.mock('@/features/session', () => ({
  usePlannerTimeZone: () => 'Europe/Samara',
}))

vi.mock('@/features/task-create', () => ({
  TaskComposer: (props: { hideOpenButton?: boolean }) => {
    mocks.taskComposer(props)
    return null
  },
}))

describe('SpheresPage states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasLifeSphereRecords = true
    mocks.hasLifeSphereReadError = false
    mocks.hasTaskRecords = true
    mocks.hasTaskReadError = false
    mocks.isLifeSphereOffline = false
    mocks.isLifeSphereCacheHydrating = false
    mocks.isLoading = false
    mocks.isTaskOffline = false
    mocks.isTaskCacheHydrating = false
    mocks.lifeSphereLastSuccessfulSyncAt = '2026-08-05T09:30:00.000Z'
    mocks.readiness = createReadiness()
    mocks.spheres = []
    mocks.taskLastSuccessfulSyncAt = '2026-08-05T09:35:00.000Z'
    mocks.taskComposer.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a card skeleton until both spheres and tasks are available', () => {
    mocks.hasTaskRecords = false
    mocks.isLoading = true
    mocks.readiness = createReadiness({
      reason: 'planner_pending',
      status: 'blockedAuth',
    })

    renderPage()

    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(screen.getByText('Загружаем сферы')).toBeInTheDocument()
    expect(screen.queryByText('пока без задач')).not.toBeInTheDocument()
  })

  it('shows an explicit error and retries when records did not load', () => {
    mocks.hasTaskReadError = true
    mocks.hasLifeSphereRecords = false
    mocks.hasTaskRecords = false

    renderPage()

    expect(
      screen.getByRole('heading', { name: 'Не удалось загрузить сферы' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not describe an unavailable auth session as offline and retries denied auth', () => {
    mocks.hasLifeSphereRecords = false
    mocks.hasTaskRecords = false
    mocks.isLoading = true
    mocks.readiness = createReadiness({
      reason: 'auth_deferred',
      status: 'offlineWithCache',
    })

    renderPage()

    expect(screen.getByText(/Не удалось подтвердить доступ/)).toBeVisible()
    expect(screen.queryByText('Нет подключения')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(mocks.refresh).toHaveBeenCalledWith({ retryDeniedAuth: true })
  })

  it('shows offline with retry when no complete cache is available', () => {
    mocks.hasLifeSphereRecords = true
    mocks.hasTaskRecords = false
    mocks.isTaskOffline = true
    mocks.lifeSphereLastSuccessfulSyncAt = ''
    mocks.taskLastSuccessfulSyncAt = ''

    renderPage()

    expect(
      screen.getByRole('heading', {
        name: 'Сферы недоступны без подключения',
      }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
    expect(
      screen.getByText('Время последней синхронизации неизвестно'),
    ).toBeVisible()
  })

  it('shows offline immediately when browser queries are paused without cache', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    mocks.hasLifeSphereRecords = false
    mocks.hasTaskRecords = false
    mocks.isLoading = true
    mocks.readiness = createReadiness({
      reason: 'planner_pending',
      status: 'blockedAuth',
    })

    renderPage()

    expect(
      screen.getByRole('heading', {
        name: 'Сферы недоступны без подключения',
      }),
    ).toBeVisible()
    expect(screen.queryByTestId('page-state-skeleton')).not.toBeInTheDocument()
  })

  it('checks both local caches before declaring a cold start offline', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    mocks.hasLifeSphereRecords = false
    mocks.hasTaskRecords = false
    mocks.isLifeSphereCacheHydrating = true
    mocks.isTaskCacheHydrating = true
    mocks.isLoading = true

    renderPage()

    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(screen.getByText('Проверяем сохранённые сферы')).toBeVisible()
    expect(
      screen.queryByRole('heading', {
        name: 'Сферы недоступны без подключения',
      }),
    ).not.toBeInTheDocument()
    expect(mocks.taskComposer).toHaveBeenLastCalledWith(
      expect.objectContaining({ hideOpenButton: true }),
    )
  })

  it('explains restoring access while cached spheres stay visible', () => {
    mocks.spheres = [createSphere()]
    mocks.readiness = createReadiness({
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'auth_restoring',
      status: 'blockedAuth',
    })

    renderPage()

    expect(screen.getByText('Восстанавливаем доступ')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Дом' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not offer a dead empty-state action while access is restoring', () => {
    mocks.readiness = createReadiness({
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'auth_restoring',
      status: 'blockedAuth',
    })

    renderPage()

    expect(screen.getByText('Восстанавливаем доступ')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Сфер пока нет' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Создать сферу' }),
    ).not.toBeInTheDocument()
    expect(mocks.taskComposer).toHaveBeenLastCalledWith(
      expect.objectContaining({ hideOpenButton: true }),
    )
  })

  it('keeps cached spheres visible when the browser goes offline', () => {
    let isOnline = true
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(
      () => isOnline,
    )
    mocks.spheres = [createSphere()]
    renderPage()

    isOnline = false
    fireEvent(window, new Event('offline'))

    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Дом' })).toBeVisible()
    expect(mocks.taskComposer).toHaveBeenLastCalledWith(
      expect.objectContaining({ hideOpenButton: false }),
    )
  })

  it('keeps cached content visible offline and shows its freshness', () => {
    mocks.hasLifeSphereReadError = true
    mocks.isLifeSphereOffline = true
    mocks.spheres = [createSphere()]

    renderPage()

    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(screen.getByText(/Последняя синхронизация:/)).toHaveAttribute(
      'datetime',
      '2026-08-05T09:30:00.000Z',
    )
    expect(screen.getByRole('heading', { name: 'Дом' })).toBeVisible()
    expect(screen.getAllByText('пока без задач')).toHaveLength(2)
    expect(screen.queryByText('заброшено')).not.toBeInTheDocument()
  })

  it('uses a neutral headline when every sphere has no tasks this week', () => {
    mocks.spheres = [
      createSphere(),
      createSphere({ id: 'health', name: 'Здоровье', sortOrder: 1 }),
    ]

    renderPage()

    expect(
      screen.getByRole('heading', {
        name: 'На этой неделе задач по сферам пока нет',
      }),
    ).toBeVisible()
    expect(
      screen.queryByText(/Большая часть задач недели/),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/задачи с прошедшей датой/),
    ).not.toBeInTheDocument()
  })

  it('shows a non-blocking error when cached records survive an online read failure', () => {
    mocks.hasTaskReadError = true
    mocks.spheres = [createSphere()]

    renderPage()

    expect(screen.getByText('Не удалось обновить сферы')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Дом' })).toBeVisible()
  })

  it('offers one concrete action for the loaded empty state', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Сфер пока нет' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Создать сферу' }))

    expect(screen.getByRole('dialog', { name: 'Новая сфера' })).toBeVisible()
  })
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/spheres']}>
      <SpheresPage />
    </MemoryRouter>,
  )
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

function createSphere(overrides: Partial<Sphere> = {}): Sphere {
  return {
    color: '#4f9f8a',
    createdAt: '2026-08-01T10:00:00.000Z',
    deletedAt: null,
    description: '',
    icon: '🌿',
    id: 'home',
    isActive: true,
    isDefault: false,
    name: 'Дом',
    sortOrder: 0,
    updatedAt: '2026-08-01T10:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}
