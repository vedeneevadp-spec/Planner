import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useBrowserOffline } from './useBrowserOffline'

describe('useBrowserOffline', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('reads the initial browser state and reacts to connection events', () => {
    let isOnline = false
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(
      () => isOnline,
    )

    const { result } = renderHook(() => useBrowserOffline())

    expect(result.current).toBe(true)

    act(() => {
      isOnline = true
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(false)

    act(() => {
      isOnline = false
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(true)
  })
})
