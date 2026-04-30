import type { SessionResponse } from '@planner/contracts'
import { useQuery } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  getCachedPlannerSession,
  setCachedPlannerSession,
} from './planner-session-cache'
import {
  isUnauthorizedSessionApiError,
  resolvePlannerSession,
  SessionApiError,
} from './session-api'
import { canBootstrapPlannerSession } from './session-bootstrap'
import { useSessionAuth } from './useSessionAuth'
import {
  clearSelectedWorkspaceId,
  getLastActorUserId,
  setLastActorUserId,
  useSelectedWorkspaceId,
} from './workspace-selection'

export function usePlannerSession() {
  const auth = useSessionAuth()
  const selectedWorkspaceActorUserId =
    auth.userId ??
    getLastActorUserId() ??
    plannerApiConfig.actorUserIdOverride ??
    null
  const selectedWorkspaceId = useSelectedWorkspaceId(selectedWorkspaceActorUserId)
  const canLoadPlannerSession = canBootstrapPlannerSession({
    accessToken: auth.accessToken,
    config: plannerApiConfig,
    isAuthEnabled: auth.isAuthEnabled,
  })
  const cachedPlannerSession = getCachedPlannerSession({
    actorUserId: selectedWorkspaceActorUserId,
    workspaceId: selectedWorkspaceId ?? plannerApiConfig.workspaceIdOverride,
  })

  return useQuery({
    enabled: canLoadPlannerSession,
    queryFn: async ({ signal }) => {
      const session = await loadPlannerSession({
        accessToken: auth.accessToken ?? undefined,
        legacyActorUserId:
          getLastActorUserId() ?? plannerApiConfig.actorUserIdOverride,
        selectedWorkspaceActorUserId,
        selectedWorkspaceId,
        signal,
      })
      setCachedPlannerSession(session)

      return session
    },
    queryKey: [
      'planner',
      'session',
      auth.userId ?? 'anonymous',
      plannerApiConfig.actorUserIdOverride ?? 'default',
      plannerApiConfig.workspaceIdOverride ?? 'default',
      selectedWorkspaceActorUserId ?? 'default',
      selectedWorkspaceId ?? 'default',
    ] as const,
    ...(cachedPlannerSession
      ? {
          placeholderData: cachedPlannerSession,
        }
      : {}),
    refetchOnMount: 'always',
    retry: (failureCount, error) =>
      !isUnauthorizedSessionApiError(error) && failureCount < 2,
    staleTime: 5 * 60_000,
  })
}

interface LoadPlannerSessionOptions {
  accessToken?: string | undefined
  legacyActorUserId?: string | undefined
  selectedWorkspaceActorUserId?: string | null
  selectedWorkspaceId?: string | null
  signal?: AbortSignal
}

export async function loadPlannerSession(
  options: LoadPlannerSessionOptions,
  resolveSession: typeof resolvePlannerSession = resolvePlannerSession,
): Promise<SessionResponse> {
  const canRequestSelectedWorkspace =
    !options.selectedWorkspaceId ||
    Boolean(options.accessToken || options.legacyActorUserId)

  if (options.selectedWorkspaceId && !canRequestSelectedWorkspace) {
    clearSelectedWorkspaceId(options.selectedWorkspaceActorUserId)
  }

  const baseRequest = {
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
    ...(options.legacyActorUserId
      ? { actorUserId: options.legacyActorUserId }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  }
  const requestedWorkspaceId = canRequestSelectedWorkspace
    ? (options.selectedWorkspaceId ?? undefined)
    : undefined

  try {
    const session = await resolveSession({
      ...baseRequest,
      workspaceId: requestedWorkspaceId,
    })

    return finalizeLoadedPlannerSession(session, options)
  } catch (error) {
    if (
      !requestedWorkspaceId ||
      !(error instanceof SessionApiError) ||
      error.status !== 403
    ) {
      throw error
    }

    const session = await resolveSession(baseRequest)
    clearSelectedWorkspaceId(
      options.selectedWorkspaceActorUserId ?? session.actorUserId,
    )

    return finalizeLoadedPlannerSession(session, {
      ...options,
      selectedWorkspaceId: null,
    })
  }
}

function finalizeLoadedPlannerSession(
  session: SessionResponse,
  options: Pick<
    LoadPlannerSessionOptions,
    'selectedWorkspaceActorUserId' | 'selectedWorkspaceId'
  >,
): SessionResponse {
  setLastActorUserId(session.actorUserId)

  if (
    options.selectedWorkspaceId &&
    !session.workspaces.some(
      (workspace) => workspace.id === options.selectedWorkspaceId,
    )
  ) {
    clearSelectedWorkspaceId(
      options.selectedWorkspaceActorUserId ?? session.actorUserId,
    )
  }

  return session
}
