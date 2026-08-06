import 'fake-indexeddb/auto'

import type {
  CleaningListResponse,
  CleaningTodayResponse,
} from '@planner/contracts'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CleaningApiClient } from './cleaning-api'
import {
  CLEANING_OFFLINE_DATABASE_NAME,
  CLEANING_TODAY_CACHE_LIMIT,
  CleaningOfflineMutationNotPersistedError,
  clearCleaningOfflineWorkspaceData,
  completeCleaningOfflineMutation,
  discardConflictedCleaningMutations,
  enqueueCleaningOfflineMutation,
  getCleaningOfflineStorageHealth,
  getCleaningOfflineWorkspaceWriteGeneration,
  listCleaningOfflineMutations,
  loadCachedCleaningPlan,
  loadCachedCleaningToday,
  markCleaningOfflineMutationConflicted,
  probeCleaningOfflineStorage,
  replaceCachedCleaningPlan,
  replaceCachedCleaningToday,
  resetCleaningOfflineDatabaseForTests,
  resetCleaningOfflineRuntimeForTests,
  retryConflictedCleaningMutations,
} from './offline-cleaning-store'
import { drainCleaningOfflineQueue } from './offline-cleaning-sync'

type TestDexieTransaction = (this: Dexie, ...args: unknown[]) => unknown
const testDexiePrototype = Dexie.prototype as unknown as {
  transaction: TestDexieTransaction
}

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'
const SYNCED_AT = '2026-08-06T08:30:00.000Z'

