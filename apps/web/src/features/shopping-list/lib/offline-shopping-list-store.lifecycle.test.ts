import 'fake-indexeddb/auto'

import type { ChaosInboxItemRecord } from '@planner/contracts'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearShoppingListOfflineWorkspaceData,
  enqueueShoppingListOfflineMutation,
  listRetryableShoppingListOfflineMutations,
  loadCachedShoppingListItems,
  loadCachedShoppingListSnapshot,
  replaceCachedShoppingListItems,
  resetShoppingListOfflineDatabaseForTests,
  resetShoppingListOfflineRuntimeForTests,
  SHOPPING_LIST_OFFLINE_DATABASE_NAME,
  SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
  SHOPPING_LIST_OFFLINE_SCHEMA_VERSION,
  ShoppingListOfflinePurgeUnavailableError,
  upsertCachedShoppingListItem,
} from './offline-shopping-list-store'

type TestDexieTransaction = (this: Dexie, ...args: unknown[]) => unknown
const testDexiePrototype = Dexie.prototype as unknown as {
  transaction: TestDexieTransaction
}

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'

describe('offline shopping-list workspace lifecycle', () => {
  beforeEach(async () => {
    await resetShoppingListOfflineDatabaseForTests()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await resetShoppingListOfflineDatabaseForTests()
  })

  it('rejects cleanup when neither IndexedDB purge nor a durable marker is available', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined)
    vi.stubGlobal('indexedDB', undefined)

    await expect(
      clearShoppingListOfflineWorkspaceData(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(ShoppingListOfflinePurgeUnavailableError)
  })

  it('persists a complete empty snapshot with its last successful sync time', async () => {
    const lastSuccessfulSyncAt = '2026-08-13T09:00:00.000Z'

    await replaceCachedShoppingListItems(WORKSPACE_ID, [], lastSuccessfulSyncAt)

    expect(await loadCachedShoppingListSnapshot(WORKSPACE_ID)).toEqual({
      items: [],
      lastSuccessfulSyncAt,
    })
  })

  it('upgrades a v1 item cache without losing its offline data', async () => {
    await resetShoppingListOfflineDatabaseForTests()
    const legacyDatabase = new Dexie(SHOPPING_LIST_OFFLINE_DATABASE_NAME)
    legacyDatabase.version(1).stores({
      cachedItems: 'key, workspaceId, itemId, updatedAt',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
    })
    await legacyDatabase.open()
    const item = createShoppingListItem('legacy-item')
    const updatedAt = '2026-08-12T08:30:00.000Z'
    await legacyDatabase.table('cachedItems').put({
      item,
      itemId: item.id,
      key: `${WORKSPACE_ID}:${item.id}`,
      updatedAt,
      workspaceId: WORKSPACE_ID,
    })
    legacyDatabase.close()
    resetShoppingListOfflineRuntimeForTests()

    expect(await loadCachedShoppingListSnapshot(WORKSPACE_ID)).toEqual({
      items: [item],
      lastSuccessfulSyncAt: updatedAt,
    })

    const upgradedDatabase = await openShoppingListDatabase()
    expect(upgradedDatabase.verno).toBe(SHOPPING_LIST_OFFLINE_SCHEMA_VERSION)
    expect(upgradedDatabase.tables.map((table) => table.name)).toContain(
      'cachedSnapshots',
    )
    upgradedDatabase.close()
  })

  it('rejects a current-tab purge without the durable cross-tab marker', async () => {
    await replaceCachedShoppingListItems(WORKSPACE_ID, [
      createShoppingListItem('item-1'),
    ])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked.', 'SecurityError')
    })

    await expect(
      clearShoppingListOfflineWorkspaceData(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(ShoppingListOfflinePurgeUnavailableError)

    const db = await openShoppingListDatabase()
    expect(
      await db
        .table('cachedItems')
        .where('workspaceId')
        .equals(WORKSPACE_ID)
        .count(),
    ).toBe(0)
    db.close()
  })

  it('persists a pending purge and applies it before cached reads or queue drain', async () => {
    await replaceCachedShoppingListItems(WORKSPACE_ID, [
      createShoppingListItem('item-1'),
    ])
    await enqueueShoppingListOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      itemId: 'item-2',
      text: 'Queued item',
      type: 'shopping.create',
      workspaceId: WORKSPACE_ID,
    })

    vi.stubGlobal('indexedDB', undefined)
    await clearShoppingListOfflineWorkspaceData(WORKSPACE_ID)

    expect(readLifecycleState().pendingPurgeGeneration).toBe(1)

    resetShoppingListOfflineRuntimeForTests()
    vi.unstubAllGlobals()

    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([])
    expect(
      await listRetryableShoppingListOfflineMutations(WORKSPACE_ID),
    ).toEqual([])
    expect(readLifecycleState().pendingPurgeGeneration).toBeNull()
  })

  it('blocks stale-tab writes after observing a newer durable generation', async () => {
    await replaceCachedShoppingListItems(WORKSPACE_ID, [
      createShoppingListItem('item-1'),
    ])

    const db = await openShoppingListDatabase()
    await db
      .table('cachedItems')
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

    await upsertCachedShoppingListItem(
      WORKSPACE_ID,
      createShoppingListItem('item-2'),
    )

    expect(
      await db
        .table('cachedItems')
        .where('workspaceId')
        .equals(WORKSPACE_ID)
        .count(),
    ).toBe(0)
    db.close()
  })

  it('keeps concurrent purge markers isolated per workspace', async () => {
    const otherWorkspaceId = 'workspace-2'
    await replaceCachedShoppingListItems(WORKSPACE_ID, [
      createShoppingListItem('item-1'),
    ])
    await replaceCachedShoppingListItems(otherWorkspaceId, [
      {
        ...createShoppingListItem('item-2'),
        workspaceId: otherWorkspaceId,
      },
    ])

    const firstPurge = clearShoppingListOfflineWorkspaceData(WORKSPACE_ID)
    const secondPurge = clearShoppingListOfflineWorkspaceData(otherWorkspaceId)

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
    await replaceCachedShoppingListItems(WORKSPACE_ID, [
      createShoppingListItem('item-1'),
    ])
    const db = await openShoppingListDatabase()
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

    const staleWrite = replaceCachedShoppingListItems(WORKSPACE_ID, [
      createShoppingListItem('item-2'),
    ])
    await staleTransactionQueued.promise

    await db.transaction('rw', db.table('cachedItems'), () =>
      db
        .table('cachedItems')
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
        .table('cachedItems')
        .where('workspaceId')
        .equals(WORKSPACE_ID)
        .count(),
    ).toBe(0)
    db.close()
  })
})

async function openShoppingListDatabase(): Promise<Dexie> {
  const db = new Dexie(SHOPPING_LIST_OFFLINE_DATABASE_NAME)
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
  return `${SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
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

function createShoppingListItem(itemId: string): ChaosInboxItemRecord {
  return {
    activatedAt: '2026-05-04T10:00:00.000Z',
    completedAt: null,
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: '2026-05-04T10:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id: itemId,
    isFavorite: false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: null,
    shoppingCategory: null,
    source: 'manual',
    sphereId: null,
    status: 'new',
    text: 'Milk',
    updatedAt: '2026-05-04T10:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}
