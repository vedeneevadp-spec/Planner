import type {
  AssignableWorkspaceGroupRole,
  WorkspaceInvitationCreateInput,
} from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { plannerApiConfig } from '@/shared/config/planner-api'

import { usePlannerSession } from './usePlannerSession'
import { useSessionAuth } from './useSessionAuth'
import type { WorkspaceParticipantsApiError } from './workspace-participants-api'
import {
  createWorkspaceParticipantsApiClient,
  type WorkspaceParticipantsApiClientConfig,
} from './workspace-participants-api'

function workspaceUsersQueryKey(workspaceId: string) {
  return ['workspace-users', workspaceId] as const
}

function workspaceInvitationsQueryKey(workspaceId: string) {
  return ['workspace-invitations', workspaceId] as const
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

      return createWorkspaceParticipantsApiClient(
        createWorkspaceParticipantsApiClientConfig({
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

export function useWorkspaceInvitations(options: { enabled?: boolean } = {}) {
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
        throw new Error(
          'Planner session is required to load workspace invitations.',
        )
      }

      return createWorkspaceParticipantsApiClient(
        createWorkspaceParticipantsApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).listWorkspaceInvitations(signal)
    },
    queryKey: workspaceInvitationsQueryKey(session?.workspaceId ?? 'pending'),
    staleTime: 30_000,
  })
}

export function useCreateWorkspaceInvitation() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: WorkspaceInvitationCreateInput) => {
      if (!session) {
        throw new Error('Planner session is required to invite participants.')
      }

      return createWorkspaceParticipantsApiClient(
        createWorkspaceParticipantsApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).createWorkspaceInvitation(input)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceInvitationsQueryKey(session.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['planner', 'session'],
        }),
      ])
    },
  })
}

export function useUpdateWorkspaceUserGroupRole() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      membershipId: string
      groupRole: AssignableWorkspaceGroupRole
    }) => {
      if (!session) {
        throw new Error(
          'Planner session is required to update participant roles.',
        )
      }

      return createWorkspaceParticipantsApiClient(
        createWorkspaceParticipantsApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).updateWorkspaceUserGroupRole(input.membershipId, input.groupRole)
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

export function useRemoveWorkspaceUser() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (membershipId: string) => {
      if (!session) {
        throw new Error('Planner session is required to remove participants.')
      }

      return createWorkspaceParticipantsApiClient(
        createWorkspaceParticipantsApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).removeWorkspaceUser(membershipId)
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

export function useRevokeWorkspaceInvitation() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (invitationId: string) => {
      if (!session) {
        throw new Error('Planner session is required to revoke invitations.')
      }

      return createWorkspaceParticipantsApiClient(
        createWorkspaceParticipantsApiClientConfig({
          accessToken: auth.accessToken,
          actorUserId: session.actorUserId,
          workspaceId: session.workspaceId,
        }),
      ).revokeWorkspaceInvitation(invitationId)
    },
    onSuccess: async () => {
      if (!session) {
        return
      }

      await queryClient.invalidateQueries({
        queryKey: workspaceInvitationsQueryKey(session.workspaceId),
      })
    },
  })
}

export function getWorkspaceParticipantsErrorMessage(error: unknown): string {
  const apiError = error as Partial<WorkspaceParticipantsApiError>

  if (apiError.code === 'shared_workspace_required') {
    return 'Участниками можно управлять только в общем workspace.'
  }

  if (apiError.code === 'workspace_participants_manage_forbidden') {
    return 'Только owner и group admin могут управлять участниками.'
  }

  if (apiError.code === 'workspace_user_already_exists') {
    return 'Этот пользователь уже состоит в workspace.'
  }

  if (apiError.code === 'workspace_self_removal_forbidden') {
    return 'Нельзя удалить собственный доступ из этого окна.'
  }

  if (apiError.code === 'workspace_self_group_role_change_forbidden') {
    return 'Нельзя менять свою групповую роль из этого окна.'
  }

  if (apiError.code === 'workspace_owner_group_role_immutable') {
    return 'Права владельца меняются только отдельной передачей владения.'
  }

  if (apiError.code === 'workspace_owner_removal_forbidden') {
    return 'Owner нельзя удалить из workspace.'
  }

  if (apiError.code === 'workspace_invitation_not_found') {
    return 'Приглашение уже недоступно.'
  }

  if (apiError.code === 'workspace_user_not_found') {
    return 'Участник уже недоступен.'
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось обновить участников workspace.'
}

function createWorkspaceParticipantsApiClientConfig(input: {
  accessToken: string | null
  actorUserId: string
  workspaceId: string
}): WorkspaceParticipantsApiClientConfig {
  return {
    actorUserId: input.actorUserId,
    apiBaseUrl: plannerApiConfig.apiBaseUrl,
    workspaceId: input.workspaceId,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  }
}
