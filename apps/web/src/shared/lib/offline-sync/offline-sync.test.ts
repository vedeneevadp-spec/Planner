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
