import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDialogModuleWarmup,
  createRetryableModuleLoader,
  SELF_CARE_DIALOG_WARMUP_DELAY_MS,
  startSelfCareDialogWarmup,
} from './SelfCarePage.dialog-loader'

describe('self-care dialog module loading', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shares a successful load and resets the cache after a rejected attempt', async () => {
    const loadModule = vi
      .fn<() => Promise<{ value: string }>>()
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ value: 'loaded' })
    const loadRetryably = createRetryableModuleLoader(loadModule)

    const failedAttempt = loadRetryably()
    expect(loadRetryably()).toBe(failedAttempt)
    await expect(failedAttempt).rejects.toThrow('Network unavailable')

    const successfulAttempt = loadRetryably()
    await expect(successfulAttempt).resolves.toEqual({ value: 'loaded' })
    expect(loadRetryably()).toBe(successfulAttempt)
    expect(loadModule).toHaveBeenCalledTimes(2)
  })

  it('warms every dialog group without letting one failed group block the other', async () => {
    const loadForms = vi.fn().mockRejectedValue(new Error('Forms unavailable'))
    const loadActions = vi.fn().mockResolvedValue({ actions: true })
    const warmup = createDialogModuleWarmup([loadForms, loadActions])

    const results = await warmup()

    expect(loadForms).toHaveBeenCalledTimes(1)
    expect(loadActions).toHaveBeenCalledTimes(1)
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'fulfilled',
    ])
  })

  it('waits for connectivity, deduplicates pending warmups, and cleans up', () => {
    vi.useFakeTimers()
    let isOnline = false
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(
      () => isOnline,
    )
    const warmup = vi.fn().mockResolvedValue(undefined)

    const stopWarmup = startSelfCareDialogWarmup(warmup)

    vi.advanceTimersByTime(SELF_CARE_DIALOG_WARMUP_DELAY_MS)
    expect(warmup).not.toHaveBeenCalled()

    isOnline = true
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(SELF_CARE_DIALOG_WARMUP_DELAY_MS - 1)
    expect(warmup).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(warmup).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('online'))
    stopWarmup()
    vi.advanceTimersByTime(SELF_CARE_DIALOG_WARMUP_DELAY_MS)
    expect(warmup).toHaveBeenCalledTimes(1)
  })
})
