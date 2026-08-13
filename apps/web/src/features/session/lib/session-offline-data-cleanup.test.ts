import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  clearCleaning: vi.fn(),
  clearHabits: vi.fn(),
  clearPlanner: vi.fn(),
  clearSelfCare: vi.fn(),
  clearShoppingList: vi.fn(),
  getCachedSession: vi.fn(),
  getSelectedWorkspaceId: vi.fn(),
}))

vi.mock('@/shared/lib/offline-sync', () => ({
  broadcastWorkspaceLocalDataInvalidation: mocks.broadcast,
}))

vi.mock('@/features/cleaning/offline-storage', () => ({
  clearCleaningOfflineWorkspaceData: mocks.clearCleaning,
}))

vi.mock('@/features/habits/offline-storage', () => ({
  clearHabitOfflineWorkspaceData: mocks.clearHabits,
}))

vi.mock('@/features/planner/offline-storage', () => ({
  clearPlannerOfflineWorkspaceData: mocks.clearPlanner,
}))

vi.mock('@/features/self-care/offline-storage', () => ({
  clearSelfCareOfflineWorkspaceData: mocks.clearSelfCare,
}))

vi.mock('@/features/shopping-list/offline-storage', () => ({
  clearShoppingListOfflineWorkspaceData: mocks.clearShoppingList,
}))

vi.mock('./planner-session-cache', () => ({
  getCachedPlannerSession: mocks.getCachedSession,
}))

vi.mock('./workspace-selection', () => ({
  getSelectedWorkspaceId: mocks.getSelectedWorkspaceId,
}))

import { clearSessionOfflineWorkspaceData } from './session-offline-data-cleanup'

describe('clearSessionOfflineWorkspaceData', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }

    mocks.broadcast.mockReturnValue(undefined)
    mocks.clearCleaning.mockResolvedValue(undefined)
    mocks.clearHabits.mockResolvedValue(undefined)
    mocks.clearPlanner.mockResolvedValue(undefined)
    mocks.clearSelfCare.mockResolvedValue(undefined)
    mocks.clearShoppingList.mockResolvedValue(undefined)
    mocks.getSelectedWorkspaceId.mockReturnValue('workspace-selected')
    mocks.getCachedSession.mockReturnValue({
      workspaceId: 'workspace-current',
      workspaces: [{ id: 'workspace-current' }, { id: 'workspace-other' }],
    })
  })

  it('purges every current-account workspace from every offline domain', async () => {
    const result = await clearSessionOfflineWorkspaceData('user-1')
    const expectedWorkspaceIds = [
      'workspace-current',
      'workspace-other',
      'workspace-selected',
    ]

    expect(result).toEqual({
      failures: [],
      workspaceIds: expectedWorkspaceIds,
    })

    for (const cleanup of [
      mocks.clearCleaning,
      mocks.clearHabits,
      mocks.clearPlanner,
      mocks.clearSelfCare,
      mocks.clearShoppingList,
    ]) {
      expect(cleanup.mock.calls).toEqual(
        expectedWorkspaceIds.map((workspaceId) => [workspaceId]),
      )
    }

    expect(mocks.broadcast.mock.calls).toEqual(
      expectedWorkspaceIds.map((workspaceId) => [
        workspaceId,
        'session-cleared',
      ]),
    )
  })

  it('continues all purges and reports failures without crossing account scope', async () => {
    const cleanupFailure = new Error('IndexedDB is blocked')
    mocks.clearPlanner.mockRejectedValueOnce(cleanupFailure)

    const result = await clearSessionOfflineWorkspaceData('user-1')

    expect(result.failures).toEqual([cleanupFailure])
    expect(mocks.clearShoppingList).toHaveBeenCalledTimes(3)
    expect(mocks.broadcast).toHaveBeenCalledTimes(3)
  })

  it('does not purge unscoped storage when the current actor is unknown', async () => {
    const result = await clearSessionOfflineWorkspaceData(null)

    expect(result).toEqual({ failures: [], workspaceIds: [] })
    expect(mocks.getCachedSession).not.toHaveBeenCalled()
    expect(mocks.clearPlanner).not.toHaveBeenCalled()
  })
})
