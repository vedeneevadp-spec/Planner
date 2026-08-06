import 'fake-indexeddb/auto'

import type {
  CleaningListResponse,
  CleaningTaskRecord,
  CleaningTodayResponse,
  CleaningZoneRecord,
  SessionResponse,
} from '@planner/contracts'
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import Dexie from 'dexie'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { useSessionFeatureReadiness } from '@/features/session'

type SessionFeatureReadinessResult = ReturnType<
  typeof useSessionFeatureReadiness
>

const mocks = vi.hoisted(() => ({
  usePlannerTimeZone: vi.fn<() => string>(),
  useSessionFeatureReadiness:
    vi.fn<(options?: { enabled?: boolean }) => SessionFeatureReadinessResult>(),
}))

vi.mock('@/features/session', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    usePlannerTimeZone: mocks.usePlannerTimeZone,
    useSessionFeatureReadiness: mocks.useSessionFeatureReadiness,
  }
})

import {
  listCleaningOfflineMutations,
  probeCleaningOfflineStorage,
  replaceCachedCleaningPlan,
  resetCleaningOfflineDatabaseForTests,
} from './offline-cleaning-store'
import {
  canSessionWriteCleaning,
  getCleaningErrorMessage,
  useCleaningPlan,
  useCleaningSummary,
  useCleaningToday,
  useCreateCleaningZone,
} from './useCleaning'

type TestDexieTransaction = (this: Dexie, ...args: unknown[]) => unknown
const testDexiePrototype = Dexie.prototype as unknown as {
  transaction: TestDexieTransaction
}

