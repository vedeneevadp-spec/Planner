import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { NewEmojiSetInput } from '@/entities/emoji-set'
import { usePlannerSession, useSessionAuth } from '@/features/session'
import { plannerApiConfig } from '@/shared/config/planner-api'

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
        throw new Error('Planner session is required to load emoji sets.')
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

export function useCreateEmojiSet() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: NewEmojiSetInput) => {
      if (!session) {
        throw new Error('Planner session is required to create emoji sets.')
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
