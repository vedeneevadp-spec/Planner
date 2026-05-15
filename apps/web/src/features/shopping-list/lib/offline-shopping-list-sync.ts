import type { ChaosInboxItemRecord } from '@planner/contracts'

import {
  drainOfflineMutations,
  getOfflineErrorMessage,
  isBrowserRetryableOfflineError,
} from '@/shared/lib/offline-sync'

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

  return drainOfflineMutations({
    apply: (mutation) => applyOfflineMutation(api, mutation, callbacks),
    complete: completeShoppingListOfflineMutation,
    getMutationId: (mutation) => mutation.id,
    markSyncing: markShoppingListOfflineMutationSyncing,
    mutations,
    result,
    onError: async ({ error, mutationId, result: drainResult }) => {
      await markShoppingListOfflineMutationFailed(
        mutationId,
        getErrorMessage(error),
      )
      drainResult.failed += 1

      return 'break'
    },
  })
}

export function isQueueableShoppingListMutationError(error: unknown): boolean {
  if (error instanceof ShoppingListApiError) {
    return false
  }

  return isBrowserRetryableOfflineError(error)
}

async function applyOfflineMutation(
  api: ShoppingListApiClient,
  mutation: ShoppingListOfflineMutationRecord,
  callbacks: OfflineMutationCallbacks,
): Promise<void> {
  if (mutation.type === 'shopping.create') {
    const item = await api.createItem({
      id: mutation.itemId,
      isFavorite: mutation.isFavorite ?? false,
      priority: mutation.priority ?? null,
      shoppingCategory: mutation.shoppingCategory ?? null,
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
  return getOfflineErrorMessage(
    error,
    'Не удалось синхронизировать offline-покупку.',
  )
}
