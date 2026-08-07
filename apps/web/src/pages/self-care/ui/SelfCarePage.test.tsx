import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionReadiness } from '@/features/session'

import { SelfCarePage } from './SelfCarePage'

const mocks = vi.hoisted(() => ({
  retryActiveTab: vi.fn<() => Promise<void>>(),
  retrySession: vi.fn<() => Promise<unknown>>(),
  useBrowserOffline: vi.fn<() => boolean>(),
  useSelfCareOfflineQueue: vi.fn<() => unknown>(),
  useSelfCarePageData: vi.fn<(routeState: unknown) => unknown>(),
  useSelfCarePageMutations: vi.fn<() => unknown>(),
  useSessionFeatureReadiness: vi.fn<() => unknown>(),
}))

vi.mock('@/features/session', () => ({
  usePlannerTimeZone: () => 'Europe/Samara',
  useSessionFeatureReadiness: mocks.useSessionFeatureReadiness,
}))

vi.mock('@/features/self-care', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...(actual as object),
    useSelfCareOfflineQueue: mocks.useSelfCareOfflineQueue,
  }
})

vi.mock('@/shared/lib/offline-sync', () => ({
  isBrowserRetryableOfflineError: (error: unknown) =>
    error instanceof DOMException || error instanceof TypeError,
  useBrowserOffline: mocks.useBrowserOffline,
}))

vi.mock('./SelfCarePage.action-dialogs', () => ({
  SelfCareCompletionEditDialog: () => null,
  SelfCareCourseRestartDialog: () => null,
  SelfCareExerciseDialog: () => null,
  SelfCareMeasurementDialog: () => null,
  SelfCareScheduleDialog: () => null,
}))

vi.mock('./SelfCarePage.components', () => ({
  SelfCareHistoryTab: ({ isBusy }: { isBusy: boolean }) => (
    <div data-read-only={String(isBusy)} data-testid="history-tab" />
  ),
  SelfCarePlanTab: ({ isBusy }: { isBusy: boolean }) => (
    <div data-read-only={String(isBusy)} data-testid="plan-tab" />
  ),
  SelfCareRitualsTab: ({ isBusy }: { isBusy: boolean }) => (
    <div data-read-only={String(isBusy)} data-testid="rituals-tab" />
  ),
  SelfCareSettingsTab: ({ isBusy }: { isBusy: boolean }) => (
    <div data-read-only={String(isBusy)} data-testid="settings-tab" />
  ),
  SelfCareTodayTab: ({ isBusy }: { isBusy: boolean }) => (
    <div data-read-only={String(isBusy)} data-testid="today-tab" />
  ),
}))

vi.mock('./SelfCarePage.data', () => ({
  useSelfCarePageData: mocks.useSelfCarePageData,
}))

vi.mock('./SelfCarePage.forms', () => ({
  SelfCareCustomCreateForm: () => <div data-testid="custom-create-form" />,
  SelfCareEditForm: () => null,
}))

vi.mock('./SelfCarePage.mutations', () => ({
  useSelfCarePageMutations: mocks.useSelfCarePageMutations,
}))

vi.mock('./SelfCarePage.tabs', () => ({
  SelfCarePageTabs: ({ activeTab }: { activeTab: string }) => (
    <nav aria-label="Разделы заботы" data-active-tab={activeTab} />
  ),
}))

