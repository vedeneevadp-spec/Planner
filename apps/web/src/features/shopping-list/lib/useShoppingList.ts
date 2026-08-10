import {
  type ChaosInboxItemUpdateInput,
  generateUuidV7,
} from '@planner/contracts'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'

import { useSessionFeatureReadiness } from '@/features/session'
import {
  createOfflineDrainCoordinator,
  useOfflineQueueDrain,
} from '@/shared/lib/offline-sync'

import {
  countConflictedShoppingListOfflineMutations,
  countRetryableShoppingListOfflineMutations,
  enqueueShoppingListOfflineMutation,
  isShoppingListOfflineStorageAvailable,
  loadCachedShoppingListItems,
  removeCachedShoppingListItem,
  replaceCachedShoppingListItems,
  type ShoppingListOfflineMutationInput,
  upsertCachedShoppingListItem,
} from './offline-shopping-list-store'
import {
  drainShoppingListOfflineQueue,
  isQueueableShoppingListMutationError,
  type ShoppingListOfflineDrainResult,
} from './offline-shopping-list-sync'
import {
  createShoppingListApiClient,
  type ShoppingListApiClient,
  type ShoppingListItemCreateInput,
} from './shopping-list-api'
import {
  type ShoppingListItem,
  sortActiveShoppingListItems,
  sortCompletedShoppingListItems,
} from './shopping-list-sort'
import {
  findShoppingListItemByText,
  formatShoppingListText,
  isActiveShoppingListTextItem,
} from './shopping-list-text'

function shoppingListQueryKey(workspaceId: string) {
  return ['shopping-list', workspaceId] as const
}

function shoppingListOfflineStatusQueryKey(
  workspaceId: string,
  actorUserId?: string,
) {
  return [
    'shopping-list-offline-status',
    workspaceId,
    actorUserId ?? 'pending',
  ] as const
}

export type ShoppingListItemDraft = Omit<ShoppingListItemCreateInput, 'id'>
export interface ShoppingListOfflineStatus {
  conflictedMutationCount: number
  queuedMutationCount: number
}
export {
  isShoppingListItemCompleted,
  type ShoppingListItem,
  sortActiveShoppingListItems,
  sortCompletedShoppingListItems,
} from './shopping-list-sort'
export {
  findShoppingListItemByText,
  formatShoppingListText,
  isActiveShoppingListTextItem,
} from './shopping-list-text'

class ShoppingListApiUnavailableError extends Error {
  constructor() {
    super('Shopping list session is not ready.')
    this.name = 'ShoppingListApiUnavailableError'
  }
}

class ShoppingListOfflinePersistenceError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'Не удалось сохранить покупку на устройстве. Проверьте доступное место и повторите.',
      options,
    )
    this.name = 'ShoppingListOfflinePersistenceError'
  }
}

const shoppingListDrainCoordinator = createOfflineDrainCoordinator<
  string,
  ShoppingListOfflineDrainResult
>()
const shoppingListMutationTails = new Map<string, Promise<void>>()
const shoppingListQueueRevisions = new Map<string, number>()
const shoppingListCompletedDrainRevisions = new Map<string, number>()

export function useShoppingListItems(options: { enabled?: boolean } = {}) {
  const { api, session, workspaceId } = useShoppingListApi(options)
  const queryClient = useQueryClient()
  const hasSession = options.enabled !== false && Boolean(session)
  const queryKey = useMemo(
    () => shoppingListQueryKey(workspaceId),
    [workspaceId],
  )

  const drainQueuedMutations = useCallback(async () => {
    if (!api || !session) {
      return
    }

    await drainQueuedShoppingListMutations({
      actorUserId: session.actorUserId,
      api,
      queryClient,
      workspaceId: session.workspaceId,
    })
  }, [api, queryClient, session])

  useEffect(() => {
    if (options.enabled === false || !session) {
      return
    }

    let isActive = true

    void loadCachedShoppingListItems(session.workspaceId).then(
      (cachedItems) => {
        if (!isActive || cachedItems.length === 0) {
          return
        }

        queryClient.setQueryData<ShoppingListItem[]>(
          queryKey,
          (currentItems) => currentItems ?? cachedItems,
        )
      },
    )

    return () => {
      isActive = false
    }
  }, [options.enabled, queryClient, queryKey, session])

  useOfflineQueueDrain({
    drain: drainQueuedMutations,
    enabled: Boolean(api && session),
  })

  return useQuery({
    enabled: hasSession,
    queryFn: async ({ signal }) => {
      if (!session) {
        throw new Error(
          'Planner session is required to load shopping list items.',
        )
      }

      if (!api) {
        return loadCachedShoppingListItems(session.workspaceId)
      }

      try {
        await drainQueuedMutations()

        const items = await api.listItems(signal)

        await replaceCachedShoppingListItems(session.workspaceId, items)

        return items
      } catch (error) {
        if (isQueueableShoppingListMutationError(error)) {
          return loadCachedShoppingListItems(session.workspaceId)
        }

        throw error
      }
    },
    queryKey,
    retry: (failureCount, error) =>
      !isQueueableShoppingListMutationError(error) && failureCount < 2,
    staleTime: 30_000,
  })
}

