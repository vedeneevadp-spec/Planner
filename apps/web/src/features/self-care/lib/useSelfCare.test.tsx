import 'fake-indexeddb/auto'

import {
  generateUuidV7,
  type SelfCareCompletion,
  type SelfCareCompletionInput,
  type SelfCareDashboardResponse,
  type SelfCareHistoryResponse,
  type SelfCareItem,
  type SelfCareItemInput,
  type SelfCareItemScheduleInput,
  type SelfCareListResponse,
  type SelfCareOccurrence,
  type SelfCareOfflineCommand,
  type SelfCareOfflineCommandRequest,
  type SelfCareOfflineCommandResult,
  type SelfCarePlanResponse,
  type SelfCareRitualCompletionInput,
  type SelfCareRitualStepDraftListResponse,
  type SelfCareSettings,
  type SelfCareSettingsResponse,
  type SelfCareTemplate,
  type SelfCareTodayItem,
  type SessionResponse,
} from '@planner/contracts'
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import Dexie from 'dexie'
import type { ReactNode } from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'

import {
  clearSelfCareOfflineWorkspaceData,
  createSelfCareCacheKey,
  enqueueSelfCareOfflineMutation,
  getSelfCareOfflineStorageHealth,
  getSelfCareOfflineWorkspaceWriteGeneration,
  listSelfCareOfflineMutations,
  loadCachedSelfCareRead,
  probeSelfCareOfflineStorage,
  reportSelfCareOfflineStorageFailure,
  resetSelfCareOfflineDatabaseForTests,
  saveCachedSelfCareRead,
} from './offline-self-care-store'
import { type SelfCareApiClient, SelfCareApiError } from './self-care-api'

interface SessionFeatureReadinessStub {
  apiConfig: {
    accessToken: string
    actorUserId: string
    apiBaseUrl: string
    clientTimeZone: string
    workspaceId: string
  } | null
  isApiEnabled: boolean
  readiness: {
    canWriteProtectedData: boolean
  }
  session: SessionResponse | undefined
  workspaceId: string
}

const mocks = vi.hoisted(() => ({
  createSelfCareApiClient: vi.fn(),
  useSessionFeatureReadiness: vi.fn<() => SessionFeatureReadinessStub>(),
}))

vi.mock('@/features/session', () => ({
  usePlannerTimeZone: () => 'Europe/Astrakhan',
  useSessionFeatureReadiness: () => mocks.useSessionFeatureReadiness(),
}))

vi.mock('./self-care-api', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...(actual as object),
    createSelfCareApiClient: mocks.createSelfCareApiClient,
  }
})