describe('SelfCarePage states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.retryActiveTab.mockResolvedValue()
    mocks.retrySession.mockResolvedValue(undefined)
    mocks.useBrowserOffline.mockReturnValue(false)
    mocks.useSelfCareOfflineQueue.mockReturnValue(createOfflineQueue())
    mocks.useSelfCarePageData.mockReturnValue(createPageData())
    mocks.useSelfCarePageMutations.mockReturnValue(createMutations())
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createSessionFeatureReadiness(),
    )
  })

  afterEach(() => {
    cleanup()
  })

  it('shows a page skeleton while the initial data is loading', () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        hasActiveTabData: false,
        isActiveTabLoading: true,
      }),
    )

    renderPage()

    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(screen.getByText('Загружаем заботу о себе')).toBeInTheDocument()
    expect(screen.queryByTestId('today-tab')).not.toBeInTheDocument()
  })

  it('checks the cache first and then shows cold-start offline after hydration', () => {
    mocks.useBrowserOffline.mockReturnValue(true)
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        hasActiveTabData: false,
        isActiveTabCacheLoading: true,
        isActiveTabLoading: true,
      }),
    )

    const view = renderPage()

    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(screen.getByText('Проверяем сохранённые данные')).toBeInTheDocument()

    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        hasActiveTabData: false,
        isActiveTabCacheLoading: false,
        isActiveTabLoading: true,
      }),
    )
    view.rerender(
      <MemoryRouter initialEntries={['/self-care']}>
        <SelfCarePage />
      </MemoryRouter>,
    )

    expect(screen.queryByTestId('page-state-skeleton')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: 'Забота о себе недоступна без подключения',
      }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
    expect(
      screen.getByText('Время последней синхронизации неизвестно'),
    ).toBeVisible()
  })

  it('shows cached offline data with its sync time and keeps durable writes available', () => {
    const lastSuccessfulSyncAt = '2026-08-06T08:30:00.000Z'
    mocks.useBrowserOffline.mockReturnValue(true)
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({ lastSuccessfulSyncAt }),
    )

    renderPage()

    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(
      screen.getByText(
        'Сохранённые данные доступны. Новые изменения останутся на устройстве и отправятся после восстановления связи.',
      ),
    ).toBeVisible()
    expect(screen.getByText(/Последняя синхронизация:/)).toHaveAttribute(
      'datetime',
      lastSuccessfulSyncAt,
    )
    expect(screen.getByTestId('today-tab')).toHaveAttribute(
      'data-read-only',
      'false',
    )
  })

  it('shows a server error and retries the active data scope', async () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        activeTabReadErrors: [new Error('Server unavailable')],
        hasActiveTabData: false,
      }),
    )

    renderPage()

    expect(
      screen.getByRole('heading', {
        name: 'Не удалось открыть заботу о себе',
      }),
    ).toBeVisible()
    expect(screen.getByText('Server unavailable')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() => {
      expect(mocks.retryActiveTab).toHaveBeenCalledTimes(1)
    })
    expect(mocks.retrySession).not.toHaveBeenCalled()
  })

  it('explains an unavailable session and retries session restoration', async () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        hasActiveTabData: false,
        isActiveTabLoading: true,
      }),
    )
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createSessionFeatureReadiness(
        createReadiness({
          canReadCachedData: false,
          canRenderAppContent: false,
          canUseProtectedApi: false,
          canWriteProtectedData: false,
          reason: 'unauthorized',
          status: 'blockedAuth',
        }),
      ),
    )

    renderPage()

    expect(
      screen.getByRole('heading', { name: 'Нужно восстановить доступ' }),
    ).toBeVisible()
    expect(screen.queryByTestId('page-state-skeleton')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Обновить доступ' }))

    await waitFor(() => {
      expect(mocks.retrySession).toHaveBeenCalledTimes(1)
    })
    expect(mocks.retryActiveTab).not.toHaveBeenCalled()
  })

  it('keeps cached data and durable writes available while auth is restoring', () => {
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createSessionFeatureReadiness(
        createReadiness({
          canUseProtectedApi: false,
          canWriteProtectedData: false,
          reason: 'auth_restoring',
          status: 'restoringWithCache',
        }),
      ),
    )

    renderPage()

    expect(screen.getByText('Восстанавливаем доступ')).toBeVisible()
    expect(
      screen.getByText(
        'Сохранённые данные доступны для просмотра. Изменения появятся после восстановления доступа.',
      ),
    ).toBeVisible()
    expect(screen.getByTestId('today-tab')).toHaveAttribute(
      'data-read-only',
      'false',
    )
  })

  it('keeps the Today core cache visible when an auxiliary scope fails', () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        activeTabReadErrors: [new TypeError('History unavailable')],
        dashboard: { todayItems: [] },
        hasActiveTabData: true,
        hasCompleteActiveTabData: false,
      }),
    )

    renderPage()

    expect(screen.getByTestId('today-tab')).toBeVisible()
    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(screen.queryByTestId('page-state-skeleton')).not.toBeInTheDocument()
  })

  it('keeps the All care core cache visible when an auxiliary scope fails', () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        activeTabReadErrors: [new TypeError('Plan unavailable')],
        hasActiveTabData: true,
        hasCompleteActiveTabData: false,
        list: { items: [] },
      }),
    )

    renderPage('/self-care?tab=rituals')

    expect(screen.getByTestId('rituals-tab')).toBeVisible()
    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(screen.queryByTestId('page-state-skeleton')).not.toBeInTheDocument()
  })

  it('shows a skeleton inside a deep-linked create dialog', async () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        hasCreateDialogData: false,
        isCreateDialogLoading: true,
      }),
    )

    renderPage('/self-care?selfCareAction=care&selfCareActionRequest=custom')

    const dialog = await screen.findByRole('dialog', {
      name: 'Создать свою заботу',
    })
    expect(within(dialog).getByTestId('page-state-skeleton')).toBeVisible()
    expect(within(dialog).getByText('Готовим добавление заботы')).toBeVisible()
    expect(
      within(dialog).queryByTestId('custom-create-form'),
    ).not.toBeInTheDocument()
  })

  it('shows a create-dialog read error and retries all visible data', async () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        createDialogReadErrors: [new Error('Templates are unavailable')],
        hasCreateDialogData: false,
        hasCreateDialogReadError: true,
      }),
    )

    renderPage('/self-care?selfCareAction=care&selfCareActionRequest=template')

    const dialog = await screen.findByRole('dialog', {
      name: 'Выбрать из шаблона',
    })
    expect(
      within(dialog).getByRole('heading', {
        name: 'Не удалось открыть добавление',
      }),
    ).toBeVisible()
    expect(within(dialog).getByText('Templates are unavailable')).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Повторить' }))

    await waitFor(() => {
      expect(mocks.retryActiveTab).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps cached create-dialog data and durable actions available after a network read failure', async () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        createDialogReadErrors: [new TypeError('Failed to fetch')],
        hasCreateDialogReadError: true,
      }),
    )

    renderPage('/self-care?selfCareAction=care')

    const dialog = await screen.findByRole('dialog', {
      name: 'Добавить заботу',
    })
    expect(dialog).toBeVisible()
    expect(within(dialog).getByText('Не удалось обновить данные')).toBeVisible()
    expect(
      within(dialog).getByText(/Не удалось связаться с сервером/),
    ).toBeVisible()
    expect(
      within(dialog).getByRole('button', { name: /^Создать свою/ }),
    ).toBeEnabled()
    expect(
      within(dialog).getByRole('button', { name: /^Выбрать из шаблона/ }),
    ).toBeEnabled()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Обновить данные' }),
    )

    await waitFor(() => {
      expect(mocks.retryActiveTab).toHaveBeenCalledTimes(1)
    })
  })

  it('offers one next action when the template dialog is empty', async () => {
    mocks.useSelfCarePageData.mockReturnValue(
      createPageData({
        templates: [],
        templatesLoaded: true,
      }),
    )

    renderPage('/self-care?selfCareAction=care&selfCareActionRequest=template')

    const dialog = await screen.findByRole('dialog', {
      name: 'Выбрать из шаблона',
    })
    expect(
      within(dialog).getByRole('heading', { name: 'Шаблонов пока нет' }),
    ).toBeVisible()
    expect(
      within(dialog).getByText(
        'Можно создать свою заботу и настроить её под себя.',
      ),
    ).toBeVisible()
    expect(
      within(dialog).getAllByRole('button', { name: 'Создать свою' }),
    ).toHaveLength(1)
  })

  it('opens a deep-linked create dialog while durable offline storage is available', async () => {
    mocks.useBrowserOffline.mockReturnValue(true)

    renderPage('/self-care?selfCareAction=care&selfCareActionRequest=custom')

    expect(mocks.useSelfCarePageData).toHaveBeenCalledWith(
      expect.objectContaining({ createDialogMode: 'custom' }),
    )
    expect(
      await screen.findByRole('dialog', { name: 'Создать свою заботу' }),
    ).toBeVisible()
    expect(screen.getByText('Нет подключения')).toBeVisible()
    expect(screen.getByTestId('today-tab')).toHaveAttribute(
      'data-read-only',
      'false',
    )
  })

  it('disables writes offline when durable storage is unavailable', () => {
    mocks.useBrowserOffline.mockReturnValue(true)
    mocks.useSelfCareOfflineQueue.mockReturnValue(
      createOfflineQueue({ canQueueWrites: false }),
    )

    renderPage('/self-care?selfCareAction=care&selfCareActionRequest=custom')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Можно просматривать сохранённые данные. Для изменений нужно восстановить связь.',
      ),
    ).toBeVisible()
    expect(screen.getByTestId('today-tab')).toHaveAttribute(
      'data-read-only',
      'true',
    )
  })
})