export function useShoppingListSyncStatus(options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const { api, session, workspaceId } = useShoppingListApi(options)
  const isEnabled = options.enabled !== false && Boolean(session)
  const queryKey = useMemo(
    () => shoppingListOfflineStatusQueryKey(workspaceId, session?.actorUserId),
    [session?.actorUserId, workspaceId],
  )
  const statusQuery = useQuery({
    enabled: isEnabled,
    queryFn: () =>
      loadShoppingListOfflineStatus(workspaceId, session?.actorUserId),
    queryKey,
    refetchInterval: 10_000,
    staleTime: 5_000,
  })
  const retryMutation = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      if (api && session) {
        await drainQueuedShoppingListMutations({
          actorUserId: session.actorUserId,
          api,
          queryClient,
          workspaceId: session.workspaceId,
        })
      }

      return loadShoppingListOfflineStatus(workspaceId, session?.actorUserId)
    },
    onSuccess: (status) => {
      queryClient.setQueryData(queryKey, status)
    },
  })
  const retry = useCallback(() => retryMutation.mutateAsync(), [retryMutation])

  useOfflineQueueDrain({
    drain: retry,
    drainOnMount: false,
    enabled: isEnabled && Boolean(api),
  })

  return {
    conflictedMutationCount: statusQuery.data?.conflictedMutationCount ?? 0,
    error: statusQuery.error ?? retryMutation.error,
    isPending: statusQuery.isPending,
    isSyncing: retryMutation.isPending,
    queuedMutationCount: statusQuery.data?.queuedMutationCount ?? 0,
    retry,
  }
}

export function useCreateShoppingListItem() {
  const { api, session, workspaceId } = useShoppingListApi()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => shoppingListQueryKey(workspaceId),
    [workspaceId],
  )

  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: string | ShoppingListItemDraft) => {
      if (!session) {
        throw new Error(
          'Planner session is required to create shopping list items.',
        )
      }

      return runShoppingListMutationSerially(
        `${session.actorUserId}:${session.workspaceId}`,
        async () => {
          const itemInput = normalizeShoppingListItemDraft(input)
          const previousItems =
            queryClient.getQueryData<ShoppingListItem[]>(queryKey) ??
            (await loadCachedShoppingListItems(session.workspaceId))
          const existingItem = findShoppingListItemByText(
            previousItems,
            itemInput.text,
          )

          if (existingItem) {
            if (isActiveShoppingListTextItem(existingItem)) {
              return existingItem
            }

            const patch = { status: 'new' as const }
            const optimisticItem = applyShoppingListItemPatch(
              existingItem,
              patch,
            )
            const queued = await persistQueuedShoppingListMutation({
              api,
              baseItems: previousItems,
              mutation: {
                actorUserId: session.actorUserId,
                itemId: existingItem.id,
                patch,
                type: 'shopping.update',
                workspaceId: session.workspaceId,
              },
              optimisticItem,
              queryClient,
              queryKey,
            })

            if (queued) {
              return optimisticItem
            }

            assertShoppingListNetworkFallbackAvailable()
            queryClient.setQueryData<ShoppingListItem[]>(
              queryKey,
              (current = previousItems) =>
                replaceShoppingListItemRecord(current, optimisticItem),
            )
            await upsertCachedShoppingListItem(
              session.workspaceId,
              optimisticItem,
            )

            try {
              const updatedItem = await requireShoppingListApi(api).updateItem(
                existingItem.id,
                patch,
              )

              queryClient.setQueryData<ShoppingListItem[]>(
                queryKey,
                (current = []) =>
                  replaceShoppingListItemRecord(current, updatedItem),
              )
              await upsertCachedShoppingListItem(
                session.workspaceId,
                updatedItem,
              )

              return updatedItem
            } catch (error) {
              await restoreShoppingListItem({
                index: previousItems.findIndex(
                  (item) => item.id === existingItem.id,
                ),
                item: existingItem,
                queryClient,
                queryKey,
                workspaceId: session.workspaceId,
              })

              throw error
            }
          }

          const itemId = generateUuidV7()
          const optimisticItem = createOptimisticShoppingListItem(
            {
              id: itemId,
              ...itemInput,
            },
            {
              actorUserId: session.actorUserId,
              workspaceId: session.workspaceId,
            },
          )
          const queued = await persistQueuedShoppingListMutation({
            api,
            baseItems: previousItems,
            mutation: {
              actorUserId: session.actorUserId,
              isFavorite: optimisticItem.isFavorite,
              itemId,
              priority: optimisticItem.priority,
              shoppingCategory: optimisticItem.shoppingCategory,
              text: optimisticItem.text,
              type: 'shopping.create',
              workspaceId: session.workspaceId,
            },
            optimisticItem,
            queryClient,
            queryKey,
          })

          if (queued) {
            return optimisticItem
          }

          assertShoppingListNetworkFallbackAvailable()
          queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current) =>
            replaceShoppingListItemRecord(
              current ?? previousItems,
              optimisticItem,
            ),
          )
          await upsertCachedShoppingListItem(
            session.workspaceId,
            optimisticItem,
          )

          try {
            const createdItem = await requireShoppingListApi(api).createItem({
              id: itemId,
              ...itemInput,
            })

            queryClient.setQueryData<ShoppingListItem[]>(
              queryKey,
              (current = []) =>
                replaceShoppingListItemRecord(current, createdItem),
            )
            await upsertCachedShoppingListItem(session.workspaceId, createdItem)

            return createdItem
          } catch (error) {
            await removeOptimisticShoppingListItem({
              itemId,
              queryClient,
              queryKey,
              workspaceId: session.workspaceId,
            })

            throw error
          }
        },
      )
    },
  })
}

