import type { SessionResponse, UpdateUserProfileInput } from '@planner/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  type SessionApiError,
  updateUserProfile,
} from './session-api'
import { usePlannerSession } from './usePlannerSession'
import { useSessionAuth } from './useSessionAuth'

interface UserProfileMutationContext {
  previousSessions: Array<[readonly unknown[], SessionResponse | undefined]>
}

export function useUpdateUserProfile() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateUserProfileInput) => {
      if (!session) {
        throw new Error('Planner session is required to update profile.')
      }

      return updateUserProfile({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        actorUserId: session.actorUserId,
        input,
        workspaceId: session.workspaceId,
      })
    },
    onMutate: async (input): Promise<UserProfileMutationContext> => {
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
                actor: {
                  ...current.actor,
                  avatarUrl: input.removeAvatar
                    ? null
                    : input.avatarDataUrl ?? current.actor.avatarUrl,
                  displayName:
                    input.displayName?.trim() ?? current.actor.displayName,
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
    onSuccess: async (profile) => {
      queryClient.setQueriesData<SessionResponse>(
        {
          queryKey: ['planner', 'session'],
        },
        (current) =>
          current
            ? {
                ...current,
                actor: {
                  avatarUrl: profile.avatarUrl,
                  displayName: profile.displayName,
                  email: profile.email,
                  id: profile.id,
                },
              }
            : current,
      )

      await queryClient.invalidateQueries({
        queryKey: ['planner', 'session'],
      })
    },
  })
}

export function getUpdateUserProfileErrorMessage(error: unknown): string {
  const apiError = error as Partial<SessionApiError>

  if (apiError.code === 'user_profile_not_found') {
    return 'Профиль пользователя не найден.'
  }

  if (apiError.code === 'invalid_body') {
    return 'Не удалось сохранить профиль. Проверьте имя и файл аватарки.'
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось сохранить изменения профиля.'
}

export function resolveProfileApiBaseUrl(): string {
  return plannerApiConfig.apiBaseUrl.replace(/\/$/, '')
}
