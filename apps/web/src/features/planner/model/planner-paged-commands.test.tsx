import 'fake-indexeddb/auto'

import {
  type TaskCursorListResponse,
  type TaskReadModelResponse,
  type TaskRecord,
  taskUpdateInputSchema,
} from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as offlineStore from '../lib/offline-planner-store'
import { type PlannerApiClient, PlannerApiError } from '../lib/planner-api'
import {
  usePlannerTaskCursor,
  usePlannerTaskInfiniteCursor,
} from '../lib/usePlannerTaskCursor'
import { getPlannerTaskQueryKey } from './planner-queries'
import { getPlannerCachedTaskRecord } from './planner-task-cache'
import { usePlannerState } from './usePlannerState'

const mocks = vi.hoisted(() => ({
  api: {
    getTaskReadModel: vi.fn(),
    listLifeSpheres: vi.fn(),
    listTaskTemplates: vi.fn(),
    listTaskEvents: vi.fn(),
    listTasksCursor: vi.fn(),
    updateTask: vi.fn<PlannerApiClient['updateTask']>(),
    removeTask: vi.fn(),
    setTaskStatus: vi.fn<PlannerApiClient['setTaskStatus']>(),
  },
  apiConfig: { workspaceId: 'workspace-1' },
  sessionVersion: 1,
  session: {
    actorUserId: 'user-1',
    actor: { displayName: 'Test' },
    workspaceId: 'workspace-1',
    workspaceSettings: { taskCompletionConfettiEnabled: false },
  },
  readiness: {
    canReadCachedData: true,
    canRenderAppContent: true,
    canUseProtectedApi: true,
    canWriteProtectedData: true,
    reason: 'ready',
    status: 'ready',
  },
  recoverSession: vi.fn(),
}))

vi.mock('../lib/planner-api', async (original) => ({
  ...(await original<object>()),
  createPlannerApiClient: () => mocks.api,
}))
vi.mock('@/features/session', async (original) => ({
  ...(await original<object>()),
  usePlannerTimeZone: () => 'UTC',
  useSessionAuth: () => ({
    isAuthEnabled: false,
    recoverSession: mocks.recoverSession,
    sessionVersion: mocks.sessionVersion,
  }),
  useSessionFeatureReadiness: () => ({
    apiConfig: mocks.apiConfig,
    getReadiness: () => mocks.readiness,
    session: mocks.session,
    sessionQuery: {
      isPending: false,
      isSuccess: true,
      isFetching: false,
      error: null,
    },
  }),
}))

const taskKey = getPlannerTaskQueryKey('workspace-1', 1)
const pageFilters = {
  dateFrom: '2027-01-01',
  dateTo: '2027-01-31',
  dateMode: 'planned',
  direction: 'asc',
  scope: 'all',
  limit: 500,
} as const
const historyFilters = {
  dateMode: 'planned',
  direction: 'desc',
  scope: 'closed',
  limit: 100,
} as const
let queryClient: QueryClient
let serverTask: TaskRecord | undefined

function page(items: TaskRecord[]): TaskCursorListResponse {
  return {
    items,
    returnedCount: items.length,
    nextCursor: null,
    hasMore: false,
    limit: 500,
    totalCount: items.length,
    truncated: false,
  }
}

function Wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function usePagedPlanner() {
  const planner = usePlannerState()
  const calendar = usePlannerTaskCursor(pageFilters)
  const history = usePlannerTaskInfiniteCursor(historyFilters, {
    initialCursor: 'older',
  })
  return { planner, calendar, history }
}

async function setup() {
  const hook = renderHook(usePagedPlanner, { wrapper: Wrapper })
  await waitFor(() => {
    expect(hook.result.current.planner.isLoading).toBe(false)
    expect(hook.result.current.calendar.isSuccess).toBe(true)
    expect(hook.result.current.history.isSuccess).toBe(true)
    expect(hook.result.current.planner.isTaskCacheHydrating).toBe(false)
  })
  expect(queryClient.getQueryData(taskKey)).toEqual([])
  return hook
}

