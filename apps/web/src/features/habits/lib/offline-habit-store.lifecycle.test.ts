import 'fake-indexeddb/auto'

import type { HabitRecord } from '@planner/contracts'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearHabitOfflineWorkspaceData,
  enqueueHabitOfflineMutation,
  HABIT_OFFLINE_DATABASE_NAME,
  HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
  HabitOfflinePurgeUnavailableError,
  listRetryableHabitOfflineMutations,
  loadCachedHabitRecords,
  replaceCachedHabitRecords,
  resetHabitOfflineDatabaseForTests,
  resetHabitOfflineRuntimeForTests,
  upsertCachedHabitRecord,
} from './offline-habit-store'

type TestDexieTransaction = (this: Dexie, ...args: unknown[]) => unknown
const testDexiePrototype = Dexie.prototype as unknown as {
  transaction: TestDexieTransaction
}

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'

describe('offline habit workspace lifecycle', () => {
  beforeEach(async () => {
    await resetHabitOfflineDatabaseForTests()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await resetHabitOfflineDatabaseForTests()
  })

  it('rejects cleanup when neither IndexedDB purge nor a durable marker is available', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined)
    vi.stubGlobal('indexedDB', undefined)

    await expect(
      clearHabitOfflineWorkspaceData(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(HabitOfflinePurgeUnavailableError)
  })

  it('rejects a current-tab purge without the durable cross-tab marker', async () => {
    await replaceCachedHabitRecords(WORKSPACE_ID, [
      createHabitRecord('habit-1'),
    ])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked.', 'SecurityError')
    })

    await expect(
      clearHabitOfflineWorkspaceData(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(HabitOfflinePurgeUnavailableError)

    const db = await openHabitDatabase()
    expect(
      await db
        .table('cachedHabits')
        .where('workspaceId')
        .equals(WORKSPACE_ID)
        .count(),
    ).toBe(0)
    db.close()
  })

  it('persists a pending purge and applies it before cached reads or queue drain', async () => {
    await replaceCachedHabitRecords(WORKSPACE_ID, [
      createHabitRecord('habit-1'),
    ])
    await enqueueHabitOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      habitId: 'habit-2',
      input: {
        color: '#2f6f62',
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        description: '',
        endDate: null,
        frequency: 'daily',
        icon: 'check',
        id: 'habit-2',
        reminderTime: null,
        sortOrder: 0,
        sphereId: null,
        startDate: '2026-05-11',
        targetType: 'check',
        targetValue: 1,
        title: 'Queued habit',
        unit: '',
      },
      type: 'habit.create',
      workspaceId: WORKSPACE_ID,
    })

    vi.stubGlobal('indexedDB', undefined)
    await clearHabitOfflineWorkspaceData(WORKSPACE_ID)

    expect(readLifecycleState().pendingPurgeGeneration).toBe(1)

    resetHabitOfflineRuntimeForTests()
    vi.unstubAllGlobals()

    expect(await loadCachedHabitRecords(WORKSPACE_ID)).toEqual([])
    expect(await listRetryableHabitOfflineMutations(WORKSPACE_ID)).toEqual([])
    expect(readLifecycleState().pendingPurgeGeneration).toBeNull()
  })

  it('blocks stale-tab writes after observing a newer durable generation', async () => {
    await replaceCachedHabitRecords(WORKSPACE_ID, [
      createHabitRecord('habit-1'),
    ])

    const db = await openHabitDatabase()
    await db
      .table('cachedHabits')
      .where('workspaceId')
      .equals(WORKSPACE_ID)
      .delete()

    const nextLifecycle = JSON.stringify({
      pendingPurgeGeneration: null,
      writeGeneration: 1,
    })
    window.localStorage.setItem(lifecycleStorageKey(), nextLifecycle)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: lifecycleStorageKey(),
        newValue: nextLifecycle,
      }),
    )

    await upsertCachedHabitRecord(WORKSPACE_ID, createHabitRecord('habit-2'))

    expect(
      await db
        .table('cachedHabits')
        .where('workspaceId')
        .equals(WORKSPACE_ID)
        .count(),
    ).toBe(0)
    db.close()
  })

  it('keeps concurrent purge markers isolated per workspace', async () => {
    const otherWorkspaceId = 'workspace-2'
    await replaceCachedHabitRecords(WORKSPACE_ID, [
      createHabitRecord('habit-1'),
    ])
    await replaceCachedHabitRecords(otherWorkspaceId, [
      { ...createHabitRecord('habit-2'), workspaceId: otherWorkspaceId },
    ])

    const firstPurge = clearHabitOfflineWorkspaceData(WORKSPACE_ID)
    const secondPurge = clearHabitOfflineWorkspaceData(otherWorkspaceId)

    expect(readLifecycleState(WORKSPACE_ID)).toEqual({
      pendingPurgeGeneration: 1,
      writeGeneration: 1,
    })
    expect(readLifecycleState(otherWorkspaceId)).toEqual({
      pendingPurgeGeneration: 1,
      writeGeneration: 1,
    })

    await Promise.all([firstPurge, secondPurge])

    expect(readLifecycleState(WORKSPACE_ID).pendingPurgeGeneration).toBeNull()
    expect(
      readLifecycleState(otherWorkspaceId).pendingPurgeGeneration,
    ).toBeNull()
  })

  it('rechecks generation inside a queued write transaction after a cross-tab purge', async () => {
    await replaceCachedHabitRecords(WORKSPACE_ID, [
      createHabitRecord('habit-1'),
    ])
    const db = await openHabitDatabase()
    const originalTransaction = testDexiePrototype.transaction
    const staleTransactionQueued = createDeferred<void>()
    const releaseStaleTransaction = createDeferred<void>()
    let shouldGateTransaction = true

    vi.spyOn(testDexiePrototype, 'transaction').mockImplementation(function (
      this: Dexie,
      ...args: unknown[]
    ) {
      if (!shouldGateTransaction) {
        return callTestDexieTransaction(originalTransaction, this, args)
      }

      shouldGateTransaction = false
      staleTransactionQueued.resolve()
      return releaseStaleTransaction.promise.then(() =>
        callTestDexieTransaction(originalTransaction, this, args),
      )
    })

    const staleWrite = replaceCachedHabitRecords(WORKSPACE_ID, [
      createHabitRecord('habit-2'),
    ])
    await staleTransactionQueued.promise

    await db.transaction('rw', db.table('cachedHabits'), () =>
      db
        .table('cachedHabits')
        .where('workspaceId')
        .equals(WORKSPACE_ID)
        .delete(),
    )
    const nextLifecycle = JSON.stringify({
      pendingPurgeGeneration: null,
      writeGeneration: 1,
    })
    window.localStorage.setItem(lifecycleStorageKey(), nextLifecycle)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: lifecycleStorageKey(),
        newValue: nextLifecycle,
      }),
    )
    releaseStaleTransaction.resolve()
    await staleWrite

    expect(
      await db
        .table('cachedHabits')
        .where('workspaceId')
        .equals(WORKSPACE_ID)
        .count(),
    ).toBe(0)
    db.close()
  })
})

