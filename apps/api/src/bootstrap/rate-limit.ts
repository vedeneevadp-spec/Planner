import { createHash } from 'node:crypto'

import type { FastifyRequest } from 'fastify'
import { type Kysely, sql } from 'kysely'

import type { DatabaseSchema } from '../infrastructure/db/schema.js'
import { HttpError } from './http-error.js'

interface RateLimitBucket {
  count: number
  resetAt: number
}

export interface RateLimitOptions {
  key: string
  limit: number
  windowMs: number
}

export interface RateLimiter {
  consume(options: RateLimitOptions): Promise<void>
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>()

  consume({ key, limit, windowMs }: RateLimitOptions): Promise<void> {
    return Promise.resolve().then(() => {
      assertValidOptions(key, limit, windowMs)
      const now = Date.now()
      const bucketKey = hashBucketKey(key)
      const currentBucket = this.buckets.get(bucketKey)

      if (!currentBucket || currentBucket.resetAt <= now) {
        this.buckets.set(bucketKey, {
          count: 1,
          resetAt: now + windowMs,
        })
        this.cleanupExpiredBuckets(now)
        return
      }

      currentBucket.count += 1

      if (currentBucket.count > limit) {
        throwRateLimitExceeded(Math.ceil((currentBucket.resetAt - now) / 1000))
      }
    })
  }

  private cleanupExpiredBuckets(now: number): void {
    if (this.buckets.size < 10_000) {
      return
    }

    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key)
      }
    }
  }
}

export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async consume({ key, limit, windowMs }: RateLimitOptions): Promise<void> {
    assertValidOptions(key, limit, windowMs)
    const result = await sql<{
      allowed: boolean
      retry_after_seconds: number
    }>`
      select allowed, retry_after_seconds
      from app.consume_rate_limit_bucket(
        ${hashBucketKey(key)},
        ${limit},
        ${Math.ceil(windowMs / 1000)}
      )
    `.execute(this.db)
    const decision = result.rows[0]

    if (!decision) {
      throw new Error('Rate limit decision was not returned.')
    }

    if (!decision.allowed) {
      throwRateLimitExceeded(Number(decision.retry_after_seconds))
    }
  }
}

export function getClientAddress(request: FastifyRequest): string {
  // Fastify applies the explicit trustProxy policy before exposing request.ip.
  // Do not read x-forwarded-for directly here: unauthenticated clients can spoof it.
  return request.ip
}

export function readRateLimitRetryAfterSeconds(
  error: unknown,
  fallbackWindowMs = 60_000,
): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'msBeforeNext' in error &&
    typeof error.msBeforeNext === 'number' &&
    Number.isFinite(error.msBeforeNext)
  ) {
    return Math.max(1, Math.ceil(error.msBeforeNext / 1000))
  }

  return Math.max(1, Math.ceil(fallbackWindowMs / 1000))
}

function assertValidOptions(
  key: string,
  limit: number,
  windowMs: number,
): void {
  if (
    key.length === 0 ||
    !Number.isInteger(limit) ||
    limit <= 0 ||
    !Number.isFinite(windowMs) ||
    windowMs < 1000
  ) {
    throw new Error('Invalid rate limit options.')
  }
}

function hashBucketKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function throwRateLimitExceeded(retryAfterSeconds: number): never {
  throw new HttpError(
    429,
    'rate_limit_exceeded',
    'Too many requests. Please try again later.',
    {
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    },
  )
}
