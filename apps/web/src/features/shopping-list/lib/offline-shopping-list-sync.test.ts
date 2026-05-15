import 'fake-indexeddb/auto'

import type { ChaosInboxItemRecord } from '@planner/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  enqueueShoppingListOfflineMutation,
  loadCachedShoppingListItems,
  replaceCachedShoppingListItems,
  resetShoppingListOfflineDatabaseForTests,
} from './offline-shopping-list-store'
import { drainShoppingListOfflineQueue } from './offline-shopping-list-sync'
import type { ShoppingListApiClient } from './shopping-list-api'

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
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({
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
      api,
      workspaceId: WORKSPACE_ID,
    })

    expect(result.synced).toBe(1)
    expect(api.removeItem).toHaveBeenCalledWith(item.id)
    expect(await loadCachedShoppingListItems(WORKSPACE_ID)).toEqual([])
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
