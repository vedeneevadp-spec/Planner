import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearCleaning: vi.fn(() => Promise.resolve()),
  clearHabit: vi.fn(() => Promise.resolve()),
  clearPlanner: vi.fn(() => Promise.resolve()),
  clearSelfCare: vi.fn(() => Promise.resolve()),
  clearShopping: vi.fn(() => Promise.resolve()),
  featureModuleLoads: {
    cleaning: 0,
    habits: 0,
    planner: 0,
    selfCare: 0,
    shopping: 0,
  },
}))

vi.mock('@/features/cleaning/offline-storage', () => {
  mocks.featureModuleLoads.cleaning += 1
  return { clearCleaningOfflineWorkspaceData: mocks.clearCleaning }
})

vi.mock('@/features/habits/offline-storage', () => {
  mocks.featureModuleLoads.habits += 1
  return { clearHabitOfflineWorkspaceData: mocks.clearHabit }
})

vi.mock('@/features/planner/offline-storage', () => {
  mocks.featureModuleLoads.planner += 1
  return { clearPlannerOfflineWorkspaceData: mocks.clearPlanner }
})

vi.mock('@/features/self-care/offline-storage', () => {
  mocks.featureModuleLoads.selfCare += 1
  return { clearSelfCareOfflineWorkspaceData: mocks.clearSelfCare }
})

vi.mock('@/features/shopping-list/offline-storage', () => {
  mocks.featureModuleLoads.shopping += 1
  return { clearShoppingListOfflineWorkspaceData: mocks.clearShopping }
})

import { getUserBackupErrorMessage } from './user-backup-api'
import {
  prepareWorkspaceForUserBackupRestore,
  UserBackupLocalCleanupError,
} from './user-backup-local-state'

describe('user backup local state', () => {
  beforeEach(() => {
    mocks.clearCleaning.mockReset().mockResolvedValue(undefined)
    mocks.clearHabit.mockReset().mockResolvedValue(undefined)
    mocks.clearPlanner.mockReset().mockResolvedValue(undefined)
    mocks.clearSelfCare.mockReset().mockResolvedValue(undefined)
    mocks.clearShopping.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads offline feature APIs only when local cleanup starts', async () => {
    expect(mocks.featureModuleLoads).toEqual({
      cleaning: 0,
      habits: 0,
      planner: 0,
      selfCare: 0,
      shopping: 0,
    })

    await prepareWorkspaceForUserBackupRestore(
      'workspace-1',
      createQueryClient(),
    )

    expect(mocks.featureModuleLoads).toEqual({
      cleaning: 1,
      habits: 1,
      planner: 1,
      selfCare: 1,
      shopping: 1,
    })
  })

  it('stops workspace queries and clears every offline cache before restore', async () => {
    const queryClient = createQueryClient()
    const selfCareOwnerId = JSON.stringify(['workspace-1', 'user-1'])
    const otherSelfCareOwnerId = JSON.stringify(['workspace-2', 'user-2'])
    queryClient.setQueryData(['planner', 'tasks', 'workspace-1', 1], [])
    queryClient.setQueryData(['planner', 'session'], { actorUserId: 'user-1' })
    queryClient.setQueryData(
      ['self-care', selfCareOwnerId, 'items'],
      ['stale-self-care-data'],
    )
    queryClient.setQueryData(['self-care', otherSelfCareOwnerId, 'items'], [])
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')

    await prepareWorkspaceForUserBackupRestore('workspace-1', queryClient)

    expect(cancelQueries).toHaveBeenCalledTimes(2)
    expect(mocks.clearCleaning).toHaveBeenCalledWith('workspace-1')
    expect(mocks.clearHabit).toHaveBeenCalledWith('workspace-1')
    expect(mocks.clearPlanner).toHaveBeenCalledWith('workspace-1')
    expect(mocks.clearSelfCare).toHaveBeenCalledWith('workspace-1')
    expect(mocks.clearShopping).toHaveBeenCalledWith('workspace-1')
    expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearCleaning.mock.invocationCallOrder[0]!,
    )
    expect(mocks.clearShopping.mock.invocationCallOrder[0]).toBeLessThan(
      cancelQueries.mock.invocationCallOrder[1]!,
    )
    expect(
      queryClient.getQueryData(['planner', 'tasks', 'workspace-1', 1]),
    ).toBeUndefined()
    expect(queryClient.getQueryData(['planner', 'session'])).toEqual({
      actorUserId: 'user-1',
    })
    expect(
      queryClient.getQueryData(['self-care', selfCareOwnerId, 'items']),
    ).toBeUndefined()
    expect(
      queryClient.getQueryData(['self-care', otherSelfCareOwnerId, 'items']),
    ).toEqual([])
  })

  it('rejects with a retryable user-facing error after finishing the cleanup pass', async () => {
    const queryClient = createQueryClient()
    mocks.clearCleaning.mockRejectedValueOnce(new Error('IndexedDB blocked'))

    const cleanup = prepareWorkspaceForUserBackupRestore(
      'workspace-1',
      queryClient,
    )

    await expect(cleanup).rejects.toBeInstanceOf(UserBackupLocalCleanupError)

    expect(mocks.clearPlanner).toHaveBeenCalledWith('workspace-1')
    expect(mocks.clearSelfCare).toHaveBeenCalledWith('workspace-1')
    expect(mocks.clearShopping).toHaveBeenCalledWith('workspace-1')
    await expect(cleanup).rejects.toSatisfy(
      (error: unknown) =>
        getUserBackupErrorMessage(error) ===
        'Не удалось завершить безопасную очистку локальных данных. Восстановление не начато. Закройте другие вкладки приложения, проверьте доступ браузера к хранилищу и повторите.',
    )
  })

  it('does not start local purges when workspace queries cannot be stopped', async () => {
    const queryClient = createQueryClient()
    vi.spyOn(queryClient, 'cancelQueries').mockRejectedValueOnce(
      new Error('Query cancellation failed'),
    )

    const preparation = prepareWorkspaceForUserBackupRestore(
      'workspace-1',
      queryClient,
    )

    await expect(preparation).rejects.toMatchObject({
      code: 'backup_local_cleanup_failed',
    })
    await expect(preparation).rejects.toThrow('Восстановление не начато.')
    expect(mocks.clearCleaning).not.toHaveBeenCalled()
    expect(mocks.clearPlanner).not.toHaveBeenCalled()
  })
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
}