describe('commands on tasks loaded only by cursor pages', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await offlineStore.resetPlannerOfflineDatabaseForTests()
    mocks.sessionVersion = 1
    mocks.apiConfig.workspaceId = mocks.session.workspaceId = 'workspace-1'
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })
    serverTask = createTaskRecord()
    const empty = { returnedCount: 0, totalCount: 0, truncated: false }
    mocks.api.getTaskReadModel.mockResolvedValue({
      items: [],
      eventCursor: 0,
      historyNextCursor: 'older',
      returnedCount: 0,
      totalCount: 600,
      truncated: true,
      sources: {
        active: { ...empty, totalCount: 600, truncated: true },
        history: empty,
        range: empty,
      },
    } satisfies TaskReadModelResponse)
    mocks.api.listLifeSpheres.mockResolvedValue([])
    mocks.api.listTaskTemplates.mockResolvedValue([])
    mocks.api.listTaskEvents.mockResolvedValue({
      items: [],
      nextEventId: 0,
      hasMore: false,
    })
    mocks.api.listTasksCursor.mockImplementation(() =>
      Promise.resolve(page(serverTask ? [serverTask] : [])),
    )
    mocks.api.updateTask.mockImplementation((_id, input) => {
      serverTask = {
        ...serverTask!,
        title: input.title,
        version: (input.expectedVersion ?? 0) + 1,
      }
      return Promise.resolve(serverTask)
    })
    mocks.api.removeTask.mockImplementation(() => {
      serverTask = undefined
      return Promise.resolve()
    })
    mocks.api.setTaskStatus.mockImplementation((_id, input) => {
      serverTask = {
        ...serverTask!,
        status: input.status,
        version: (input.expectedVersion ?? 0) + 1,
      }
      return Promise.resolve(serverTask)
    })
  })

  afterEach(async () => {
    cleanup()
    queryClient.clear()
    await offlineStore.resetPlannerOfflineDatabaseForTests()
    vi.restoreAllMocks()
  })

  it.each([true, false])(
    'edits a paged task and refreshes both page caches (offline storage: %s)',
    async (withStorage) => {
      if (!withStorage)
        vi.spyOn(
          offlineStore,
          'isPlannerOfflineStorageAvailable',
        ).mockReturnValue(false)
      const { result } = await setup()
      await act(async () => {
        expect(
          await result.current.planner.updateTask(
            'task-1',
            taskUpdateInputSchema.parse({ ...serverTask, title: 'Saved' }),
          ),
        ).toBe(true)
      })
      await waitFor(() => {
        expect(mocks.api.updateTask).toHaveBeenCalledWith(
          'task-1',
          expect.objectContaining({ title: 'Saved', expectedVersion: 7 }),
        )
        expect(result.current.calendar.data?.items[0]).toMatchObject({
          title: 'Saved',
          version: 8,
        })
        expect(result.current.history.data?.pages[0]?.items[0]).toMatchObject({
          title: 'Saved',
          version: 8,
        })
        expect(result.current.planner.queuedMutationCount).toBe(0)
      })
      expect(mocks.api.listTasksCursor.mock.calls.length).toBeGreaterThan(2)
    },
  )

  it('rolls a rejected edit back in the calendar and history', async () => {
    vi.spyOn(offlineStore, 'isPlannerOfflineStorageAvailable').mockReturnValue(
      false,
    )
    mocks.api.updateTask.mockRejectedValue(
      new PlannerApiError('Rejected', { status: 403, code: 'forbidden' }),
    )
    const { result } = await setup()
    await act(async () => {
      expect(
        await result.current.planner.updateTask(
          'task-1',
          taskUpdateInputSchema.parse({ ...serverTask, title: 'Rejected' }),
        ),
      ).toBe(false)
    })
    await waitFor(() => {
      expect(result.current.calendar.data?.items[0]?.title).toBe('Original')
      expect(result.current.history.data?.pages[0]?.items[0]?.title).toBe(
        'Original',
      )
    })
  })

  it('persists an offline edit of a paged task and replays it after reconnecting', async () => {
    const { result } = await setup()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await act(async () => {
      expect(
        await result.current.planner.updateTask(
          'task-1',
          taskUpdateInputSchema.parse({ ...serverTask, title: 'Offline edit' }),
        ),
      ).toBe(true)
    })
    expect(mocks.api.updateTask).not.toHaveBeenCalled()
    expect(await offlineStore.loadCachedTaskRecords('workspace-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', title: 'Offline edit' }),
      ]),
    )
    await waitFor(() => {
      expect(result.current.calendar.data?.items[0]?.title).toBe('Offline edit')
      expect(result.current.history.data?.pages[0]?.items[0]?.title).toBe(
        'Offline edit',
      )
    })
    online.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => {
      expect(mocks.api.updateTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ title: 'Offline edit', expectedVersion: 7 }),
      )
      expect(result.current.planner.queuedMutationCount).toBe(0)
      expect(result.current.calendar.data?.items[0]?.version).toBe(8)
    })
  })

  it('hydrates the snapshot from disk while its server read is pending', async () => {
    await offlineStore.replaceCachedTaskRecords('workspace-1', [serverTask!])
    mocks.api.getTaskReadModel.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(usePagedPlanner, { wrapper: Wrapper })
    await waitFor(() => {
      expect(result.current.planner.isTaskCacheHydrating).toBe(false)
      expect(queryClient.getQueryData(taskKey)).toEqual([serverTask])
      expect(result.current.planner.tasks[0]?.title).toBe('Original')
    })
  })

  it('removes a task absent from the snapshot from both loaded pages', async () => {
    vi.spyOn(offlineStore, 'isPlannerOfflineStorageAvailable').mockReturnValue(
      false,
    )
    const { result } = await setup()
    await act(async () => {
      expect(await result.current.planner.removeTask('task-1')).toBe(true)
    })
    await waitFor(() => {
      expect(mocks.api.removeTask).toHaveBeenCalledWith('task-1', 7)
      expect(result.current.calendar.data?.items).toEqual([])
      expect(result.current.history.data?.pages[0]?.items).toEqual([])
    })
  })

  it('uses the latest version from later history pages when changing status', async () => {
    vi.spyOn(offlineStore, 'isPlannerOfflineStorageAvailable').mockReturnValue(
      false,
    )
    const { result } = await setup()
    queryClient.setQueryData(
      [...taskKey, 'cursor', 'infinite', historyFilters, 'older'],
      {
        pages: [
          page([]),
          page([{ ...serverTask!, version: 9, status: 'done' }]),
        ],
        pageParams: ['older', 'next'],
      },
    )
    await act(async () => {
      expect(await result.current.planner.setTaskStatus('task-1', 'todo')).toBe(
        true,
      )
    })
    expect(mocks.api.setTaskStatus).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ expectedVersion: 9, status: 'todo' }),
    )
  })

  it('does not let a stale cursor response overwrite a newer snapshot record', async () => {
    const { result } = await setup()
    act(() => {
      queryClient.setQueryData(taskKey, [
        { ...serverTask!, title: 'Newer', version: 8 },
      ])
    })
    await act(async () => {
      await result.current.calendar.refetch()
      await result.current.history.refetch()
    })
    await waitFor(() => {
      expect(result.current.calendar.data?.items[0]?.title).toBe('Newer')
      expect(result.current.history.data?.pages[0]?.items[0]?.title).toBe(
        'Newer',
      )
    })
  })

  it('invalidates paged tasks when the server event cursor advances', async () => {
    const { result } = await setup()
    serverTask = { ...serverTask!, title: 'Changed elsewhere', version: 8 }
    mocks.api.listTaskEvents.mockResolvedValue({
      items: [],
      nextEventId: 1,
      hasMore: false,
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => {
      expect(result.current.calendar.data?.items[0]?.title).toBe(
        'Changed elsewhere',
      )
      expect(result.current.history.data?.pages[0]?.items[0]?.title).toBe(
        'Changed elsewhere',
      )
    })
  })

  it('does not reuse page records from another workspace or auth session', async () => {
    const { rerender, result } = await setup()
    expect(
      getPlannerCachedTaskRecord(
        queryClient,
        getPlannerTaskQueryKey('workspace-1', 2),
        'task-1',
      ),
    ).toBeUndefined()
    expect(
      getPlannerCachedTaskRecord(
        queryClient,
        getPlannerTaskQueryKey('workspace-2', 1),
        'task-1',
      ),
    ).toBeUndefined()
    mocks.sessionVersion = 2
    serverTask = undefined
    rerender()
    await waitFor(() => {
      expect(result.current.calendar.data?.items).toEqual([])
    })
  })
})

function createTaskRecord(): TaskRecord {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    necessity: 'desired',
    linkedTask: null,
    note: '',
    plannedDate: '2027-01-15',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    recurrence: null,
    requiresConfirmation: false,
    resource: null,
    routine: null,
    sourceWorkspace: null,
    sphereId: null,
    status: 'todo',
    title: 'Original',
    updatedAt: '2026-05-01T10:00:00.000Z',
    urgency: 'not_urgent',
    version: 7,
    workspaceId: 'workspace-1',
  }
}
