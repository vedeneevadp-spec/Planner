import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HttpError } from './http-error.js'
import { assertInMemoryRateLimit } from './rate-limit.js'

void describe('assertInMemoryRateLimit', () => {
  void it('rejects requests after the configured bucket limit', () => {
    const key = `test:${Date.now()}:${Math.random()}`

    assert.doesNotThrow(() =>
      assertInMemoryRateLimit({
        key,
        limit: 2,
        windowMs: 60_000,
      }),
    )
    assert.doesNotThrow(() =>
      assertInMemoryRateLimit({
        key,
        limit: 2,
        windowMs: 60_000,
      }),
    )

    assert.throws(
      () =>
        assertInMemoryRateLimit({
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
