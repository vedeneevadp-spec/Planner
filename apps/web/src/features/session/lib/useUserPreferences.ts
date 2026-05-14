import type {
  SessionResponse,
  UserPreferencesUpdateInput,
} from '@planner/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { usePlannerSession } from './usePlannerSession'
import {
  createUserPreferencesApiClient,
  type UserPreferencesApiClientConfig,
} from './user-preferences-api'
import { useSessionAuth } from './useSessionAuth'

interface UserPreferencesMutationContext {
  previousSessions: Array<[readonly unknown[], SessionResponse | undefined]>
}

export function useUpdateUserPreferences() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UserPreferencesUpdateInput) => {
      if (!session) {
        throw new Error('Planner session is required to update preferences.')
      }

      return createUserPreferencesApiClient(
        createUserPreferencesApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).updateUserPreferences(input)
    },
    onMutate: async (input): Promise<UserPreferencesMutationContext> => {
      await queryClient.cancelQueries({ queryKey: ['planner', 'session'] })

      const previousSessions = queryClient.getQueriesData<SessionResponse>({
        queryKey: ['planner', 'session'],
      })

      queryClient.setQueriesData<SessionResponse>(
        {
          queryKey: ['planner', 'session'],
        },
        (current) =>
          current
            ? {
                ...current,
                userPreferences: {
                  ...current.userPreferences,
                  ...(input.calendarViewMode
                    ? { calendarViewMode: input.calendarViewMode }
                    : {}),
                  ...(input.energyMode ? { energyMode: input.energyMode } : {}),
                },
              }
            : current,
      )

      return { previousSessions }
    },
    onError: (_error, _input, context) => {
      for (const [queryKey, snapshot] of context?.previousSessions ?? []) {
        queryClient.setQueryData(queryKey, snapshot)
      }
    },
    onSuccess: async (preferences) => {
      queryClient.setQueriesData<SessionResponse>(
        {
          queryKey: ['planner', 'session'],
        },
        (current) =>
          current
            ? {
                ...current,
                userPreferences: preferences,
              }
            : current,
      )
      await queryClient.invalidateQueries({
        queryKey: ['planner', 'session'],
      })
    },
  })
}

function createUserPreferencesApiClientConfig(input: {
  accessToken: string | null
  actorUserId: string
  workspaceId: string
}): UserPreferencesApiClientConfig {
  return {
    actorUserId: input.actorUserId,
    apiBaseUrl: plannerApiConfig.apiBaseUrl,
    workspaceId: input.workspaceId,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  }
}
