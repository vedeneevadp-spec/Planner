import 'fake-indexeddb/auto'

import { QueryClient } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionReadiness } from '@/features/session'

import * as plannerOfflineStore from '../lib/offline-planner-store'
import { usePlannerOfflineSync } from './planner-offline'

const plannerOfflineStoreMocks = vi.hoisted(() => ({
  countConflictedPlannerOfflineMutations: vi.fn(),
  countRetryablePlannerOfflineMutations: vi.fn(),
}))

vi.mock('../lib/offline-planner-store', async (importOriginal) => {
  const actual = await importOriginal<typeof plannerOfflineStore>()

  return {
    ...actual,
    countConflictedPlannerOfflineMutations:
      plannerOfflineStoreMocks.countConflictedPlannerOfflineMutations,
    countRetryablePlannerOfflineMutations:
      plannerOfflineStoreMocks.countRetryablePlannerOfflineMutations,
  }
})

describe('usePlannerOfflineSync cache hydration', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    plannerOfflineStoreMocks.countConflictedPlannerOfflineMutations.mockResolvedValue(
      0,
    )
    plannerOfflineStoreMocks.countRetryablePlannerOfflineMutations.mockResolvedValue(
      0,
    )
    await plannerOfflineStore.resetPlannerOfflineDatabaseForTests()
  })

  afterEach(async () => {
    cleanup()
    await plannerOfflineStore.resetPlannerOfflineDatabaseForTests()
    vi.restoreAllMocks()
  })

  it('keeps each cache scope pending until its local read finishes', async () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() =>
      usePlannerOfflineSync({
        actorUserId: 'user-1',
        invalidatePlannerQueries: vi.fn(() => Promise.resolve()),
        plannerApi: null,
        queryClient,
        readiness: createReadiness(),
        recoverSession: vi.fn(() => Promise.resolve()),
        setMutationErrorMessage: vi.fn(),
        sphereQueryKey: ['planner', 'spheres', 'workspace-1', 1],
        spheres: undefined,
        taskQueryKey: ['planner', 'tasks', 'workspace-1', 1],
        taskTemplateQueryKey: ['planner', 'task-templates', 'workspace-1', 1],
        taskTemplates: undefined,
        tasks: undefined,
        workspaceId: 'workspace-1',
      }),
    )

    expect(result.current.isTaskCacheHydrating).toBe(true)
    expect(result.current.isLifeSphereCacheHydrating).toBe(true)
    expect(result.current.isTaskTemplateCacheHydrating).toBe(true)

    await waitFor(() => {
      expect(result.current.isTaskCacheHydrating).toBe(false)
      expect(result.current.isLifeSphereCacheHydrating).toBe(false)
      expect(result.current.isTaskTemplateCacheHydrating).toBe(false)
    })

    queryClient.clear()
  })

  it('contains a background queue-count failure during storage teardown', async () => {
    const queueReadError = new Error('IndexedDB connection closed')
    plannerOfflineStoreMocks.countRetryablePlannerOfflineMutations.mockRejectedValueOnce(
      queueReadError,
    )
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const queryClient = new QueryClient()
    const { result } = renderHook(() =>
      usePlannerOfflineSync({
        actorUserId: 'user-1',
        invalidatePlannerQueries: vi.fn(() => Promise.resolve()),
        plannerApi: null,
        queryClient,
        readiness: createReadiness(),
        recoverSession: vi.fn(() => Promise.resolve()),
        setMutationErrorMessage: vi.fn(),
        sphereQueryKey: ['planner', 'spheres', 'workspace-1', 1],
        spheres: undefined,
        taskQueryKey: ['planner', 'tasks', 'workspace-1', 1],
        taskTemplateQueryKey: ['planner', 'task-templates', 'workspace-1', 1],
        taskTemplates: undefined,
        tasks: undefined,
        workspaceId: 'workspace-1',
      }),
    )

    await waitFor(() => {
      expect(result.current.isTaskCacheHydrating).toBe(false)
      expect(result.current.isLifeSphereCacheHydrating).toBe(false)
      expect(result.current.isTaskTemplateCacheHydrating).toBe(false)
      expect(consoleWarn).toHaveBeenCalledWith(
        'Failed to refresh queued planner mutation counts.',
        queueReadError,
      )
    })

    expect(result.current.queuedMutationCount).toBe(0)
    expect(result.current.conflictedMutationCount).toBe(0)
    queryClient.clear()
  })
})

function createReadiness(): SessionReadiness {
  return {
    canReadCachedData: true,
    canRenderAppContent: true,
    canUseProtectedApi: true,
    canWriteProtectedData: true,
    reason: 'ready',
    status: 'ready',
  }
}
