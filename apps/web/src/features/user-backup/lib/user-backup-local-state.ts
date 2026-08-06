import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { broadcastWorkspaceLocalDataInvalidation } from '@/shared/lib/offline-sync'

const RESTORE_MESSAGE_KEY = 'planner.user-backup.restore-message'

export async function prepareWorkspaceForUserBackupRestore(
  workspaceId: string,
  queryClient: QueryClient,
  phase: UserBackupLocalCleanupPhase = 'before-restore',
): Promise<void> {
  const queryFilters = {
    predicate: (query: { queryKey: QueryKey }) =>
      isWorkspaceLocalDataQuery(query.queryKey, workspaceId),
  }

  try {
    await queryClient.cancelQueries(queryFilters)
    queryClient.removeQueries(queryFilters)
  } catch (error) {
    throw new UserBackupLocalCleanupError([error], phase)
  }

  const results = await Promise.allSettled(
    createWorkspaceOfflineCleanupTasks(workspaceId),
  )
  const failures = results.flatMap<unknown>((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )

  try {
    await queryClient.cancelQueries(queryFilters)
    queryClient.removeQueries(queryFilters)
  } catch (error) {
    failures.push(error)
  }

  try {
    broadcastWorkspaceLocalDataInvalidation(workspaceId, 'backup-restore')
  } catch (error) {
    failures.push(error)
  }

  if (failures.length > 0) {
    throw new UserBackupLocalCleanupError(failures, phase)
  }
}

function createWorkspaceOfflineCleanupTasks(
  workspaceId: string,
): Promise<void>[] {
  return [
    import('@/features/cleaning/offline-storage').then(
      ({ clearCleaningOfflineWorkspaceData }) =>
        clearCleaningOfflineWorkspaceData(workspaceId),
    ),
    import('@/features/planner/offline-storage').then(
      ({ clearPlannerOfflineWorkspaceData }) =>
        clearPlannerOfflineWorkspaceData(workspaceId),
    ),
    import('@/features/habits/offline-storage').then(
      ({ clearHabitOfflineWorkspaceData }) =>
        clearHabitOfflineWorkspaceData(workspaceId),
    ),
    import('@/features/self-care/offline-storage').then(
      ({ clearSelfCareOfflineWorkspaceData }) =>
        clearSelfCareOfflineWorkspaceData(workspaceId),
    ),
    import('@/features/shopping-list/offline-storage').then(
      ({ clearShoppingListOfflineWorkspaceData }) =>
        clearShoppingListOfflineWorkspaceData(workspaceId),
    ),
  ]
}

export type UserBackupLocalCleanupPhase = 'after-restore' | 'before-restore'

export class UserBackupLocalCleanupError extends Error {
  readonly code = 'backup_local_cleanup_failed'
  readonly failures: readonly unknown[]

  constructor(
    failures: readonly unknown[],
    phase: UserBackupLocalCleanupPhase = 'before-restore',
  ) {
    super(
      phase === 'after-restore'
        ? 'Данные на сервере восстановлены, но безопасно обновить локальные данные не удалось. Закройте другие вкладки приложения, проверьте доступ браузера к хранилищу и повторите восстановление.'
        : 'Не удалось завершить безопасную очистку локальных данных. Восстановление не начато. Закройте другие вкладки приложения, проверьте доступ браузера к хранилищу и повторите.',
    )
    this.name = 'UserBackupLocalCleanupError'
    this.failures = failures
  }
}

function isWorkspaceLocalDataQuery(
  queryKey: QueryKey,
  workspaceId: string,
): boolean {
  const [scope, categoryOrWorkspaceId, plannerWorkspaceId] = queryKey

  if (scope === 'planner') {
    return (
      categoryOrWorkspaceId !== 'session' && plannerWorkspaceId === workspaceId
    )
  }

  if (scope === 'self-care') {
    return isSelfCareQueryOwnerForWorkspace(categoryOrWorkspaceId, workspaceId)
  }

  return (
    categoryOrWorkspaceId === workspaceId &&
    [
      'cleaning',
      'habits',
      'shopping-list',
      'shopping-list-offline-status',
    ].includes(typeof scope === 'string' ? scope : '')
  )
}

function isSelfCareQueryOwnerForWorkspace(
  ownerId: unknown,
  workspaceId: string,
): boolean {
  if (ownerId === workspaceId) {
    return true
  }

  if (typeof ownerId !== 'string') {
    return false
  }

  try {
    const value: unknown = JSON.parse(ownerId)

    return (
      Array.isArray(value) &&
      value.length === 2 &&
      value[0] === workspaceId &&
      typeof value[1] === 'string'
    )
  } catch {
    return false
  }
}

export function reloadAfterUserBackupRestore(message: string): void {
  try {
    sessionStorage.setItem(RESTORE_MESSAGE_KEY, message)
  } catch {
    // The reload is still required when storage is unavailable.
  }

  window.location.reload()
}

export function takeUserBackupRestoreMessage(): string | null {
  try {
    const message = sessionStorage.getItem(RESTORE_MESSAGE_KEY)

    sessionStorage.removeItem(RESTORE_MESSAGE_KEY)

    return message
  } catch {
    return null
  }
}