function renderPage(initialEntry = '/self-care') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SelfCarePage />
    </MemoryRouter>,
  )
}

function createPageData(overrides: Record<string, unknown> = {}) {
  return {
    activeTabReadErrors: [],
    analytics: undefined,
    createDialogReadErrors: [],
    createdTemplateIds: new Set<string>(),
    dashboard: undefined,
    defaultCurrency: 'RUB',
    hasActiveTabData: true,
    hasCompleteActiveTabData: true,
    hasCreateDialogData: true,
    hasCreateDialogReadError: false,
    history: undefined,
    isActiveTabCacheLoading: false,
    isActiveTabLoading: false,
    isCreateDialogLoading: false,
    lastSuccessfulSyncAt: null,
    list: undefined,
    plan: undefined,
    retryActiveTab: mocks.retryActiveTab,
    serverRitualStepDrafts: {},
    settingsResponse: undefined,
    templates: [],
    templatesLoaded: false,
    todayKey: '2026-08-06',
    uploadedIcons: [],
    ...overrides,
  }
}

function createMutations() {
  const mutation = {
    error: null,
    isPending: false,
    mutateAsync: vi.fn(() => Promise.resolve(undefined)),
  }

  return {
    archiveItemMutation: mutation,
    cancelOccurrenceMutation: mutation,
    completeCourseMutation: mutation,
    completeFlexibleGoalMutation: mutation,
    completeItemNowMutation: mutation,
    completeOccurrenceMutation: mutation,
    createFromTemplateMutation: mutation,
    createItemMutation: mutation,
    isActionBusy: false,
    moveOccurrenceMutation: mutation,
    mutationErrors: [],
    scheduleItemMutation: mutation,
    skipOccurrenceMutation: mutation,
    updateCompletionMutation: mutation,
    updateItemMutation: mutation,
    updateSettingsMutation: mutation,
    upsertRitualStepDraftMutation: mutation,
  }
}

function createOfflineQueue(overrides: Record<string, unknown> = {}) {
  return {
    awaitingRefresh: 0,
    canQueueWrites: true,
    canWriteFromSession: true,
    conflicted: 0,
    discardConflicts: vi.fn(() => Promise.resolve()),
    failed: 0,
    isDraining: false,
    pending: 0,
    refreshAndRetryConflicts: vi.fn(() => Promise.resolve(null)),
    retry: vi.fn(() => Promise.resolve(null)),
    total: 0,
    ...overrides,
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

function createSessionFeatureReadiness(
  readiness: SessionReadiness = createReadiness(),
) {
  return {
    readiness,
    sessionQuery: { refetch: mocks.retrySession },
  }
}