describe('useCleaning', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(async () => {
    await resetCleaningOfflineDatabaseForTests()
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    mocks.useSessionFeatureReadiness.mockImplementation((options) =>
      createFeatureReadinessResult({
        isApiEnabled: options?.enabled !== false,
      }),
    )
    mocks.usePlannerTimeZone.mockReturnValue('Europe/Astrakhan')
  })

  afterEach(() => {
    cleanup()
    onlineManager.setOnline(true)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mocks.usePlannerTimeZone.mockReset()
    mocks.useSessionFeatureReadiness.mockReset()
  })

  it('restores a successful plan read from persistent cache without calling the API', async () => {
    const plan = createCleaningPlan()
    fetchMock.mockResolvedValueOnce(jsonResponse(plan))

    const onlineHook = renderHook(() => useCleaningPlan(), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => {
      expect(onlineHook.result.current.data).toEqual(plan)
      expect(onlineHook.result.current.lastSuccessfulSyncAt).not.toBeNull()
    })
    onlineHook.unmount()

    mocks.useSessionFeatureReadiness.mockReturnValue(
      createFeatureReadinessResult({
        apiConfig: null,
        isApiEnabled: false,
        readiness: {
          canReadCachedData: true,
          canRenderAppContent: true,
          canUseProtectedApi: false,
          canWriteProtectedData: false,
          reason: 'planner_error',
          status: 'offlineWithCache',
        },
      }),
    )

    const cachedHook = renderHook(() => useCleaningPlan(), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => {
      expect(cachedHook.result.current.data).toEqual(plan)
      expect(cachedHook.result.current.lastSuccessfulSyncAt).not.toBeNull()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('explains that a first offline write needs a cached cleaning plan', async () => {
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createFeatureReadinessResult({
        apiConfig: null,
        isApiEnabled: false,
        readiness: {
          canReadCachedData: true,
          canRenderAppContent: true,
          canUseProtectedApi: false,
          canWriteProtectedData: false,
          reason: 'planner_error',
          status: 'offlineWithCache',
        },
      }),
    )

    const { result } = renderHook(() => useCreateCleaningZone(), {
      wrapper: createQueryWrapper(),
    })

    let thrown: unknown

    await act(async () => {
      try {
        await result.current.mutateAsync({
          dayOfWeek: 2,
          description: '',
          isActive: true,
          title: 'Ванная',
        })
      } catch (error) {
        thrown = error
      }
    })

    expect(getCleaningErrorMessage(thrown)).toContain(
      'сначала откройте этот раздел при подключении',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never leaves a write paused for automatic replay', async () => {
    onlineManager.setOnline(false)
    const zone = createCleaningZoneRecord()
    fetchMock.mockResolvedValueOnce(jsonResponse(zone))
    const { result } = renderHook(() => useCreateCleaningZone(), {
      wrapper: createQueryWrapper(),
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          dayOfWeek: 2,
          description: '',
          isActive: true,
          title: 'Ванная',
        }),
      ).resolves.toEqual(zone)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.isPaused).toBe(false)
  })

  it('does not reuse another date freshness when a cached day is missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createCleaningTodayResponse()))

    const { rerender, result } = renderHook(
      ({ date }) => useCleaningToday(date),
      {
        initialProps: { date: '2026-05-26' },
        wrapper: createQueryWrapper(),
      },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
      expect(result.current.lastSuccessfulSyncAt).not.toBeNull()
    })

    mocks.useSessionFeatureReadiness.mockReturnValue(
      createFeatureReadinessResult({
        apiConfig: null,
        isApiEnabled: false,
      }),
    )
    rerender({ date: '2026-05-27' })

    await waitFor(() => {
      expect(result.current.data).toBeUndefined()
      expect(result.current.lastSuccessfulSyncAt).toBeNull()
    })
  })

  it('loads the cleaning plan with protected session headers', async () => {
    const plan = createCleaningPlan()

    fetchMock.mockResolvedValueOnce(jsonResponse(plan))

    const { result } = renderHook(() => useCleaningPlan(), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual(plan)
    })

    const [url, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)

    expect(getRequestUrl(url)).toBe('https://api.chaotika.test/api/v1/cleaning')
    expect(headers.get('authorization')).toBe('Bearer access-token')
    expect(headers.get('x-workspace-id')).toBe('workspace-1')
  })

  it('does not call the API when session readiness disables the feature', () => {
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createFeatureReadinessResult({
        apiConfig: null,
        isApiEnabled: false,
      }),
    )

    const { result } = renderHook(() => useCleaningPlan(), {
      wrapper: createQueryWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { expected: true, groupRole: null, kind: 'personal', role: 'owner' },
    { expected: true, groupRole: null, kind: 'personal', role: 'user' },
    { expected: false, groupRole: null, kind: 'personal', role: 'guest' },
    { expected: true, groupRole: null, kind: 'shared', role: 'owner' },
    {
      expected: true,
      groupRole: 'group_admin',
      kind: 'shared',
      role: 'user',
    },
    {
      expected: true,
      groupRole: 'senior_member',
      kind: 'shared',
      role: 'user',
    },
    { expected: true, groupRole: 'member', kind: 'shared', role: 'user' },
    { expected: false, groupRole: null, kind: 'shared', role: 'guest' },
  ] as const)(
    'mirrors workspace write access for $kind $role/$groupRole',
    ({ expected, groupRole, kind, role }) => {
      const session = createSessionResponse()

      expect(
        canSessionWriteCleaning({
          ...session,
          groupRole,
          role,
          workspace: { ...session.workspace, kind },
        }),
      ).toBe(expected)
    },
  )

  it('creates a zone through the cleaning API and invalidates cleaning queries', async () => {
    const zone = createCleaningZoneRecord()

    fetchMock.mockResolvedValueOnce(jsonResponse(zone))

    const { queryClient, wrapper } = createQueryWrapperWithClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateCleaningZone(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          dayOfWeek: 2,
          description: '',
          isActive: true,
          title: 'Ванная',
        }),
      ).resolves.toEqual(zone)
    })

    const [url, init] = fetchMock.mock.calls[0]!
    const body = parseRequestBody<Record<string, unknown>>(init)

    expect(getRequestUrl(url)).toBe(
      'https://api.chaotika.test/api/v1/cleaning/zones',
    )
    expect(init?.method).toBe('POST')
    expect(body).toMatchObject({
      dayOfWeek: 2,
      description: '',
      isActive: true,
      title: 'Ванная',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['cleaning', 'workspace-1'],
    })
  })

  it('waits for the shared storage probe before the first online send', async () => {
    const zone = createCleaningZoneRecord()
    const probeStarted = createDeferred<void>()
    const releaseProbe = createDeferred<void>()
    const originalTransaction = testDexiePrototype.transaction
    vi.spyOn(testDexiePrototype, 'transaction').mockImplementationOnce(
      function (this: Dexie, ...args: unknown[]): unknown {
        probeStarted.resolve()
        return releaseProbe.promise.then(() =>
          callTestDexieTransaction(originalTransaction, this, args),
        )
      },
    )
    fetchMock.mockImplementation(async (_request, init) => {
      const queued = await listCleaningOfflineMutations('workspace-1', 'user-1')
      expect(queued).toHaveLength(1)
      expect(queued[0]?.status).toBe('syncing')
      const body = parseRequestBody<{ id: string }>(init)
      return jsonResponse({ ...zone, id: body.id })
    })
    const { queryClient, wrapper } = createQueryWrapperWithClient()
    queryClient.setQueryData(
      ['cleaning', 'workspace-1', 'user-1'],
      createCleaningPlan(),
    )
    const { result } = renderHook(() => useCreateCleaningZone(), { wrapper })
    let mutation!: Promise<CleaningZoneRecord>

    act(() => {
      mutation = result.current.mutateAsync({
        dayOfWeek: 2,
        description: '',
        isActive: true,
        title: 'Ванная',
      })
    })
    await probeStarted.promise
    expect(fetchMock).not.toHaveBeenCalled()

    releaseProbe.resolve()
    await act(async () => {
      await expect(mutation).resolves.toMatchObject({ title: zone.title })
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('falls back to one direct online request after an unpersisted enqueue failure', async () => {
    const zone = createCleaningZoneRecord()
    const plan = createCleaningPlan()
    await replaceCachedCleaningPlan(
      'workspace-1',
      'user-1',
      plan,
      '2026-05-26T00:00:00.000Z',
    )
    await expect(probeCleaningOfflineStorage()).resolves.toBe('ready')
    fetchMock.mockResolvedValueOnce(jsonResponse(zone))
    const { queryClient, wrapper } = createQueryWrapperWithClient()
    queryClient.setQueryData(['cleaning', 'workspace-1', 'user-1'], plan)
    const { result } = renderHook(() => useCreateCleaningZone(), { wrapper })
    const storageError = new Error('IndexedDB write failed')
    storageError.name = 'QuotaExceededError'
    const originalTransaction = testDexiePrototype.transaction
    let failedEnqueue = false
    const transactionSpy = vi
      .spyOn(testDexiePrototype, 'transaction')
      .mockImplementation(function (this: Dexie, ...args: unknown[]): unknown {
        const [mode, table] = args

        if (
          !failedEnqueue &&
          mode === 'rw' &&
          typeof table === 'object' &&
          table !== null &&
          'name' in table &&
          table.name === 'mutationQueue'
        ) {
          failedEnqueue = true
          throw storageError
        }

        return callTestDexieTransaction(originalTransaction, this, args)
      })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          dayOfWeek: 2,
          description: '',
          isActive: true,
          title: 'Ванная',
        }),
      ).resolves.toEqual(zone)
    })
    transactionSpy.mockRestore()

    expect(failedEnqueue).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0]!
    expect(new Headers(init?.headers).get('idempotency-key')).toMatch(
      /^[0-9a-f-]+$/,
    )
    await expect(
      listCleaningOfflineMutations('workspace-1', 'user-1'),
    ).resolves.toEqual([])
  })

  it('maps an empty today response to a zero summary', () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createCleaningTodayResponse()))

    const { result } = renderHook(() => useCleaningSummary('2026-05-26'), {
      wrapper: createQueryWrapper(),
    })

    expect(result.current.activeZoneCount).toBe(0)
    expect(result.current.dueCount).toBe(0)
    expect(result.current.urgentCount).toBe(0)
  })

  it('keeps the today summary idle when it is explicitly deferred', () => {
    const { result } = renderHook(
      () => useCleaningSummary('2026-05-26', { enabled: false }),
      { wrapper: createQueryWrapper() },
    )

    expect(result.current.isLoading).toBe(false)
    expect(mocks.useSessionFeatureReadiness).toHaveBeenCalledWith({
      enabled: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function createQueryWrapper() {
  return createQueryWrapperWithClient().wrapper
}

function createQueryWrapperWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })

  function TestQueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  return {
    queryClient,
    wrapper: TestQueryWrapper,
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
    },
    status: 200,
  })
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

