import { useMutation, useQueryClient } from '@tanstack/react-query'

import { usePlannerSession } from '@/features/session/lib/usePlannerSession'
import { useSessionAuth } from '@/features/session/lib/useSessionAuth'
import { setSelectedWorkspaceId } from '@/features/session/lib/workspace-selection'

import {
  createSharedWorkspace,
  type SessionApiError,
} from './session-api'

export function useCreateSharedWorkspace() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const session = sessionQuery.data

      if (!session) {
        throw new Error('Planner session is required to create a workspace.')
      }

      return createSharedWorkspace({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        actorUserId: session.actorUserId,
        workspaceId: session.workspaceId,
      })
    },
    onSuccess: async (workspace) => {
      setSelectedWorkspaceId(workspace.id, sessionQuery.data?.actorUserId)
      await queryClient.invalidateQueries({ queryKey: ['planner', 'session'] })
    },
  })
}

export function getCreateSharedWorkspaceErrorMessage(error: unknown): string {
  const apiError = error as Partial<SessionApiError>

  if (apiError.code === 'shared_workspace_limit_reached') {
    return 'Можно создать не больше трёх общих workspace.'
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось создать общий workspace.'
}
