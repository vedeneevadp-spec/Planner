import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionReadiness } from '@/features/session'

import { TodaySourceStatus, type TodayStatusSource } from './TodaySourceStatus'

const mocks = vi.hoisted(() => ({ isBrowserOffline: false }))

vi.mock('@/shared/lib/offline-sync', () => ({
  useBrowserOffline: () => mocks.isBrowserOffline,
}))

function createReadiness(
  overrides: Partial<SessionReadiness> = {},
): SessionReadiness {
  return {
    canReadCachedData: true,
    canRenderAppContent: true,
    canUseProtectedApi: true,
    canWriteProtectedData: true,
    reason: 'ready',
    status: 'ready',
    ...overrides,
  }
}

function createSource(
  overrides: Partial<TodayStatusSource['query']> = {},
  label = 'Покупки',
): TodayStatusSource {
  return {
    label,
    query: {
      data: [],
      error: null,
      isFetching: false,
      isPending: false,
      refetch: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
  }
}

describe('TodaySourceStatus', () => {
  beforeEach(() => {
    mocks.isBrowserOffline = false
  })

  afterEach(() => {
    cleanup()
  })

  it.each(['error', 'readError'] as const)(
    'only reports a settled %s and disappears after recovery',
    (errorField) => {
      const failure = { [errorField]: new Error('HTTP 503') }
      const { rerender } = render(
        <TodaySourceStatus
          sources={[createSource({ ...failure, isFetching: true })]}
        />,
      )

      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      rerender(<TodaySourceStatus sources={[createSource(failure)]} />)

      expect(screen.getByRole('status')).toHaveTextContent(
        'Не обновились: Покупки.',
      )
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()

      rerender(<TodaySourceStatus sources={[createSource()]} />)

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    },
  )

  it.each([
    { phase: 'initial loading', state: { isPending: true } },
    { phase: 'cache hydration', state: { isCacheHydrating: true } },
    { phase: 'cache loading', state: { isCacheLoading: true } },
    {
      phase: 'auth restoration',
      state: { readiness: createReadiness({ reason: 'auth_restoring' }) },
    },
    {
      phase: 'planner restoration',
      state: { readiness: createReadiness({ reason: 'planner_pending' }) },
    },
  ])('stays silent during $phase despite an earlier failure', ({ state }) => {
    render(
      <TodaySourceStatus
        sources={[
          createSource({
            data: undefined,
            error: new Error('Earlier failure'),
            ...state,
          }),
        ]}
      />,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each([
    { condition: 'missing data', state: { data: undefined } },
    { condition: 'cached data', state: { isShowingCachedData: true } },
    {
      condition: 'restricted API readiness',
      state: { readiness: createReadiness({ canUseProtectedApi: false }) },
    },
    {
      condition: 'cached offline readiness while the browser is online',
      state: {
        isShowingCachedData: true,
        readiness: createReadiness({
          status: 'offlineWithCache',
          canUseProtectedApi: false,
        }),
      },
    },
  ])('does not treat $condition as a failed read', ({ state }) => {
    render(<TodaySourceStatus sources={[createSource(state)]} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports actual browser offline immediately even during loading', () => {
    mocks.isBrowserOffline = true
    const sources = [
      createSource({ data: undefined, isPending: true, isFetching: true }),
    ]
    const { rerender } = render(<TodaySourceStatus sources={sources} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Не обновились: Покупки.',
    )
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeDisabled()

    mocks.isBrowserOffline = false
    rerender(<TodaySourceStatus sources={sources} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('retries only affected sources and deduplicates shared session recovery', async () => {
    const refetchShopping = vi.fn().mockRejectedValue(new Error('HTTP 503'))
    const refetchCleaning = vi.fn().mockResolvedValue(undefined)
    const refetchCare = vi.fn().mockResolvedValue(undefined)
    const retrySession = vi.fn().mockResolvedValue(undefined)
    const careQuery = {
      error: new Error('Unauthorized'),
      readiness: createReadiness({
        reason: 'unauthorized',
        canUseProtectedApi: false,
      }),
      refetch: refetchCare,
      retrySession,
    }
    render(
      <TodaySourceStatus
        sources={[
          createSource({
            error: new Error('HTTP 503'),
            refetch: refetchShopping,
          }),
          createSource({ refetch: refetchCleaning }, 'Уборка'),
          createSource(careQuery, 'Забота'),
          createSource(careQuery, 'Забота'),
        ]}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Не обновились: Покупки, Забота.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(refetchShopping).toHaveBeenCalledOnce()
      expect(retrySession).toHaveBeenCalledOnce()
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
    })
    expect(refetchCleaning).not.toHaveBeenCalled()
    expect(refetchCare).not.toHaveBeenCalled()
  })

  it('stays silent throughout a manual retry and after successful recovery', async () => {
    let finishRetry!: () => void
    const retry = new Promise<void>((resolve) => {
      finishRetry = resolve
    })
    const refetch = vi.fn(() => retry)
    const { rerender } = render(
      <TodaySourceStatus
        sources={[createSource({ error: new Error('HTTP 503'), refetch })]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(refetch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(<TodaySourceStatus sources={[createSource({ refetch })]} />)
    await act(async () => {
      finishRetry()
      await retry
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
