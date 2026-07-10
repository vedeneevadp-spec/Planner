import type { ChaosInboxItemRecord } from '@planner/contracts'

import {
  createOfflineDrainErrorHandler,
  createOfflineDrainResult,
  drainOfflineQueue,
  getOfflineErrorMessage,
  isBrowserRetryableOfflineError,
} from '@/shared/lib/offline-sync'

import {
  completeShoppingListOfflineMutation,
  listRetryableShoppingListOfflineMutations,
  markShoppingListOfflineMutationConflicted,
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
  conflicted: number
  failed: number
  processed: number
  synced: number
}

export interface DrainShoppingListOfflineQueueOptions {
  actorUserId: string
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
  actorUserId,
  api,
  onItemDeleted,
  onItemSynced,
  workspaceId,
}: DrainShoppingListOfflineQueueOptions): Promise<ShoppingListOfflineDrainResult> {
  const result = createOfflineDrainResult<ShoppingListOfflineDrainResult>({
    conflicted: 0,
  })
  const callbacks: OfflineMutationCallbacks = {}

  if (onItemDeleted) {
    callbacks.onItemDeleted = onItemDeleted
  }

  if (onItemSynced) {
    callbacks.onItemSynced = onItemSynced
  }

  return drainOfflineQueue({
    adapter: {
      completeMutation: completeShoppingListOfflineMutation,
      getMutationId: (mutation) => mutation.id,
      listRetryableMutations: () =>
        listRetryableShoppingListOfflineMutations(workspaceId, actorUserId),
      markMutationSyncing: markShoppingListOfflineMutationSyncing,
    },
    apply: (mutation) => applyOfflineMutation(api, mutation, callbacks),
    result,
    onError: createOfflineDrainErrorHandler<ShoppingListOfflineDrainResult>({
      getErrorMessage,
      isTerminalError: isTerminalShoppingListSyncError,
      markConflicted: (mutationId, conflict) =>
        markShoppingListOfflineMutationConflicted(mutationId, conflict.message),
      markFailed: markShoppingListOfflineMutationFailed,
    }),
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

function isTerminalShoppingListSyncError(
  error: unknown,
): error is ShoppingListApiError {
  return (
    error instanceof ShoppingListApiError &&
    error.code === 'chaos_inbox_item_not_found'
  )
}

function getErrorMessage(error: unknown): string {
  return getOfflineErrorMessage(
    error,
    'Не удалось синхронизировать offline-покупку.',
  )
}
