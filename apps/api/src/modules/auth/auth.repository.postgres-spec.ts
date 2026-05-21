import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { Client } from 'pg'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'

interface AuthRefreshFixture {
  activeTokenId: string
  nextTokenId: string
  prefix: string
  sessionId: string
  staleTokenId: string
  userAgent: string
  userId: string
}

const client = new Client({
  connectionString,
  connectionTimeoutMillis: 10_000,
  query_timeout: 30_000,
})

void describe('Postgres auth runtime functions', () => {
  void before(async () => {
    await client.connect()
  })

  void after(async () => {
    await client.end()
  })

  void test('rotates an active refresh token without revoking the device session', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)

      const result = await client.query<{
        id: string
        session_id: string
      }>(
        `
          select id, session_id
          from app.auth_rotate_refresh_token(
            $1,
            $2::uuid,
            $3,
            now() + interval '30 days',
            $4,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-active-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.userAgent,
        ],
      )

      assert.equal(result.rows[0]?.id, fixture.userId)
      assert.equal(result.rows[0]?.session_id, fixture.sessionId)

      const tokenState = await client.query<{
        next_token_count: string
        revoked_count: string
        rotated_active_count: string
      }>(
        `
          select
            count(*) filter (where token_hash = $2) as next_token_count,
            count(*) filter (
              where id = $3
                and rotated_at is not null
                and replaced_by_token_id = $4::uuid
            ) as rotated_active_count,
            count(*) filter (where revoked_at is not null) as revoked_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [
          fixture.sessionId,
          `${fixture.prefix}-next-hash`,
          fixture.activeTokenId,
          fixture.nextTokenId,
        ],
      )

      assert.equal(Number(tokenState.rows[0]?.next_token_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.rotated_active_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 0)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('recovers a stale rotated refresh token for the same mobile client', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)

      const result = await client.query<{
        id: string
        session_id: string
      }>(
        `
          select id, session_id
          from app.auth_rotate_refresh_token(
            $1,
            $2::uuid,
            $3,
            now() + interval '30 days',
            $4,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-stale-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.userAgent,
        ],
      )

      assert.equal(result.rows[0]?.id, fixture.userId)
      assert.equal(result.rows[0]?.session_id, fixture.sessionId)

      const tokenState = await client.query<{
        next_token_count: string
        revoked_count: string
        rotated_active_count: string
      }>(
        `
          select
            count(*) filter (where token_hash = $2) as next_token_count,
            count(*) filter (where id = $3 and rotated_at is not null) as rotated_active_count,
            count(*) filter (where revoked_at is not null) as revoked_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [
          fixture.sessionId,
          `${fixture.prefix}-next-hash`,
          fixture.activeTokenId,
        ],
      )

      assert.equal(Number(tokenState.rows[0]?.next_token_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.rotated_active_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 0)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('revokes a stale rotated refresh token from a different client', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)

      const result = await client.query(
        `
          select *
          from app.auth_rotate_refresh_token(
            $1,
            $2::uuid,
            $3,
            now() + interval '30 days',
            'OtherClient/1.0',
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-stale-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
        ],
      )

      assert.equal(result.rows.length, 0)

      const tokenState = await client.query<{
        revoked_count: string
      }>(
        `
          select count(*) filter (where revoked_at is not null) as revoked_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [fixture.sessionId],
      )

      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 2)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('rejects an expired refresh token without creating the next token', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)
      await client.query(
        `
          update app.auth_refresh_tokens
          set expires_at = now() - interval '1 minute'
          where id = $1::uuid
        `,
        [fixture.activeTokenId],
      )

      const result = await client.query(
        `
          select *
          from app.auth_rotate_refresh_token(
            $1,
            $2::uuid,
            $3,
            now() + interval '30 days',
            $4,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-active-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.userAgent,
        ],
      )

      assert.equal(result.rows.length, 0)

      const tokenState = await client.query<{
        next_token_count: string
        revoked_count: string
      }>(
        `
          select
            count(*) filter (where token_hash = $2) as next_token_count,
            count(*) filter (where revoked_at is not null) as revoked_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [fixture.sessionId, `${fixture.prefix}-next-hash`],
      )

      assert.equal(Number(tokenState.rows[0]?.next_token_count ?? 0), 0)
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 0)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('rejects a revoked refresh token without creating the next token', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)
      await client.query(
        `
          update app.auth_refresh_tokens
          set revoked_at = now()
          where id = $1::uuid
        `,
        [fixture.activeTokenId],
      )

      const result = await client.query(
        `
          select *
          from app.auth_rotate_refresh_token(
            $1,
            $2::uuid,
            $3,
            now() + interval '30 days',
            $4,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-active-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.userAgent,
        ],
      )

      assert.equal(result.rows.length, 0)

      const tokenState = await client.query<{
        next_token_count: string
        revoked_count: string
      }>(
        `
          select
            count(*) filter (where token_hash = $2) as next_token_count,
            count(*) filter (where revoked_at is not null) as revoked_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [fixture.sessionId, `${fixture.prefix}-next-hash`],
      )

      assert.equal(Number(tokenState.rows[0]?.next_token_count ?? 0), 0)
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 1)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })
})

function createFixture(): AuthRefreshFixture {
  const suffix = randomUUID()

  return {
    activeTokenId: randomUUID(),
    nextTokenId: randomUUID(),
    prefix: `auth-refresh-${suffix}`,
    sessionId: randomUUID(),
    staleTokenId: randomUUID(),
    userAgent: `ChaotikaMobile/${suffix}`,
    userId: randomUUID(),
  }
}

async function seedRefreshFixture(fixture: AuthRefreshFixture): Promise<void> {
  await cleanupRefreshFixture(fixture)

  await client.query(
    `
      insert into app.users (
        id,
        email,
        display_name,
        app_role,
        locale,
        timezone
      )
      values ($1, $2, 'Mobile Auth User', 'user', 'ru', 'UTC')
    `,
    [fixture.userId, `${fixture.prefix}@example.test`],
  )

  await client.query(
    `
      insert into app.auth_refresh_tokens (
        id,
        user_id,
        token_hash,
        session_id,
        expires_at,
        rotated_at,
        user_agent,
        ip_address
      )
      values
        (
          $1::uuid,
          $2::uuid,
          $3,
          $4::uuid,
          now() + interval '30 days',
          now() - interval '2 days',
          $5,
          '127.0.0.1'
        ),
        (
          $6::uuid,
          $2::uuid,
          $7,
          $4::uuid,
          now() + interval '30 days',
          null,
          $5,
          '127.0.0.1'
        )
    `,
    [
      fixture.staleTokenId,
      fixture.userId,
      `${fixture.prefix}-stale-hash`,
      fixture.sessionId,
      fixture.userAgent,
      fixture.activeTokenId,
      `${fixture.prefix}-active-hash`,
    ],
  )
}

async function cleanupRefreshFixture(
  fixture: AuthRefreshFixture,
): Promise<void> {
  await client.query('delete from app.users where id = $1', [fixture.userId])
}
