import type { AssignableAppRole } from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  type AdminUsersApiClientConfig,
  createAdminUsersApiClient,
} from './admin-users-api'
import { assertCanUseProtectedSessionApi } from './session-auth-lifecycle'
import { usePlannerSession } from './usePlannerSession'
import { useSessionAuth } from './useSessionAuth'
import { useSessionFeatureReadiness } from './useSessionFeatureReadiness'

function adminUsersQueryKey(workspaceId: string) {
  return ['admin-users', workspaceId] as const
}

export function useAdminUsers(options: { enabled?: boolean } = {}) {
  const { apiConfig, isApiEnabled, workspaceId } = useSessionFeatureReadiness({
    enabled: options.enabled,
  })

  return useQuery({
    enabled: isApiEnabled,
    queryFn: ({ signal }) => {
      if (!apiConfig) {
        throw new Error('Admin users API is not ready.')
      }

      return createAdminUsersApiClient(apiConfig).listAdminUsers(signal)
    },
    queryKey: adminUsersQueryKey(workspaceId),
    staleTime: 30_000,
  })
}

export function useUpdateAdminUserRole() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { role: AssignableAppRole; userId: string }) => {
      if (!session) {
        throw new Error('Planner session is required to update user roles.')
      }

      assertCanUseProtectedSessionApi(auth)

      return createAdminUsersApiClient(
        createAdminUsersApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).updateAdminUserRole(input.userId, input.role)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminUsersQueryKey(session.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['planner', 'session'],
        }),
      ])
    },
  })
}

function createAdminUsersApiClientConfig(input: {
  accessToken: string | null
  actorUserId: string
  workspaceId: string
}): AdminUsersApiClientConfig {
  return {
    actorUserId: input.actorUserId,
    apiBaseUrl: plannerApiConfig.apiBaseUrl,
    workspaceId: input.workspaceId,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  }
}
