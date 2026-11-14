import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  withRequestTimeout,
} from './request-timeout'

describe('withRequestTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects and aborts even when the transport never settles', async () => {
    vi.useFakeTimers()
    const operation = vi.fn(
      (_signal: AbortSignal) => new Promise<string>(() => undefined),
    )
    const result = withRequestTimeout(operation)
    const rejection = expect(result).rejects.toBeInstanceOf(RequestTimeoutError)

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

    await rejection
    const signal = operation.mock.calls[0]?.[0]
    expect(signal?.aborted).toBe(true)
    expect(signal?.reason).toBeInstanceOf(RequestTimeoutError)
    expect(signal?.reason).toBeInstanceOf(TypeError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves caller cancellation and cancels a stalled operation', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const operation = vi.fn(
      (_signal: AbortSignal) => new Promise<string>(() => undefined),
    )
    const reason = new DOMException('Request superseded', 'AbortError')
    const result = withRequestTimeout(operation, { signal: caller.signal })
    const rejection = expect(result).rejects.toBe(reason)
    await Promise.resolve()

    caller.abort(reason)

    await rejection
    expect(operation.mock.calls[0]?.[0].aborted).toBe(true)
    expect(operation.mock.calls[0]?.[0].reason).toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a request whose caller already cancelled it', async () => {
    const caller = new AbortController()
    caller.abort()
    const operation = vi.fn().mockResolvedValue('unused')

    await expect(
      withRequestTimeout(operation, { signal: caller.signal }),
    ).rejects.toBe(caller.signal.reason)
    expect(operation).not.toHaveBeenCalled()
  })

  it('removes the deadline and caller listener when the operation succeeds', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const operation = vi.fn((_signal: AbortSignal) => Promise.resolve('ready'))

    await expect(
      withRequestTimeout(operation, { signal: caller.signal }),
    ).resolves.toBe('ready')
    expect(vi.getTimerCount()).toBe(0)

    caller.abort()
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

    expect(operation.mock.calls[0]?.[0].aborted).toBe(false)
  })

  it('keeps the original operation error and clears its deadline', async () => {
    vi.useFakeTimers()
    const error = new Error('Rejected by server')

    await expect(withRequestTimeout(() => Promise.reject(error))).rejects.toBe(
      error,
    )
    expect(vi.getTimerCount()).toBe(0)
  })
})