import {
  canSessionQueueSelfCare,
  createSelfCareQueryOwnerId,
  getSelfCareErrorMessage,
  SELF_CARE_NETWORK_ERROR_MESSAGE,
  SelfCareApiUnavailableError,
  selfCareDashboardQueryKey,
  selfCareHistoryQueryKey,
  selfCareItemsQueryKey,
  selfCarePlanQueryKey,
  selfCareRitualStepDraftsQueryKey,
  selfCareSettingsQueryKey,
  selfCareTemplatesQueryKey,
  useArchiveSelfCareItem,
  useCancelSelfCareOccurrence,
  useCompleteSelfCareCourseSession,
  useCompleteSelfCareFlexibleGoal,
  useCompleteSelfCareItemNow,
  useCompleteSelfCareOccurrence,
  useCreateSelfCareItem,
  useCreateSelfCareItemFromTemplate,
  useMoveSelfCareOccurrence,
  useScheduleSelfCareItem,
  useSelfCareDashboard,
  useSelfCareOfflineQueue,
  useSkipSelfCareOccurrence,
  useUpdateSelfCareCompletion,
  useUpdateSelfCareItem,
  useUpdateSelfCareSettings,
  useUpsertSelfCareRitualStepDraft,
} from './useSelfCare'

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'
const OWNER_ID = createSelfCareQueryOwnerId(WORKSPACE_ID, ACTOR_USER_ID)
const ITEM_ID = 'self-care-item-1'
const OCCURRENCE_ID = 'self-care-occurrence-1'
const COMPLETION_ID = 'self-care-completion-1'
const CLIENT_TIME_ZONE = 'Europe/Astrakhan'
const DATE = '2026-06-18'
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('self-care persistent reads and offline commands', () => {
  let browserOnline = true
  let onlineSpy: MockInstance<() => boolean>
  let queryClient: QueryClient
  let selfCareApi: SelfCareApiClient

  beforeEach(async () => {
    await resetSelfCareOfflineDatabaseForTests()
    await probeSelfCareOfflineStorage()
    queryClient = createQueryClient()
    selfCareApi = createSelfCareApi()
    mocks.createSelfCareApiClient.mockReturnValue(selfCareApi)
    mocks.useSessionFeatureReadiness.mockReturnValue(createReadinessStub())
    onlineManager.setOnline(true)
    browserOnline = true
    onlineSpy = vi
      .spyOn(window.navigator, 'onLine', 'get')
      .mockImplementation(() => browserOnline)
  })

  afterEach(async () => {
    cleanup()
    onlineSpy.mockRestore()
    onlineManager.setOnline(true)
    queryClient.clear()
    await resetSelfCareOfflineDatabaseForTests()
    mocks.createSelfCareApiClient.mockReset()
    mocks.useSessionFeatureReadiness.mockReset()
  })

  describe('persistent reads', () => {
    it('waits for the API client before enabling a query', async () => {
      mocks.useSessionFeatureReadiness.mockReturnValue(
        createReadinessStub({
          apiConfig: null,
          isApiEnabled: true,
          readiness: { canWriteProtectedData: false },
        }),
      )

      const { result } = renderHook(() => useSelfCareDashboard(DATE), {
        wrapper: createQueryWrapper(queryClient),
      })

      await Promise.resolve()

      expect(result.current.fetchStatus).toBe('idle')
      expect(result.current.error).toBeNull()
      expect(mocks.createSelfCareApiClient).not.toHaveBeenCalled()
    })

    it('loads and persists the dashboard through the confirmed actor config', async () => {
      const dashboard = createDashboard()
      vi.mocked(selfCareApi.getDashboard).mockResolvedValueOnce(dashboard)

      const { result } = renderHook(() => useSelfCareDashboard(DATE), {
        wrapper: createQueryWrapper(queryClient),
      })

      await waitFor(() => {
        expect(result.current.data).toEqual(dashboard)
        expect(result.current.lastSuccessfulSyncAt).not.toBeNull()
      })

      expect(mocks.createSelfCareApiClient).toHaveBeenCalledWith({
        accessToken: 'access-token',
        actorUserId: ACTOR_USER_ID,
        apiBaseUrl: 'https://api.chaotika.test',
        clientTimeZone: CLIENT_TIME_ZONE,
        workspaceId: WORKSPACE_ID,
      })
      expect(selfCareApi.getDashboard).toHaveBeenCalledWith(
        DATE,
        expect.any(AbortSignal),
      )

      const cached = await loadCachedSelfCareRead<SelfCareDashboardResponse>(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        createSelfCareCacheKey('dashboard', [DATE]),
      )
      expect(cached?.data).toEqual(dashboard)
      expect(cached?.lastSuccessfulSyncAt).toBe(
        result.current.lastSuccessfulSyncAt,
      )
    })

    it('persists the request start stamp so an older response cannot replace the query result', async () => {
      const olderDashboard = createDashboard()
      const newerDashboard = {
        ...olderDashboard,
        settings: { ...olderDashboard.settings, currency: 'USD' },
      }
      vi.mocked(selfCareApi.getDashboard).mockResolvedValueOnce(newerDashboard)
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(200)

      try {
        const { result } = renderHook(() => useSelfCareDashboard(DATE), {
          wrapper: createQueryWrapper(queryClient),
        })
        await waitFor(() => {
          expect(result.current.data?.settings.currency).toBe('USD')
          expect(result.current.isFetching).toBe(false)
        })

        const staleWrite = await saveCachedSelfCareRead(
          WORKSPACE_ID,
          ACTOR_USER_ID,
          'dashboard',
          createSelfCareCacheKey('dashboard', [DATE]),
          olderDashboard,
          '2026-06-18T10:00:00.000Z',
          getSelfCareOfflineWorkspaceWriteGeneration(WORKSPACE_ID),
          100,
        )

        expect(staleWrite.data.settings.currency).toBe('USD')
      } finally {
        nowSpy.mockRestore()
      }
    })

    it('restores an actor-scoped cached read when the API is unavailable', async () => {
      const dashboard = createDashboard()
      const lastSuccessfulSyncAt = '2026-06-18T08:30:00.000Z'
      await saveCachedSelfCareRead(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        'dashboard',
        createSelfCareCacheKey('dashboard', [DATE]),
        dashboard,
        lastSuccessfulSyncAt,
      )
      mocks.useSessionFeatureReadiness.mockReturnValue(
        createReadinessStub({
          apiConfig: null,
          isApiEnabled: false,
          readiness: { canWriteProtectedData: false },
        }),
      )

      const { result } = renderHook(() => useSelfCareDashboard(DATE), {
        wrapper: createQueryWrapper(queryClient),
      })

      await waitFor(() => {
        expect(result.current.data).toEqual(dashboard)
      })
      expect(result.current.isShowingCachedData).toBe(true)
      expect(result.current.lastSuccessfulSyncAt).toBe(lastSuccessfulSyncAt)
      expect(selfCareApi.getDashboard).not.toHaveBeenCalled()
    })

    it('does not present an offline mutation time as the last server sync', async () => {
      browserOnline = false
      const dashboard = createDashboard()
      const lastSuccessfulSyncAt = '2026-06-18T08:30:00.000Z'
      await saveCachedSelfCareRead(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        'dashboard',
        createSelfCareCacheKey('dashboard', [DATE]),
        dashboard,
        lastSuccessfulSyncAt,
      )
      mocks.useSessionFeatureReadiness.mockReturnValue(
        createReadinessStub({
          apiConfig: null,
          isApiEnabled: false,
          readiness: { canWriteProtectedData: false },
        }),
      )

      const dashboardHook = renderHook(() => useSelfCareDashboard(DATE), {
        wrapper: createQueryWrapper(queryClient),
      })
      await waitFor(() => {
        expect(dashboardHook.result.current.data).toEqual(dashboard)
      })
      queryClient.setQueryData(
        selfCareDashboardQueryKey(OWNER_ID, DATE),
        dashboard,
      )

      const settingsMutation = renderHook(() => useUpdateSelfCareSettings(), {
        wrapper: createQueryWrapper(queryClient),
      })
      await act(async () => {
        await settingsMutation.result.current.mutateAsync({ currency: 'USD' })
      })

      expect(dashboardHook.result.current.lastSuccessfulSyncAt).toBe(
        lastSuccessfulSyncAt,
      )
      expect(
        queryClient.getQueryData<SelfCareDashboardResponse>(
          selfCareDashboardQueryKey(OWNER_ID, DATE),
        )?.settings.currency,
      ).toBe('USD')
    })
  })

  describe('actor permission boundary', () => {
    it('queues only for the confirmed personal non-guest actor', () => {
      const confirmed = createPersonalSession()

      expect(canSessionQueueSelfCare(confirmed)).toBe(true)
      expect(
        canSessionQueueSelfCare({
          ...confirmed,
          role: 'guest',
        }),
      ).toBe(false)
      expect(
        canSessionQueueSelfCare({
          ...confirmed,
          actorUserId: 'different-user',
        }),
      ).toBe(false)
      expect(
        canSessionQueueSelfCare({
          ...confirmed,
          workspace: { ...confirmed.workspace, kind: 'shared' },
        }),
      ).toBe(false)
      expect(
        canSessionQueueSelfCare({
          ...confirmed,
          workspace: { ...confirmed.workspace, id: 'different-workspace' },
        }),
      ).toBe(false)
      expect(canSessionQueueSelfCare(undefined)).toBe(false)
    })

    it('rejects writes for a guest without sending or persisting them', async () => {
      const session = createPersonalSession({ role: 'guest' })
      mocks.useSessionFeatureReadiness.mockReturnValue(
        createReadinessStub({ session }),
      )
      seedSelfCareSource(queryClient)

      const mutation = renderHook(() => useUpdateSelfCareSettings(), {
        wrapper: createQueryWrapper(queryClient),
      })

      await act(async () => {
        await expect(
          mutation.result.current.mutateAsync({ currency: 'USD' }),
        ).rejects.toMatchObject({ name: 'SelfCareApiUnavailableError' })
      })
      expect(selfCareApi.executeOfflineCommand).not.toHaveBeenCalled()
      expect(
        await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).toEqual([])
    })
  })

  describe('cached-only command recovery', () => {
    it('hydrates the confirmed actor cache before completing a visible item', async () => {
      browserOnline = false
      const dashboard = createDashboard()
      const list = createList()
      const lastSuccessfulSyncAt = '2026-06-18T08:30:00.000Z'

      await saveCachedSelfCareRead(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        'dashboard',
        createSelfCareCacheKey('dashboard', [DATE]),
        dashboard,
        lastSuccessfulSyncAt,
      )
      await saveCachedSelfCareRead(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        'items',
        createSelfCareCacheKey('items'),
        list,
        lastSuccessfulSyncAt,
      )
      mocks.useSessionFeatureReadiness.mockReturnValue(
        createReadinessStub({
          apiConfig: null,
          isApiEnabled: false,
          readiness: { canWriteProtectedData: false },
        }),
      )

      const mutation = renderHook(() => useCompleteSelfCareItemNow(), {
        wrapper: createQueryWrapper(queryClient),
      })

      await act(async () => {
        await mutation.result.current.mutateAsync({
          input: createRitualCompletionInput('Сделано из кэша'),
          itemId: ITEM_ID,
        })
      })

      const [queued] = await listSelfCareOfflineMutations(
        WORKSPACE_ID,
        ACTOR_USER_ID,
      )
      expect(queued?.command).toMatchObject({
        expectedVersion: 7,
        input: { note: 'Сделано из кэша' },
        itemId: ITEM_ID,
        type: 'complete_item_now',
      })
      expect(
        queryClient.getQueryData(selfCareDashboardQueryKey(OWNER_ID, DATE)),
      ).toBeDefined()
      expect(selfCareApi.executeOfflineCommand).not.toHaveBeenCalled()
    })

    it('projects a created item into a cached-only list immediately', async () => {
      browserOnline = false
      const lastSuccessfulSyncAt = '2026-06-18T08:30:00.000Z'

      await saveCachedSelfCareRead(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        'dashboard',
        createSelfCareCacheKey('dashboard', [DATE]),
        createDashboard(),
        lastSuccessfulSyncAt,
      )
      await saveCachedSelfCareRead(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        'items',
        createSelfCareCacheKey('items'),
        createList(),
        lastSuccessfulSyncAt,
      )
      mocks.useSessionFeatureReadiness.mockReturnValue(
        createReadinessStub({
          apiConfig: null,
          isApiEnabled: false,
          readiness: { canWriteProtectedData: false },
        }),
      )
      const mutation = renderHook(() => useCreateSelfCareItem(), {
        wrapper: createQueryWrapper(queryClient),
      })

      await act(async () => {
        await mutation.result.current.mutateAsync({
          input: { ...createItemInput(), title: 'Новая офлайн-забота' },
        })
      })

      const visibleList = queryClient.getQueryData<SelfCareListResponse>(
        selfCareItemsQueryKey(OWNER_ID),
      )
      expect(
        visibleList?.items.some((item) => item.title === 'Новая офлайн-забота'),
      ).toBe(true)
      expect(
        await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).toHaveLength(1)
      expect(selfCareApi.executeOfflineCommand).not.toHaveBeenCalled()
    })
  })

  describe('all page mutation commands', () => {
    const scenarios = createCommandScenarios()

    for (const scenario of scenarios) {
      it(scenario.name, async () => {
        browserOnline = false
        seedSelfCareSource(queryClient)

        await scenario.run(queryClient)

        const mutations = await listSelfCareOfflineMutations(
          WORKSPACE_ID,
          ACTOR_USER_ID,
        )
        expect(mutations).toHaveLength(1)
        expect(mutations[0]?.clientTimeZone).toBe(CLIENT_TIME_ZONE)
        expect(mutations[0]?.status).toBe('pending')
        scenario.assert(mutations[0]!.command)
        expect(selfCareApi.executeOfflineCommand).not.toHaveBeenCalled()
      })
    }
  })

  describe('responsive queued writes while the browser still reports online', () => {
    it('creates one item and resolves before the stalled request', async () => {
      seedSelfCareSource(queryClient)
      const response =
        createDeferred<
          Awaited<ReturnType<SelfCareApiClient['executeOfflineCommand']>>
        >()
      let request: SelfCareOfflineCommandRequest | undefined
      let requestReleased = false
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        (input) => {
          request = input
          return response.promise
        },
      )
      const mutation = renderHook(() => useCreateSelfCareItem(), {
        wrapper: createQueryWrapper(queryClient),
      })
      const variables = { input: createItemInput() }
      let first!: Promise<SelfCareItem>
      let duplicate!: Promise<SelfCareItem>

      act(() => {
        first = mutation.result.current.mutateAsync(variables)
        duplicate = mutation.result.current.mutateAsync({
          input: { ...variables.input },
        })
      })

      await act(async () => {
        const results = await Promise.all([first, duplicate])
        expect(results[0]?.id).toBe(results[1]?.id)
      })
      expect(requestReleased).toBe(false)
      await waitFor(() => {
        expect(selfCareApi.executeOfflineCommand).toHaveBeenCalledOnce()
      })
      const [queued] = await listSelfCareOfflineMutations(
        WORKSPACE_ID,
        ACTOR_USER_ID,
      )
      expect(queued).toBeDefined()

      requestReleased = true
      response.resolve({
        operationId: request!.operationId,
        replayed: false,
        result: queued!.optimisticResult,
      })
      await waitFor(async () => {
        expect(
          await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
        ).toEqual([])
      })
    })

    it('edits one item and resolves before the stalled request', async () => {
      seedSelfCareSource(queryClient)
      const response =
        createDeferred<
          Awaited<ReturnType<SelfCareApiClient['executeOfflineCommand']>>
        >()
      let request: SelfCareOfflineCommandRequest | undefined
      let requestReleased = false
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        (input) => {
          request = input
          return response.promise
        },
      )
      const mutation = renderHook(() => useUpdateSelfCareItem(), {
        wrapper: createQueryWrapper(queryClient),
      })
      const variables = {
        input: { title: 'Обновлённая забота' },
        itemId: ITEM_ID,
      }
      let first!: Promise<SelfCareItem>
      let duplicate!: Promise<SelfCareItem>

      act(() => {
        first = mutation.result.current.mutateAsync(variables)
        duplicate = mutation.result.current.mutateAsync({
          input: { ...variables.input },
          itemId: variables.itemId,
        })
      })

      await act(async () => {
        const results = await Promise.all([first, duplicate])
        expect(results[0]?.title).toBe('Обновлённая забота')
        expect(results[1]?.title).toBe('Обновлённая забота')
      })
      expect(requestReleased).toBe(false)
      await waitFor(() => {
        expect(selfCareApi.executeOfflineCommand).toHaveBeenCalledOnce()
      })
      const [queued] = await listSelfCareOfflineMutations(
        WORKSPACE_ID,
        ACTOR_USER_ID,
      )
      expect(queued).toBeDefined()

      requestReleased = true
      response.resolve({
        operationId: request!.operationId,
        replayed: false,
        result: queued!.optimisticResult,
      })
      await waitFor(async () => {
        expect(
          await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
        ).toEqual([])
      })
    })

    it('serializes distinct offline edits so the second one depends on the first projection', async () => {
      browserOnline = false
      seedSelfCareSource(queryClient)
      const mutation = renderHook(() => useUpdateSelfCareItem(), {
        wrapper: createQueryWrapper(queryClient),
      })
      let first!: Promise<SelfCareItem>
      let second!: Promise<SelfCareItem>

      act(() => {
        first = mutation.result.current.mutateAsync({
          input: { title: 'Сначала вода' },
          itemId: ITEM_ID,
        })
        second = mutation.result.current.mutateAsync({
          input: { title: 'Потом витамины' },
          itemId: ITEM_ID,
        })
      })

      await act(async () => {
        await Promise.all([first, second])
      })
      const queued = await listSelfCareOfflineMutations(
        WORKSPACE_ID,
        ACTOR_USER_ID,
      )
      expect(queued).toHaveLength(2)
      expect(queued[0]?.command).toMatchObject({ expectedVersion: 7 })
      expect(queued[1]?.command).toMatchObject({ expectedVersion: 8 })
      expect(queued[1]?.dependsOn).toEqual([queued[0]!.id])
      expect(selfCareApi.executeOfflineCommand).not.toHaveBeenCalled()
    })

    it('records one completion and resolves before the stalled request', async () => {
      seedSelfCareSource(queryClient)
      const response =
        createDeferred<
          Awaited<ReturnType<SelfCareApiClient['executeOfflineCommand']>>
        >()
      let request: SelfCareOfflineCommandRequest | undefined
      let requestReleased = false
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        (input) => {
          request = input
          return response.promise
        },
      )
      const mutation = renderHook(() => useCompleteSelfCareOccurrence(), {
        wrapper: createQueryWrapper(queryClient),
      })
      const variables = {
        input: createRitualCompletionInput('Готово'),
        occurrenceId: OCCURRENCE_ID,
      }
      let first!: Promise<SelfCareCompletion>
      let duplicate!: Promise<SelfCareCompletion>

      act(() => {
        first = mutation.result.current.mutateAsync(variables)
        duplicate = mutation.result.current.mutateAsync({
          input: { ...variables.input },
          occurrenceId: variables.occurrenceId,
        })
      })

      await act(async () => {
        const results = await Promise.all([first, duplicate])
        expect(results[0]?.id).toBe(results[1]?.id)
      })
      expect(requestReleased).toBe(false)
      await waitFor(() => {
        expect(selfCareApi.executeOfflineCommand).toHaveBeenCalledOnce()
      })
      const [queued] = await listSelfCareOfflineMutations(
        WORKSPACE_ID,
        ACTOR_USER_ID,
      )
      expect(queued).toBeDefined()

      requestReleased = true
      response.resolve({
        operationId: request!.operationId,
        replayed: false,
        result: queued!.optimisticResult,
      })
      await waitFor(async () => {
        expect(
          await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
        ).toEqual([])
      })
    })
  })

  describe('outbox lifecycle and reconciliation', () => {
    it('downgrades queue capability after a write failure and falls back to the API while online', async () => {
      const queue = renderHook(() => useSelfCareOfflineQueue(), {
        wrapper: createQueryWrapper(queryClient),
      })
      await waitFor(() => {
        expect(queue.result.current.canQueueWrites).toBe(true)
      })

      seedSelfCareSource(queryClient)
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        (request) =>
          Promise.resolve({
            operationId: request.operationId,
            replayed: false,
            result: createSettingsResult('USD', 6),
          }),
      )
      const putSpy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(() => {
          throw new DOMException('Quota exhausted', 'QuotaExceededError')
        })

      try {
        const mutation = renderHook(() => useUpdateSelfCareSettings(), {
          wrapper: createQueryWrapper(queryClient),
        })
        await act(async () => {
          await expect(
            mutation.result.current.mutateAsync({ currency: 'USD' }),
          ).resolves.toMatchObject({
            settings: { currency: 'USD', version: 6 },
          })
        })
      } finally {
        putSpy.mockRestore()
      }

      await waitFor(() => {
        expect(queue.result.current.canQueueWrites).toBe(false)
      })
      expect(getSelfCareOfflineStorageHealth()).toBe('failed')
      expect(selfCareApi.executeOfflineCommand).toHaveBeenCalledTimes(1)
      expect(
        await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).toEqual([])
    })

    it('marks an injected IndexedDB open failure as unavailable', async () => {
      await resetSelfCareOfflineDatabaseForTests()
      browserOnline = false
      const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        throw new DOMException('Storage denied', 'SecurityError')
      })

      try {
        expect(getSelfCareOfflineStorageHealth()).toBe('unknown')
        const queue = renderHook(() => useSelfCareOfflineQueue(), {
          wrapper: createQueryWrapper(queryClient),
        })

        expect(queue.result.current.canQueueWrites).toBe(false)
        await waitFor(() => {
          expect(getSelfCareOfflineStorageHealth()).toBe('failed')
          expect(queue.result.current.canQueueWrites).toBe(false)
        })
      } finally {
        openSpy.mockRestore()
      }
    })

    it('does not expose queue counts from the previous actor while a new scope loads', async () => {
      browserOnline = false
      await enqueueSelfCareOfflineMutation({
        actorUserId: ACTOR_USER_ID,
        command: {
          expectedVersion: 5,
          input: { currency: 'USD' },
          type: 'update_settings',
        },
        occurredAt: '2026-06-18T08:00:00.000Z',
        operationId: generateUuidV7(),
        optimisticResult: createSettingsResult('USD', 6),
        workspaceId: WORKSPACE_ID,
      })
      const queue = renderHook(() => useSelfCareOfflineQueue(), {
        wrapper: createQueryWrapper(queryClient),
      })
      await waitFor(() => {
        expect(queue.result.current.total).toBe(1)
      })

      const nextActorUserId = 'user-2'
      const nextWorkspaceId = 'workspace-2'
      const currentSession = createPersonalSession()
      mocks.useSessionFeatureReadiness.mockReturnValue(
        createReadinessStub({
          apiConfig: {
            accessToken: 'access-token',
            actorUserId: nextActorUserId,
            apiBaseUrl: 'https://api.chaotika.test',
            clientTimeZone: CLIENT_TIME_ZONE,
            workspaceId: nextWorkspaceId,
          },
          session: createPersonalSession({
            actor: {
              ...currentSession.actor,
              email: 'user-2@example.test',
              id: nextActorUserId,
            },
            actorUserId: nextActorUserId,
            workspace: {
              ...currentSession.workspace,
              id: nextWorkspaceId,
              slug: 'personal-user-2',
            },
            workspaceId: nextWorkspaceId,
          }),
          workspaceId: nextWorkspaceId,
        }),
      )
      queue.rerender()

      expect(queue.result.current.total).toBe(0)
      await waitFor(() => {
        expect(queue.result.current.pending).toBe(0)
        expect(queue.result.current.total).toBe(0)
      })
    })

    it('waits for an unknown storage probe and durably enqueues before the first online POST', async () => {
      await resetSelfCareOfflineDatabaseForTests()
      seedSelfCareSource(queryClient)
      const probeTransaction = deferNextDexieTransaction()
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        async (request) => {
          expect(getSelfCareOfflineStorageHealth()).toBe('ready')
          await expect(
            listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
          ).resolves.toEqual([
            expect.objectContaining({
              operationId: request.operationId,
              status: 'syncing',
            }),
          ])
          return {
            operationId: request.operationId,
            replayed: false,
            result: createSettingsResult('USD', 6),
          }
        },
      )
      const mutation = renderHook(() => useUpdateSelfCareSettings(), {
        wrapper: createQueryWrapper(queryClient),
      })
      let pendingMutation!: Promise<SelfCareSettingsResponse>

      try {
        act(() => {
          pendingMutation = mutation.result.current.mutateAsync({
            currency: 'USD',
          })
        })
        await probeTransaction.entered

        expect(getSelfCareOfflineStorageHealth()).toBe('unknown')
        expect(selfCareApi.executeOfflineCommand).not.toHaveBeenCalled()
        probeTransaction.release()
        await act(async () => {
          await expect(pendingMutation).resolves.toMatchObject({
            settings: { currency: 'USD', version: 6 },
          })
        })
      } finally {
        probeTransaction.restore()
      }
    })

    it('keeps a concurrent storage failure terminal after a deferred probe completes', async () => {
      await resetSelfCareOfflineDatabaseForTests()
      const probeTransaction = deferNextDexieTransaction()
      const queue = renderHook(() => useSelfCareOfflineQueue(), {
        wrapper: createQueryWrapper(queryClient),
      })

      try {
        await probeTransaction.entered
        act(() => {
          reportSelfCareOfflineStorageFailure(
            new DOMException('Quota exhausted', 'QuotaExceededError'),
          )
        })
        probeTransaction.release()

        await waitFor(() => {
          expect(getSelfCareOfflineStorageHealth()).toBe('failed')
          expect(queue.result.current.canQueueWrites).toBe(false)
        })
      } finally {
        probeTransaction.restore()
      }
    })

    it('does not re-enqueue a command into the generation created by concurrent cleanup', async () => {
      seedSelfCareSource(queryClient)
      const originalGet = Object.getOwnPropertyDescriptor(
        IDBObjectStore.prototype,
        'get',
      )?.value as IDBObjectStore['get']
      const cleanup = { promise: null as Promise<void> | null }
      const getSpy = vi
        .spyOn(IDBObjectStore.prototype, 'get')
        .mockImplementation(function (this: IDBObjectStore, query) {
          cleanup.promise ??= clearSelfCareOfflineWorkspaceData(WORKSPACE_ID)
          return originalGet.call(this, query)
        })
      const mutation = renderHook(() => useUpdateSelfCareSettings(), {
        wrapper: createQueryWrapper(queryClient),
      })

      try {
        await act(async () => {
          await expect(
            mutation.result.current.mutateAsync({ currency: 'USD' }),
          ).rejects.toBeInstanceOf(SelfCareApiUnavailableError)
        })
        if (!cleanup.promise) {
          throw new Error('Expected cleanup to start during cache preparation.')
        }
        await cleanup.promise
      } finally {
        getSpy.mockRestore()
      }

      expect(selfCareApi.executeOfflineCommand).not.toHaveBeenCalled()
      await expect(
        listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).resolves.toEqual([])
    })

    it('durably enqueues before POST and reconciles the authoritative response', async () => {
      seedSelfCareSource(queryClient)
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        async (request) => {
          const queued = await listSelfCareOfflineMutations(
            WORKSPACE_ID,
            ACTOR_USER_ID,
          )
          expect(queued).toHaveLength(1)
          expect(queued[0]).toMatchObject({
            operationId: request.operationId,
            status: 'syncing',
          })

          return {
            operationId: request.operationId,
            replayed: false,
            result: createSettingsResult('USD', 6),
          }
        },
      )

      const mutation = renderHook(() => useUpdateSelfCareSettings(), {
        wrapper: createQueryWrapper(queryClient),
      })
      await act(async () => {
        await expect(
          mutation.result.current.mutateAsync({ currency: 'USD' }),
        ).resolves.toMatchObject({ settings: { currency: 'USD', version: 6 } })
      })

      await waitFor(() => {
        expect(selfCareApi.executeOfflineCommand).toHaveBeenCalledWith(
          expect.objectContaining({ clientTimeZone: CLIENT_TIME_ZONE }),
        )
      })
      await waitFor(async () => {
        expect(
          await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
        ).toEqual([])
      })
      expect(
        queryClient.getQueryData<SelfCareSettingsResponse>(
          selfCareSettingsQueryKey(OWNER_ID),
        )?.settings,
      ).toMatchObject({ currency: 'USD', version: 6 })
      const cached = await loadCachedSelfCareRead<SelfCareSettingsResponse>(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        createSelfCareCacheKey('settings'),
      )
      expect(cached?.data.settings).toMatchObject({
        currency: 'USD',
        version: 6,
      })
    })

    it('uses the same operation id after a lost response and aliases dependent completion edits', async () => {
      seedSelfCareSource(queryClient)
      const requests: SelfCareOfflineCommandRequest[] = []
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        (request) => {
          requests.push(request)
          return Promise.reject(new TypeError('Failed to fetch'))
        },
      )
      const hooks = renderHook(
        () => ({
          complete: useCompleteSelfCareOccurrence(),
          queue: useSelfCareOfflineQueue(),
          update: useUpdateSelfCareCompletion(),
        }),
        { wrapper: createQueryWrapper(queryClient) },
      )

      let optimisticCompletion: SelfCareCompletion | undefined
      await act(async () => {
        optimisticCompletion = await hooks.result.current.complete.mutateAsync({
          input: createRitualCompletionInput('Локальная запись'),
          occurrenceId: OCCURRENCE_ID,
        })
      })
      await waitFor(() => {
        expect(requests).toHaveLength(1)
      })
      await waitFor(async () => {
        expect(
          await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
        ).toEqual([expect.objectContaining({ status: 'failed' })])
      })
      const firstOperationId = requests[0]!.operationId

      browserOnline = false
      await act(async () => {
        await hooks.result.current.update.mutateAsync({
          completionId: optimisticCompletion!.id,
          input: { note: 'Уточнённая запись' },
        })
      })

      const queuedBeforeRetry = await listSelfCareOfflineMutations(
        WORKSPACE_ID,
        ACTOR_USER_ID,
      )
      expect(queuedBeforeRetry).toHaveLength(2)
      expect(queuedBeforeRetry[1]?.dependsOn).toEqual([
        queuedBeforeRetry[0]!.id,
      ])

      browserOnline = true
      const canonicalCompletion = createCompletion({
        id: 'canonical-completion-1',
        note: 'Локальная запись',
        occurrenceId: OCCURRENCE_ID,
        status: 'done',
        version: 1,
      })
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        (request) => {
          requests.push(request)

          if (request.command.type === 'complete_occurrence') {
            return Promise.resolve({
              operationId: request.operationId,
              replayed: true,
              result: {
                completion: canonicalCompletion,
                kind: 'completion',
              },
            })
          }

          expect(request.command).toEqual({
            completionId: canonicalCompletion.id,
            expectedVersion: 1,
            input: { note: 'Уточнённая запись' },
            type: 'update_completion',
          })
          return Promise.resolve({
            operationId: request.operationId,
            replayed: false,
            result: {
              completion: {
                ...canonicalCompletion,
                note: 'Уточнённая запись',
                version: 2,
              },
              kind: 'completion',
            },
          })
        },
      )

      await act(async () => {
        await hooks.result.current.queue.retry()
      })

      expect(requests[1]?.operationId).toBe(firstOperationId)
      expect(requests[2]?.command.type).toBe('update_completion')
      expect(
        await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).toEqual([])
      const reconciledCompletions =
        queryClient.getQueryData<SelfCareHistoryResponse>(
          selfCareHistoryQueryKey(OWNER_ID, '2026-06-01', '2026-06-30'),
        )?.completions
      expect(reconciledCompletions).toHaveLength(2)
      expect(
        reconciledCompletions?.find(
          (completion) => completion.id === canonicalCompletion.id,
        ),
      ).toMatchObject({
        note: 'Уточнённая запись',
        version: 2,
      })
      expect(
        reconciledCompletions?.some(
          (completion) => completion.id === optimisticCompletion!.id,
        ),
      ).toBe(false)
    })

    it('falls back to the command endpoint online when IndexedDB is unavailable', async () => {
      seedSelfCareSource(queryClient)
      const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'indexedDB',
      )
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: undefined,
      })
      vi.mocked(selfCareApi.executeOfflineCommand).mockImplementation(
        (request) =>
          Promise.resolve({
            operationId: request.operationId,
            replayed: false,
            result: createSettingsResult('USD', 6),
          }),
      )

      try {
        const mutation = renderHook(() => useUpdateSelfCareSettings(), {
          wrapper: createQueryWrapper(queryClient),
        })
        await act(async () => {
          await mutation.result.current.mutateAsync({ currency: 'USD' })
        })
      } finally {
        if (descriptor) {
          Object.defineProperty(globalThis, 'indexedDB', descriptor)
        }
      }

      expect(selfCareApi.executeOfflineCommand).toHaveBeenCalledTimes(1)
      const directRequest = vi.mocked(selfCareApi.executeOfflineCommand).mock
        .calls[0]?.[0]
      expect(directRequest?.clientTimeZone).toBe(CLIENT_TIME_ZONE)
      expect(directRequest?.command.type).toBe('update_settings')
      expect(
        await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).toEqual([])
    })

    it('keeps same-slot scheduling and a queued item edit in one dependency chain without a false move', async () => {
      browserOnline = false
      seedSelfCareSource(queryClient)

      await runMutation(queryClient, useScheduleSelfCareItem, {
        existingOccurrenceId: OCCURRENCE_ID,
        input: createScheduleInput({ note: 'Новый кабинет' }),
        itemId: ITEM_ID,
      })
      await runMutation(queryClient, useUpdateSelfCareItem, {
        input: { title: 'Обновлённая забота' },
        itemId: ITEM_ID,
      })

      const queue = await listSelfCareOfflineMutations(
        WORKSPACE_ID,
        ACTOR_USER_ID,
      )
      expect(queue).toHaveLength(2)
      expect(queue[0]?.command).toMatchObject({
        existingOccurrenceId: OCCURRENCE_ID,
        expectedOccurrenceVersion: 4,
        expectedVersion: 7,
        type: 'schedule_item',
      })
      expect(queue[1]?.command).toMatchObject({
        expectedVersion: 7,
        type: 'update_item',
      })
      expect(queue[1]?.dependsOn).toEqual([queue[0]!.id])

      const projectedPlan = queryClient.getQueryData<SelfCarePlanResponse>(
        selfCarePlanQueryKey(OWNER_ID, DATE, '2026-07-03'),
      )
      expect(projectedPlan?.occurrences[0]?.occurrence).toMatchObject({
        id: OCCURRENCE_ID,
        movedTo: null,
        status: 'scheduled',
        version: 5,
      })
      expect(
        queryClient.getQueryData<SelfCareHistoryResponse>(
          selfCareHistoryQueryKey(OWNER_ID, '2026-06-01', '2026-06-30'),
        )?.completions,
      ).toEqual([expect.objectContaining({ id: COMPLETION_ID })])
    })

    it('rebases conflicts for retry and lets the user discard a later conflict', async () => {
      seedSelfCareSource(queryClient)
      const conflict = new SelfCareApiError('Конфликт версии', {
        code: 'self_care_version_conflict',
        details: {
          actualVersion: 6,
          entityId: 'settings-1',
          entityType: 'settings',
          expectedVersion: 5,
        },
        status: 409,
      })
      vi.mocked(selfCareApi.executeOfflineCommand)
        .mockRejectedValueOnce(conflict)
        .mockImplementationOnce((request) =>
          Promise.resolve({
            operationId: request.operationId,
            replayed: false,
            result: createSettingsResult('USD', 6),
          }),
        )
        .mockRejectedValueOnce(conflict)
      const hooks = renderHook(
        () => ({
          mutation: useUpdateSelfCareSettings(),
          queue: useSelfCareOfflineQueue(),
        }),
        { wrapper: createQueryWrapper(queryClient) },
      )

      await act(async () => {
        await expect(
          hooks.result.current.mutation.mutateAsync({ currency: 'USD' }),
        ).resolves.toMatchObject({ settings: { currency: 'USD' } })
      })
      await waitFor(() => {
        expect(hooks.result.current.queue.conflicted).toBe(1)
      })

      await act(async () => {
        await hooks.result.current.queue.refreshAndRetryConflicts()
      })
      await waitFor(() => {
        expect(hooks.result.current.queue.total).toBe(0)
      })
      expect(
        queryClient.getQueryData<SelfCareSettingsResponse>(
          selfCareSettingsQueryKey(OWNER_ID),
        )?.settings.currency,
      ).toBe('USD')

      await act(async () => {
        await expect(
          hooks.result.current.mutation.mutateAsync({ currency: 'EUR' }),
        ).resolves.toMatchObject({ settings: { currency: 'EUR' } })
      })
      await waitFor(() => {
        expect(hooks.result.current.queue.conflicted).toBe(1)
      })
      await act(async () => {
        await hooks.result.current.queue.discardConflicts()
      })
      expect(
        await listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).toEqual([])
      expect(
        queryClient.getQueryData<SelfCareSettingsResponse>(
          selfCareSettingsQueryKey(OWNER_ID),
        )?.settings.currency,
      ).toBe('USD')
    })
  })

  it('uses neutral localized copy for a transport failure', () => {
    expect(getSelfCareErrorMessage(new TypeError('Failed to fetch'))).toBe(
      SELF_CARE_NETWORK_ERROR_MESSAGE,
    )
  })
})

