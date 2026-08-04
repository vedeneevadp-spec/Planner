import { useMutation } from '@tanstack/react-query'

import { clearHabitOfflineWorkspaceData } from '@/features/habits'
import { clearPlannerOfflineWorkspaceData } from '@/features/planner'
import {
  deleteCurrentUserAccount,
  usePlannerSession,
  useSessionAuth,
} from '@/features/session'
import { clearShoppingListOfflineWorkspaceData } from '@/features/shopping-list'

export function useDeleteCurrentUserAccount() {
  const auth = useSessionAuth()
  const session = usePlannerSession().data

  return useMutation({
    mutationFn: async () => {
      if (!session) {
        throw new Error('Planner session is required to delete the account.')
      }

      if (!auth.canUseProtectedApi) {
        throw new Error('Войдите в аккаунт заново и повторите удаление.')
      }

      await deleteCurrentUserAccount({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        actorUserId: session.actorUserId,
        workspaceId: session.workspaceId,
      })

      await Promise.allSettled(
        session.workspaces.flatMap((workspace) => [
          clearPlannerOfflineWorkspaceData(workspace.id),
          clearHabitOfflineWorkspaceData(workspace.id),
          clearShoppingListOfflineWorkspaceData(workspace.id),
        ]),
      )

      await auth.signOut()
    },
  })
}

export function getDeleteUserAccountErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'owner_account_deletion_forbidden'
  ) {
    return 'Глобальный owner не может удалить свой аккаунт.'
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось удалить аккаунт. Попробуйте ещё раз.'
}