export function useUpdateShoppingListItem() {
  const { api, session, workspaceId } = useShoppingListApi()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => shoppingListQueryKey(workspaceId),
    [workspaceId],
  )

  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: {
      itemId: string
      patch: ChaosInboxItemUpdateInput
    }) => {
      if (!session) {
        throw new Error(
          'Planner session is required to update shopping list items.',
        )
      }

      return runShoppingListMutationSerially(
        `${session.actorUserId}:${session.workspaceId}`,
        async () => {
          const previousItems =
            queryClient.getQueryData<ShoppingListItem[]>(queryKey) ??
            (await loadCachedShoppingListItems(session.workspaceId))
          const currentItem = previousItems.find(
            (item) => item.id === input.itemId,
          )

          if (!currentItem) {
            throw new Error(
              `Shopping list item "${input.itemId}" was not found.`,
            )
          }

          const optimisticItem = applyShoppingListItemPatch(
            currentItem,
            input.patch,
          )
          const queued = await persistQueuedShoppingListMutation({
            api,
            baseItems: previousItems,
            mutation: {
              actorUserId: session.actorUserId,
              itemId: input.itemId,
              patch: input.patch,
              type: 'shopping.update',
              workspaceId: session.workspaceId,
            },
            optimisticItem,
            queryClient,
            queryKey,
          })

          if (queued) {
            return optimisticItem
          }

          assertShoppingListNetworkFallbackAvailable()
          queryClient.setQueryData<ShoppingListItem[]>(
            queryKey,
            (current = previousItems) =>
              replaceShoppingListItemRecord(current, optimisticItem),
          )
          await upsertCachedShoppingListItem(
            session.workspaceId,
            optimisticItem,
          )

          try {
            const updatedItem = await requireShoppingListApi(api).updateItem(
              input.itemId,
              input.patch,
            )

            queryClient.setQueryData<ShoppingListItem[]>(
              queryKey,
              (current = []) =>
                replaceShoppingListItemRecord(current, updatedItem),
            )
            await upsertCachedShoppingListItem(session.workspaceId, updatedItem)

            return updatedItem
          } catch (error) {
            await restoreShoppingListItem({
              index: previousItems.findIndex(
                (item) => item.id === currentItem.id,
              ),
              item: currentItem,
              queryClient,
              queryKey,
              workspaceId: session.workspaceId,
            })

            throw error
          }
        },
      )
    },
  })
}

