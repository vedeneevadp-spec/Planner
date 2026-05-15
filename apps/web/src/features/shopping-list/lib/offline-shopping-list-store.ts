import {
  type ChaosInboxItemRecord,
  type ChaosInboxItemUpdateInput,
  type ChaosInboxPriority,
  type ChaosInboxShoppingCategory,
  generateUuidV7,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

export type ShoppingListOfflineMutationStatus = 'failed' | 'pending' | 'syncing'

interface ShoppingListCachedItemRow {
  item: ChaosInboxItemRecord
  itemId: string
  key: string
  updatedAt: string
  workspaceId: string
}

interface ShoppingListOfflineMutationBase {
  actorUserId: string
  attemptCount: number
  createdAt: string
  id: string
  itemId: string
  lastError: string | null
  status: ShoppingListOfflineMutationStatus
  updatedAt: string
  workspaceId: string
}

export type ShoppingListOfflineMutationRecord =
  | (ShoppingListOfflineMutationBase & {
      isFavorite?: boolean
      priority?: ChaosInboxPriority | null
      shoppingCategory?: ChaosInboxShoppingCategory | null
      text: string
      type: 'shopping.create'
    })
  | (ShoppingListOfflineMutationBase & {
      patch: ChaosInboxItemUpdateInput
      type: 'shopping.update'
    })
  | (ShoppingListOfflineMutationBase & {
      type: 'shopping.delete'
    })

export type ShoppingListOfflineMutationInput =
  | {
      actorUserId: string
      isFavorite?: boolean
      itemId: string
      priority?: ChaosInboxPriority | null
      shoppingCategory?: ChaosInboxShoppingCategory | null
      text: string
      type: 'shopping.create'
      workspaceId: string
    }
  | {
      actorUserId: string
      itemId: string
      patch: ChaosInboxItemUpdateInput
      type: 'shopping.update'
      workspaceId: string
    }
  | {
      actorUserId: string
      itemId: string
      type: 'shopping.delete'
      workspaceId: string
    }

const RETRYABLE_QUEUE_STATUSES: ShoppingListOfflineMutationStatus[] = [
  'failed',
  'pending',
  'syncing',
]

class ShoppingListOfflineDatabase extends Dexie {
  cachedItems!: Table<ShoppingListCachedItemRow, string>
  mutationQueue!: Table<ShoppingListOfflineMutationRecord, string>

  constructor() {
    super('shopping-list-offline')

    this.version(1).stores({
      cachedItems: 'key, workspaceId, itemId, updatedAt',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
    })
  }
}

let database: ShoppingListOfflineDatabase | null = null

export function isShoppingListOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export async function resetShoppingListOfflineDatabaseForTests(): Promise<void> {
  database?.close()
  database = null

  if (isShoppingListOfflineStorageAvailable()) {
    await Dexie.delete('shopping-list-offline')
  }
}

export async function loadCachedShoppingListItems(
  workspaceId: string,
): Promise<ChaosInboxItemRecord[]> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.cachedItems
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  return rows.map((row) => row.item)
}

export async function replaceCachedShoppingListItems(
  workspaceId: string,
  items: ChaosInboxItemRecord[],
): Promise<void> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()
  const rows = items.map(
    (item): ShoppingListCachedItemRow => ({
      item,
      itemId: item.id,
      key: createCachedShoppingListItemKey(workspaceId, item.id),
      updatedAt,
      workspaceId,
    }),
  )

  await db.transaction('rw', db.cachedItems, async () => {
    await db.cachedItems.where('workspaceId').equals(workspaceId).delete()

    if (rows.length > 0) {
      await db.cachedItems.bulkPut(rows)
    }
  })
}

export async function upsertCachedShoppingListItem(
  workspaceId: string,
  item: ChaosInboxItemRecord,
): Promise<void> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedItems.put({
    item,
    itemId: item.id,
    key: createCachedShoppingListItemKey(workspaceId, item.id),
    updatedAt: new Date().toISOString(),
    workspaceId,
  })
}

export async function removeCachedShoppingListItem(
  workspaceId: string,
  itemId: string,
): Promise<void> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedItems.delete(
    createCachedShoppingListItemKey(workspaceId, itemId),
  )
}

export async function enqueueShoppingListOfflineMutation(
  input: ShoppingListOfflineMutationInput,
): Promise<ShoppingListOfflineMutationRecord | null> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return null
  }

  const now = new Date().toISOString()
  const mutation = {
    ...input,
    attemptCount: 0,
    createdAt: now,
    id: generateUuidV7(),
    lastError: null,
    status: 'pending',
    updatedAt: now,
  } satisfies ShoppingListOfflineMutationRecord

  await db.mutationQueue.put(mutation)

  return mutation
}

export async function listRetryableShoppingListOfflineMutations(
  workspaceId: string,
): Promise<ShoppingListOfflineMutationRecord[]> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter((mutation) => RETRYABLE_QUEUE_STATUSES.includes(mutation.status))
    .toArray()

  return rows.sort(compareOfflineMutations)
}

export async function countRetryableShoppingListOfflineMutations(
  workspaceId: string,
): Promise<number> {
  const mutations = await listRetryableShoppingListOfflineMutations(workspaceId)

  return mutations.length
}

export async function markShoppingListOfflineMutationSyncing(
  mutationId: string,
): Promise<void> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return
  }

  const mutation = await db.mutationQueue.get(mutationId)

  if (!mutation) {
    return
  }

  await db.mutationQueue.update(mutationId, {
    attemptCount: mutation.attemptCount + 1,
    lastError: null,
    status: 'syncing',
    updatedAt: new Date().toISOString(),
  })
}

export async function completeShoppingListOfflineMutation(
  mutationId: string,
): Promise<void> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return
  }

  await db.mutationQueue.delete(mutationId)
}

export async function markShoppingListOfflineMutationFailed(
  mutationId: string,
  errorMessage: string,
): Promise<void> {
  const db = getShoppingListOfflineDatabase()

  if (!db) {
    return
  }

  await db.mutationQueue.update(mutationId, {
    lastError: errorMessage,
    status: 'failed',
    updatedAt: new Date().toISOString(),
  })
}

function getShoppingListOfflineDatabase(): ShoppingListOfflineDatabase | null {
  if (!isShoppingListOfflineStorageAvailable()) {
    return null
  }

  database ??= new ShoppingListOfflineDatabase()

  return database
}

function createCachedShoppingListItemKey(
  workspaceId: string,
  itemId: string,
): string {
  return `${workspaceId}:${itemId}`
}

function compareOfflineMutations(
  left: ShoppingListOfflineMutationRecord,
  right: ShoppingListOfflineMutationRecord,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1
  }

  if (left.id === right.id) {
    return 0
  }

  return left.id < right.id ? -1 : 1
}
