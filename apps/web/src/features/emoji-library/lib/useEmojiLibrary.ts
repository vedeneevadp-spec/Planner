import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import type {
  AddEmojiSetItemsInput,
  NewEmojiSetInput,
} from '@/entities/emoji-set'
import { usePlannerSession, useSessionAuth } from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'
import type { UploadedIconAsset } from '@/shared/ui/Icon'

import {
  createEmojiLibraryApiClient,
  type EmojiLibraryApiClientConfig,
} from './emoji-library-api'

function emojiSetQueryKey(workspaceId: string) {
  return ['emoji-library', 'sets', workspaceId] as const
}

export function useEmojiSets() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data

  return useQuery({
    enabled:
      Boolean(session) && (!auth.isAuthEnabled || Boolean(auth.accessToken)),
    queryFn: ({ signal }) => {
      if (!session) {
        throw new Error('Planner session is required to load icon sets.')
      }

      return createEmojiLibraryApiClient(
        createEmojiLibraryApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).listEmojiSets(signal)
    },
    queryKey: emojiSetQueryKey(session?.workspaceId ?? 'pending'),
    staleTime: 60_000,
  })
}

export function useUploadedIconAssets(): {
  isLoading: boolean
  uploadedIcons: UploadedIconAsset[]
} {
  const iconSetsQuery = useEmojiSets()
  const uploadedIcons = useMemo(
    () =>
      (iconSetsQuery.data ?? []).flatMap((iconSet) =>
        iconSet.items.map(
          (item): UploadedIconAsset => ({
            id: item.id,
            label: item.label,
            value: item.value,
          }),
        ),
      ),
    [iconSetsQuery.data],
  )

  return {
    isLoading: iconSetsQuery.isLoading,
    uploadedIcons,
  }
}

export function useCreateEmojiSet() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: NewEmojiSetInput) => {
      if (!session) {
        throw new Error('Planner session is required to create icon sets.')
      }

      return createEmojiLibraryApiClient(
        createEmojiLibraryApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).createEmojiSet(input)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: emojiSetQueryKey(session.workspaceId),
      })
    },
  })
}

export function useAddEmojiSetItems() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      emojiSetId: string
      items: AddEmojiSetItemsInput['items']
    }) => {
      if (!session) {
        throw new Error('Planner session is required to update icon sets.')
      }

      return createEmojiLibraryApiClient(
        createEmojiLibraryApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).addEmojiSetItems(input.emojiSetId, {
        items: input.items,
      })
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: emojiSetQueryKey(session.workspaceId),
      })
    },
  })
}

export function useDeleteEmojiSet() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (emojiSetId: string) => {
      if (!session) {
        throw new Error('Planner session is required to delete icon sets.')
      }

      await createEmojiLibraryApiClient(
        createEmojiLibraryApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).deleteEmojiSet(emojiSetId)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: emojiSetQueryKey(session.workspaceId),
      })
    },
  })
}

export function useDeleteEmojiSetItem() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { emojiSetId: string; iconAssetId: string }) => {
      if (!session) {
        throw new Error('Planner session is required to delete icon assets.')
      }

      await createEmojiLibraryApiClient(
        createEmojiLibraryApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).deleteEmojiSetItem(input.emojiSetId, input.iconAssetId)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: emojiSetQueryKey(session.workspaceId),
      })
    },
  })
}

function createEmojiLibraryApiClientConfig(input: {
  accessToken: string | null
  actorUserId: string
  workspaceId: string
}): EmojiLibraryApiClientConfig {
  return {
    actorUserId: input.actorUserId,
    apiBaseUrl: plannerApiConfig.apiBaseUrl,
    workspaceId: input.workspaceId,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  }
}