export function useRemoveShoppingListItem() {
  const { api, session, workspaceId } = useShoppingListApi()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => shoppingListQueryKey(workspaceId),
    [workspaceId],
  )

  return useMutation({
    networkMode: 'always',
    mutationFn: async (itemId: string) => {
      if (!session) {
        throw new Error(
          'Planner session is required to remove shopping list items.',
        )
      }

      return runShoppingListMutationSerially(
        `${session.actorUserId}:${session.workspaceId}`,
        async () => {
          const previousItems =
            queryClient.getQueryData<ShoppingListItem[]>(queryKey) ??
            (await loadCachedShoppingListItems(session.workspaceId))
          const previousItemIndex = previousItems.findIndex(
            (item) => item.id === itemId,
          )
          const previousItem =
            previousItemIndex >= 0
              ? previousItems[previousItemIndex]
              : undefined

          if (!previousItem) {
            return
          }

          const queued = await persistQueuedShoppingListMutation({
            api,
            baseItems: previousItems,
            mutation: {
              actorUserId: session.actorUserId,
              itemId,
              type: 'shopping.delete',
              workspaceId: session.workspaceId,
            },
            queryClient,
            queryKey,
            removeCachedItemId: itemId,
          })

          if (queued) {
            return
          }

          assertShoppingListNetworkFallbackAvailable()
          queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current) =>
            removeShoppingListItemRecord(current ?? previousItems, itemId),
          )
          await removeCachedShoppingListItem(session.workspaceId, itemId)

          try {
            await requireShoppingListApi(api).removeItem(itemId)
          } catch (error) {
            await restoreShoppingListItem({
              index: previousItemIndex,
              item: previousItem,
              queryClient,
              queryKey,
              workspaceId: session.workspaceId,
            })

            throw error
          }
        },
      )
    },
  })
}

export function useShoppingListSummary(options: { enabled?: boolean } = {}) {
  const itemsQuery = useShoppingListItems(options)

  const summary = useMemo(() => {
    const items = itemsQuery.data ?? []
    const activeItems = sortActiveShoppingListItems(items)
    const completedItems = sortCompletedShoppingListItems(items)

    return {
      activeItemCount: activeItems.length,
      activeItems,
      completedItemCount: completedItems.length,
      completedItems,
      totalItemCount: items.length,
    }
  }, [itemsQuery.data])

  return {
    ...itemsQuery,
    ...summary,
  }
}

function useShoppingListApi(options: { enabled?: boolean } = {}) {
  const { apiConfig, session, workspaceId } = useSessionFeatureReadiness({
    enabled: options.enabled,
  })
  const api = useMemo(
    () => (apiConfig ? createShoppingListApiClient(apiConfig) : null),
    [apiConfig],
  )

  return {
    api,
    session,
    workspaceId,
  }
}

function normalizeShoppingListItemDraft(
  input: string | ShoppingListItemDraft,
): ShoppingListItemDraft {
  if (typeof input === 'string') {
    return {
      text: formatShoppingListText(input),
    }
  }

  return {
    ...input,
    text: formatShoppingListText(input.text),
  }
}