describe('offline cleaning store', () => {
  beforeEach(async () => {
    await resetCleaningOfflineDatabaseForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('persists an empty plan as a successful read instead of losing it', async () => {
    const plan = createPlan()

    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      plan,
      SYNCED_AT,
    )

    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual({
      data: plan,
      lastSuccessfulSyncAt: SYNCED_AT,
    })
  })

  it('downgrades durable storage health after a browser transaction failure', async () => {
    await expect(probeCleaningOfflineStorage()).resolves.toBe('ready')
    const storageError = new Error('IndexedDB writes are blocked')
    storageError.name = 'SecurityError'
    const transactionSpy = vi
      .spyOn(Dexie.prototype, 'transaction')
      .mockImplementationOnce(() => {
        throw storageError
      })

    try {
      await expect(
        enqueueCleaningOfflineMutation({
          actorUserId: ACTOR_USER_ID,
          entityKeys: [],
          input: {
            dayOfWeek: 2,
            description: '',
            id: 'zone-offline',
            isActive: true,
            title: 'Ванная',
          },
          type: 'zone.create',
          workspaceId: WORKSPACE_ID,
          zoneId: 'zone-offline',
        }),
      ).rejects.toMatchObject({
        cause: storageError,
        name: CleaningOfflineMutationNotPersistedError.name,
      })
    } finally {
      transactionSpy.mockRestore()
    }

    expect(getCleaningOfflineStorageHealth()).toBe('failed')
  })

  it('keeps failed storage terminal when an older successful write settles later', async () => {
    await expect(probeCleaningOfflineStorage()).resolves.toBe('ready')
    const originalTransaction = testDexiePrototype.transaction
    const firstTransactionFinished = createDeferred<void>()
    const releaseFirstResult = createDeferred<void>()
    const storageError = new Error('IndexedDB quota exhausted')
    storageError.name = 'QuotaExceededError'
    let transactionCount = 0

    vi.spyOn(testDexiePrototype, 'transaction').mockImplementation(function (
      this: Dexie,
      ...args: unknown[]
    ) {
      transactionCount += 1

      if (transactionCount === 2) {
        throw storageError
      }

      const transaction = Promise.resolve(
        callTestDexieTransaction(originalTransaction, this, args),
      )

      if (transactionCount !== 1) {
        return transaction
      }

      return transaction.then(async (value: unknown) => {
        firstTransactionFinished.resolve()
        await releaseFirstResult.promise
        return value
      })
    })

    const olderSuccessfulWrite = replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
    )
    await firstTransactionFinished.promise

    await expect(
      replaceCachedCleaningPlan(
        'workspace-2',
        ACTOR_USER_ID,
        createPlan(),
        SYNCED_AT,
      ),
    ).rejects.toBe(storageError)
    releaseFirstResult.resolve()
    await expect(olderSuccessfulWrite).resolves.toBeDefined()

    expect(getCleaningOfflineStorageHealth()).toBe('failed')
  })

  it('does not mark IndexedDB durable when opening it is blocked', async () => {
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })

    try {
      await expect(probeCleaningOfflineStorage()).resolves.toBe('failed')
    } finally {
      openSpy.mockRestore()
    }

    expect(getCleaningOfflineStorageHealth()).toBe('failed')
  })

  it('keeps dated today responses isolated', async () => {
    const today = createToday('2026-08-06')

    await replaceCachedCleaningToday(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      '2026-08-06',
      today,
      SYNCED_AT,
    )

    await expect(
      loadCachedCleaningToday(WORKSPACE_ID, ACTOR_USER_ID, '2026-08-06'),
    ).resolves.toEqual({
      data: today,
      lastSuccessfulSyncAt: SYNCED_AT,
    })
    await expect(
      loadCachedCleaningToday(WORKSPACE_ID, ACTOR_USER_ID, '2026-08-07'),
    ).resolves.toBeNull()
  })

  it('keeps the newer dated response when an older request finishes later', async () => {
    const olderToday = createToday('2026-08-06')
    const newerToday = {
      ...olderToday,
      summary: { ...olderToday.summary, dueCount: 1 },
    }
    const generation = getCleaningOfflineWorkspaceWriteGeneration(WORKSPACE_ID)

    await replaceCachedCleaningToday(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      '2026-08-06',
      newerToday,
      '2026-08-06T08:32:00.000Z',
      generation,
      200,
    )
    const staleWrite = await replaceCachedCleaningToday(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      '2026-08-06',
      olderToday,
      '2026-08-06T08:31:00.000Z',
      generation,
      100,
    )

    expect(staleWrite.data.summary.dueCount).toBe(1)
    expect(staleWrite.lastSuccessfulSyncAt).toBe('2026-08-06T08:32:00.000Z')
  })

  it('clears only the selected workspace', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
    )
    await replaceCachedCleaningPlan(
      'workspace-2',
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
    )

    await clearCleaningOfflineWorkspaceData(WORKSPACE_ID)

    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toBeNull()
    await expect(
      loadCachedCleaningPlan('workspace-2', ACTOR_USER_ID),
    ).resolves.not.toBeNull()
  })

  it('replays a durable pending purge before cache reads or queue drain after storage recovers', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlanWithTask(),
      SYNCED_AT,
    )
    await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['zone:zone-1'],
      expectedVersion: 1,
      input: { title: 'Старая кухня' },
      operationId: '0198-queued-before-purge',
      type: 'zone.update',
      workspaceId: WORKSPACE_ID,
      zoneId: 'zone-1',
    })
    const storageError = new Error('IndexedDB is temporarily unavailable')
    storageError.name = 'SecurityError'
    const transactionSpy = vi
      .spyOn(Dexie.prototype, 'transaction')
      .mockImplementation(() => {
        throw storageError
      })

    await expect(
      enqueueCleaningOfflineMutation({
        actorUserId: ACTOR_USER_ID,
        entityKeys: ['zone:zone-failing'],
        input: {
          dayOfWeek: 2,
          description: '',
          id: 'zone-failing',
          isActive: true,
          title: 'Ванная',
        },
        type: 'zone.create',
        workspaceId: WORKSPACE_ID,
        zoneId: 'zone-failing',
      }),
    ).rejects.toBeInstanceOf(CleaningOfflineMutationNotPersistedError)
    expect(getCleaningOfflineStorageHealth()).toBe('failed')

    await expect(
      clearCleaningOfflineWorkspaceData(WORKSPACE_ID),
    ).resolves.toBeUndefined()
    transactionSpy.mockRestore()
    resetCleaningOfflineRuntimeForTests()

    await expect(probeCleaningOfflineStorage()).resolves.toBe('ready')
    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toBeNull()
    await expect(
      listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([])

    const createZone = vi.fn()
    await expect(
      drainCleaningOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api: { createZone } as unknown as CleaningApiClient,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toMatchObject({ processed: 0, synced: 0 })
    expect(createZone).not.toHaveBeenCalled()
  })

  it('rejects cleanup when neither an immediate purge nor a durable marker is possible', async () => {
    vi.stubGlobal('indexedDB', undefined)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })

    await expect(
      clearCleaningOfflineWorkspaceData(WORKSPACE_ID),
    ).rejects.toThrow('Не удалось надёжно очистить локальные данные уборки')
  })

  it('rejects cleanup when the current tab is purged but cross-tab invalidation cannot be persisted', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlanWithTask(),
      SYNCED_AT,
    )
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Storage denied', 'SecurityError')
      })

    await expect(
      clearCleaningOfflineWorkspaceData(WORKSPACE_ID),
    ).rejects.toThrow('Не удалось надёжно очистить локальные данные уборки')

    setItemSpy.mockRestore()
    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toBeNull()
  })

  it('keeps pending purges for different workspaces in independent durable records', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlanWithTask(),
      SYNCED_AT,
    )
    await replaceCachedCleaningPlan(
      'workspace-2',
      ACTOR_USER_ID,
      createPlanWithTask(),
      SYNCED_AT,
    )
    const storageError = new Error('IndexedDB is temporarily unavailable')
    storageError.name = 'SecurityError'
    const transactionSpy = vi
      .spyOn(Dexie.prototype, 'transaction')
      .mockImplementation(() => {
        throw storageError
      })

    await expect(
      Promise.all([
        clearCleaningOfflineWorkspaceData(WORKSPACE_ID),
        clearCleaningOfflineWorkspaceData('workspace-2'),
      ]),
    ).resolves.toEqual([undefined, undefined])

    expect(
      window.localStorage.getItem(
        `planner.cleaningOfflineLifecycle:${encodeURIComponent(WORKSPACE_ID)}`,
      ),
    ).not.toBeNull()
    expect(
      window.localStorage.getItem(
        `planner.cleaningOfflineLifecycle:${encodeURIComponent('workspace-2')}`,
      ),
    ).not.toBeNull()
    transactionSpy.mockRestore()
    resetCleaningOfflineRuntimeForTests()

    await expect(probeCleaningOfflineStorage()).resolves.toBe('ready')
    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toBeNull()
    await expect(
      loadCachedCleaningPlan('workspace-2', ACTOR_USER_ID),
    ).resolves.toBeNull()
  })

  it('never exposes one actor cache to another actor in the same workspace', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
    )

    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, 'user-2'),
    ).resolves.toBeNull()
  })

  it('clears legacy rows without an actor during the schema upgrade', async () => {
    const legacyDatabase = new Dexie(CLEANING_OFFLINE_DATABASE_NAME)
    legacyDatabase.version(1).stores({
      cachedPlans: 'key, workspaceId, lastSuccessfulSyncAt',
      cachedTodayResponses:
        'key, workspaceId, date, lastSuccessfulSyncAt, [workspaceId+date]',
    })
    await legacyDatabase.open()
    await legacyDatabase.table('cachedPlans').put({
      data: createPlan(),
      key: `${WORKSPACE_ID}:plan`,
      lastSuccessfulSyncAt: SYNCED_AT,
      workspaceId: WORKSPACE_ID,
    })
    legacyDatabase.close()

    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toBeNull()

    const upgradedDatabase = new Dexie(CLEANING_OFFLINE_DATABASE_NAME)
    await upgradedDatabase.open()
    await expect(upgradedDatabase.table('cachedPlans').count()).resolves.toBe(0)
    upgradedDatabase.close()
  })

  it('bounds dated responses per actor while retaining the newest days', async () => {
    for (let index = 0; index <= CLEANING_TODAY_CACHE_LIMIT; index += 1) {
      const date = new Date(Date.UTC(2026, 0, index + 1))
        .toISOString()
        .slice(0, 10)
      await replaceCachedCleaningToday(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        date,
        createToday(date),
        `${date}T08:00:00.000Z`,
      )
    }

    await expect(
      loadCachedCleaningToday(WORKSPACE_ID, ACTOR_USER_ID, '2026-01-01'),
    ).resolves.toBeNull()
    await expect(
      loadCachedCleaningToday(
        WORKSPACE_ID,
        ACTOR_USER_ID,
        new Date(Date.UTC(2026, 0, CLEANING_TODAY_CACHE_LIMIT + 1))
          .toISOString()
          .slice(0, 10),
      ),
    ).resolves.not.toBeNull()
  })

  it('does not resurrect a snapshot returned after workspace cleanup', async () => {
    const requestGeneration =
      getCleaningOfflineWorkspaceWriteGeneration(WORKSPACE_ID)

    await clearCleaningOfflineWorkspaceData(WORKSPACE_ID)
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
      requestGeneration,
    )

    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toBeNull()
  })

  it('does not return a stale read that started before an asynchronous storage probe and cleanup', async () => {
    const stalePlan = createPlanWithTask()
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      stalePlan,
      SYNCED_AT,
    )
    resetCleaningOfflineRuntimeForTests()

    const originalTransaction = testDexiePrototype.transaction
    const probeStarted = createDeferred<void>()
    const releaseProbe = createDeferred<void>()
    let transactionCount = 0

    vi.spyOn(testDexiePrototype, 'transaction').mockImplementation(function (
      this: Dexie,
      ...args: unknown[]
    ) {
      transactionCount += 1

      if (transactionCount !== 1) {
        return callTestDexieTransaction(originalTransaction, this, args)
      }

      probeStarted.resolve()
      return releaseProbe.promise.then(() =>
        callTestDexieTransaction(originalTransaction, this, args),
      )
    })

    const pendingRead = loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID)
    await probeStarted.promise
    await clearCleaningOfflineWorkspaceData(WORKSPACE_ID)

    const staleDatabase = new Dexie(CLEANING_OFFLINE_DATABASE_NAME)
    await staleDatabase.open()
    await staleDatabase.table('cachedPlans').put({
      actorUserId: ACTOR_USER_ID,
      data: stalePlan,
      key: `${WORKSPACE_ID}:${ACTOR_USER_ID}:plan`,
      lastSuccessfulSyncAt: SYNCED_AT,
      valueVersion: 1,
      workspaceId: WORKSPACE_ID,
    })
    staleDatabase.close()
    releaseProbe.resolve()

    await expect(pendingRead).resolves.toBeNull()
  })

  it('observes a cleanup generation written by another browser context', async () => {
    const requestGeneration =
      getCleaningOfflineWorkspaceWriteGeneration(WORKSPACE_ID)
    window.localStorage.setItem(
      `planner.cleaningOfflineLifecycle:${encodeURIComponent(WORKSPACE_ID)}`,
      JSON.stringify({
        pendingPurgeMarker: null,
        writeGeneration: requestGeneration + 1,
      }),
    )

    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
      requestGeneration,
    )

    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toBeNull()
  })

  it('keeps the optimistic overlay after a server refresh and reload', async () => {
    const plan = createPlanWithTask()

    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      plan,
      SYNCED_AT,
    )
    await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['zone:zone-1'],
      expectedVersion: 1,
      input: { title: 'Новая кухня' },
      type: 'zone.update',
      workspaceId: WORKSPACE_ID,
      zoneId: 'zone-1',
    })
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      plan,
      '2026-08-06T08:31:00.000Z',
    )

    const restored = await loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID)

    expect(restored?.data.zones[0]).toMatchObject({
      title: 'Новая кухня',
      version: 2,
    })
  })

  it('ignores an older read response that arrives after a newer request', async () => {
    const olderPlan = createPlanWithTask()
    const newerPlan = {
      ...olderPlan,
      zones: olderPlan.zones.map((zone) => ({
        ...zone,
        title: 'Кухня с нового снимка',
        version: 2,
      })),
    }
    const generation = getCleaningOfflineWorkspaceWriteGeneration(WORKSPACE_ID)

    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      newerPlan,
      '2026-08-06T08:32:00.000Z',
      generation,
      200,
    )
    const staleWrite = await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      olderPlan,
      '2026-08-06T08:31:00.000Z',
      generation,
      100,
    )

    expect(staleWrite).toMatchObject({
      data: {
        zones: [
          expect.objectContaining({
            title: 'Кухня с нового снимка',
            version: 2,
          }),
        ],
      },
      lastSuccessfulSyncAt: '2026-08-06T08:32:00.000Z',
    })
    await expect(
      loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toMatchObject(staleWrite)
  })

  it('does not let a read started before mutation confirmation erase it', async () => {
    const plan = createPlanWithTask()
    const generation = getCleaningOfflineWorkspaceWriteGeneration(WORKSPACE_ID)
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      plan,
      SYNCED_AT,
      generation,
      100,
    )
    const mutation = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['zone:zone-1'],
      expectedVersion: 1,
      input: { title: 'Подтверждённая кухня' },
      type: 'zone.update',
      workspaceId: WORKSPACE_ID,
      zoneId: 'zone-1',
    })
    const staleRequestStartedAt = Date.now()

    await completeCleaningOfflineMutation(
      mutation.operationId,
      {
        kind: 'zone',
        value: {
          ...plan.zones[0]!,
          title: 'Подтверждённая кухня',
          version: 2,
        },
      },
      WORKSPACE_ID,
      ACTOR_USER_ID,
      generation,
    )
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      plan,
      '2026-08-06T08:31:00.000Z',
      generation,
      staleRequestStartedAt,
    )

    expect(
      (await loadCachedCleaningPlan(WORKSPACE_ID, ACTOR_USER_ID))?.data
        .zones[0],
    ).toMatchObject({ title: 'Подтверждённая кухня', version: 2 })
  })

  it('coalesces same-day actions while retaining confirmed base versions', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlanWithTask(),
      SYNCED_AT,
    )
    await enqueueCleaningOfflineMutation(
      createTaskActionMutation('completed', 1),
    )
    await enqueueCleaningOfflineMutation(createTaskActionMutation('skipped', 2))

    const queued = await listCleaningOfflineMutations(
      WORKSPACE_ID,
      ACTOR_USER_ID,
    )

    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({
      action: 'skipped',
      expectedStateVersion: 1,
      expectedTaskVersion: 1,
      type: 'task.action',
    })
  })

  it('does not coalesce an action across a later update of the same task', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlanWithTask(),
      SYNCED_AT,
    )
    const firstAction = await enqueueCleaningOfflineMutation(
      createTaskActionMutation('completed', 1),
    )
    const taskUpdate = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['task:task-1'],
      expectedVersion: 1,
      input: { title: 'Пылесосить тщательно' },
      taskId: 'task-1',
      type: 'task.update',
      workspaceId: WORKSPACE_ID,
    })
    const secondAction = await enqueueCleaningOfflineMutation(
      createTaskActionMutation('skipped', 2),
    )

    const queued = await listCleaningOfflineMutations(
      WORKSPACE_ID,
      ACTOR_USER_ID,
    )
    const persistedUpdate = queued.find(
      (mutation) => mutation.operationId === taskUpdate.operationId,
    )
    const persistedSecondAction = queued.find(
      (mutation) => mutation.operationId === secondAction.operationId,
    )

    expect(queued).toHaveLength(3)
    expect(persistedUpdate?.dependsOnOperationIds).toContain(
      firstAction.operationId,
    )
    expect(persistedUpdate?.dependsOnOperationIds).not.toContain(
      secondAction.operationId,
    )
    expect(persistedSecondAction?.dependsOnOperationIds).toContain(
      taskUpdate.operationId,
    )
  })

  it('records create dependencies and removes a discarded conflict subtree', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
    )
    const zone = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['zone:zone-new'],
      input: {
        dayOfWeek: 1,
        description: '',
        id: 'zone-new',
        isActive: true,
        title: 'Кухня',
      },
      type: 'zone.create',
      workspaceId: WORKSPACE_ID,
      zoneId: 'zone-new',
    })
    const task = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['task:task-new', 'zone:zone-new'],
      input: {
        assignee: 'anyone',
        customIntervalDays: null,
        depth: 'regular',
        description: '',
        energy: 'normal',
        estimatedMinutes: null,
        frequencyInterval: 1,
        frequencyType: 'weekly',
        id: 'task-new',
        impactScore: 3,
        isActive: true,
        isSeasonal: false,
        priority: 'normal',
        scope: 'zone',
        seasonMonths: [],
        tags: [],
        title: 'Пылесос',
        zoneId: 'zone-new',
      },
      taskId: 'task-new',
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })

    expect(task.dependsOnOperationIds).toContain(zone.operationId)

    await markCleaningOfflineMutationConflicted(
      zone.operationId,
      { actualVersion: 2, expectedVersion: 1, message: 'conflict' },
      WORKSPACE_ID,
      ACTOR_USER_ID,
      getCleaningOfflineWorkspaceWriteGeneration(WORKSPACE_ID),
    )
    await discardConflictedCleaningMutations(WORKSPACE_ID, ACTOR_USER_ID)

    await expect(
      listCleaningOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it('derives a target-zone dependency for a task move', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlanWithTask(),
      SYNCED_AT,
    )
    const zone = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['zone:zone-2'],
      input: {
        dayOfWeek: 2,
        description: '',
        id: 'zone-2',
        isActive: true,
        title: 'Ванная',
      },
      type: 'zone.create',
      workspaceId: WORKSPACE_ID,
      zoneId: 'zone-2',
    })
    const task = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['task:task-1'],
      expectedVersion: 1,
      input: { scope: 'zone', zoneId: 'zone-2' },
      taskId: 'task-1',
      type: 'task.update',
      workspaceId: WORKSPACE_ID,
    })

    expect(task.entityKeys).toContain('zone:zone-2')
    expect(task.dependsOnOperationIds).toContain(zone.operationId)
  })

  it('rewrites pending dependents when retrying a conflicted mutation', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
    )
    const zone = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['zone:zone-new'],
      input: {
        dayOfWeek: 1,
        description: '',
        id: 'zone-new',
        isActive: true,
        title: 'Кухня',
      },
      type: 'zone.create',
      workspaceId: WORKSPACE_ID,
      zoneId: 'zone-new',
    })
    const task = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['task:task-new', 'zone:zone-new'],
      input: {
        assignee: 'anyone',
        customIntervalDays: null,
        depth: 'regular',
        description: '',
        energy: 'normal',
        estimatedMinutes: null,
        frequencyInterval: 1,
        frequencyType: 'weekly',
        id: 'task-new',
        impactScore: 3,
        isActive: true,
        isSeasonal: false,
        priority: 'normal',
        scope: 'zone',
        seasonMonths: [],
        tags: [],
        title: 'Пылесос',
        zoneId: 'zone-new',
      },
      taskId: 'task-new',
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })
    await markCleaningOfflineMutationConflicted(
      zone.operationId,
      { actualVersion: null, expectedVersion: null, message: 'conflict' },
      WORKSPACE_ID,
      ACTOR_USER_ID,
      getCleaningOfflineWorkspaceWriteGeneration(WORKSPACE_ID),
    )

    await expect(
      retryConflictedCleaningMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toBe(1)

    const queued = await listCleaningOfflineMutations(
      WORKSPACE_ID,
      ACTOR_USER_ID,
    )
    const replacement = queued.find(
      (mutation) => mutation.type === 'zone.create',
    )
    const persistedTask = queued.find(
      (mutation) => mutation.operationId === task.operationId,
    )

    expect(replacement).toMatchObject({
      sequence: zone.sequence,
      status: 'pending',
    })
    expect(replacement?.operationId).not.toBe(zone.operationId)
    expect(persistedTask?.dependsOnOperationIds).toContain(
      replacement?.operationId,
    )
    expect(persistedTask?.dependsOnOperationIds).not.toContain(zone.operationId)
    expect(replacement?.sequence).toBeLessThan(persistedTask?.sequence ?? 0)
  })

  it('removes a completed dependency from persisted children atomically', async () => {
    await replaceCachedCleaningPlan(
      WORKSPACE_ID,
      ACTOR_USER_ID,
      createPlan(),
      SYNCED_AT,
    )
    const zone = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['zone:zone-new'],
      input: {
        dayOfWeek: 1,
        description: '',
        id: 'zone-new',
        isActive: true,
        title: 'Кухня',
      },
      type: 'zone.create',
      workspaceId: WORKSPACE_ID,
      zoneId: 'zone-new',
    })
    const task = await enqueueCleaningOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      entityKeys: ['task:task-new', 'zone:zone-new'],
      input: {
        assignee: 'anyone',
        customIntervalDays: null,
        depth: 'regular',
        description: '',
        energy: 'normal',
        estimatedMinutes: null,
        frequencyInterval: 1,
        frequencyType: 'weekly',
        id: 'task-new',
        impactScore: 3,
        isActive: true,
        isSeasonal: false,
        priority: 'normal',
        scope: 'zone',
        seasonMonths: [],
        tags: [],
        title: 'Пылесос',
        zoneId: 'zone-new',
      },
      taskId: 'task-new',
      type: 'task.create',
      workspaceId: WORKSPACE_ID,
    })

    await completeCleaningOfflineMutation(
      zone.operationId,
      { kind: 'zone', value: createZoneRecord('zone-new') },
      WORKSPACE_ID,
      ACTOR_USER_ID,
      getCleaningOfflineWorkspaceWriteGeneration(WORKSPACE_ID),
    )

    const queued = await listCleaningOfflineMutations(
      WORKSPACE_ID,
      ACTOR_USER_ID,
    )
    const persistedTask = queued.find(
      (mutation) => mutation.operationId === task.operationId,
    )

    expect(queued).toHaveLength(1)
    expect(persistedTask?.dependsOnOperationIds).not.toContain(zone.operationId)
  })
})

