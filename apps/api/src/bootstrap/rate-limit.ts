import type { FastifyRequest } from 'fastify'

import { HttpError } from './http-error.js'

interface RateLimitBucket {
  count: number
  resetAt: number
}

export interface InMemoryRateLimitOptions {
  key: string
  limit: number
  windowMs: number
}

const buckets = new Map<string, RateLimitBucket>()

export function assertInMemoryRateLimit({
  key,
  limit,
  windowMs,
}: InMemoryRateLimitOptions): void {
  const now = Date.now()
  const currentBucket = buckets.get(key)

  if (!currentBucket || currentBucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    })
    cleanupExpiredBuckets(now)
    return
  }

  if (currentBucket.count >= limit) {
    throw new HttpError(
      429,
      'rate_limit_exceeded',
      'Too many requests. Please try again later.',
      {
        retryAfterSeconds: Math.ceil((currentBucket.resetAt - now) / 1000),
      },
    )
  }

  currentBucket.count += 1
}

export function getClientAddress(request: FastifyRequest): string {
  const forwardedFor = request.headers['x-forwarded-for']

  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0]?.trim() || request.ip
  }

  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(',')[0]?.trim() || request.ip
  }

  return request.ip
}

function cleanupExpiredBuckets(now: number): void {
  if (buckets.size < 10_000) {
    return
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key)
    }
  }
}
