import 'fake-indexeddb/auto'

import type { ChaosInboxItemRecord } from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  countConflictedShoppingListOfflineMutations,
  countRetryableShoppingListOfflineMutations,
  enqueueShoppingListOfflineMutation,
  loadCachedShoppingListItems,
  replaceCachedShoppingListItems,
  resetShoppingListOfflineDatabaseForTests,
} from './offline-shopping-list-store'
import { drainShoppingListOfflineQueue } from './offline-shopping-list-sync'
import {
  type ShoppingListApiClient,
  ShoppingListApiError,
} from './shopping-list-api'

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'

describe('offline shopping list sync', () => {
  beforeEach(async () => {
    await resetShoppingListOfflineDatabaseForTests()
  })

  it('replays queued creates through the API and caches the server record', async () => {
    const item = createShoppingListItemRecord('item-1', 'Milk')
    const api = createShoppingListApiClientMock({
      createItem: vi.fn().mockResolvedValue(item),
    })

    await enqueueShoppingListOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      isFavorite: true,
      itemId: item.id,
      priority: 'high',
      shoppingCategory: 'groceries',
      text: item.text,
      type: 'shopping.create',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(api.createItem).toHaveBeenCalledWith({
      id: item.id,
      isFavorite: true,
      priority: 'high',
      shoppingCategory: 'groceries',
      text: item.text,
    })
    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([item])
  })

  it('reconciles an ambiguous create retry by its stable item id', async () => {
    const item = createShoppingListItemRecord('item-existing', 'Milk')
    const api = createShoppingListApiClientMock({
      createItem: vi.fn().mockRejectedValue(
        new ShoppingListApiError('Duplicate key.', {
          code: 'internal_error',
          status: 500,
        }),
      ),
      listItems: vi.fn().mockResolvedValue([item]),
    })

    await enqueueShoppingListOfflineMutation(
      {
        actorUserId: ACTOR_USER_ID,
        itemId: item.id,
        text: item.text,
        type: 'shopping.create',
        workspaceId: WORKSPACE_ID,
      },
      { optimisticItem: item },
    )

    const result = await drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(api.listItems).toHaveBeenCalledTimes(1)
    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([item])
  })

  it('never replays another actor mutation from the same workspace', async () => {
    const otherActorUserId = 'user-2'
    const item = createShoppingListItemRecord('item-current', 'Milk')
    const api = createShoppingListApiClientMock({
      createItem: vi.fn().mockResolvedValue(item),
    })

    await enqueueShoppingListOfflineMutation({
      actorUserId: otherActorUserId,
      itemId: 'item-other',
      text: 'Other actor item',
      type: 'shopping.create',
      workspaceId: WORKSPACE_ID,
    })
    await enqueueShoppingListOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      itemId: item.id,
      text: item.text,
      type: 'shopping.create',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.processed).toBe(1)
    expect(api.createItem).toHaveBeenCalledTimes(1)
    expect(
      await countRetryableShoppingListOfflineMutations(
        WORKSPACE_ID,
        otherActorUserId,
      ),
    ).toBe(1)
  })

  it('replays queued status updates and caches the updated item', async () => {
    const item = createShoppingListItemRecord('item-1', 'Milk')
    const completedItem = {
      ...item,
      status: 'archived',
      updatedAt: '2026-05-04T10:05:00.000Z',
      version: 2,
    } satisfies ChaosInboxItemRecord
    const api = createShoppingListApiClientMock({
      updateItem: vi.fn().mockResolvedValue(completedItem),
    })

    await replaceCachedShoppingListItems(WORKSPACE_ID, [item])
    await enqueueShoppingListOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      itemId: item.id,
      patch: {
        status: 'archived',
      },
      type: 'shopping.update',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.synced).toBe(1)
    expect(api.updateItem).toHaveBeenCalledWith(item.id, {
      status: 'archived',
    })
    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([
      completedItem,
    ])
  })

  it('does not overwrite a newer optimistic cache projection with an older in-flight response', async () => {
    const optimisticCreatedItem = createShoppingListItemRecord(
      'item-in-flight',
      'Milk',
    )
    const optimisticUpdatedItem = {
      ...optimisticCreatedItem,
      priority: 'high' as const,
      updatedAt: '2026-05-04T10:01:00.000Z',
      version: 2,
    }
    const serverUpdatedItem = {
      ...optimisticUpdatedItem,
      updatedAt: '2026-05-04T10:02:00.000Z',
    }
    const createStarted = createDeferred<void>()
    const createResponse = createDeferred<ChaosInboxItemRecord>()
    const api = createShoppingListApiClientMock({
      createItem: vi.fn(() => {
        createStarted.resolve()
        return createResponse.promise
      }),
      updateItem: vi.fn().mockResolvedValue(serverUpdatedItem),
    })

    await enqueueShoppingListOfflineMutation(
      {
        actorUserId: ACTOR_USER_ID,
        itemId: optimisticCreatedItem.id,
        text: optimisticCreatedItem.text,
        type: 'shopping.create',
        workspaceId: WORKSPACE_ID,
      },
      { optimisticItem: optimisticCreatedItem },
    )

    const firstDrain = drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })
    await createStarted.promise

    await enqueueShoppingListOfflineMutation(
      {
        actorUserId: ACTOR_USER_ID,
        itemId: optimisticCreatedItem.id,
        patch: { priority: 'high' },
        type: 'shopping.update',
        workspaceId: WORKSPACE_ID,
      },
      { optimisticItem: optimisticUpdatedItem },
    )
    createResponse.resolve(optimisticCreatedItem)
    await firstDrain

    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([
      optimisticUpdatedItem,
    ])
    expect(api.updateItem).not.toHaveBeenCalled()

    await drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(api.updateItem).toHaveBeenCalledWith(optimisticCreatedItem.id, {
      priority: 'high',
    })
    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([
      serverUpdatedItem,
    ])
  })

  it('replays queued deletes and removes the cached item', async () => {
    const item = createShoppingListItemRecord('item-1', 'Milk')
    const api = createShoppingListApiClientMock({
      removeItem: vi.fn().mockResolvedValue(undefined),
    })

    await replaceCachedShoppingListItems(WORKSPACE_ID, [item])
    await enqueueShoppingListOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      itemId: item.id,
      type: 'shopping.delete',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.synced).toBe(1)
    expect(api.removeItem).toHaveBeenCalledWith(item.id)
    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([])
  })

  it('treats an already missing item as a successful idempotent delete', async () => {
    const item = createShoppingListItemRecord('item-missing', 'Milk')
    const api = createShoppingListApiClientMock({
      removeItem: vi.fn().mockRejectedValue(
        new ShoppingListApiError('Chaos inbox item not found.', {
          code: 'chaos_inbox_item_not_found',
          status: 404,
        }),
      ),
    })

    await replaceCachedShoppingListItems(WORKSPACE_ID, [item])
    await enqueueShoppingListOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      itemId: item.id,
      type: 'shopping.delete',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 0,
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([])
    expect(
      await countConflictedShoppingListOfflineMutations(WORKSPACE_ID),
    ).toBe(0)
  })

  it('marks missing server items as terminal conflicts instead of retrying forever', async () => {
    const item = createShoppingListItemRecord('item-1', 'Milk')
    const api = createShoppingListApiClientMock({
      updateItem: vi.fn().mockRejectedValue(
        new ShoppingListApiError('Chaos inbox item not found.', {
          code: 'chaos_inbox_item_not_found',
          status: 404,
        }),
      ),
    })

    await replaceCachedShoppingListItems(WORKSPACE_ID, [item])
    await enqueueShoppingListOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      itemId: item.id,
      patch: {
        status: 'archived',
      },
      type: 'shopping.update',
      workspaceId: WORKSPACE_ID,
    })

    const result = await drainShoppingListOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
      conflicted: 1,
      failed: 0,
      processed: 1,
      synced: 0,
    })
    expect(await countRetryableShoppingListOfflineMutations(WORKSPACE_ID)).toBe(
      0,
    )
    expect(
      await countConflictedShoppingListOfflineMutations(WORKSPACE_ID),
    ).toBe(1)
  })
})

function createShoppingListApiClientMock(
  overrides: Partial<ShoppingListApiClient>,
): ShoppingListApiClient {
  return {
    createItem: vi.fn(),
    listItems: vi.fn(),
    removeItem: vi.fn(),
    updateItem: vi.fn(),
    ...overrides,
  }
}

function createShoppingListItemRecord(
  itemId: string,
  text: string,
): ChaosInboxItemRecord {
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
    text,
    updatedAt: '2026-05-04T10:00:00.000Z',
    userId: ACTOR_USER_ID,
    version: 1,
    workspaceId: WORKSPACE_ID,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}