function createPlan(): CleaningListResponse {
  return {
    history: [],
    states: [],
    tasks: [],
    zones: [],
  }
}

function createPlanWithTask(): CleaningListResponse {
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
        updatedAt: SYNCED_AT,
        version: 1,
        workspaceId: WORKSPACE_ID,
      },
    ],
    tasks: [
      {
        assignee: 'anyone',
        createdAt: SYNCED_AT,
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
        scope: 'zone',
        seasonMonths: [],
        sortOrder: 0,
        tags: [],
        title: 'Пылесос',
        updatedAt: SYNCED_AT,
        userId: ACTOR_USER_ID,
        version: 1,
        workspaceId: WORKSPACE_ID,
        zoneId: 'zone-1',
      },
    ],
    zones: [
      {
        createdAt: SYNCED_AT,
        dayOfWeek: 4,
        deletedAt: null,
        description: '',
        id: 'zone-1',
        isActive: true,
        sortOrder: 0,
        title: 'Кухня',
        updatedAt: SYNCED_AT,
        userId: ACTOR_USER_ID,
        version: 1,
        workspaceId: WORKSPACE_ID,
      },
    ],
  }
}

function createZoneRecord(id: string) {
  return {
    createdAt: SYNCED_AT,
    dayOfWeek: 1 as const,
    deletedAt: null,
    description: '',
    id,
    isActive: true,
    sortOrder: 0,
    title: 'Кухня',
    updatedAt: SYNCED_AT,
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
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

function createTaskActionMutation(
  action: 'completed' | 'skipped',
  expectedStateVersion: number,
) {
  return {
    action,
    actorUserId: ACTOR_USER_ID,
    entityKeys: ['task:task-1'],
    expectedStateVersion,
    expectedTaskVersion: 1,
    input: {
      date: '2026-08-06',
      mode: 'next_cycle' as const,
      note: '',
      occurredAt: '2026-08-06T08:30:00.000Z',
      targetDate: null,
    },
    taskId: 'task-1',
    type: 'task.action' as const,
    workspaceId: WORKSPACE_ID,
  }
}

function createToday(date: string): CleaningTodayResponse {
  return {
    accumulatedItems: [],
    date,
    dayOfWeek: 4,
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
