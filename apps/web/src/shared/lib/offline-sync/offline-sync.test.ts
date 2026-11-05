import { describe, expect, it, vi } from 'vitest'

import {
  createOfflineDrainCoordinator,
  createOfflineDrainErrorHandler,
  createOfflineDrainResult,
} from './offline-sync'

interface TestDrainResult {
  conflicted: number
  failed: number
  processed: number
  synced: number
}

describe('offline sync shared orchestration', () => {
  it('deduplicates concurrent drains for the same key', async () => {
    const coordinator = createOfflineDrainCoordinator<string, number>()
    const drainResolver: {
      current?: ((value: number) => void) | undefined
    } = {}
    const run = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          drainResolver.current = resolve
        }),
    )

    const firstDrain = coordinator.drain('workspace-1', run)
    const secondDrain = coordinator.drain('workspace-1', run)

    expect(run).toHaveBeenCalledTimes(1)

    if (!drainResolver.current) {
      throw new Error('Drain resolver was not captured.')
    }

    drainResolver.current(42)

    await expect(firstDrain).resolves.toBe(42)
    await expect(secondDrain).resolves.toBe(42)
  })

  it.each(['resolved', 'rejected'] as const)(
    'deduplicates waiting drains after the previous workspace %s',
    async (outcome) => {
      const coordinator = createOfflineDrainCoordinator<string, number>()
      const previous = deferred<number>()
      const next = deferred<number>()
      const started = deferred<void>()
      const firstDrain = coordinator.drain(
        'workspace-1',
        () => previous.promise,
      )
      const firstResult = firstDrain.catch(() => -1)
      const run = vi.fn(() => {
        started.resolve()
        return next.promise
      })
      const waitingDrains = [
        coordinator.drain('workspace-2', run),
        coordinator.drain('workspace-2', run),
      ]

      expect(run).not.toHaveBeenCalled()
      if (outcome === 'resolved') previous.resolve(1)
      else previous.reject(new Error('Previous workspace failed'))
      await started.promise

      expect(run).toHaveBeenCalledTimes(1)
      next.resolve(2)
      await expect(Promise.all(waitingDrains)).resolves.toEqual([2, 2])
      await firstResult
    },
  )

  it('serializes different workspaces waiting for the same drain', async () => {
    const coordinator = createOfflineDrainCoordinator<string, number>()
    const first = deferred<number>()
    const second = deferred<number>()
    const secondStarted = deferred<void>()
    const runThird = vi.fn(() => Promise.resolve(3))
    const firstDrain = coordinator.drain('workspace-1', () => first.promise)
    const secondDrain = coordinator.drain('workspace-2', () => {
      secondStarted.resolve()
      return second.promise
    })
    const thirdDrain = coordinator.drain('workspace-3', runThird)

    first.resolve(1)
    await secondStarted.promise
    expect(runThird).not.toHaveBeenCalled()
    second.resolve(2)

    await expect(
      Promise.all([firstDrain, secondDrain, thirdDrain]),
    ).resolves.toEqual([1, 2, 3])
    expect(runThird).toHaveBeenCalledTimes(1)
  })

  it('allows a retry after a drain throws synchronously', async () => {
    const coordinator = createOfflineDrainCoordinator<string, number>()
    await expect(
      coordinator.drain('workspace-1', () => {
        throw new Error('Queue unavailable')
      }),
    ).rejects.toThrow('Queue unavailable')
    await expect(
      coordinator.drain('workspace-1', () => Promise.resolve(1)),
    ).resolves.toBe(1)
  })

  it('maps terminal drain errors to conflicts and retryable errors to failed breaks', async () => {
    const markConflicted = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const markFailed = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const handler = createOfflineDrainErrorHandler<TestDrainResult>({
      getErrorMessage: (error) =>
        error instanceof Error ? error.message : 'Unknown error',
      isTerminalError: (error) =>
        error instanceof Error && error.message === 'terminal',
      markConflicted: async (mutationId, conflict) => {
        expect(mutationId).toBe('mutation-1')
        expect(conflict).toEqual({
          actualVersion: null,
          expectedVersion: null,
          message: 'terminal',
        })
        await markConflicted()
      },
      markFailed: async (mutationId, message) => {
        expect(mutationId).toBe('mutation-2')
        expect(message).toBe('retryable')
        await markFailed()
      },
    })
    const result = createOfflineDrainResult<TestDrainResult>({ conflicted: 0 })

    await expect(
      handler({
        error: new Error('terminal'),
        mutationId: 'mutation-1',
        result,
      }),
    ).resolves.toBe('continue')
    await expect(
      handler({
        error: new Error('retryable'),
        mutationId: 'mutation-2',
        result,
      }),
    ).resolves.toBe('break')

    expect(result.conflicted).toBe(1)
    expect(result.failed).toBe(1)
    expect(markConflicted).toHaveBeenCalledTimes(1)
    expect(markFailed).toHaveBeenCalledTimes(1)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
