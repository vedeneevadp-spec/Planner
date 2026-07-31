import { clearHabitOfflineWorkspaceData } from '@/features/habits'
import { clearPlannerOfflineWorkspaceData } from '@/features/planner'
import { clearShoppingListOfflineWorkspaceData } from '@/features/shopping-list'

const RESTORE_MESSAGE_KEY = 'planner.user-backup.restore-message'

export async function clearRestoredWorkspaceLocalData(
  workspaceId: string,
): Promise<void> {
  await Promise.all([
    clearPlannerOfflineWorkspaceData(workspaceId),
    clearHabitOfflineWorkspaceData(workspaceId),
    clearShoppingListOfflineWorkspaceData(workspaceId),
  ])
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
