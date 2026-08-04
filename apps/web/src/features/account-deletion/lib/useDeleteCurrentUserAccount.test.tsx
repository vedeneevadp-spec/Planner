import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearHabit: vi.fn(() => Promise.resolve()),
  clearPlanner: vi.fn(() => Promise.resolve()),
  clearShopping: vi.fn(() => Promise.resolve()),
  deleteAccount: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/features/habits', () => ({
  clearHabitOfflineWorkspaceData: mocks.clearHabit,
}))

vi.mock('@/features/planner', () => ({
  clearPlannerOfflineWorkspaceData: mocks.clearPlanner,
}))

vi.mock('@/features/shopping-list', () => ({
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

import { useDeleteCurrentUserAccount } from './useDeleteCurrentUserAccount'

describe('useDeleteCurrentUserAccount', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockClear()
    }
  })

  afterEach(cleanup)

  it('deletes server data before clearing every local workspace and signing out', async () => {
    const { result } = renderHook(() => useDeleteCurrentUserAccount(), {
      wrapper: createQueryWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mocks.deleteAccount).toHaveBeenCalledWith({
      accessToken: 'access-token',
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.clearPlanner).toHaveBeenCalledTimes(2)
    expect(mocks.clearHabit).toHaveBeenCalledTimes(2)
    expect(mocks.clearShopping).toHaveBeenCalledTimes(2)
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0]!,
    )
  })
})

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return function QueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}
