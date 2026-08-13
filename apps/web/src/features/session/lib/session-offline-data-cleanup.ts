import { broadcastWorkspaceLocalDataInvalidation } from '@/shared/lib/offline-sync'

import { getCachedPlannerSession } from './planner-session-cache'
import { getSelectedWorkspaceId } from './workspace-selection'

interface SessionOfflineDataCleanupResult {
  failures: readonly unknown[]
  workspaceIds: readonly string[]
}

type OfflineWorkspaceCleanup = (workspaceId: string) => Promise<void>

export async function clearSessionOfflineWorkspaceData(
  actorUserId: string | null,
): Promise<SessionOfflineDataCleanupResult> {
  let workspaceIds: string[]

  try {
    workspaceIds = getSessionOfflineWorkspaceIds(actorUserId)
  } catch (error) {
    return { failures: [error], workspaceIds: [] }
  }

  if (workspaceIds.length === 0) {
    return { failures: [], workspaceIds }
  }

  let cleanupFunctions: readonly OfflineWorkspaceCleanup[]

  try {
    cleanupFunctions = await loadOfflineWorkspaceCleanupFunctions()
  } catch (error) {
    return { failures: [error], workspaceIds }
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
      broadcastWorkspaceLocalDataInvalidation(workspaceId, 'session-cleared')
    } catch (error) {
      failures.push(error)
    }
  }

  return { failures, workspaceIds }
}

function getSessionOfflineWorkspaceIds(actorUserId: string | null): string[] {
  if (!actorUserId) {
    return []
  }

  const cachedSession = getCachedPlannerSession({ actorUserId })
  const selectedWorkspaceId = getSelectedWorkspaceId(actorUserId)

  return [
    ...new Set(
      [
        selectedWorkspaceId,
        cachedSession?.workspaceId,
        ...(cachedSession?.workspaces.map((workspace) => workspace.id) ?? []),
      ].filter((workspaceId): workspaceId is string => Boolean(workspaceId)),
    ),
  ].sort()
}

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
