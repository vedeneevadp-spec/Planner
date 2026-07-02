import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import type {
  AddEmojiSetItemsInput,
  NewEmojiSetInput,
} from '@/entities/emoji-set'
import { useSessionFeatureReadiness } from '@/features/session'
import type { UploadedIconAsset } from '@/shared/ui/Icon'

import { createEmojiLibraryApiClient } from './emoji-library-api'

function emojiSetQueryKey(workspaceId: string) {
  return ['emoji-library', 'sets', workspaceId] as const
}

export function useEmojiSets() {
  const { api, isEnabled, workspaceId } = useEmojiLibraryApi()

  return useQuery({
    enabled: isEnabled,
    queryFn: ({ signal }) => {
      return requireEmojiLibraryApi(api).listEmojiSets(signal)
    },
    queryKey: emojiSetQueryKey(workspaceId),
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
        iconSet.items.map((item): UploadedIconAsset => ({
          id: item.id,
          label: item.label,
          value: item.value,
        })),
      ),
    [iconSetsQuery.data],
  )

  return {
    isLoading: iconSetsQuery.isLoading,
    uploadedIcons,
  }
}

export function useCreateEmojiSet() {
  const { api, session } = useEmojiLibraryApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: NewEmojiSetInput) => {
      if (!session) {
        throw new Error('Planner session is required to create icon sets.')
      }

      return requireEmojiLibraryApi(api).createEmojiSet(input)
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
  const { api, session } = useEmojiLibraryApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      emojiSetId: string
      items: AddEmojiSetItemsInput['items']
    }) => {
      if (!session) {
        throw new Error('Planner session is required to update icon sets.')
      }

      return requireEmojiLibraryApi(api).addEmojiSetItems(input.emojiSetId, {
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
  const { api, session } = useEmojiLibraryApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (emojiSetId: string) => {
      if (!session) {
        throw new Error('Planner session is required to delete icon sets.')
      }

      await requireEmojiLibraryApi(api).deleteEmojiSet(emojiSetId)
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
  const { api, session } = useEmojiLibraryApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { emojiSetId: string; iconAssetId: string }) => {
      if (!session) {
        throw new Error('Planner session is required to delete icon assets.')
      }

      await requireEmojiLibraryApi(api).deleteEmojiSetItem(
        input.emojiSetId,
        input.iconAssetId,
      )
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

function useEmojiLibraryApi() {
  const { apiConfig, isApiEnabled, session, workspaceId } =
    useSessionFeatureReadiness()
  const api = useMemo(
    () => (apiConfig ? createEmojiLibraryApiClient(apiConfig) : null),
    [apiConfig],
  )

  return {
    api,
    isEnabled: isApiEnabled,
    session,
    workspaceId,
  }
}

function requireEmojiLibraryApi(
  api: ReturnType<typeof createEmojiLibraryApiClient> | null,
) {
  if (!api) {
    throw new Error('Icon library API is not ready.')
  }

  return api
}
