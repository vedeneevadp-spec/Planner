import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearCleaning: vi.fn<(workspaceId: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  clearHabit: vi.fn<(workspaceId: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  clearPlanner: vi.fn<(workspaceId: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  clearSelfCare: vi.fn<(workspaceId: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  clearShopping: vi.fn<(workspaceId: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  deleteAccount: vi.fn(() => Promise.resolve()),
  discoverWorkspaces: vi.fn<() => Promise<string[]>>(() => Promise.resolve([])),
  signOut: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/features/cleaning/offline-storage', () => ({
  clearCleaningOfflineWorkspaceData: mocks.clearCleaning,
}))

vi.mock('@/features/habits/offline-storage', () => ({
  clearHabitOfflineWorkspaceData: mocks.clearHabit,
}))

vi.mock('@/features/planner/offline-storage', () => ({
  clearPlannerOfflineWorkspaceData: mocks.clearPlanner,
}))

vi.mock('@/features/self-care/offline-storage', () => ({
  clearSelfCareOfflineWorkspaceData: mocks.clearSelfCare,
}))

vi.mock('@/features/shopping-list/offline-storage', () => ({
  clearShoppingListOfflineWorkspaceData: mocks.clearShopping,
}))

vi.mock('@/features/session', () => ({
  deleteCurrentUserAccount: mocks.deleteAccount,
  usePlannerSession: () => ({
    data: {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      workspaces: [{ id: 'workspace-1' }, { id: 'workspace-2' }],
    },
  }),
  useSessionAuth: () => ({
    accessToken: 'access-token',
    canUseProtectedApi: true,
    signOut: mocks.signOut,
  }),
}))

vi.mock('./account-deletion-local-workspaces', () => ({
  discoverAccountDeletionOfflineWorkspaceIds: mocks.discoverWorkspaces,
}))

import {
  getDeleteUserAccountErrorMessage,
  useDeleteCurrentUserAccount,
} from './useDeleteCurrentUserAccount'

describe('useDeleteCurrentUserAccount', () => {
  beforeEach(() => {
    mocks.clearCleaning.mockReset().mockResolvedValue(undefined)
    mocks.clearHabit.mockReset().mockResolvedValue(undefined)
    mocks.clearPlanner.mockReset().mockResolvedValue(undefined)
    mocks.clearSelfCare.mockReset().mockResolvedValue(undefined)
    mocks.clearShopping.mockReset().mockResolvedValue(undefined)
    mocks.deleteAccount.mockReset().mockResolvedValue(undefined)
    mocks.discoverWorkspaces.mockReset().mockResolvedValue([])
    mocks.signOut.mockReset().mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('clears every local workspace before deleting server data and signing out', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(['self-care', 'private-user-data'], {
      title: 'private',
    })
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mocks.deleteAccount).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.clearPlanner).toHaveBeenCalledTimes(4)
    expect(mocks.clearCleaning).toHaveBeenCalledTimes(4)
    expect(mocks.clearHabit).toHaveBeenCalledTimes(4)
    expect(mocks.clearSelfCare).toHaveBeenCalledTimes(4)
    expect(mocks.clearShopping).toHaveBeenCalledTimes(4)
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(cancelQueries).toHaveBeenCalledTimes(3)
    expect(removeQueries).toHaveBeenCalledTimes(1)
    expect(
      queryClient.getQueryData(['self-care', 'private-user-data']),
    ).toBeUndefined()
    expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearCleaning.mock.invocationCallOrder[0]!,
    )
    expect(mocks.clearShopping.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.deleteAccount.mock.invocationCallOrder[0]!,
    )
    expect(mocks.deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(
      cancelQueries.mock.invocationCallOrder[1]!,
    )
    expect(cancelQueries.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.clearCleaning.mock.invocationCallOrder[2]!,
    )
    expect(mocks.clearShopping.mock.invocationCallOrder[3]).toBeLessThan(
      cancelQueries.mock.invocationCallOrder[2]!,
    )
    expect(cancelQueries.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0]!,
    )
    expect(mocks.deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0]!,
    )
  })

  it('does not delete the account or sign out when local cleanup is incomplete', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(['self-care', 'private-user-data'], {
      title: 'private',
    })
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const storageError = new Error('IndexedDB blocked')
    mocks.clearCleaning.mockRejectedValueOnce(storageError)
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(queryClient),
    })
    let mutationError: unknown

    await act(async () => {
      try {
        await result.current.mutateAsync()
      } catch (error) {
        mutationError = error
      }
    })

    expect(getDeleteUserAccountErrorMessage(mutationError)).toBe(
      'Не удалось завершить безопасную очистку локальных данных. Удаление аккаунта не начато. Закройте другие вкладки приложения, проверьте доступ браузера к хранилищу и повторите.',
    )
    expect(cancelQueries).toHaveBeenCalledTimes(1)
    expect(mocks.clearPlanner).toHaveBeenCalledTimes(2)
    expect(mocks.clearSelfCare).toHaveBeenCalledTimes(2)
    expect(mocks.clearShopping).toHaveBeenCalledTimes(2)
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(removeQueries).not.toHaveBeenCalled()
    expect(
      queryClient.getQueryData(['self-care', 'private-user-data']),
    ).toEqual({ title: 'private' })
  })

  it('also clears a locally cached workspace that is no longer in the session', async () => {
    mocks.discoverWorkspaces.mockResolvedValueOnce([
      'workspace-2',
      'workspace-stale',
    ])
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(
      mocks.clearCleaning.mock.calls.filter(
        ([workspaceId]) => workspaceId === 'workspace-stale',
      ),
    ).toHaveLength(2)
    expect(
      mocks.clearPlanner.mock.calls.filter(
        ([workspaceId]) => workspaceId === 'workspace-stale',
      ),
    ).toHaveLength(2)
    expect(mocks.clearCleaning.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.deleteAccount.mock.invocationCallOrder[0]!,
    )
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
  })

  it('does not delete the account when local workspace discovery is untrusted', async () => {
    const discoveryError = new Error('IndexedDB enumeration failed')
    mocks.discoverWorkspaces.mockRejectedValueOnce(discoveryError)
    const queryClient = createQueryClient()
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(queryClient),
    })
    let mutationError: unknown

    await act(async () => {
      try {
        await result.current.mutateAsync()
      } catch (error) {
        mutationError = error
      }
    })

    expect(getDeleteUserAccountErrorMessage(mutationError)).toContain(
      'Удаление аккаунта не начато.',
    )
    expect(cancelQueries).toHaveBeenCalledTimes(1)
    expect(mocks.clearCleaning).not.toHaveBeenCalled()
    expect(mocks.clearPlanner).not.toHaveBeenCalled()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('does not start cleanup or deletion when active queries cannot be stopped', async () => {
    const queryClient = createQueryClient()
    vi.spyOn(queryClient, 'cancelQueries').mockRejectedValueOnce(
      new Error('Query cancellation failed'),
    )
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(queryClient),
    })
    let mutationError: unknown

    await act(async () => {
      try {
        await result.current.mutateAsync()
      } catch (error) {
        mutationError = error
      }
    })

    expect(getDeleteUserAccountErrorMessage(mutationError)).toContain(
      'Удаление аккаунта не начато.',
    )
    expect(mocks.clearCleaning).not.toHaveBeenCalled()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('does not sign out or discard query state when server deletion fails', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(['self-care', 'private-user-data'], {
      title: 'private',
    })
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const serverError = new Error('Не удалось удалить аккаунт.')
    mocks.deleteAccount.mockRejectedValueOnce(serverError)
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(queryClient),
    })

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBe(serverError)
    })

    expect(mocks.clearCleaning).toHaveBeenCalledTimes(2)
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(removeQueries).not.toHaveBeenCalled()
    expect(
      queryClient.getQueryData(['self-care', 'private-user-data']),
    ).toEqual({ title: 'private' })
  })

  it('reports that deletion succeeded when only the final sign-out fails', async () => {
    const queryClient = createQueryClient()
    const signOutError = new Error('Auth storage unavailable')
    mocks.signOut.mockRejectedValueOnce(signOutError)
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(queryClient),
    })
    let mutationError: unknown

    await act(async () => {
      try {
        await result.current.mutateAsync()
      } catch (error) {
        mutationError = error
      }
    })

    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(getDeleteUserAccountErrorMessage(mutationError)).toBe(
      'Аккаунт удалён, но не удалось завершить выход на этом устройстве. Обновите страницу и выполните выход ещё раз.',
    )
  })

  it('still signs out and reports truthful status when post-delete cleanup fails', async () => {
    const queryClient = createQueryClient()
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const storageError = new Error('IndexedDB became unavailable')
    mocks.clearCleaning
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(storageError)
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(queryClient),
    })
    let mutationError: unknown

    await act(async () => {
      try {
        await result.current.mutateAsync()
      } catch (error) {
        mutationError = error
      }
    })

    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
    expect(mocks.clearCleaning).toHaveBeenCalledTimes(4)
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(removeQueries).toHaveBeenCalledTimes(1)
    expect(getDeleteUserAccountErrorMessage(mutationError)).toBe(
      'Аккаунт удалён, но безопасная локальная очистка не завершена. Закройте другие вкладки приложения и обновите страницу, чтобы повторить очистку.',
    )
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

function createQueryWrapper(queryClient = createQueryClient()) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}
