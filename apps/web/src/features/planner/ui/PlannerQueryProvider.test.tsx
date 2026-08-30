import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useSessionAuth } from '@/features/session'

import { PlannerQueryProvider } from './PlannerProvider'

vi.mock('@/features/session', () => ({
  useSessionAuth: vi.fn(),
}))

const mockedUseSessionAuth = vi.mocked(useSessionAuth)
type SessionAuthState = ReturnType<typeof useSessionAuth>

describe('PlannerQueryProvider session boundary', () => {
  it('clears in-memory query data after sign-out', async () => {
    let queryClient: QueryClient | null = null
    const { rerender } = render(
      createTree(createAuthState('authenticated', 'user-1'), (client) => {
        queryClient = client
      }),
    )

    await waitFor(() => expect(queryClient).not.toBeNull())
    queryClient!.setQueryData(['private-data'], { title: 'private' })

    rerender(
      createTree(createAuthState('signed_out', null), (client) => {
        queryClient = client
      }),
    )

    await waitFor(() => {
      expect(queryClient!.getQueryData(['private-data'])).toBeUndefined()
    })
  })
})

function createTree(
  auth: SessionAuthState,
  onClient: (queryClient: QueryClient) => void,
): ReactNode {
  mockedUseSessionAuth.mockReturnValue(auth)

  return (
    <PlannerQueryProvider>
      <QueryClientProbe onClient={onClient} />
    </PlannerQueryProvider>
  )
}

function QueryClientProbe({
  onClient,
}: {
  onClient: (queryClient: QueryClient) => void
}) {
  const queryClient = useQueryClient()

  useEffect(() => {
    onClient(queryClient)
  }, [onClient, queryClient])

  return null
}

function createAuthState(
  lifecycleStatus: SessionAuthState['lifecycleStatus'],
  userId: string | null,
): SessionAuthState {
  return {
    accessToken: userId ? 'access-token' : null,
    authNotice: null,
    canUseProtectedApi: userId !== null,
    clearAuthNotice: vi.fn(),
    email: userId ? 'user@example.test' : null,
    expireSession: vi.fn(),
    isAuthEnabled: true,
    isLoading: false,
    isPasswordRecovery: false,
    isSignInRequired: false,
    lifecycleStatus,
    recoverSession: vi.fn(),
    requestPasswordReset: vi.fn(),
    sessionVersion: 1,
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUpWithPassword: vi.fn(),
    updatePassword: vi.fn(),
    userId,
  }
}
