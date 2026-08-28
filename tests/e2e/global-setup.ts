import { createHash } from 'node:crypto'

import { Client } from 'pg'

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const e2eClientAddresses = [
  '127.0.0.1',
  '192.0.2.11',
  '192.0.2.12',
  '192.0.2.13',
  '192.0.2.14',
]
const authRateLimitedActions = [
  'password-reset-confirm',
  'password-reset-request',
  'sign-in',
  'sign-up',
]
const e2eAuthBucketKeys = e2eClientAddresses.flatMap((clientAddress) =>
  authRateLimitedActions.map((action) =>
    createHash('sha256')
      .update(`auth:${action}:ip:${clientAddress}`)
      .digest('hex'),
  ),
)

export default async function prepareE2eRateLimits(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl })

  await client.connect()

  try {
    await client.query(
      `
        delete from app.rate_limit_buckets
        where bucket_key = any($1::text[])
      `,
      [e2eAuthBucketKeys],
    )
  } finally {
    await client.end()
  }
}
