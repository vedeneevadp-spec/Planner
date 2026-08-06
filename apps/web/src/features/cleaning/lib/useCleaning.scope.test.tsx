import type { SessionResponse } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { useSessionFeatureReadiness } from '@/features/session'

type SessionFeatureReadinessResult = ReturnType<
  typeof useSessionFeatureReadiness
>

const mocks = vi.hoisted(() => ({
  getQueueCounts: vi.fn(),
  probeStorage: vi.fn(),
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

vi.mock('./offline-cleaning-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    getCleaningOfflineQueueCounts: mocks.getQueueCounts,
    getCleaningOfflineStorageHealth: () => 'ready',
    probeCleaningOfflineStorage: mocks.probeStorage,
    subscribeCleaningOfflineQueue: () => () => undefined,
  }
})

import { useCleaningPlan } from './useCleaning'

describe('cleaning queue scope lifecycle', () => {
  let currentWorkspaceId: string

  beforeEach(() => {
    currentWorkspaceId = 'workspace-1'
    mocks.probeStorage.mockResolvedValue('ready')
    mocks.usePlannerTimeZone.mockReturnValue('Europe/Astrakhan')
    mocks.useSessionFeatureReadiness.mockImplementation(() =>
      createFeatureReadinessResult(currentWorkspaceId),
    )
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('ignores queue counts that settle after switching workspace scope', async () => {
    const oldScopeCounts = createDeferred<{
      conflicted: number
      failed: number
      pending: number
    }>()
    mocks.getQueueCounts.mockImplementation((workspaceId: string) =>
      workspaceId === 'workspace-1'
        ? oldScopeCounts.promise
        : Promise.resolve({ conflicted: 0, failed: 0, pending: 0 }),
    )
    const { rerender, result } = renderHook(
      () => useCleaningPlan({ enabled: false }),
      { wrapper: createQueryWrapper() },
    )

    await waitFor(() => {
      expect(mocks.getQueueCounts).toHaveBeenCalledWith('workspace-1', 'user-1')
    })
    currentWorkspaceId = 'workspace-2'
    rerender()

    await waitFor(() => {
      expect(mocks.getQueueCounts).toHaveBeenCalledWith('workspace-2', 'user-1')
      expect(result.current.offlineQueue.pending).toBe(0)
    })

    await act(async () => {
      oldScopeCounts.resolve({ conflicted: 1, failed: 2, pending: 3 })
      await oldScopeCounts.promise
    })

    expect(result.current.offlineQueue).toMatchObject({
      conflicted: 0,
      failed: 0,
      pending: 0,
    })
  })
})

function createFeatureReadinessResult(
  workspaceId: string,
): SessionFeatureReadinessResult {
  const session = createSessionResponse(workspaceId)

  return {
    apiConfig: null,
    getReadiness: () => ({
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'planner_error',
      status: 'offlineWithCache',
    }),
    isApiEnabled: false,
    readiness: {
      canReadCachedData: true,
      canRenderAppContent: true,
      canUseProtectedApi: false,
      canWriteProtectedData: false,
      reason: 'planner_error',
      status: 'offlineWithCache',
    },
    session,
    sessionQuery: {
      refetch: vi.fn(),
    } as unknown as SessionFeatureReadinessResult['sessionQuery'],
    workspaceId,
  }
}

function createSessionResponse(workspaceId: string): SessionResponse {
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
      id: workspaceId,
      kind: 'personal',
      name: 'Planner Workspace',
      slug: workspaceId,
    },
    workspaceId,
    workspaceSettings: {
      defaultTimeZone: null,
      taskCompletionConfettiEnabled: true,
      wakeWordTrainingModeEnabled: false,
    },
    workspaces: [
      {
        groupRole: null,
        id: workspaceId,
        kind: 'personal',
        name: 'Planner Workspace',
        role: 'owner',
        slug: workspaceId,
      },
    ],
  }
}

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return function TestQueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
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
