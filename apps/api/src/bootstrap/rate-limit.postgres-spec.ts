import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../infrastructure/db/client.js'
import { createDatabaseConfig } from '../infrastructure/db/config.js'
import { HttpError } from './http-error.js'
import { PostgresRateLimiter } from './rate-limit.js'

let connection: DatabaseConnection

void before(() => {
  connection = createDatabaseConnection(createDatabaseConfig())
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }
})

void test('PostgresRateLimiter shares a bucket across API instances', async () => {
  const key = `postgres-rate-limit:${randomUUID()}`
  const options = { key, limit: 2, windowMs: 60_000 }
  const firstInstance = new PostgresRateLimiter(connection.db)
  const secondInstance = new PostgresRateLimiter(connection.db)

  try {
    await firstInstance.consume(options)
    await secondInstance.consume(options)
    await assert.rejects(
      firstInstance.consume(options),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === 'rate_limit_exceeded' &&
        error.statusCode === 429,
    )
    const persistedBucket = await connection.db
      .selectFrom('app.rate_limit_buckets')
      .select(['bucket_key', 'request_count'])
      .where('bucket_key', '=', createHash('sha256').update(key).digest('hex'))
      .executeTakeFirstOrThrow()

    assert.equal(persistedBucket.bucket_key.length, 64)
    assert.equal(persistedBucket.request_count, options.limit + 1)
  } finally {
    await connection.db
      .deleteFrom('app.rate_limit_buckets')
      .where('bucket_key', '=', createHash('sha256').update(key).digest('hex'))
      .execute()
  }
})
