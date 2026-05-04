import type {
  CreateSharedWorkspaceInput,
  UpdateSharedWorkspaceInput,
} from '@planner/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { usePlannerSession } from '@/features/session/lib/usePlannerSession'
import { useSessionAuth } from '@/features/session/lib/useSessionAuth'
import {
  clearSelectedWorkspaceId,
  setSelectedWorkspaceIdForActors,
} from '@/features/session/lib/workspace-selection'

import {
  createSharedWorkspace,
  deleteSharedWorkspace,
  type SessionApiError,
  updateSharedWorkspace,
} from './session-api'

export function useCreateSharedWorkspace() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateSharedWorkspaceInput) => {
      const session = sessionQuery.data

      if (!session) {
        throw new Error('Planner session is required to create a workspace.')
      }

      return createSharedWorkspace({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        actorUserId: session.actorUserId,
        input,
        workspaceId: session.workspaceId,
      })
    },
    onSuccess: async (workspace) => {
      setSelectedWorkspaceIdForActors(workspace.id, [
        auth.userId,
        sessionQuery.data?.actorUserId,
      ])
      await queryClient.invalidateQueries({ queryKey: ['planner', 'session'] })
    },
  })
}

export function useUpdateSharedWorkspace() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateSharedWorkspaceInput) => {
      const session = sessionQuery.data

      if (!session) {
        throw new Error('Planner session is required to rename a workspace.')
      }

      return updateSharedWorkspace({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        actorUserId: session.actorUserId,
        input,
        workspaceId: session.workspaceId,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['planner', 'session'] })
    },
  })
}

export function useDeleteSharedWorkspace() {
  const auth = useSessionAuth()
  const sessionQuery = usePlannerSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const session = sessionQuery.data

      if (!session) {
        throw new Error('Planner session is required to delete a workspace.')
      }

      await deleteSharedWorkspace({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        actorUserId: session.actorUserId,
        workspaceId: session.workspaceId,
      })
    },
    onSuccess: async () => {
      clearSelectedWorkspaceId(auth.userId)
      clearSelectedWorkspaceId(sessionQuery.data?.actorUserId)
      await queryClient.invalidateQueries({ queryKey: ['planner', 'session'] })
    },
  })
}

export function getCreateSharedWorkspaceErrorMessage(error: unknown): string {
  return getWorkspaceActionErrorMessage(error, {
    fallback: 'Не удалось создать общее пространство.',
    limitMessage: 'Можно создать не больше трёх общих пространств.',
  })
}

export function getUpdateSharedWorkspaceErrorMessage(error: unknown): string {
  return getWorkspaceActionErrorMessage(error, {
    fallback: 'Не удалось переименовать пространство.',
  })
}

export function getDeleteSharedWorkspaceErrorMessage(error: unknown): string {
  return getWorkspaceActionErrorMessage(error, {
    fallback: 'Не удалось удалить пространство.',
  })
}

function getWorkspaceActionErrorMessage(
  error: unknown,
  options: {
    fallback: string
    limitMessage?: string
  },
): string {
  const apiError = error as Partial<SessionApiError>

  if (apiError.code === 'shared_workspace_limit_reached') {
    return options.limitMessage ?? 'Достигнут лимит общих пространств.'
  }

  if (apiError.code === 'shared_workspace_creator_required') {
    return 'Переименовывать и удалять пространство может только его создатель.'
  }

  if (apiError.code === 'shared_workspace_required') {
    return 'Эта операция доступна только для общего пространства.'
  }

  return error instanceof Error
    ? error.message
    : options.fallback
}
