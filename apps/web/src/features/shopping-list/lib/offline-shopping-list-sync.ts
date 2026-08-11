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
    const item = await createShoppingListItemIdempotently(api, mutation)

    await commitSyncedShoppingListItem(mutation, item, callbacks)

    return
  }

  if (mutation.type === 'shopping.update') {
    const item = await api.updateItem(mutation.itemId, mutation.patch)

    await commitSyncedShoppingListItem(mutation, item, callbacks)

    return
  }

  try {
    await api.removeItem(mutation.itemId)
  } catch (error) {
    if (!isMissingShoppingListItemError(error)) {
      throw error
    }
  }

  if (!(await hasLaterShoppingListMutation(mutation))) {
    await removeCachedShoppingListItem(mutation.workspaceId, mutation.itemId)
    callbacks.onItemDeleted?.(mutation.itemId)
  }
}

async function createShoppingListItemIdempotently(
  api: ShoppingListApiClient,
  mutation: Extract<
    ShoppingListOfflineMutationRecord,
    { type: 'shopping.create' }
  >,
): Promise<ChaosInboxItemRecord> {
  try {
    return await api.createItem({
      id: mutation.itemId,
      isFavorite: mutation.isFavorite ?? false,
      priority: mutation.priority ?? null,
      shoppingCategory: mutation.shoppingCategory ?? null,
      text: mutation.text,
    })
  } catch (error) {
    if (!(error instanceof ShoppingListApiError)) {
      throw error
    }

    // A previous POST may have reached the server even when its response was
    // lost. The stable client-generated id lets us reconcile that ambiguous
    // retry instead of creating a duplicate or leaving the queue stuck.
    const existingItem = (await api.listItems()).find(
      (item) => item.id === mutation.itemId,
    )

    if (
      !existingItem ||
      existingItem.kind !== 'shopping' ||
      existingItem.workspaceId !== mutation.workspaceId ||
      existingItem.text !== mutation.text
    ) {
      throw error
    }

    return existingItem
  }
}

async function commitSyncedShoppingListItem(
  mutation: ShoppingListOfflineMutationRecord,
  item: ChaosInboxItemRecord,
  callbacks: OfflineMutationCallbacks,
): Promise<void> {
  if (await hasLaterShoppingListMutation(mutation)) {
    // A newer local command already projected its state into the cache. Do not
    // overwrite it with an older server response while that command waits for
    // the next drain pass.
    return
  }

  await upsertCachedShoppingListItem(mutation.workspaceId, item)
  callbacks.onItemSynced?.(item)
}

async function hasLaterShoppingListMutation(
  mutation: ShoppingListOfflineMutationRecord,
): Promise<boolean> {
  const queuedMutations = await listRetryableShoppingListOfflineMutations(
    mutation.workspaceId,
    mutation.actorUserId,
  )
  const currentIndex = queuedMutations.findIndex(
    (queuedMutation) => queuedMutation.id === mutation.id,
  )

  if (currentIndex === -1) {
    return false
  }

  return queuedMutations
    .slice(currentIndex + 1)
    .some((queuedMutation) => queuedMutation.itemId === mutation.itemId)
}

function isTerminalShoppingListSyncError(
  error: unknown,
): error is ShoppingListApiError {
  return isMissingShoppingListItemError(error)
}

function isMissingShoppingListItemError(
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
