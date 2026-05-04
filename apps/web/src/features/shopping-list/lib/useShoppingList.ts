import type { ChaosInboxItemRecord } from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { usePlannerSession, useSessionAuth } from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  createShoppingListApiClient,
  type ShoppingListApiClientConfig,
} from './shopping-list-api'

function shoppingListQueryKey(workspaceId: string) {
  return ['shopping-list', workspaceId] as const
}

export type ShoppingListItem = ChaosInboxItemRecord

export function useShoppingListItems(options: { enabled?: boolean } = {}) {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data

  return useQuery({
    enabled:
      options.enabled !== false &&
      Boolean(session) &&
      (!auth.isAuthEnabled || Boolean(auth.accessToken)),
    queryFn: ({ signal }) => {
      if (!session) {
        throw new Error(
          'Planner session is required to load shopping list items.',
        )
      }

      return createShoppingListApiClient(
        createShoppingListApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).listItems(signal)
    },
    queryKey: shoppingListQueryKey(session?.workspaceId ?? 'pending'),
    staleTime: 30_000,
  })
}

export function useCreateShoppingListItem() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (text: string) => {
      if (!session) {
        throw new Error(
          'Planner session is required to create shopping list items.',
        )
      }

      return createShoppingListApiClient(
        createShoppingListApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).createItem(text)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: shoppingListQueryKey(session.workspaceId),
      })
    },
  })
}

export function useUpdateShoppingListItem() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      itemId: string
      patch: {
        status?: 'archived' | 'new'
      }
    }) => {
      if (!session) {
        throw new Error(
          'Planner session is required to update shopping list items.',
        )
      }

      return createShoppingListApiClient(
        createShoppingListApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).updateItem(input.itemId, input.patch)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: shoppingListQueryKey(session.workspaceId),
      })
    },
  })
}

export function useRemoveShoppingListItem() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (itemId: string) => {
      if (!session) {
        throw new Error(
          'Planner session is required to remove shopping list items.',
        )
      }

      await createShoppingListApiClient(
        createShoppingListApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).removeItem(itemId)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: shoppingListQueryKey(session.workspaceId),
      })
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
