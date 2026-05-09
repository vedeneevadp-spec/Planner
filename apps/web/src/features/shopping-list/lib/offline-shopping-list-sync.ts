import type { ChaosInboxItemRecord } from '@planner/contracts'

import {
  completeShoppingListOfflineMutation,
  listRetryableShoppingListOfflineMutations,
  markShoppingListOfflineMutationFailed,
  markShoppingListOfflineMutationSyncing,
  removeCachedShoppingListItem,
  type ShoppingListOfflineMutationRecord,
  upsertCachedShoppingListItem,
} from './offline-shopping-list-store'
import {
  type ShoppingListApiClient,
  ShoppingListApiError,
} from './shopping-list-api'

export interface ShoppingListOfflineDrainResult {
  failed: number
  processed: number
  synced: number
}

export interface DrainShoppingListOfflineQueueOptions {
  api: ShoppingListApiClient
  onItemDeleted?: (itemId: string) => void
  onItemSynced?: (item: ChaosInboxItemRecord) => void
  workspaceId: string
}

interface OfflineMutationCallbacks {
  onItemDeleted?: (itemId: string) => void
  onItemSynced?: (item: ChaosInboxItemRecord) => void
}

export async function drainShoppingListOfflineQueue({
  api,
  onItemDeleted,
  onItemSynced,
  workspaceId,
}: DrainShoppingListOfflineQueueOptions): Promise<ShoppingListOfflineDrainResult> {
  const result: ShoppingListOfflineDrainResult = {
    failed: 0,
    processed: 0,
    synced: 0,
  }
  const mutations = await listRetryableShoppingListOfflineMutations(workspaceId)
  const callbacks: OfflineMutationCallbacks = {}

  if (onItemDeleted) {
    callbacks.onItemDeleted = onItemDeleted
  }

  if (onItemSynced) {
    callbacks.onItemSynced = onItemSynced
  }

  for (const mutation of mutations) {
    result.processed += 1
    await markShoppingListOfflineMutationSyncing(mutation.id)

    try {
      await applyOfflineMutation(api, mutation, callbacks)
      await completeShoppingListOfflineMutation(mutation.id)
      result.synced += 1
    } catch (error) {
      await markShoppingListOfflineMutationFailed(
        mutation.id,
        getErrorMessage(error),
      )
      result.failed += 1
      break
    }
  }

  return result
}

export function isQueueableShoppingListMutationError(error: unknown): boolean {
  if (error instanceof ShoppingListApiError) {
    return false
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }

  return error instanceof DOMException || error instanceof TypeError
}

async function applyOfflineMutation(
  api: ShoppingListApiClient,
  mutation: ShoppingListOfflineMutationRecord,
  callbacks: OfflineMutationCallbacks,
): Promise<void> {
  if (mutation.type === 'shopping.create') {
    const item = await api.createItem({
      id: mutation.itemId,
      text: mutation.text,
    })

    await upsertCachedShoppingListItem(mutation.workspaceId, item)
    callbacks.onItemSynced?.(item)

    return
  }

  if (mutation.type === 'shopping.update') {
    const item = await api.updateItem(mutation.itemId, mutation.patch)

    await upsertCachedShoppingListItem(mutation.workspaceId, item)
    callbacks.onItemSynced?.(item)

    return
  }

  await api.removeItem(mutation.itemId)
  await removeCachedShoppingListItem(mutation.workspaceId, mutation.itemId)
  callbacks.onItemDeleted?.(mutation.itemId)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Не удалось синхронизировать offline-покупку.'
}
