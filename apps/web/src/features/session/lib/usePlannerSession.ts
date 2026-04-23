import { useQuery } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  isUnauthorizedSessionApiError,
  resolvePlannerSession,
} from './session-api'
import { useSessionAuth } from './useSessionAuth'
import {
  clearSelectedWorkspaceId,
  getLastActorUserId,
  setLastActorUserId,
  useSelectedWorkspaceId,
} from './workspace-selection'

export function usePlannerSession() {
  const auth = useSessionAuth()
  const selectedWorkspaceId = useSelectedWorkspaceId()

  return useQuery({
    enabled: !auth.isAuthEnabled || Boolean(auth.accessToken),
    queryFn: async ({ signal }) => {
      const legacyActorUserId =
        getLastActorUserId() ?? plannerApiConfig.actorUserIdOverride
      const canRequestSelectedWorkspace =
        !selectedWorkspaceId || Boolean(auth.accessToken || legacyActorUserId)

      if (selectedWorkspaceId && !canRequestSelectedWorkspace) {
        clearSelectedWorkspaceId()
      }

      const session = await resolvePlannerSession({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        actorUserId: legacyActorUserId ?? undefined,
        signal,
        workspaceId: canRequestSelectedWorkspace
          ? (selectedWorkspaceId ?? undefined)
          : undefined,
      })

      setLastActorUserId(session.actorUserId)

      if (
        selectedWorkspaceId &&
        !session.workspaces.some(
          (workspace) => workspace.id === selectedWorkspaceId,
        )
      ) {
        clearSelectedWorkspaceId()
      }

      return session
    },
    queryKey: [
      'planner',
      'session',
      auth.userId ?? 'anonymous',
      plannerApiConfig.actorUserIdOverride ?? 'default',
      plannerApiConfig.workspaceIdOverride ?? 'default',
      selectedWorkspaceId ?? 'default',
    ] as const,
    retry: (failureCount, error) =>
      !isUnauthorizedSessionApiError(error) && failureCount < 2,
    staleTime: 5 * 60_000,
  })
}
