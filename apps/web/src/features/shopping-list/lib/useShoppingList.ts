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
  enqueueShoppingListOfflineMutation,
  isShoppingListOfflineStorageAvailable,
  loadCachedShoppingListItems,
  removeCachedShoppingListItem,
  replaceCachedShoppingListItems,
  upsertCachedShoppingListItem,
} from './offline-shopping-list-store'
import {
  drainShoppingListOfflineQueue,
  isQueueableShoppingListMutationError,
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

export type ShoppingListItemDraft = Omit<ShoppingListItemCreateInput, 'id'>
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

const shoppingListDrainCoordinator = createOfflineDrainCoordinator<
  string,
  void
>()

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

    await shoppingListDrainCoordinator.drain(session.workspaceId, async () => {
      const result = await drainShoppingListOfflineQueue({
        api,
        onItemDeleted: (itemId) => {
          queryClient.setQueryData<ShoppingListItem[]>(
            queryKey,
            (current = []) => removeShoppingListItemRecord(current, itemId),
          )
        },
        onItemSynced: (item) => {
          queryClient.setQueryData<ShoppingListItem[]>(
            queryKey,
            (current = []) => replaceShoppingListItemRecord(current, item),
          )
        },
        workspaceId: session.workspaceId,
      })

      if (result.synced > 0 || result.conflicted > 0) {
        await queryClient.invalidateQueries({ queryKey })
      }
    })
  }, [api, queryClient, queryKey, session])

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