function createOptimisticShoppingListItem(
  input: ShoppingListItemCreateInput & { id: string },
  options: {
    actorUserId: string
    workspaceId: string
  },
): ShoppingListItem {
  const now = new Date().toISOString()

  return {
    activatedAt: now,
    completedAt: null,
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: now,
    deletedAt: null,
    dueDate: null,
    id: input.id,
    isFavorite: input.isFavorite ?? false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: input.priority ?? null,
    shoppingCategory: input.shoppingCategory ?? null,
    source: 'manual',
    sphereId: null,
    status: 'new',
    text: input.text.trim(),
    updatedAt: now,
    userId: options.actorUserId,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

function applyShoppingListItemPatch(
  item: ShoppingListItem,
  patch: ChaosInboxItemUpdateInput,
): ShoppingListItem {
  return {
    ...item,
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.isFavorite !== undefined ? { isFavorite: patch.isFavorite } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.shoppingCategory !== undefined
      ? { shoppingCategory: patch.shoppingCategory }
      : {}),
    ...(patch.sphereId !== undefined ? { sphereId: patch.sphereId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: new Date().toISOString(),
    version: item.version + 1,
  }
}

function replaceShoppingListItemRecord(
  items: ShoppingListItem[],
  nextItem: ShoppingListItem,
): ShoppingListItem[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id)

  if (existingIndex === -1) {
    return [nextItem, ...items]
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item))
}

function removeShoppingListItemRecord(
  items: ShoppingListItem[],
  itemId: string,
): ShoppingListItem[] {
  return items.filter((item) => item.id !== itemId)
}

export function restoreShoppingListItemRecordAtIndex(
  items: ShoppingListItem[],
  item: ShoppingListItem,
  index: number,
): ShoppingListItem[] {
  const withoutItem = removeShoppingListItemRecord(items, item.id)
  const insertionIndex = Math.min(Math.max(index, 0), withoutItem.length)

  return [
    ...withoutItem.slice(0, insertionIndex),
    item,
    ...withoutItem.slice(insertionIndex),
  ]
}

async function restoreShoppingListItem(input: {
  index: number
  item: ShoppingListItem
  queryClient: QueryClient
  queryKey: ReturnType<typeof shoppingListQueryKey>
  workspaceId: string
}): Promise<void> {
  input.queryClient.setQueryData<ShoppingListItem[]>(
    input.queryKey,
    (current = []) =>
      restoreShoppingListItemRecordAtIndex(current, input.item, input.index),
  )
  await upsertCachedShoppingListItem(input.workspaceId, input.item)
}

async function removeOptimisticShoppingListItem(input: {
  itemId: string
  queryClient: QueryClient
  queryKey: ReturnType<typeof shoppingListQueryKey>
  workspaceId: string
}): Promise<void> {
  input.queryClient.setQueryData<ShoppingListItem[]>(
    input.queryKey,
    (current = []) => removeShoppingListItemRecord(current, input.itemId),
  )
  await removeCachedShoppingListItem(input.workspaceId, input.itemId)
}

function requireShoppingListApi(
  api: ShoppingListApiClient | null,
): ShoppingListApiClient {
  if (!api) {
    throw new ShoppingListApiUnavailableError()
  }

  return api
}

interface PersistQueuedShoppingListMutationInput {
  api: ShoppingListApiClient | null
  baseItems: ShoppingListItem[]
  mutation: ShoppingListOfflineMutationInput
  optimisticItem?: ShoppingListItem | undefined
  queryClient: QueryClient
  queryKey: ReturnType<typeof shoppingListQueryKey>
  removeCachedItemId?: string | undefined
}

async function persistQueuedShoppingListMutation({
  api,
  baseItems,
  mutation,
  optimisticItem,
  queryClient,
  queryKey,
  removeCachedItemId,
}: PersistQueuedShoppingListMutationInput): Promise<boolean> {
  if (!isShoppingListOfflineStorageAvailable()) {
    return false
  }

  try {
    const queuedMutation = await enqueueShoppingListOfflineMutation(mutation, {
      optimisticItem,
      removeCachedItemId,
    })

    if (!queuedMutation) {
      return false
    }

    incrementShoppingListQueueRevision(
      mutation.actorUserId,
      mutation.workspaceId,
    )

    if (optimisticItem) {
      queryClient.setQueryData<ShoppingListItem[]>(
        queryKey,
        (current = baseItems) =>
          replaceShoppingListItemRecord(current, optimisticItem),
      )
    } else if (removeCachedItemId) {
      queryClient.setQueryData<ShoppingListItem[]>(
        queryKey,
        (current = baseItems) =>
          removeShoppingListItemRecord(current, removeCachedItemId),
      )
    }

    scheduleShoppingListOfflineSync({
      actorUserId: mutation.actorUserId,
      api,
      queryClient,
      workspaceId: mutation.workspaceId,
    })

    return true
  } catch (error) {
    if (isBrowserOfflineNow()) {
      throw new ShoppingListOfflinePersistenceError({ cause: error })
    }

    return false
  }
}

function scheduleShoppingListOfflineSync(input: {
  actorUserId: string
  api: ShoppingListApiClient | null
  queryClient: QueryClient
  workspaceId: string
}): void {
  void refreshShoppingListOfflineStatus(
    input.queryClient,
    input.workspaceId,
    input.actorUserId,
  )
    .catch((error) => {
      console.warn('Failed to refresh shopping offline status.', error)
    })
    .finally(() => {
      if (!input.api || isBrowserOfflineNow()) {
        return
      }

      requestQueuedShoppingListMutationDrain({
        actorUserId: input.actorUserId,
        api: input.api,
        queryClient: input.queryClient,
        workspaceId: input.workspaceId,
      })
    })
}

function requestQueuedShoppingListMutationDrain(input: {
  actorUserId: string
  api: ShoppingListApiClient
  queryClient: QueryClient
  workspaceId: string
}): void {
  const scopeKey = getShoppingListMutationScopeKey(
    input.actorUserId,
    input.workspaceId,
  )
  const requestedRevision = shoppingListQueueRevisions.get(scopeKey) ?? 0

  void drainQueuedShoppingListMutations(input)
    .then((result) => {
      if (
        result.failed > 0 ||
        (shoppingListCompletedDrainRevisions.get(scopeKey) ?? 0) >=
          requestedRevision
      ) {
        return result
      }

      // This request joined a drain that started before its mutation was
      // queued. A second pass picks up that newer command.
      return drainQueuedShoppingListMutations(input)
    })
    .catch((error) => {
      console.warn('Failed to drain shopping offline mutations.', error)
    })
}

async function runShoppingListMutationSerially<T>(
  scopeKey: string,
  action: () => Promise<T>,
): Promise<T> {
  const previousTail = shoppingListMutationTails.get(scopeKey)
  const result = (previousTail ?? Promise.resolve())
    .catch(() => undefined)
    .then(action)
  const nextTail = result.then(
    () => undefined,
    () => undefined,
  )

  shoppingListMutationTails.set(scopeKey, nextTail)

  try {
    return await result
  } finally {
    if (shoppingListMutationTails.get(scopeKey) === nextTail) {
      shoppingListMutationTails.delete(scopeKey)
    }
  }
}

function assertShoppingListNetworkFallbackAvailable(): void {
  if (isBrowserOfflineNow()) {
    throw new ShoppingListOfflinePersistenceError()
  }
}

function isBrowserOfflineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function incrementShoppingListQueueRevision(
  actorUserId: string,
  workspaceId: string,
): void {
  const scopeKey = getShoppingListMutationScopeKey(actorUserId, workspaceId)
  shoppingListQueueRevisions.set(
    scopeKey,
    (shoppingListQueueRevisions.get(scopeKey) ?? 0) + 1,
  )
}

function getShoppingListMutationScopeKey(
  actorUserId: string,
  workspaceId: string,
): string {
  return `${actorUserId}:${workspaceId}`
}

async function drainQueuedShoppingListMutations(input: {
  actorUserId: string
  api: ShoppingListApiClient
  queryClient: QueryClient
  workspaceId: string
}): Promise<ShoppingListOfflineDrainResult> {
  const scopeKey = getShoppingListMutationScopeKey(
    input.actorUserId,
    input.workspaceId,
  )

  return shoppingListDrainCoordinator.drain(scopeKey, async () => {
    const drainRevision = shoppingListQueueRevisions.get(scopeKey) ?? 0
    const queryKey = shoppingListQueryKey(input.workspaceId)
    const result = await drainShoppingListOfflineQueue({
      actorUserId: input.actorUserId,
      api: input.api,
      onItemDeleted: (itemId) => {
        input.queryClient.setQueryData<ShoppingListItem[]>(
          queryKey,
          (current = []) => removeShoppingListItemRecord(current, itemId),
        )
      },
      onItemSynced: (item) => {
        input.queryClient.setQueryData<ShoppingListItem[]>(
          queryKey,
          (current = []) => replaceShoppingListItemRecord(current, item),
        )
      },
      workspaceId: input.workspaceId,
    })

    if (result.synced > 0 || result.conflicted > 0) {
      void input.queryClient.invalidateQueries({ queryKey }).catch((error) => {
        console.warn('Failed to refresh the synced shopping list.', error)
      })
    }

    await refreshShoppingListOfflineStatus(
      input.queryClient,
      input.workspaceId,
      input.actorUserId,
    )
    shoppingListCompletedDrainRevisions.set(
      scopeKey,
      Math.max(
        shoppingListCompletedDrainRevisions.get(scopeKey) ?? 0,
        drainRevision,
      ),
    )

    return result
  })
}

async function refreshShoppingListOfflineStatus(
  queryClient: QueryClient,
  workspaceId: string,
  actorUserId?: string,
): Promise<void> {
  queryClient.setQueryData(
    shoppingListOfflineStatusQueryKey(workspaceId, actorUserId),
    await loadShoppingListOfflineStatus(workspaceId, actorUserId),
  )
}

async function loadShoppingListOfflineStatus(
  workspaceId: string,
  actorUserId?: string,
): Promise<ShoppingListOfflineStatus> {
  return {
    conflictedMutationCount: await countConflictedShoppingListOfflineMutations(
      workspaceId,
      actorUserId,
    ),
    queuedMutationCount: await countRetryableShoppingListOfflineMutations(
      workspaceId,
      actorUserId,
    ),
  }
}
