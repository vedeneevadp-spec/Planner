import { createHash } from 'node:crypto'

import { Client } from 'pg'

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const localhostAuthBucketKeys = [
  'auth:password-reset-confirm:ip:127.0.0.1',
  'auth:password-reset-request:ip:127.0.0.1',
  'auth:sign-in:ip:127.0.0.1',
  'auth:sign-up:ip:127.0.0.1',
].map((key) => createHash('sha256').update(key).digest('hex'))

export default async function prepareE2eRateLimits(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl })

  await client.connect()

  try {
    await client.query(
      `
        delete from app.rate_limit_buckets
        where bucket_key = any($1::text[])
      `,
      [localhostAuthBucketKeys],
    )
  } finally {
    await client.end()
  }
}