async function openHabitDatabase(): Promise<Dexie> {
  const db = new Dexie(HABIT_OFFLINE_DATABASE_NAME)
  await db.open()
  return db
}

function readLifecycleState(workspaceId = WORKSPACE_ID): {
  pendingPurgeGeneration: number | null
  writeGeneration: number
} {
  return JSON.parse(
    window.localStorage.getItem(lifecycleStorageKey(workspaceId)) ?? '{}',
  ) as {
    pendingPurgeGeneration: number | null
    writeGeneration: number
  }
}

function lifecycleStorageKey(workspaceId = WORKSPACE_ID): string {
  return `${HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

function callTestDexieTransaction(
  transaction: TestDexieTransaction,
  database: Dexie,
  args: unknown[],
): unknown {
  return Reflect.apply(transaction, database, args)
}

function createHabitRecord(habitId: string): HabitRecord {
  return {
    color: '#2f6f62',
    createdAt: '2026-05-11T00:00:00.000Z',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    deletedAt: null,
    description: '',
    endDate: null,
    frequency: 'daily',
    icon: 'check',
    id: habitId,
    isActive: true,
    reminderTime: null,
    sortOrder: 0,
    sphereId: null,
    startDate: '2026-05-11',
    targetType: 'check',
    targetValue: 1,
    title: 'Habit',
    unit: '',
    updatedAt: '2026-05-11T00:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}