export function useCreateShoppingListItem() {
  const { api, session, workspaceId } = useShoppingListApi()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => shoppingListQueryKey(workspaceId),
    [workspaceId],
  )

  return useMutation({
    mutationFn: async (input: string | ShoppingListItemDraft) => {
      if (!session) {
        throw new Error(
          'Planner session is required to create shopping list items.',
        )
      }

      const itemInput = normalizeShoppingListItemDraft(input)
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

        const optimisticItem = applyShoppingListItemPatch(existingItem, {
          status: 'new',
        })

        queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current = []) =>
          replaceShoppingListItemRecord(current, optimisticItem),
        )
        await upsertCachedShoppingListItem(session.workspaceId, optimisticItem)

        try {
          const updatedItem = await requireShoppingListApi(api).updateItem(
            existingItem.id,
            { status: 'new' },
          )

          queryClient.setQueryData<ShoppingListItem[]>(
            queryKey,
            (current = []) =>
              replaceShoppingListItemRecord(current, updatedItem),
          )
          await upsertCachedShoppingListItem(session.workspaceId, updatedItem)

          return updatedItem
        } catch (error) {
          if (shouldKeepOptimisticShoppingListMutation(error)) {
            await enqueueShoppingListOfflineMutation({
              actorUserId: session.actorUserId,
              itemId: existingItem.id,
              patch: { status: 'new' },
              type: 'shopping.update',
              workspaceId: session.workspaceId,
            })

            return optimisticItem
          }

          await restoreShoppingListItems({
            items: previousItems,
            queryClient,
            queryKey,
            workspaceId: session.workspaceId,
          })

          throw error
        }
      }

      queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current) =>
        replaceShoppingListItemRecord(current ?? previousItems, optimisticItem),
      )
      await upsertCachedShoppingListItem(session.workspaceId, optimisticItem)

      try {
        const createdItem = await requireShoppingListApi(api).createItem({
          id: itemId,
          ...itemInput,
        })

        queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current = []) =>
          replaceShoppingListItemRecord(current, createdItem),
        )
        await upsertCachedShoppingListItem(session.workspaceId, createdItem)

        return createdItem
      } catch (error) {
        if (shouldKeepOptimisticShoppingListMutation(error)) {
          await enqueueShoppingListOfflineMutation({
            actorUserId: session.actorUserId,
            isFavorite: optimisticItem.isFavorite,
            itemId,
            priority: optimisticItem.priority,
            shoppingCategory: optimisticItem.shoppingCategory,
            text: optimisticItem.text,
            type: 'shopping.create',
            workspaceId: session.workspaceId,
          })

          return optimisticItem
        }

        await restoreShoppingListItems({
          items: previousItems,
          queryClient,
          queryKey,
          workspaceId: session.workspaceId,
        })

        throw error
      }
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
    mutationFn: async (input: {
      itemId: string
      patch: ChaosInboxItemUpdateInput
    }) => {
      if (!session) {
        throw new Error(
          'Planner session is required to update shopping list items.',
        )
      }

      const previousItems =
        queryClient.getQueryData<ShoppingListItem[]>(queryKey) ??
        (await loadCachedShoppingListItems(session.workspaceId))
      const currentItem = previousItems.find((item) => item.id === input.itemId)

      if (!currentItem) {
        throw new Error(`Shopping list item "${input.itemId}" was not found.`)
      }

      const optimisticItem = applyShoppingListItemPatch(
        currentItem,
        input.patch,
      )

      queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current = []) =>
        replaceShoppingListItemRecord(current, optimisticItem),
      )
      await upsertCachedShoppingListItem(session.workspaceId, optimisticItem)

      try {
        const updatedItem = await requireShoppingListApi(api).updateItem(
          input.itemId,
          input.patch,
        )

        queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current = []) =>
          replaceShoppingListItemRecord(current, updatedItem),
        )
        await upsertCachedShoppingListItem(session.workspaceId, updatedItem)

        return updatedItem
      } catch (error) {
        if (shouldKeepOptimisticShoppingListMutation(error)) {
          await enqueueShoppingListOfflineMutation({
            actorUserId: session.actorUserId,
            itemId: input.itemId,
            patch: input.patch,
            type: 'shopping.update',
            workspaceId: session.workspaceId,
          })

          return optimisticItem
        }

        await restoreShoppingListItems({
          items: previousItems,
          queryClient,
          queryKey,
          workspaceId: session.workspaceId,
        })

        throw error
      }
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
    mutationFn: async (itemId: string) => {
      if (!session) {
        throw new Error(
          'Planner session is required to remove shopping list items.',
        )
      }

      const previousItems =
        queryClient.getQueryData<ShoppingListItem[]>(queryKey) ??
        (await loadCachedShoppingListItems(session.workspaceId))

      queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current) =>
        removeShoppingListItemRecord(current ?? previousItems, itemId),
      )
      await removeCachedShoppingListItem(session.workspaceId, itemId)

      try {
        await requireShoppingListApi(api).removeItem(itemId)
      } catch (error) {
        if (shouldKeepOptimisticShoppingListMutation(error)) {
          await enqueueShoppingListOfflineMutation({
            actorUserId: session.actorUserId,
            itemId,
            type: 'shopping.delete',
            workspaceId: session.workspaceId,
          })

          return
        }

        await restoreShoppingListItems({
          items: previousItems,
          queryClient,
          queryKey,
          workspaceId: session.workspaceId,
        })

        throw error
      }
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

async function restoreShoppingListItems(input: {
  items: ShoppingListItem[]
  queryClient: QueryClient
  queryKey: ReturnType<typeof shoppingListQueryKey>
  workspaceId: string
}): Promise<void> {
  input.queryClient.setQueryData<ShoppingListItem[]>(
    input.queryKey,
    input.items,
  )
  await replaceCachedShoppingListItems(input.workspaceId, input.items)
}

function requireShoppingListApi(
  api: ShoppingListApiClient | null,
): ShoppingListApiClient {
  if (!api) {
    throw new ShoppingListApiUnavailableError()
  }

  return api
}

function shouldKeepOptimisticShoppingListMutation(error: unknown): boolean {
  return (
    isShoppingListOfflineStorageAvailable() &&
    (error instanceof ShoppingListApiUnavailableError ||
      isQueueableShoppingListMutationError(error))
  )
}
