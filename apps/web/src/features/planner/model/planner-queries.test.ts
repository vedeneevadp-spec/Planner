import type { TaskReadModelResponse } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as timeService from '@/shared/time/time.service'

import type { PlannerApiClient } from '../lib/planner-api'
import {
  loadPlannerTaskSnapshot,
  PLANNER_TASK_SNAPSHOT_LIMITS,
  usePlannerQueries,
} from './planner-queries'

const mocks = vi.hoisted(() => ({
  todayKey: '2026-09-17',
  replaceCachedTaskRecordsFromServer: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/shared/time/time.service', async (importOriginal) => ({
  ...(await importOriginal<typeof timeService>()),
  getTodayDate: vi.fn(() => mocks.todayKey),
}))

vi.mock('../lib/offline-planner-store', () => ({
  getPlannerOfflineWorkspaceWriteGeneration: vi.fn(() => 3),
  replaceCachedLifeSphereRecordsFromServer: vi
    .fn()
    .mockResolvedValue(undefined),
  replaceCachedTaskRecordsFromServer: mocks.replaceCachedTaskRecordsFromServer,
  replaceCachedTaskTemplateRecordsFromServer: vi
    .fn()
    .mockResolvedValue(undefined),
}))

function createSnapshot(
  date = '2026-09-17',
  timeZone = 'UTC',
): TaskReadModelResponse {
  return {
    eventCursor: 12,
    historyNextCursor: null,
    items: [],
    returnedCount: 0,
    sources: {
      active: { returnedCount: 0, totalCount: 0, truncated: false },
      dailyLoad: {
        date,
        timeZone,
        returnedCount: 0,
        totalCount: 0,
        truncated: false,
      },
      history: { returnedCount: 0, totalCount: 0, truncated: false },
      range: { returnedCount: 0, totalCount: 0, truncated: false },
    },
    totalCount: 0,
    truncated: false,
  }
}

function createPendingSnapshot() {
  let resolve!: (response: TaskReadModelResponse) => void
  const promise = new Promise<TaskReadModelResponse>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

const queryClients: QueryClient[] = []

function renderPlannerQueries(
  getTaskReadModel: PlannerApiClient['getTaskReadModel'],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity } },
  })
  queryClients.push(queryClient)
  const plannerApi = {
    getTaskReadModel,
    listLifeSpheres: vi.fn().mockResolvedValue([]),
    listTaskTemplates: vi.fn().mockResolvedValue([]),
  } as unknown as PlannerApiClient
  const onServerReadSuccess = vi.fn()

  return renderHook(
    ({ authSessionVersion, plannerTimeZone }) =>
      usePlannerQueries({
        authSessionVersion,
        onServerReadSuccess,
        plannerApi,
        plannerTimeZone,
        queryClient,
        workspaceId: 'workspace-1',
      }),
    {
      initialProps: { authSessionVersion: 1, plannerTimeZone: 'UTC' },
      wrapper: ({ children }: PropsWithChildren) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    },
  )
}

