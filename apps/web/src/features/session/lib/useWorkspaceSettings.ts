import type {
  SessionResponse,
  WorkspaceSettingsUpdateInput,
} from '@planner/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { usePlannerSession } from './usePlannerSession'
import { useSessionAuth } from './useSessionAuth'
import {
  createWorkspaceSettingsApiClient,
  type WorkspaceSettingsApiClientConfig,
} from './workspace-settings-api'

interface WorkspaceSettingsMutationContext {
  previousSessions: Array<[readonly unknown[], SessionResponse | undefined]>
}

export function useUpdateWorkspaceSettings() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: WorkspaceSettingsUpdateInput) => {
      if (!session) {
        throw new Error(
          'Planner session is required to update workspace settings.',
        )
      }

      return createWorkspaceSettingsApiClient(
        createWorkspaceSettingsApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).updateWorkspaceSettings(input)
    },
    onMutate: async (input): Promise<WorkspaceSettingsMutationContext> => {
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
                workspaceSettings: {
                  taskCompletionConfettiEnabled:
                    input.taskCompletionConfettiEnabled,
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['planner', 'session'],
      })
    },
  })
}

function createWorkspaceSettingsApiClientConfig(input: {
  accessToken: string | null
  actorUserId: string
  workspaceId: string
}): WorkspaceSettingsApiClientConfig {
  return {
    actorUserId: input.actorUserId,
    apiBaseUrl: plannerApiConfig.apiBaseUrl,
    workspaceId: input.workspaceId,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  }
}
