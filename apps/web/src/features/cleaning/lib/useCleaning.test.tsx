import type {
  CleaningListResponse,
  CleaningTaskRecord,
  CleaningTodayResponse,
  CleaningZoneRecord,
  SessionResponse,
} from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { useSessionFeatureReadiness } from '@/features/session'

type SessionFeatureReadinessResult = ReturnType<
  typeof useSessionFeatureReadiness
>

const mocks = vi.hoisted(() => ({
  usePlannerTimeZone: vi.fn<() => string>(),
  useSessionFeatureReadiness: vi.fn<() => SessionFeatureReadinessResult>(),
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
  useCleaningPlan,
  useCleaningSummary,
  useCreateCleaningZone,
} from './useCleaning'

describe('useCleaning', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createFeatureReadinessResult(),
    )
    mocks.usePlannerTimeZone.mockReturnValue('Europe/Astrakhan')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    mocks.usePlannerTimeZone.mockReset()
    mocks.useSessionFeatureReadiness.mockReset()
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

  it('maps an empty today response to a zero summary', () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createCleaningTodayResponse()))

    const { result } = renderHook(() => useCleaningSummary('2026-05-26'), {
      wrapper: createQueryWrapper(),
    })

    expect(result.current.activeZoneCount).toBe(0)
    expect(result.current.dueCount).toBe(0)
    expect(result.current.urgentCount).toBe(0)
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
