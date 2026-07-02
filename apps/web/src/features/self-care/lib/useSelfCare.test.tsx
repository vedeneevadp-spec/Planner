import type {
  SelfCareDashboardResponse,
  SelfCarePlanResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelfCareApiClient } from './self-care-api'

interface SessionFeatureReadinessStub {
  apiConfig: {
    accessToken: string
    actorUserId: string
    apiBaseUrl: string
    clientTimeZone: string
    workspaceId: string
  } | null
  isApiEnabled: boolean
  session:
    | {
        actorUserId: string
        workspaceId: string
      }
    | undefined
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
  isSelfCareApiUnavailableError,
  SELF_CARE_API_UNAVAILABLE_MESSAGE,
  SelfCareApiUnavailableError,
  selfCareDashboardQueryKey,
  selfCareHistoryQueryKey,
  selfCarePlanQueryKey,
  selfCareSettingsQueryKey,
  useCompleteSelfCareOccurrence,
  useCreateSelfCareItem,
  useSelfCareDashboard,
  useSkipSelfCareOccurrence,
} from './useSelfCare'

describe('useSelfCareDashboard', () => {
  let queryClient: QueryClient
  let selfCareApi: SelfCareApiClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: {
          retry: false,
        },
        queries: {
          retry: false,
        },
      },
    })
    selfCareApi = createSelfCareApi()
    mocks.createSelfCareApiClient.mockReturnValue(selfCareApi)
  })

  afterEach(() => {
    cleanup()
    queryClient.clear()
    mocks.createSelfCareApiClient.mockReset()
    mocks.useSessionFeatureReadiness.mockReset()
  })

  it('waits for the API client before enabling the query', async () => {
    mocks.useSessionFeatureReadiness.mockReturnValue({
      apiConfig: null,
      isApiEnabled: true,
      session: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      workspaceId: 'workspace-1',
    })

    const { result } = renderHook(() => useSelfCareDashboard('2026-06-18'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    await Promise.resolve()

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.error).toBeNull()
    expect(mocks.createSelfCareApiClient).not.toHaveBeenCalled()
  })

  it('loads the dashboard through the feature API config', async () => {
    vi.mocked(selfCareApi.getDashboard).mockResolvedValueOnce({
      date: '2026-06-18',
      overdueCount: 0,
    } as never)
    mocks.useSessionFeatureReadiness.mockReturnValue(createReadinessStub())

    const { result } = renderHook(() => useSelfCareDashboard('2026-06-18'), {
      wrapper: createQueryWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual({
        date: '2026-06-18',
        overdueCount: 0,
      })
    })

    expect(mocks.createSelfCareApiClient).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      apiBaseUrl: 'https://api.chaotika.test',
      clientTimeZone: 'Europe/Astrakhan',
      workspaceId: 'workspace-1',
    })
    expect(selfCareApi.getDashboard).toHaveBeenCalledWith(
      '2026-06-18',
      expect.any(AbortSignal),
    )
  })

  it('invalidates self-care item scopes after create mutations', async () => {
    vi.mocked(selfCareApi.createItem).mockResolvedValueOnce({
      id: 'self-care-item-1',
      title: 'Water',
    } as never)
    mocks.useSessionFeatureReadiness.mockReturnValue(createReadinessStub())

    queryClient.setQueryData(
      selfCareDashboardQueryKey('workspace-1', '2026-06-18'),
      { date: '2026-06-18' },
    )
    queryClient.setQueryData(selfCareSettingsQueryKey('workspace-1'), {
      gentleMode: false,
    })

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateSelfCareItem(), {
      wrapper: createQueryWrapper(queryClient),
    })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          title: 'Water',
        } as never),
      ).resolves.toMatchObject({ id: 'self-care-item-1' })
    })

    const [invalidateOptions] = invalidateSpy.mock.calls[0] ?? []
    const predicate = (
      invalidateOptions as
        | { predicate?: (query: { queryKey: readonly unknown[] }) => boolean }
        | undefined
    )?.predicate

    expect(selfCareApi.createItem).toHaveBeenCalledWith({ title: 'Water' })
    expect(
      predicate?.({ queryKey: ['self-care', 'workspace-1', 'dashboard'] }),
    ).toBe(true)
    expect(
      predicate?.({ queryKey: ['self-care', 'workspace-1', 'settings'] }),
    ).toBe(false)
  })

  it('skips self-care invalidation when the caller batches updates', async () => {
    vi.mocked(selfCareApi.createItem).mockResolvedValueOnce({
      id: 'self-care-item-1',
    } as never)
    mocks.useSessionFeatureReadiness.mockReturnValue(createReadinessStub())

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateSelfCareItem(), {
      wrapper: createQueryWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        input: { title: 'Water' } as never,
        skipInvalidation: true,
      })
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('updates loaded self-care caches after completing an occurrence without active refetch', async () => {
    const entry = createSelfCareEntry()
    const completion = {
      completedAt: '2026-06-18T09:00:00.000Z',
      id: 'completion-1',
      itemId: 'self-care-item-1',
      occurrenceId: 'occurrence-1',
      status: 'done',
    }
    vi.mocked(selfCareApi.completeOccurrence).mockResolvedValueOnce(
      completion as never,
    )
    mocks.useSessionFeatureReadiness.mockReturnValue(createReadinessStub())

    queryClient.setQueryData(
      selfCareDashboardQueryKey('workspace-1', '2026-06-18'),
      createSelfCareDashboard([entry]),
    )
    queryClient.setQueryData(
      selfCarePlanQueryKey('workspace-1', '2026-06-18', '2026-07-03'),
      createSelfCarePlan([entry]),
    )
    queryClient.setQueryData(
      selfCareHistoryQueryKey('workspace-1', '2026-06-01', '2026-06-30'),
      { completions: [], items: [entry.item], stepCompletions: [] },
    )

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCompleteSelfCareOccurrence(), {
      wrapper: createQueryWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ occurrenceId: 'occurrence-1' })
    })

    expect(
      queryClient.getQueryData<ReturnType<typeof createSelfCareDashboard>>(
        selfCareDashboardQueryKey('workspace-1', '2026-06-18'),
      )?.todayItems[0],
    ).toMatchObject({
      completion: { id: 'completion-1' },
      occurrence: { status: 'done' },
    })
    expect(
      queryClient.getQueryData<ReturnType<typeof createSelfCarePlan>>(
        selfCarePlanQueryKey('workspace-1', '2026-06-18', '2026-07-03'),
      )?.occurrences[0],
    ).toMatchObject({
      completion: { id: 'completion-1' },
      occurrence: { status: 'done' },
    })
    expect(
      queryClient.getQueryData<{
        completions: Array<{ id: string }>
      }>(selfCareHistoryQueryKey('workspace-1', '2026-06-01', '2026-06-30'))
        ?.completions,
    ).toEqual([expect.objectContaining({ id: 'completion-1' })])
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ refetchType: 'none' }),
    )
  })

  it('updates loaded occurrence caches after skipping without active refetch', async () => {
    const entry = createSelfCareEntry()
    vi.mocked(selfCareApi.skipOccurrence).mockResolvedValueOnce({
      ...entry.occurrence!,
      status: 'skipped',
    } as never)
    mocks.useSessionFeatureReadiness.mockReturnValue(createReadinessStub())

    queryClient.setQueryData(
      selfCareDashboardQueryKey('workspace-1', '2026-06-18'),
      createSelfCareDashboard([entry]),
    )
    queryClient.setQueryData(
      selfCarePlanQueryKey('workspace-1', '2026-06-18', '2026-07-03'),
      createSelfCarePlan([entry]),
    )

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useSkipSelfCareOccurrence(), {
      wrapper: createQueryWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ occurrenceId: 'occurrence-1' })
    })

    expect(
      queryClient.getQueryData<ReturnType<typeof createSelfCareDashboard>>(
        selfCareDashboardQueryKey('workspace-1', '2026-06-18'),
      )?.todayItems[0]?.occurrence,
    ).toMatchObject({ status: 'skipped' })
    expect(
      queryClient.getQueryData<ReturnType<typeof createSelfCarePlan>>(
        selfCarePlanQueryKey('workspace-1', '2026-06-18', '2026-07-03'),
      )?.occurrences[0]?.occurrence,
    ).toMatchObject({ status: 'skipped' })
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ refetchType: 'none' }),
    )
  })

  it('reports a typed transient error when a write starts before the session is ready', async () => {
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createReadinessStub({
        apiConfig: null,
        isApiEnabled: false,
        session: undefined,
        workspaceId: 'pending',
      }),
    )

    const { result } = renderHook(() => useCreateSelfCareItem(), {
      wrapper: createQueryWrapper(queryClient),
    })

    let caughtError: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({
          title: 'Water',
        } as never)
      } catch (error) {
        caughtError = error
      }
    })

    expect(caughtError).toBeInstanceOf(SelfCareApiUnavailableError)
    expect(caughtError).toMatchObject({
      message: SELF_CARE_API_UNAVAILABLE_MESSAGE,
    })
    expect(isSelfCareApiUnavailableError(caughtError)).toBe(true)
    expect(selfCareApi.createItem).not.toHaveBeenCalled()
  })
})

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
      actorUserId: 'user-1',
      apiBaseUrl: 'https://api.chaotika.test',
      clientTimeZone: 'Europe/Astrakhan',
      workspaceId: 'workspace-1',
    },
    isApiEnabled: true,
    session: {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    },
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function createSelfCareEntry(): SelfCareTodayItem {
  return {
    appointment: null,
    completion: null,
    courseDetails: null,
    exercise: null,
    flexibleProgress: null,
    item: {
      id: 'self-care-item-1',
      title: 'Water',
      type: 'habit',
    },
    lastExercise: null,
    lastMeasurement: null,
    measurement: null,
    occurrence: {
      completedAt: null,
      id: 'occurrence-1',
      scheduledFor: '2026-06-18',
      status: 'scheduled',
    },
    procedure: null,
    scheduleRule: null,
    steps: [],
    timeGroup: 'anytime',
  } as unknown as SelfCareTodayItem
}

function createSelfCareDashboard(
  todayItems: SelfCareTodayItem[],
): SelfCareDashboardResponse {
  return {
    dailyState: null,
    date: '2026-06-18',
    flexibleGoals: [],
    gentleMode: false,
    minimumItems: [],
    overdueItems: [],
    planningHints: [],
    settings: {},
    todayItems,
    upcomingImportant: [],
  } as unknown as SelfCareDashboardResponse
}

function createSelfCarePlan(
  occurrences: SelfCareTodayItem[],
): SelfCarePlanResponse {
  return {
    courses: [],
    from: '2026-06-18',
    medical: [],
    occurrences,
    planningHints: [],
    to: '2026-07-03',
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
    updateItem: vi.fn(),
    updateMinimumItems: vi.fn(),
    updateRitualSteps: vi.fn(),
    updateSettings: vi.fn(),
    upsertDailyState: vi.fn(),
    upsertRitualStepDraft: vi.fn(),
  }
}
