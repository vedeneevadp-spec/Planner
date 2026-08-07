import 'fake-indexeddb/auto'

import type {
  CleaningListResponse,
  CleaningTaskActionResponse,
  CleaningTodayResponse,
} from '@planner/contracts'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CleaningApiClient } from './cleaning-api'
import { queueCleaningTaskCompletion } from './cleaning-offline-command'
import {
  CleaningOfflineGenerationInvalidatedError,
  clearCleaningOfflineWorkspaceData,
  listCleaningOfflineMutations,
  loadCachedCleaningPlan,
  probeCleaningOfflineStorage,
  replaceCachedCleaningPlan,
  replaceCachedCleaningToday,
  resetCleaningOfflineDatabaseForTests,
} from './offline-cleaning-store'

type TestDexieTransaction = (this: Dexie, ...args: unknown[]) => unknown
const testDexiePrototype = Dexie.prototype as unknown as {
  transaction: TestDexieTransaction
}

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'
const DATE = '2026-08-06'
const NOW = '2026-08-06T08:30:00.000Z'

describe('queueCleaningTaskCompletion', () => {
  beforeEach(async () => {
    await resetCleaningOfflineDatabaseForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('accepts an offline completion durably from a partial today response', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const result = await queueCleaningTaskCompletion({
      actorUserId: ACTOR_USER_ID,
      api: null,
      date: DATE,
      occurredAt: NOW,
      taskId: 'task-1',
      today: createToday(),
      workspaceId: WORKSPACE_ID,
    })

    expect(result.queued).toBe(true)
    expect(result.today.history[0]).toMatchObject({
      action: 'completed',
      date: DATE,
      taskId: 'task-1',
    })
    const queue = await listCleaningOfflineMutations(
      WORKSPACE_ID,
      ACTOR_USER_ID,
    )
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      expectedStateVersion: 1,
      expectedTaskVersion: 1,
      operationId: result.operationId,
      status: 'pending',
    })
  })

  it('persists the command before the first online API send', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const completeTask = vi.fn<CleaningApiClient['completeTask']>(
      async (_taskId, _input, options) => {
        const queue = await listCleaningOfflineMutations(
          WORKSPACE_ID,
          ACTOR_USER_ID,
        )
        expect(queue).toHaveLength(1)
        expect(queue[0]).toMatchObject({
          operationId: options?.operationId,
          status: 'syncing',
        })
        return actionResponse()
      },
    )

    const result = await queueCleaningTaskCompletion({
      actorUserId: ACTOR_USER_ID,
      api: { completeTask } as unknown as CleaningApiClient,
      date: DATE,
      occurredAt: NOW,
      taskId: 'task-1',
      today: createToday(),
      workspaceId: WORKSPACE_ID,
    })

    expect(result.queued).toBe(true)
    expect(completeTask).toHaveBeenCalledOnce()
    expect(completeTask.mock.calls[0]?.[2]?.operationId).toBe(
      result.operationId,
    )
    await expect(
      listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it('does not replace a fuller cached plan with the partial widget snapshot', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fullPlan = createFullPlan()
    await replaceCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID, fullPlan, NOW)

    await queueCleaningTaskCompletion({
      actorUserId: ACTOR_USER_ID,
      api: null,
      date: DATE,
      occurredAt: NOW,
      taskId: 'task-1',
      today: createToday(),
      workspaceId: WORKSPACE_ID,
    })

    const cached = await loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID)
    expect(cached?.data.tasks.map((task) => task.id)).toEqual([
      'task-1',
      'task-hidden',
    ])
  })

  it('fails explicitly when both durable storage and connectivity are unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await expect(
      queueCleaningTaskCompletion({
        actorUserId: ACTOR_USER_ID,
        api: null,
        date: DATE,
        taskId: 'task-1',
        today: createToday(),
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toThrow('Надёжное локальное сохранение недоступно')
  })

  it('uses a direct online write with a stable operation id when storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const completeTask = vi
      .fn<CleaningApiClient['completeTask']>()
      .mockResolvedValue(actionResponse())

    const result = await queueCleaningTaskCompletion({
      actorUserId: ACTOR_USER_ID,
      api: { completeTask } as unknown as CleaningApiClient,
      date: DATE,
      occurredAt: NOW,
      taskId: 'task-1',
      today: createToday(),
      workspaceId: WORKSPACE_ID,
    })

    expect(result.queued).toBe(false)
    expect(completeTask.mock.calls[0]?.[2]?.operationId).toBe(
      result.operationId,
    )
  })

  it('falls back to one direct online write when enqueue fails before persistence', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const today = createToday()
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createFullPlan(),
      NOW,
    )
    await replaceCachedCleaningToday(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      DATE,
      today,
      NOW,
    )
    await expect(probeCleaningOfflineStorage()).resolves.toBe('ready')
    const storageError = new Error('IndexedDB write failed')
    storageError.name = 'QuotaExceededError'
    const originalTransaction = testDexiePrototype.transaction
    let failedEnqueue = false
    const transactionSpy = vi
      .spyOn(testDexiePrototype, 'transaction')
      .mockImplementation(function (this: Dexie, ...args: unknown[]) {
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
    const completeTask = vi
      .fn<CleaningApiClient['completeTask']>()
      .mockResolvedValue(actionResponse())

    const result = await queueCleaningTaskCompletion({
      actorUserId: ACTOR_USER_ID,
      api: { completeTask } as unknown as CleaningApiClient,
      date: DATE,
      occurredAt: NOW,
      taskId: 'task-1',
      today,
      workspaceId: WORKSPACE_ID,
    })
    transactionSpy.mockRestore()

    expect(failedEnqueue).toBe(true)
    expect(result.queued).toBe(false)
    expect(completeTask).toHaveBeenCalledOnce()
    expect(completeTask.mock.calls[0]?.[2]?.operationId).toBe(
      result.operationId,
    )
    await expect(
      listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it('invalidates a completion whose generation was captured before a delayed probe', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
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
    const completeTask = vi
      .fn<CleaningApiClient['completeTask']>()
      .mockResolvedValue(actionResponse())
    const completion = queueCleaningTaskCompletion({
      actorUserId: ACTOR_USER_ID,
      api: { completeTask } as unknown as CleaningApiClient,
      date: DATE,
      occurredAt: NOW,
      taskId: 'task-1',
      today: createToday(),
      workspaceId: WORKSPACE_ID,
    })

    await probeStarted.promise
    await clearCleaningOfflineWorkspaceData(WORKSPACE_ID)
    releaseProbe.resolve()

    await expect(completion).rejects.toBeInstanceOf(
      CleaningOfflineGenerationInvalidatedError,
    )
    expect(completeTask).not.toHaveBeenCalled()
    await expect(
      listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([])
  })
})

function createToday(): CleaningTodayResponse {
  const plan = createFullPlan()
  const task = plan.tasks[0]!
  const state = plan.states[0]!
  const zone = plan.zones[0]!
  const item = {
    isDue: true,
    isOverdue: false,
    score: 3,
    state,
    task,
    zone,
  }

  return {
    accumulatedItems: [],
    date: DATE,
    dayOfWeek: 4,
    generalItems: [],
    history: [],
    items: [item],
    quickItems: [item],
    seasonalItems: [],
    summary: {
      accumulatedCount: 0,
      activeZoneCount: 1,
      completedTodayCount: 0,
      dueCount: 1,
      generalCount: 0,
      quickCount: 1,
      seasonalCount: 0,
      urgentCount: 0,
    },
    urgentItems: [],
    zones: [zone],
  }
}

function createFullPlan(): CleaningListResponse {
  const zone = {
    createdAt: NOW,
    dayOfWeek: 4,
    deletedAt: null,
    description: '',
    id: 'zone-1',
    isActive: true,
    sortOrder: 0,
    title: 'Кухня',
    updatedAt: NOW,
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
  const baseTask = {
    assignee: 'anyone' as const,
    createdAt: NOW,
    customIntervalDays: null,
    deletedAt: null,
    depth: 'regular' as const,
    description: '',
    energy: 'normal' as const,
    estimatedMinutes: 15,
    frequencyInterval: 1,
    frequencyType: 'weekly' as const,
    impactScore: 3,
    isActive: true,
    isSeasonal: false,
    priority: 'normal' as const,
    scope: 'zone' as const,
    seasonMonths: [],
    sortOrder: 0,
    tags: [],
    updatedAt: NOW,
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
    zoneId: zone.id,
  }

  return {
    history: [],
    states: [
      {
        lastCompletedAt: null,
        lastPostponedAt: null,
        lastSkippedAt: null,
        nextDueAt: null,
        postponeCount: 0,
        taskId: 'task-1',
        updatedAt: NOW,
        version: 1,
        workspaceId: WORKSPACE_ID,
      },
      {
        lastCompletedAt: null,
        lastPostponedAt: null,
        lastSkippedAt: null,
        nextDueAt: null,
        postponeCount: 0,
        taskId: 'task-hidden',
        updatedAt: NOW,
        version: 1,
        workspaceId: WORKSPACE_ID,
      },
    ],
    tasks: [
      { ...baseTask, id: 'task-1', title: 'Пылесос' },
      { ...baseTask, id: 'task-hidden', sortOrder: 1, title: 'Окна' },
    ],
    zones: [zone],
  }
}

function actionResponse(): CleaningTaskActionResponse {
  return {
    historyItem: {
      action: 'completed',
      createdAt: NOW,
      date: DATE,
      id: 'history-1',
      note: '',
      targetDate: null,
      taskId: 'task-1',
      userId: ACTOR_USER_ID,
      workspaceId: WORKSPACE_ID,
      zoneId: 'zone-1',
    },
    state: {
      lastCompletedAt: NOW,
      lastPostponedAt: null,
      lastSkippedAt: null,
      nextDueAt: '2026-08-13',
      postponeCount: 0,
      taskId: 'task-1',
      updatedAt: NOW,
      version: 2,
      workspaceId: WORKSPACE_ID,
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

function callTestDexieTransaction(
  transaction: TestDexieTransaction,
  database: Dexie,
  args: unknown[],
): unknown {
  return Reflect.apply(transaction, database, args)
}
