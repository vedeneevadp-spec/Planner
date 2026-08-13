import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HttpError } from './http-error.js'
import { MemoryRateLimiter } from './rate-limit.js'

void describe('MemoryRateLimiter', () => {
  void it('rejects requests after the configured bucket limit', async () => {
    const key = `test:${Date.now()}:${Math.random()}`
    const rateLimiter = new MemoryRateLimiter()

    await assert.doesNotReject(() =>
      rateLimiter.consume({
        key,
        limit: 2,
        windowMs: 60_000,
      }),
    )
    await assert.doesNotReject(() =>
      rateLimiter.consume({
        key,
        limit: 2,
        windowMs: 60_000,
      }),
    )

    await assert.rejects(
      () =>
        rateLimiter.consume({
          key,
          limit: 2,
          windowMs: 60_000,
        }),
      (error) =>
        error instanceof HttpError &&
        error.statusCode === 429 &&
        error.code === 'rate_limit_exceeded',
    )
  })
})