function parseRequestBody<T>(init: RequestInit | undefined): T {
  const body = init?.body

  if (typeof body !== 'string') {
    throw new Error('Expected string request body.')
  }

  return JSON.parse(body) as T
}

function createFeatureReadinessResult(
  overrides: Partial<SessionFeatureReadinessResult> = {},
): SessionFeatureReadinessResult {
  const session = createSessionResponse()

  return {
    apiConfig: {
      accessToken: 'access-token',
      actorUserId: session.actorUserId,
      apiBaseUrl: 'https://api.chaotika.test',
      clientTimeZone: 'Europe/Astrakhan',
      workspaceId: session.workspaceId,
    },
    getReadiness: () => ({
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: true,
      canWriteProtectedData: true,
      reason: 'ready',
      status: 'ready',
    }),
    isApiEnabled: true,
    readiness: {
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: true,
      canWriteProtectedData: true,
      reason: 'ready',
      status: 'ready',
    },
    session,
    sessionQuery: {} as SessionFeatureReadinessResult['sessionQuery'],
    workspaceId: session.workspaceId,
    ...overrides,
  }
}

function createSessionResponse(): SessionResponse {
  return {
    actor: {
      avatarUrl: null,
      displayName: 'Planner User',
      email: 'user@example.test',
      id: 'user-1',
    },
    actorUserId: 'user-1',
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
      id: 'workspace-1',
      kind: 'personal',
      name: 'Planner Workspace',
      slug: 'planner-workspace',
    },
    workspaceId: 'workspace-1',
    workspaceSettings: {
      defaultTimeZone: null,
      taskCompletionConfettiEnabled: true,
      wakeWordTrainingModeEnabled: false,
    },
    workspaces: [
      {
        groupRole: null,
        id: 'workspace-1',
        kind: 'personal',
        name: 'Planner Workspace',
        role: 'owner',
        slug: 'planner-workspace',
      },
    ],
  }
}