interface CommandScenario {
  assert: (command: SelfCareOfflineCommand) => void
  name: string
  run: (queryClient: QueryClient) => Promise<void>
}

function createCommandScenarios(): CommandScenario[] {
  return [
    {
      name: 'queues atomic custom create plus its initial schedule',
      run: (client) =>
        runMutation(client, useCreateSelfCareItem, {
          input: createItemInput(),
          scheduleInput: createScheduleInput(),
        }),
      assert: (command) => {
        expectExactKeys(command, ['initialSchedule', 'input', 'type'])
        expect(command.type).toBe('create_item')
        if (command.type !== 'create_item') return
        expect(command.input).toMatchObject({
          category: 'health',
          title: 'Вода',
          type: 'habit',
        })
        expect(command.input.id).toMatch(UUID_V7_PATTERN)
        expect(command.input.steps[0]?.id).toMatch(UUID_V7_PATTERN)
        expect(command.input.alternatives[0]?.id).toMatch(UUID_V7_PATTERN)
        expect(command.initialSchedule?.occurrenceId).toMatch(UUID_V7_PATTERN)
        expect(command.initialSchedule?.input).toEqual(createScheduleInput())
      },
    },
    {
      name: 'queues atomic template create plus its initial schedule',
      run: (client) =>
        runMutation(client, useCreateSelfCareItemFromTemplate, {
          input: { overrides: { title: 'Из шаблона' } },
          scheduleInput: createScheduleInput(),
          templateId: 'template-1',
        }),
      assert: (command) => {
        expectExactKeys(command, [
          'initialSchedule',
          'itemId',
          'overrides',
          'templateId',
          'type',
        ])
        expect(command.type).toBe('create_item_from_template')
        if (command.type !== 'create_item_from_template') return
        expect(command.itemId).toMatch(UUID_V7_PATTERN)
        expect(command.templateId).toBe('template-1')
        expect(command.overrides.title).toBe('Из шаблона')
        expect(command.overrides.steps?.[0]?.id).toMatch(UUID_V7_PATTERN)
        expect(command.initialSchedule?.occurrenceId).toMatch(UUID_V7_PATTERN)
      },
    },
    {
      name: 'queues atomic item and same-slot schedule update',
      run: (client) =>
        runMutation(client, useUpdateSelfCareItem, {
          entry: createEntry(),
          input: { title: 'Обновлённая забота' },
          itemId: ITEM_ID,
          scheduleInput: createScheduleInput({ note: 'Новый кабинет' }),
        }),
      assert: (command) => {
        expectExactKeys(command, [
          'expectedVersion',
          'input',
          'itemId',
          'scheduleChange',
          'type',
        ])
        expect(command).toMatchObject({
          expectedVersion: 7,
          input: { title: 'Обновлённая забота' },
          itemId: ITEM_ID,
          scheduleChange: {
            expectedVersion: 4,
            occurrenceId: OCCURRENCE_ID,
            type: 'update_schedule',
          },
          type: 'update_item',
        })
      },
    },
    {
      name: 'queues archive with the authoritative item version',
      run: (client) => runMutation(client, useArchiveSelfCareItem, ITEM_ID),
      assert: (command) => {
        expect(command).toEqual({
          expectedVersion: 7,
          itemId: ITEM_ID,
          type: 'archive_item',
        })
      },
    },
    {
      name: 'queues a new occurrence with a stable client id',
      run: (client) =>
        runMutation(client, useScheduleSelfCareItem, {
          input: createScheduleInput({ scheduledFor: '2026-06-20' }),
          itemId: ITEM_ID,
        }),
      assert: (command) => {
        expectExactKeys(command, [
          'expectedVersion',
          'input',
          'itemId',
          'occurrenceId',
          'type',
        ])
        expect(command).toMatchObject({
          expectedVersion: 7,
          itemId: ITEM_ID,
          type: 'schedule_item',
        })
        if (command.type === 'schedule_item') {
          expect(command.occurrenceId).toMatch(UUID_V7_PATTERN)
        }
      },
    },
    {
      name: 'queues an atomic move plus replacement occurrence',
      run: (client) =>
        runMutation(client, useMoveSelfCareOccurrence, {
          input: { newDate: '2026-06-21', note: 'Перенос' },
          occurrenceId: OCCURRENCE_ID,
          replacementInput: createScheduleInput({
            scheduledFor: '2026-06-21',
          }),
        }),
      assert: (command) => {
        expectExactKeys(command, [
          'actedAt',
          'completionId',
          'expectedVersion',
          'input',
          'occurrenceId',
          'replacementInput',
          'replacementOccurrenceId',
          'type',
        ])
        expect(command).toMatchObject({
          expectedVersion: 4,
          occurrenceId: OCCURRENCE_ID,
          type: 'move_occurrence',
        })
        if (command.type === 'move_occurrence') {
          expect(command.actedAt).toMatch(/Z$/)
          expect(command.completionId).toMatch(UUID_V7_PATTERN)
          expect(command.replacementOccurrenceId).toMatch(UUID_V7_PATTERN)
        }
      },
    },
    {
      name: 'queues occurrence cancellation',
      run: (client) =>
        runMutation(client, useCancelSelfCareOccurrence, OCCURRENCE_ID),
      assert: (command) => {
        expectExactKeys(command, [
          'actedAt',
          'completionId',
          'expectedVersion',
          'occurrenceId',
          'type',
        ])
        expect(command).toMatchObject({
          expectedVersion: 4,
          occurrenceId: OCCURRENCE_ID,
          type: 'cancel_occurrence',
        })
      },
    },
    {
      name: 'queues occurrence skip',
      run: (client) =>
        runMutation(client, useSkipSelfCareOccurrence, {
          input: { reason: 'Сегодня не подходит' },
          occurrenceId: OCCURRENCE_ID,
        }),
      assert: (command) => {
        expect(command).toMatchObject({
          expectedVersion: 4,
          input: { reason: 'Сегодня не подходит' },
          occurrenceId: OCCURRENCE_ID,
          type: 'skip_occurrence',
        })
      },
    },
    {
      name: 'queues scheduled occurrence completion',
      run: (client) =>
        runMutation(client, useCompleteSelfCareOccurrence, {
          input: createRitualCompletionInput('Готово'),
          occurrenceId: OCCURRENCE_ID,
        }),
      assert: (command) => {
        expect(command).toMatchObject({
          expectedVersion: 4,
          input: { note: 'Готово' },
          occurrenceId: OCCURRENCE_ID,
          type: 'complete_occurrence',
        })
        if (command.type === 'complete_occurrence') {
          expect(command.completionId).toMatch(UUID_V7_PATTERN)
          expect(command.input.completedAt).toMatch(/Z$/)
        }
      },
    },
    {
      name: 'queues immediate item completion',
      run: (client) =>
        runMutation(client, useCompleteSelfCareItemNow, {
          input: createRitualCompletionInput('Сделано сейчас'),
          itemId: ITEM_ID,
        }),
      assert: (command) => {
        expect(command).toMatchObject({
          expectedVersion: 7,
          input: { note: 'Сделано сейчас' },
          itemId: ITEM_ID,
          type: 'complete_item_now',
        })
      },
    },
    {
      name: 'queues flexible goal completion',
      run: (client) =>
        runMutation(client, useCompleteSelfCareFlexibleGoal, {
          input: createCompletionInput('Один раз'),
          itemId: ITEM_ID,
        }),
      assert: (command) => {
        expect(command).toMatchObject({
          expectedVersion: 7,
          input: { note: 'Один раз' },
          itemId: ITEM_ID,
          type: 'complete_flexible_goal',
        })
      },
    },
    {
      name: 'queues course session completion',
      run: (client) =>
        runMutation(client, useCompleteSelfCareCourseSession, {
          input: createCompletionInput('Сеанс'),
          itemId: ITEM_ID,
        }),
      assert: (command) => {
        expect(command).toMatchObject({
          expectedVersion: 7,
          input: { note: 'Сеанс' },
          itemId: ITEM_ID,
          type: 'complete_course_session',
        })
      },
    },
    {
      name: 'queues completion edit with its version',
      run: (client) =>
        runMutation(client, useUpdateSelfCareCompletion, {
          completionId: COMPLETION_ID,
          input: { note: 'Исправлено' },
        }),
      assert: (command) => {
        expect(command).toEqual({
          completionId: COMPLETION_ID,
          expectedVersion: 3,
          input: { note: 'Исправлено' },
          type: 'update_completion',
        })
      },
    },
    {
      name: 'queues settings update with its version',
      run: (client) =>
        runMutation(client, useUpdateSelfCareSettings, {
          currency: 'USD',
          showAppointmentsInCalendar: false,
        }),
      assert: (command) => {
        expect(command).toEqual({
          expectedVersion: 5,
          input: {
            currency: 'USD',
            showAppointmentsInCalendar: false,
          },
          type: 'update_settings',
        })
      },
    },
    {
      name: 'queues ritual draft upsert with its version',
      run: (client) =>
        runMutation(client, useUpsertSelfCareRitualStepDraft, {
          date: DATE,
          itemId: ITEM_ID,
          occurrenceId: OCCURRENCE_ID,
          stepIds: ['step-1', 'step-1'],
        }),
      assert: (command) => {
        expect(command).toEqual({
          expectedVersion: 2,
          input: {
            date: DATE,
            itemId: ITEM_ID,
            occurrenceId: OCCURRENCE_ID,
            stepIds: ['step-1'],
          },
          type: 'upsert_ritual_step_draft',
        })
      },
    },
  ]
}

