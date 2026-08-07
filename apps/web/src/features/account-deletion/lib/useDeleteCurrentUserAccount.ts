import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  deleteCurrentUserAccount,
  usePlannerSession,
  useSessionAuth,
} from '@/features/session'
import { broadcastWorkspaceLocalDataInvalidation } from '@/shared/lib/offline-sync'

import { discoverAccountDeletionOfflineWorkspaceIds } from './account-deletion-local-workspaces'

export function useDeleteCurrentUserAccount() {
  const auth = useSessionAuth()
  const session = usePlannerSession().data
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!session) {
        throw new Error('Planner session is required to delete the account.')
      }

      if (!auth.canUseProtectedApi) {
        throw new Error('Войдите в аккаунт заново и повторите удаление.')
      }

      try {
        await queryClient.cancelQueries()
      } catch (error) {
        throw new AccountDeletionLocalCleanupError([error])
      }

      let discoveredWorkspaceIds: string[]

      try {
        discoveredWorkspaceIds =
          await discoverAccountDeletionOfflineWorkspaceIds()
      } catch (error) {
        throw new AccountDeletionLocalCleanupError([error])
      }

      const workspaceIds = [
        ...new Set([
          session.workspaceId,
          ...session.workspaces.map((workspace) => workspace.id),
          ...discoveredWorkspaceIds,
        ]),
      ]
      const cleanupFailures = await clearOfflineWorkspaceData(workspaceIds)

      if (cleanupFailures.length > 0) {
        throw new AccountDeletionLocalCleanupError(cleanupFailures)
      }

      await deleteCurrentUserAccount({
        ...(auth.accessToken ? { accessToken: auth.accessToken } : {}),
        actorUserId: session.actorUserId,
        workspaceId: session.workspaceId,
      })

      const postDeleteCleanupFailures: unknown[] = []

      try {
        await queryClient.cancelQueries()
      } catch (error) {
        postDeleteCleanupFailures.push(error)
      }

      postDeleteCleanupFailures.push(
        ...(await clearOfflineWorkspaceData(workspaceIds)),
      )

      try {
        await queryClient.cancelQueries()
      } catch (error) {
        postDeleteCleanupFailures.push(error)
      }

      try {
        queryClient.removeQueries()
      } catch (error) {
        postDeleteCleanupFailures.push(error)
      }
      let didSignOutFail = false
      let signOutFailure: unknown = null

      try {
        await auth.signOut()
      } catch (error) {
        didSignOutFail = true
        signOutFailure = error
      }

      if (postDeleteCleanupFailures.length > 0) {
        throw new AccountDeletionPostDeleteCleanupError(
          postDeleteCleanupFailures,
          didSignOutFail,
          signOutFailure,
        )
      }

      if (didSignOutFail) {
        throw new AccountDeletionSignOutError(signOutFailure)
      }
    },
  })
}

async function clearOfflineWorkspaceData(
  workspaceIds: readonly string[],
): Promise<unknown[]> {
  let cleanupFunctions: readonly OfflineWorkspaceCleanup[]

  try {
    cleanupFunctions = await loadOfflineWorkspaceCleanupFunctions()
  } catch (error) {
    return [error]
  }

  const cleanupResults = await Promise.allSettled(
    workspaceIds.flatMap((workspaceId) =>
      cleanupFunctions.map((cleanup) =>
        Promise.resolve().then(() => cleanup(workspaceId)),
      ),
    ),
  )
  const failures = cleanupResults.flatMap<unknown>((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )

  for (const workspaceId of workspaceIds) {
    try {
      broadcastWorkspaceLocalDataInvalidation(workspaceId, 'account-deletion')
    } catch (error) {
      failures.push(error)
    }
  }

  return failures
}

type OfflineWorkspaceCleanup = (workspaceId: string) => Promise<void>

async function loadOfflineWorkspaceCleanupFunctions(): Promise<
  readonly OfflineWorkspaceCleanup[]
> {
  const [cleaning, habits, planner, selfCare, shoppingList] = await Promise.all(
    [
      import('@/features/cleaning/offline-storage'),
      import('@/features/habits/offline-storage'),
      import('@/features/planner/offline-storage'),
      import('@/features/self-care/offline-storage'),
      import('@/features/shopping-list/offline-storage'),
    ],
  )

  return [
    cleaning.clearCleaningOfflineWorkspaceData,
    planner.clearPlannerOfflineWorkspaceData,
    habits.clearHabitOfflineWorkspaceData,
    selfCare.clearSelfCareOfflineWorkspaceData,
    shoppingList.clearShoppingListOfflineWorkspaceData,
  ]
}

export class AccountDeletionLocalCleanupError extends Error {
  readonly code = 'account_deletion_local_cleanup_failed'
  readonly failures: readonly unknown[]

  constructor(failures: readonly unknown[]) {
    super(
      'Не удалось завершить безопасную очистку локальных данных. Удаление аккаунта не начато. Закройте другие вкладки приложения, проверьте доступ браузера к хранилищу и повторите.',
    )
    this.name = 'AccountDeletionLocalCleanupError'
    this.failures = failures
  }
}

export class AccountDeletionSignOutError extends Error {
  readonly code = 'account_deletion_sign_out_failed'

  constructor(cause: unknown) {
    super(
      'Аккаунт удалён, но не удалось завершить выход на этом устройстве. Обновите страницу и выполните выход ещё раз.',
      { cause },
    )
    this.name = 'AccountDeletionSignOutError'
  }
}

export class AccountDeletionPostDeleteCleanupError extends Error {
  readonly code = 'account_deletion_post_delete_cleanup_failed'
  readonly failures: readonly unknown[]
  readonly signOutFailure: unknown

  constructor(
    failures: readonly unknown[],
    didSignOutFail: boolean,
    signOutFailure: unknown = null,
  ) {
    super(
      didSignOutFail
        ? 'Аккаунт удалён, но локальная очистка и выход на этом устройстве не завершены. Закройте другие вкладки приложения, обновите страницу и выполните выход ещё раз.'
        : 'Аккаунт удалён, но безопасная локальная очистка не завершена. Закройте другие вкладки приложения и обновите страницу, чтобы повторить очистку.',
    )
    this.name = 'AccountDeletionPostDeleteCleanupError'
    this.failures = failures
    this.signOutFailure = signOutFailure
  }
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
