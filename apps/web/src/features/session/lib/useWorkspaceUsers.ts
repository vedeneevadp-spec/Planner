import type { WorkspaceRole } from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { usePlannerSession } from './usePlannerSession'
import { useSessionAuth } from './useSessionAuth'
import {
  createWorkspaceUsersApiClient,
  type WorkspaceUsersApiClientConfig,
} from './workspace-users-api'

function workspaceUsersQueryKey(workspaceId: string) {
  return ['workspace-users', workspaceId] as const
}

export function useWorkspaceUsers(options: { enabled?: boolean } = {}) {
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
        throw new Error('Planner session is required to load workspace users.')
      }

      return createWorkspaceUsersApiClient(
        createWorkspaceUsersApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).listWorkspaceUsers(signal)
    },
    queryKey: workspaceUsersQueryKey(session?.workspaceId ?? 'pending'),
    staleTime: 30_000,
  })
}

export function useUpdateWorkspaceUserRole() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { role: WorkspaceRole; userId: string }) => {
      if (!session) {
        throw new Error('Planner session is required to update user roles.')
      }

      return createWorkspaceUsersApiClient(
        createWorkspaceUsersApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).updateWorkspaceUserRole(input.userId, input.role)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceUsersQueryKey(session.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['planner', 'session'],
        }),
      ])
    },
  })
}

function createWorkspaceUsersApiClientConfig(input: {
  accessToken: string | null
  actorUserId: string
  workspaceId: string
}): WorkspaceUsersApiClientConfig {
  return {
    actorUserId: input.actorUserId,
    apiBaseUrl: plannerApiConfig.apiBaseUrl,
    workspaceId: input.workspaceId,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  }
}