describe('planner task snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.todayKey = '2026-09-17'
  })

  afterEach(() => {
    cleanup()
    queryClients.splice(0).forEach((queryClient) => queryClient.clear())
  })

  it('uses the bounded read model instead of the legacy full task list', async () => {
    const response: TaskReadModelResponse = {
      eventCursor: 12,
      historyNextCursor: null,
      items: [],
      returnedCount: 0,
      sources: {
        active: { returnedCount: 0, totalCount: 0, truncated: false },
        history: { returnedCount: 0, totalCount: 0, truncated: false },
        range: { returnedCount: 0, totalCount: 0, truncated: false },
      },
      totalCount: 0,
      truncated: false,
    }
    const getTaskReadModel = vi.fn().mockResolvedValue(response)
    const listTasks = vi.fn()
    const api = {
      getTaskReadModel,
      listTasks,
    } as unknown as PlannerApiClient
    const signal = new AbortController().signal

    await expect(
      loadPlannerTaskSnapshot(api, '2026-08-25', '2026-08-26', signal),
    ).resolves.toBe(response)
    expect(getTaskReadModel).toHaveBeenCalledWith(
      {
        ...PLANNER_TASK_SNAPSHOT_LIMITS,
        dateFrom: '2026-08-25',
        dateTo: '2026-08-26',
      },
      signal,
    )
    expect(listTasks).not.toHaveBeenCalled()
  })

  it('exposes daily load coverage from the current server snapshot', async () => {
    const response = createSnapshot()
    const getTaskReadModel = vi
      .fn<PlannerApiClient['getTaskReadModel']>()
      .mockResolvedValue(response)
    const { result } = renderPlannerQueries(getTaskReadModel)

    await waitFor(() => expect(result.current.tasksQuery.isSuccess).toBe(true))
    expect(result.current.taskReadModelCoverage).toEqual({
      historyNextCursor: response.historyNextCursor,
      returnedCount: response.returnedCount,
      sources: response.sources,
      totalCount: response.totalCount,
      truncated: response.truncated,
    })
    expect(result.current.taskReadModelCoverage?.sources.dailyLoad).toEqual({
      date: '2026-09-17',
      timeZone: 'UTC',
      returnedCount: 0,
      totalCount: 0,
      truncated: false,
    })
    expect(mocks.replaceCachedTaskRecordsFromServer).toHaveBeenCalledWith(
      'workspace-1',
      [],
      expect.any(String),
      3,
      12,
    )
  })

  it.each(['date', 'timezone'] as const)(
    'hides previous coverage and fetches a fresh snapshot when the planner %s changes',
    async (change) => {
      const pendingSnapshot = createPendingSnapshot()
      const getTaskReadModel = vi
        .fn<PlannerApiClient['getTaskReadModel']>()
        .mockResolvedValueOnce(createSnapshot())
        .mockReturnValueOnce(pendingSnapshot.promise)
      const { result, rerender } = renderPlannerQueries(getTaskReadModel)
      await waitFor(() =>
        expect(result.current.taskReadModelCoverage?.sources.dailyLoad).toEqual(
          createSnapshot().sources.dailyLoad,
        ),
      )

      const date = change === 'date' ? '2026-09-18' : '2026-09-17'
      const timeZone = change === 'timezone' ? 'Asia/Novosibirsk' : 'UTC'
      mocks.todayKey = date
      rerender({ authSessionVersion: 1, plannerTimeZone: timeZone })

      expect(result.current.taskReadModelCoverage).toBeNull()
      await waitFor(() => expect(getTaskReadModel).toHaveBeenCalledTimes(2))
      expect(timeService.getTodayDate).toHaveBeenLastCalledWith(timeZone)
      expect(getTaskReadModel).toHaveBeenLastCalledWith(
        {
          ...PLANNER_TASK_SNAPSHOT_LIMITS,
          dateFrom: date,
          dateTo: change === 'date' ? '2026-09-19' : '2026-09-18',
        },
        expect.any(AbortSignal),
      )
      expect(result.current.taskReadModelCoverage).toBeNull()

      const response = createSnapshot(date, timeZone)
      await act(async () => {
        pendingSnapshot.resolve(response)
        await pendingSnapshot.promise
      })
      await waitFor(() =>
        expect(result.current.taskReadModelCoverage?.sources.dailyLoad).toEqual(
          response.sources.dailyLoad,
        ),
      )
      expect(getTaskReadModel).toHaveBeenCalledTimes(2)
    },
  )

  it('does not reuse previous-session coverage while the new session snapshot is pending', async () => {
    const pendingSnapshot = createPendingSnapshot()
    const getTaskReadModel = vi
      .fn<PlannerApiClient['getTaskReadModel']>()
      .mockResolvedValueOnce(createSnapshot())
      .mockReturnValueOnce(pendingSnapshot.promise)
    const { result, rerender } = renderPlannerQueries(getTaskReadModel)
    await waitFor(() =>
      expect(result.current.taskReadModelCoverage).not.toBeNull(),
    )

    rerender({ authSessionVersion: 2, plannerTimeZone: 'UTC' })

    expect(result.current.taskReadModelCoverage).toBeNull()
    expect(result.current.taskQueryKey).toEqual([
      'planner',
      'tasks',
      'workspace-1',
      2,
    ])
    await waitFor(() => expect(getTaskReadModel).toHaveBeenCalledTimes(2))
    expect(result.current.taskReadModelCoverage).toBeNull()
    const response = createSnapshot()
    response.sources.dailyLoad!.totalCount = 1
    response.sources.dailyLoad!.truncated = true
    await act(async () => {
      pendingSnapshot.resolve(response)
      await pendingSnapshot.promise
    })

    await waitFor(() =>
      expect(result.current.taskReadModelCoverage?.sources.dailyLoad).toEqual(
        response.sources.dailyLoad,
      ),
    )
  })
})
