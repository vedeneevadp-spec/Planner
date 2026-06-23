import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SessionFeatureReadinessStub {
  apiConfig: null
  isApiEnabled: boolean
  session:
    | {
        actorUserId: string
        workspaceId: string
      }
    | undefined
  workspaceId: string
}

const mocks = vi.hoisted(() => ({
  useSessionFeatureReadiness: vi.fn<() => SessionFeatureReadinessStub>(),
}))

vi.mock('@/features/session', () => ({
  usePlannerTimeZone: () => 'Europe/Astrakhan',
  useSessionFeatureReadiness: () => mocks.useSessionFeatureReadiness(),
}))

import { useSelfCareDashboard } from './useSelfCare'

describe('useSelfCareDashboard', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
  })

  afterEach(() => {
    queryClient.clear()
    mocks.useSessionFeatureReadiness.mockReset()
  })

  it('waits for the API client before enabling the query', async () => {
    mocks.useSessionFeatureReadiness.mockReturnValue({
      apiConfig: null,
      isApiEnabled: true,
      session: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
      workspaceId: 'workspace-1',
    })

    const { result } = renderHook(() => useSelfCareDashboard('2026-06-18'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    await Promise.resolve()

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.error).toBeNull()
  })
})