function createCleaningPlan(): CleaningListResponse {
  return {
    history: [],
    states: [],
    tasks: [createCleaningTaskRecord()],
    zones: [createCleaningZoneRecord()],
  }
}

function createCleaningTodayResponse(): CleaningTodayResponse {
  return {
    accumulatedItems: [],
    date: '2026-05-26',
    dayOfWeek: 2,
    generalItems: [],
    history: [],
    items: [],
    quickItems: [],
    seasonalItems: [],
    summary: {
      accumulatedCount: 0,
      activeZoneCount: 0,
      completedTodayCount: 0,
      dueCount: 0,
      generalCount: 0,
      quickCount: 0,
      seasonalCount: 0,
      urgentCount: 0,
    },
    urgentItems: [],
    zones: [],
  }
}

function createCleaningZoneRecord(): CleaningZoneRecord {
  return {
    createdAt: '2026-05-26T00:00:00.000Z',
    dayOfWeek: 2,
    deletedAt: null,
    description: '',
    id: 'zone-1',
    isActive: true,
    sortOrder: 0,
    title: 'Ванная',
    updatedAt: '2026-05-26T00:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
  }
}

function createCleaningTaskRecord(): CleaningTaskRecord {
  return {
    assignee: 'anyone',
    createdAt: '2026-05-26T00:00:00.000Z',
    customIntervalDays: null,
    deletedAt: null,
    depth: 'regular',
    description: '',
    energy: 'normal',
    estimatedMinutes: 15,
    frequencyInterval: 1,
    frequencyType: 'weekly',
    id: 'task-1',
    impactScore: 3,
    isActive: true,
    isSeasonal: false,
    priority: 'normal',
    seasonMonths: [],
    sortOrder: 0,
    scope: 'zone',
    tags: [],
    title: 'Протереть раковину',
    updatedAt: '2026-05-26T00:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    zoneId: 'zone-1',
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

function callTestDexieTransaction(
  transaction: TestDexieTransaction,
  database: Dexie,
  args: unknown[],
): unknown {
  return Reflect.apply(transaction, database, args)
}
