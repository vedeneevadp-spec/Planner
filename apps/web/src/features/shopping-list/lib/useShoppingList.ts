import {
  type ChaosInboxItemRecord,
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

import { usePlannerSession, useSessionAuth } from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'

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
  type ShoppingListApiClientConfig,
} from './shopping-list-api'

function shoppingListQueryKey(workspaceId: string) {
  return ['shopping-list', workspaceId] as const
}

export type ShoppingListItem = ChaosInboxItemRecord

class ShoppingListApiUnavailableError extends Error {
  constructor() {
    super('Shopping list session is not ready.')
    this.name = 'ShoppingListApiUnavailableError'
  }
}

let shoppingListDrainPromise: Promise<void> | null = null

export function useShoppingListItems(options: { enabled?: boolean } = {}) {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()
  const isEnabled =
    options.enabled !== false &&
    Boolean(session) &&
    (!auth.isAuthEnabled || Boolean(auth.accessToken))
  const queryKey = useMemo(
    () => shoppingListQueryKey(session?.workspaceId ?? 'pending'),
    [session?.workspaceId],
  )
  const api = useMemo(() => {
    if (!session || !isEnabled) {
      return null
    }

    return createShoppingListApiClient(
      createShoppingListApiClientConfig({
        accessToken: auth.accessToken,
        actorUserId: session.actorUserId,
        workspaceId: session.workspaceId,
      }),
    )
  }, [auth.accessToken, isEnabled, session])

  const drainQueuedMutations = useCallback(async () => {
    if (!api || !session) {
      return
    }

    if (shoppingListDrainPromise) {
      await shoppingListDrainPromise
      return
    }

    shoppingListDrainPromise = (async () => {
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

      if (result.synced > 0) {
        await queryClient.invalidateQueries({ queryKey })
      }
    })().finally(() => {
      shoppingListDrainPromise = null
    })

    await shoppingListDrainPromise
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

  useEffect(() => {
    void drainQueuedMutations()
  }, [drainQueuedMutations])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    function handleOnline() {
      void drainQueuedMutations()
    }

    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [drainQueuedMutations])

  return useQuery({
    enabled: isEnabled,
    queryFn: async ({ signal }) => {
      if (!api || !session) {
        throw new Error(
          'Planner session is required to load shopping list items.',
        )
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
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => shoppingListQueryKey(session?.workspaceId ?? 'pending'),
    [session?.workspaceId],
  )
  const api = useMemo(
    () =>
      session && (!auth.isAuthEnabled || auth.accessToken)
        ? createShoppingListApiClient(
            createShoppingListApiClientConfig({
              accessToken: auth.accessToken,
              actorUserId: session.actorUserId,
              workspaceId: session.workspaceId,
            }),
          )
        : null,
    [auth.accessToken, auth.isAuthEnabled, session],
  )

  return useMutation({
    mutationFn: async (text: string) => {
      if (!session) {
        throw new Error(
          'Planner session is required to create shopping list items.',
        )
      }

      const itemId = generateUuidV7()
      const optimisticItem = createOptimisticShoppingListItem(
        {
          id: itemId,
          text,
        },
        {
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        },
      )
      const previousItems =
        queryClient.getQueryData<ShoppingListItem[]>(queryKey) ??
        (await loadCachedShoppingListItems(session.workspaceId))

      queryClient.setQueryData<ShoppingListItem[]>(queryKey, (current) =>
        replaceShoppingListItemRecord(current ?? previousItems, optimisticItem),
      )
      await upsertCachedShoppingListItem(session.workspaceId, optimisticItem)

      try {
        const createdItem = await requireShoppingListApi(api).createItem({
          id: itemId,
          text,
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
            itemId,
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
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => shoppingListQueryKey(session?.workspaceId ?? 'pending'),
    [session?.workspaceId],
  )
  const api = useMemo(
    () =>
      session && (!auth.isAuthEnabled || auth.accessToken)
        ? createShoppingListApiClient(
            createShoppingListApiClientConfig({
              accessToken: auth.accessToken,
              actorUserId: session.actorUserId,
              workspaceId: session.workspaceId,
            }),
          )
        : null,
    [auth.accessToken, auth.isAuthEnabled, session],
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
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => shoppingListQueryKey(session?.workspaceId ?? 'pending'),
    [session?.workspaceId],
  )
  const api = useMemo(
    () =>
      session && (!auth.isAuthEnabled || auth.accessToken)
        ? createShoppingListApiClient(
            createShoppingListApiClientConfig({
              accessToken: auth.accessToken,
              actorUserId: session.actorUserId,
              workspaceId: session.workspaceId,
            }),
          )
        : null,
    [auth.accessToken, auth.isAuthEnabled, session],
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

export function useShoppingListSummary() {
  const itemsQuery = useShoppingListItems()

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

export function isShoppingListItemCompleted(item: ShoppingListItem): boolean {
  return item.status === 'archived'
}

export function sortActiveShoppingListItems(
  items: ShoppingListItem[],
): ShoppingListItem[] {
  return [...items]
    .filter((item) => !isShoppingListItemCompleted(item))
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.text.localeCompare(right.text)
        : left.createdAt.localeCompare(right.createdAt),
    )
}

export function sortCompletedShoppingListItems(
  items: ShoppingListItem[],
): ShoppingListItem[] {
  return [...items]
    .filter((item) => isShoppingListItemCompleted(item))
    .sort((left, right) =>
      left.updatedAt === right.updatedAt
        ? left.text.localeCompare(right.text)
        : right.updatedAt.localeCompare(left.updatedAt),
    )
}

function createShoppingListApiClientConfig(input: {
  accessToken: string | null
  actorUserId: string
  workspaceId: string
}): ShoppingListApiClientConfig {
  return {
    actorUserId: input.actorUserId,
    apiBaseUrl: plannerApiConfig.apiBaseUrl,
    workspaceId: input.workspaceId,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  }
}

function createOptimisticShoppingListItem(
  input: {
    id: string
    text: string
  },
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
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: null,
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
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
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