async function runMutation<TVariables>(
  queryClient: QueryClient,
  useHook: () => {
    mutateAsync: (variables: TVariables) => Promise<unknown>
  },
  variables: TVariables,
): Promise<void> {
  const rendered = renderHook(() => useHook(), {
    wrapper: createQueryWrapper(queryClient),
  })
  await act(async () => {
    await rendered.result.current.mutateAsync(variables)
  })
  rendered.unmount()
}

function expectExactKeys(value: object, expectedKeys: readonly string[]): void {
  expect(Object.keys(value).sort()).toEqual([...expectedKeys].sort())
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
}

function createQueryWrapper(queryClient: QueryClient) {
  return function TestQueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

function createReadinessStub(
  overrides: Partial<SessionFeatureReadinessStub> = {},
): SessionFeatureReadinessStub {
  return {
    apiConfig: {
      accessToken: 'access-token',
      actorUserId: ACTOR_USER_ID,
      apiBaseUrl: 'https://api.chaotika.test',
      clientTimeZone: CLIENT_TIME_ZONE,
      workspaceId: WORKSPACE_ID,
    },
    isApiEnabled: true,
    readiness: { canWriteProtectedData: true },
    session: createPersonalSession(),
    workspaceId: WORKSPACE_ID,
    ...overrides,
  }
}

function createPersonalSession(
  overrides: Partial<SessionResponse> = {},
): SessionResponse {
  return {
    actor: {
      avatarUrl: null,
      displayName: 'User One',
      email: 'user-1@example.test',
      id: ACTOR_USER_ID,
    },
    actorUserId: ACTOR_USER_ID,
    appRole: 'user',
    groupRole: null,
    role: 'owner',
    source: 'access_token',
    userPreferences: {
      calendarViewMode: 'week',
      defaultTimeZone: null,
      energyMode: 'normal',
      lastSeenTimeZone: null,
      timeZoneMode: 'device',
      voiceAssistantEnabled: true,
    },
    workspace: {
      id: WORKSPACE_ID,
      kind: 'personal',
      name: 'Personal',
      slug: 'personal-user-1',
    },
    workspaceId: WORKSPACE_ID,
    workspaceSettings: {
      defaultTimeZone: null,
      taskCompletionConfettiEnabled: true,
      wakeWordTrainingModeEnabled: false,
    },
    workspaces: [],
    ...overrides,
  }
}

function seedSelfCareSource(queryClient: QueryClient): void {
  const list = createList()
  const dashboard = createDashboard()
  const entry = createEntry()
  const settings: SelfCareSettingsResponse = {
    minimumItems: [],
    settings: createSettings(),
  }
  const drafts: SelfCareRitualStepDraftListResponse = {
    date: DATE,
    drafts: [
      {
        date: DATE,
        itemId: ITEM_ID,
        occurrenceId: OCCURRENCE_ID,
        stepIds: ['step-1'],
        version: 2,
      },
    ],
  }
  const template: SelfCareTemplate = {
    category: 'health',
    color: null,
    createdAt: '2026-06-01T08:00:00.000Z',
    defaultSchedule: null,
    defaultSteps: ['Шаг шаблона'],
    description: '',
    icon: null,
    id: 'template-1',
    importance: 'recommended',
    isSystem: true,
    title: 'Шаблон',
    type: 'habit',
    updatedAt: '2026-06-01T08:00:00.000Z',
  }

  queryClient.setQueryData(selfCareItemsQueryKey(OWNER_ID), list)
  queryClient.setQueryData(selfCareDashboardQueryKey(OWNER_ID, DATE), dashboard)
  queryClient.setQueryData(
    selfCarePlanQueryKey(OWNER_ID, DATE, '2026-07-03'),
    createPlan([entry]),
  )
  queryClient.setQueryData(
    selfCareHistoryQueryKey(OWNER_ID, '2026-06-01', '2026-06-30'),
    createHistory(),
  )
  queryClient.setQueryData(selfCareSettingsQueryKey(OWNER_ID), settings)
  queryClient.setQueryData(
    selfCareRitualStepDraftsQueryKey(OWNER_ID, DATE),
    drafts,
  )
  queryClient.setQueryData(selfCareTemplatesQueryKey(OWNER_ID), [template])
}

function createItemInput(): SelfCareItemInput {
  return {
    alternatives: [
      {
        countsAsCompletion: true,
        description: '',
        title: 'Стакан чая',
      },
    ],
    category: 'health',
    color: null,
    customCategoryId: null,
    defaultDurationMinutes: null,
    description: '',
    icon: null,
    importance: 'recommended',
    isActive: true,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: null,
    preferredTimeOfDay: 'morning',
    steps: [
      {
        defaultChecked: false,
        isOptional: false,
        order: 0,
        title: 'Налить воду',
      },
    ],
    title: 'Вода',
    type: 'habit',
  }
}

function createScheduleInput(
  overrides: Partial<SelfCareItemScheduleInput> = {},
): SelfCareItemScheduleInput {
  return {
    currency: 'RUB',
    note: '',
    place: 'Клиника',
    price: 2500,
    reminderOffsetsMinutes: [60],
    scheduledFor: DATE,
    scheduledTime: '10:00',
    specialistContact: null,
    specialistName: 'Анна',
    timezone: CLIENT_TIME_ZONE,
    ...overrides,
  }
}

function createCompletionInput(note: string): SelfCareCompletionInput {
  return {
    alternativeTitle: null,
    completedVariant: 'full',
    currency: null,
    durationMinutes: null,
    energyAfter: null,
    energyBefore: null,
    exerciseSets: [],
    measurementUnit: null,
    measurementValue: null,
    moodAfter: null,
    moodBefore: null,
    note,
    price: null,
    status: 'done',
  }
}

function createRitualCompletionInput(
  note: string,
): SelfCareRitualCompletionInput {
  return {
    ...createCompletionInput(note),
    steps: [],
  }
}

function createItem(overrides: Partial<SelfCareItem> = {}): SelfCareItem {
  return {
    category: 'health',
    color: null,
    createdAt: '2026-06-01T08:00:00.000Z',
    createdFromTemplateId: null,
    customCategoryId: null,
    defaultDurationMinutes: null,
    deletedAt: null,
    description: '',
    icon: null,
    id: ITEM_ID,
    importance: 'recommended',
    isActive: true,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: null,
    minimumVersionDescription: null,
    minimumVersionDurationMinutes: null,
    minimumVersionTitle: null,
    preferredTimeOfDay: 'morning',
    title: 'Вода',
    type: 'habit',
    updatedAt: '2026-06-17T08:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 7,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  }
}

function createOccurrence(
  overrides: Partial<SelfCareOccurrence> = {},
): SelfCareOccurrence {
  return {
    completedAt: null,
    createdAt: '2026-06-17T08:00:00.000Z',
    dueAt: '2026-06-18T06:00:00.000Z',
    generatedAt: '2026-06-17T08:00:00.000Z',
    id: OCCURRENCE_ID,
    itemId: ITEM_ID,
    movedTo: null,
    reminderOffsetsMinutes: [60],
    reminderTimeZone: CLIENT_TIME_ZONE,
    scheduledFor: DATE,
    scheduleRuleId: null,
    status: 'scheduled',
    updatedAt: '2026-06-17T08:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 4,
    ...overrides,
  }
}

function createCompletion(
  overrides: Partial<SelfCareCompletion> = {},
): SelfCareCompletion {
  return {
    alternativeTitle: null,
    completedAt: '2026-06-17T09:00:00.000Z',
    completedVariant: 'full',
    createdAt: '2026-06-17T09:00:00.000Z',
    currency: null,
    durationMinutes: null,
    energyAfter: null,
    energyBefore: null,
    exerciseSets: [],
    id: COMPLETION_ID,
    itemId: ITEM_ID,
    measurementUnit: null,
    measurementValue: null,
    moodAfter: null,
    moodBefore: null,
    note: 'Ранее',
    occurrenceId: null,
    price: null,
    scheduledFor: null,
    status: 'done',
    updatedAt: '2026-06-17T09:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 3,
    ...overrides,
  }
}

function createEntry(
  overrides: Partial<SelfCareTodayItem> = {},
): SelfCareTodayItem {
  return {
    appointment: null,
    completion: null,
    courseDetails: null,
    exercise: null,
    flexibleProgress: null,
    item: createItem(),
    lastExercise: null,
    lastMeasurement: null,
    measurement: null,
    occurrence: createOccurrence(),
    procedure: null,
    scheduleRule: null,
    steps: [
      {
        createdAt: '2026-06-01T08:00:00.000Z',
        defaultChecked: false,
        id: 'step-1',
        isOptional: false,
        itemId: ITEM_ID,
        order: 0,
        title: 'Шаг',
        updatedAt: '2026-06-01T08:00:00.000Z',
      },
    ],
    timeGroup: 'morning',
    ...overrides,
  }
}

function createList(): SelfCareListResponse {
  return {
    alternatives: [],
    appointmentDetails: [],
    courseDetails: [],
    exerciseDetails: [],
    items: [createItem()],
    medicalDetails: [],
    measurementDetails: [],
    procedureDetails: [],
    scheduleRules: [],
    steps: createEntry().steps,
  }
}

function createDashboard(): SelfCareDashboardResponse {
  return {
    dailyState: null,
    date: DATE,
    flexibleGoals: [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: [],
    planningHints: [],
    settings: createSettings(),
    todayItems: [createEntry()],
    upcomingImportant: [],
  }
}

function createPlan(entries: SelfCareTodayItem[]): SelfCarePlanResponse {
  return {
    courses: [],
    from: DATE,
    medical: [],
    occurrences: entries,
    planningHints: [],
    to: '2026-07-03',
  }
}

function createHistory(): SelfCareHistoryResponse {
  return {
    appointmentDetails: [],
    completions: [createCompletion()],
    items: [createItem()],
    procedureDetails: [],
    stepCompletions: [],
  }
}

function createSettings(
  overrides: Partial<SelfCareSettings> = {},
): SelfCareSettings {
  return {
    createdAt: '2026-06-01T08:00:00.000Z',
    currency: 'RUB',
    defaultReminderTone: 'soft',
    gentleModeDate: null,
    gentleModeEnabledToday: false,
    id: 'settings-1',
    quietHoursEnd: null,
    quietHoursStart: null,
    showAppointmentsInCalendar: true,
    showSelfCareInMainTasks: true,
    updatedAt: '2026-06-17T08:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 5,
    ...overrides,
  }
}

function createSettingsResult(
  currency: string,
  version: number,
): Extract<SelfCareOfflineCommandResult, { kind: 'settings' }> {
  return {
    kind: 'settings',
    value: {
      minimumItems: [],
      settings: createSettings({ currency, version }),
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

function deferNextDexieTransaction(): {
  entered: Promise<void>
  release: () => void
  restore: () => void
} {
  type DexieTransactionTarget = {
    transaction: (...arguments_: unknown[]) => Promise<unknown>
  }
  const target = Dexie.prototype as unknown as DexieTransactionTarget
  const originalTransaction = target.transaction
  let resolveEntered!: () => void
  let resolveRelease!: () => void
  const entered = new Promise<void>((resolve) => {
    resolveEntered = resolve
  })
  const release = new Promise<void>((resolve) => {
    resolveRelease = resolve
  })
  let deferred = false
  const transactionSpy = vi
    .spyOn(target, 'transaction')
    .mockImplementation(function (this: DexieTransactionTarget, ...arguments_) {
      if (deferred) {
        return originalTransaction.apply(this, arguments_)
      }

      deferred = true
      resolveEntered()
      return release.then(() => originalTransaction.apply(this, arguments_))
    })

  return {
    entered,
    release: resolveRelease,
    restore: () => transactionSpy.mockRestore(),
  }
}

function createSelfCareApi(): SelfCareApiClient {
  return {
    archiveItem: vi.fn(),
    cancelOccurrence: vi.fn(),
    completeCourseSession: vi.fn(),
    completeFlexibleGoal: vi.fn(),
    completeItemNow: vi.fn(),
    completeOccurrence: vi.fn(),
    createItem: vi.fn(),
    createItemFromTemplate: vi.fn(),
    deleteItem: vi.fn(),
    deleteRitualStepDraft: vi.fn(),
    disableGentleMode: vi.fn(),
    enableGentleMode: vi.fn(),
    executeOfflineCommand: vi.fn(),
    generateOccurrences: vi.fn(),
    getAnalytics: vi.fn(),
    getDailyState: vi.fn(),
    getDashboard: vi.fn(),
    getHistory: vi.fn(),
    getOccurrences: vi.fn(),
    getPlan: vi.fn(),
    getRitualStepDrafts: vi.fn(),
    getSettings: vi.fn(),
    listItems: vi.fn(),
    listTemplates: vi.fn(),
    moveOccurrence: vi.fn(),
    restoreItem: vi.fn(),
    scheduleItem: vi.fn(),
    skipOccurrence: vi.fn(),
    updateCompletion: vi.fn(),
    updateItem: vi.fn(),
    updateMinimumItems: vi.fn(),
    updateRitualSteps: vi.fn(),
    updateSettings: vi.fn(),
    upsertDailyState: vi.fn(),
    upsertRitualStepDraft: vi.fn(),
  }
}
