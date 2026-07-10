import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { Client } from 'pg'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'

interface AuthRefreshFixture {
  activeTokenId: string
  deviceId: string
  nextTokenId: string
  otherDeviceId: string
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
            $5,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-active-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.deviceId,
          fixture.userAgent,
        ],
      )

      assert.equal(result.rows[0]?.id, fixture.userId)
      assert.equal(result.rows[0]?.session_id, fixture.sessionId)

      const tokenState = await client.query<{
        next_token_count: string
        next_token_device_count: string
        revoked_count: string
        rotated_active_count: string
      }>(
        `
          select
            count(*) filter (where token_hash = $2) as next_token_count,
            count(*) filter (
              where token_hash = $2
                and device_id = $5
            ) as next_token_device_count,
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
          fixture.deviceId,
        ],
      )

      assert.equal(Number(tokenState.rows[0]?.next_token_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.next_token_device_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.rotated_active_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 0)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('returns the same successful rotation for an exact same-device retry', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)

      const input = {
        currentTokenHash: `${fixture.prefix}-active-hash`,
        deviceId: fixture.deviceId,
        nextTokenHash: `${fixture.prefix}-next-hash`,
        nextTokenId: fixture.nextTokenId,
        userAgent: fixture.userAgent,
      }
      const firstResult = await rotateRefreshToken(client, input)
      const retriedResult = await rotateRefreshToken(client, input)

      assert.equal(firstResult.rows[0]?.id, fixture.userId)
      assert.equal(retriedResult.rows[0]?.id, fixture.userId)
      assert.equal(retriedResult.rows[0]?.session_id, fixture.sessionId)

      const tokenState = await client.query<{
        active_unrotated_count: string
        next_token_count: string
        revoked_count: string
        token_count: string
      }>(
        `
          select
            count(*) filter (
              where revoked_at is null
                and rotated_at is null
            ) as active_unrotated_count,
            count(*) filter (where token_hash = $2) as next_token_count,
            count(*) filter (where revoked_at is not null) as revoked_count,
            count(*) as token_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [fixture.sessionId, `${fixture.prefix}-next-hash`],
      )

      assert.equal(Number(tokenState.rows[0]?.active_unrotated_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.next_token_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 0)
      assert.equal(Number(tokenState.rows[0]?.token_count ?? 0), 3)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('recovers a rotated refresh token for the same device within five minutes', async () => {
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
            $5,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-stale-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.deviceId,
          `${fixture.userAgent} Updated`,
        ],
      )

      assert.equal(result.rows[0]?.id, fixture.userId)
      assert.equal(result.rows[0]?.session_id, fixture.sessionId)

      const tokenState = await client.query<{
        next_token_count: string
        next_token_device_count: string
        revoked_count: string
        rotated_active_count: string
      }>(
        `
          select
            count(*) filter (where token_hash = $2) as next_token_count,
            count(*) filter (
              where token_hash = $2
                and device_id = $4
            ) as next_token_device_count,
            count(*) filter (where id = $3 and rotated_at is not null) as rotated_active_count,
            count(*) filter (where revoked_at is not null) as revoked_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [
          fixture.sessionId,
          `${fixture.prefix}-next-hash`,
          fixture.activeTokenId,
          fixture.deviceId,
        ],
      )

      assert.equal(Number(tokenState.rows[0]?.next_token_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.next_token_device_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.rotated_active_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 0)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('allows same-device recovery at the five-minute boundary', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)
      await client.query('begin')
      await client.query(
        `
          update app.auth_refresh_tokens
          set rotated_at = now() - interval '5 minutes'
          where id = $1::uuid
        `,
        [fixture.staleTokenId],
      )

      const result = await rotateRefreshToken(client, {
        currentTokenHash: `${fixture.prefix}-stale-hash`,
        deviceId: fixture.deviceId,
        nextTokenHash: `${fixture.prefix}-next-hash`,
        nextTokenId: fixture.nextTokenId,
        userAgent: fixture.userAgent,
      })

      assert.equal(result.rows[0]?.id, fixture.userId)
      assert.equal(result.rows[0]?.session_id, fixture.sessionId)
      await client.query('commit')

      const tokenState = await getRefreshTokenState(fixture)

      assert.equal(Number(tokenState.next_token_count), 1)
      assert.equal(Number(tokenState.revoked_count), 0)
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('revokes an expired same-device recovery with a new next token', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)
      await client.query(
        `
          update app.auth_refresh_tokens
          set rotated_at = now() - interval '5 minutes 1 second'
          where id = $1::uuid
        `,
        [fixture.staleTokenId],
      )

      const result = await rotateRefreshToken(client, {
        currentTokenHash: `${fixture.prefix}-stale-hash`,
        deviceId: fixture.deviceId,
        nextTokenHash: `${fixture.prefix}-next-hash`,
        nextTokenId: fixture.nextTokenId,
        userAgent: fixture.userAgent,
      })

      assert.equal(result.rows.length, 0)

      const tokenState = await getRefreshTokenState(fixture)

      assert.equal(Number(tokenState.next_token_count), 0)
      assert.equal(Number(tokenState.revoked_count), 2)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('revokes an expired exact same-device retry', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)

      const input = {
        currentTokenHash: `${fixture.prefix}-active-hash`,
        deviceId: fixture.deviceId,
        nextTokenHash: `${fixture.prefix}-next-hash`,
        nextTokenId: fixture.nextTokenId,
        userAgent: fixture.userAgent,
      }
      const firstResult = await rotateRefreshToken(client, input)

      assert.equal(firstResult.rows[0]?.id, fixture.userId)

      await client.query(
        `
          update app.auth_refresh_tokens
          set rotated_at = now() - interval '5 minutes 1 second'
          where id = $1::uuid
        `,
        [fixture.activeTokenId],
      )

      const retriedResult = await rotateRefreshToken(client, input)

      assert.equal(retriedResult.rows.length, 0)

      const tokenState = await getRefreshTokenState(fixture)

      assert.equal(Number(tokenState.next_token_count), 1)
      assert.equal(Number(tokenState.revoked_count), 3)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('revokes a rotated refresh token replayed from another device within the recovery window', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)
      await client.query(
        `
          update app.auth_refresh_tokens
          set rotated_at = now() - interval '1 minute'
          where id = $1::uuid
        `,
        [fixture.staleTokenId],
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
            $5,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-stale-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.otherDeviceId,
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
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 2)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('revokes a replayed legacy token even when the User-Agent matches', async () => {
    const fixture = createFixture()

    try {
      await seedRefreshFixture(fixture)
      await client.query(
        `
          update app.auth_refresh_tokens
          set
            device_id = null,
            rotated_at = case
              when id = $2::uuid then now() - interval '5 minutes'
              else rotated_at
            end
          where session_id = $1::uuid
        `,
        [fixture.sessionId, fixture.staleTokenId],
      )

      const result = await rotateRefreshToken(client, {
        currentTokenHash: `${fixture.prefix}-stale-hash`,
        deviceId: null,
        nextTokenHash: `${fixture.prefix}-next-hash`,
        nextTokenId: fixture.nextTokenId,
        userAgent: fixture.userAgent,
      })

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
            $5,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-active-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.deviceId,
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
            $5,
            '127.0.0.1'
          )
        `,
        [
          `${fixture.prefix}-active-hash`,
          fixture.nextTokenId,
          `${fixture.prefix}-next-hash`,
          fixture.deviceId,
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

  void test('normalizes malformed refresh metadata without failing rotation', async () => {
    const fixture = createFixture()
    const overlongDeviceId = `native-${'x'.repeat(180)}`

    try {
      await seedRefreshFixture(fixture)

      const result = await rotateRefreshToken(client, {
        currentTokenHash: `${fixture.prefix}-active-hash`,
        deviceId: overlongDeviceId,
        nextTokenHash: `${fixture.prefix}-next-hash`,
        nextTokenId: fixture.nextTokenId,
        userAgent: fixture.userAgent,
      })

      assert.equal(result.rows[0]?.id, fixture.userId)

      const tokenState = await client.query<{
        next_token_count: string
        next_token_device_count: string
      }>(
        `
          select
            count(*) filter (where token_hash = $2) as next_token_count,
            count(*) filter (
              where token_hash = $2
                and device_id is null
            ) as next_token_device_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [fixture.sessionId, `${fixture.prefix}-next-hash`],
      )

      assert.equal(Number(tokenState.rows[0]?.next_token_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.next_token_device_count ?? 0), 1)
    } finally {
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('keeps one active token when same-device refresh requests race', async () => {
    const fixture = createFixture()
    const concurrentClient = new Client({
      connectionString,
      connectionTimeoutMillis: 10_000,
      query_timeout: 30_000,
    })

    try {
      await concurrentClient.connect()
      await seedRefreshFixture(fixture)

      const firstNextTokenId = randomUUID()
      const secondNextTokenId = randomUUID()
      const [firstResult, secondResult] = await Promise.all([
        rotateRefreshToken(client, {
          currentTokenHash: `${fixture.prefix}-active-hash`,
          deviceId: fixture.deviceId,
          nextTokenHash: `${fixture.prefix}-concurrent-1-hash`,
          nextTokenId: firstNextTokenId,
          userAgent: fixture.userAgent,
        }),
        rotateRefreshToken(concurrentClient, {
          currentTokenHash: `${fixture.prefix}-active-hash`,
          deviceId: fixture.deviceId,
          nextTokenHash: `${fixture.prefix}-concurrent-2-hash`,
          nextTokenId: secondNextTokenId,
          userAgent: fixture.userAgent,
        }),
      ])

      assert.equal(firstResult.rows[0]?.id, fixture.userId)
      assert.equal(secondResult.rows[0]?.id, fixture.userId)

      const tokenState = await client.query<{
        active_unrotated_count: string
        concurrent_token_count: string
        revoked_count: string
      }>(
        `
          select
            count(*) filter (
              where revoked_at is null
                and rotated_at is null
            ) as active_unrotated_count,
            count(*) filter (
              where token_hash in ($2, $3)
            ) as concurrent_token_count,
            count(*) filter (where revoked_at is not null) as revoked_count
          from app.auth_refresh_tokens
          where session_id = $1
        `,
        [
          fixture.sessionId,
          `${fixture.prefix}-concurrent-1-hash`,
          `${fixture.prefix}-concurrent-2-hash`,
        ],
      )

      assert.equal(Number(tokenState.rows[0]?.active_unrotated_count ?? 0), 1)
      assert.equal(Number(tokenState.rows[0]?.concurrent_token_count ?? 0), 2)
      assert.equal(Number(tokenState.rows[0]?.revoked_count ?? 0), 0)
    } finally {
      await concurrentClient.end()
      await cleanupRefreshFixture(fixture)
    }
  })

  void test('keeps auth_rotate_refresh_token signature and local naming stable', async () => {
    const functionMetadata = await client.query<{
      args: string
      definition: string
      result: string
    }>(
      `
        select
          pg_get_function_arguments(function_oid) as args,
          pg_get_function_result(function_oid) as result,
          pg_get_functiondef(function_oid) as definition
        from (
          select 'app.auth_rotate_refresh_token(text, uuid, text, timestamptz, text, text, text)'::regprocedure as function_oid
        ) as function_ref
      `,
    )
    const metadata = functionMetadata.rows[0]

    assert.ok(metadata)
    assert.equal(
      metadata.args,
      [
        'input_current_token_hash text',
        'input_next_token_id uuid',
        'input_next_token_hash text',
        'input_next_expires_at timestamp with time zone',
        'input_device_id text',
        'input_user_agent text',
        'input_ip_address text',
      ].join(', '),
    )
    assert.equal(
      metadata.result,
      'TABLE(id uuid, email citext, display_name text, session_id uuid)',
    )
    assert.match(metadata.definition, /current_token record;/)
    assert.match(
      metadata.definition,
      /recovery_window constant interval := interval '5 minutes';/,
    )
    assert.match(metadata.definition, /token_to_rotate_id uuid;/)
    assert.match(metadata.definition, /normalized_device_id text :=/)
    assert.doesNotMatch(metadata.definition, /\ndeclare\s+id\s/iu)
    assert.doesNotMatch(metadata.definition, /\ndeclare\s+email\s/iu)
    assert.doesNotMatch(metadata.definition, /\ndeclare\s+session_id\s/iu)
  })
})

function rotateRefreshToken(
  queryClient: Pick<Client, 'query'>,
  input: {
    currentTokenHash: string
    deviceId: string | null
    nextTokenHash: string
    nextTokenId: string
    userAgent: string | null
  },
) {
  return queryClient.query<{
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
        $5,
        '127.0.0.1'
      )
    `,
    [
      input.currentTokenHash,
      input.nextTokenId,
      input.nextTokenHash,
      input.deviceId,
      input.userAgent,
    ],
  )
}

function createFixture(): AuthRefreshFixture {
  const suffix = randomUUID()

  return {
    activeTokenId: randomUUID(),
    deviceId: `native-device-${suffix}`,
    nextTokenId: randomUUID(),
    otherDeviceId: `native-device-other-${suffix}`,
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
        device_id,
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
          now() - interval '4 minutes',
          $5,
          $6,
          '127.0.0.1'
        ),
        (
          $7::uuid,
          $2::uuid,
          $8,
          $4::uuid,
          now() + interval '30 days',
          null,
          $5,
          $6,
          '127.0.0.1'
        )
    `,
    [
      fixture.staleTokenId,
      fixture.userId,
      `${fixture.prefix}-stale-hash`,
      fixture.sessionId,
      fixture.deviceId,
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

async function getRefreshTokenState(fixture: AuthRefreshFixture): Promise<{
  next_token_count: string
  revoked_count: string
}> {
  const result = await client.query<{
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

  return result.rows[0] ?? { next_token_count: '0', revoked_count: '0' }
}
