import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { Client } from 'pg'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const client = new Client({
  connectionString,
  connectionTimeoutMillis: 10_000,
  query_timeout: 30_000,
})
const userIds: string[] = []
const nonces: string[] = []

function command(
  overrides: {
    email?: string
    linkUserId?: string
    nonce?: string
    subject?: string
    expiresAt?: Date
  } = {},
) {
  const userId = randomUUID()
  userIds.push(userId)
  const nonce = overrides.nonce ?? randomUUID()
  nonces.push(nonce)
  return [
    overrides.subject ?? randomUUID(),
    overrides.email ?? `${userId}@google-auth.test`,
    'Google Test',
    userId,
    overrides.linkUserId ?? null,
    nonce,
    overrides.expiresAt ?? new Date(Date.now() + 300_000),
  ]
}

function complete(values: unknown[], connection = client) {
  return connection.query<{ id: string; email: string }>(
    'select * from app.auth_complete_google_sign_in($1, $2::public.citext, $3, $4::uuid, $5::uuid, $6, $7::timestamptz)',
    values,
  )
}

void describe('Postgres Google sign-in identities', () => {
  before(async () => {
    await client.connect()
  })
  after(async () => {
    await client.query(
      'delete from app.auth_google_nonce_uses where nonce_hash = any($1::text[])',
      [nonces],
    )
    await client.query('delete from app.users where id = any($1::uuid[])', [
      userIds,
    ])
    await client.end()
  })

  void it('creates a password-reset-compatible account and keeps the same id on subsequent sign-ins', async () => {
    const first = command()
    const created = await complete(first)
    assert.equal(created.rows[0]?.id, first[3])
    const second = await complete(
      command({ subject: String(first[0]), email: 'changed@google-auth.test' }),
    )
    assert.equal(second.rows[0]?.id, first[3])
    assert.equal(second.rows[0]?.email, first[1])
    const credential = await client.query<{ password_hash: string }>(
      'select password_hash from app.auth_credentials where user_id=$1',
      [first[3]],
    )
    assert.equal(credential.rows[0]?.password_hash, 'external:google')
    await assert.rejects(complete(first), /google_challenge_invalid/)
  })

  void it('does not merge an email account without verified password ownership', async () => {
    const existingId = randomUUID()
    userIds.push(existingId)
    const email = `${existingId}@google-auth.test`
    await client.query(
      "select * from app.auth_create_user_with_credential($1::uuid, $2::public.citext, 'Existing', 'existing-hash')",
      [existingId, email],
    )
    const values = command({ email })
    await assert.rejects(complete(values), /google_link_required/)
    const used = await client.query(
      'select 1 from app.auth_google_nonce_uses where nonce_hash=$1',
      [values[5]],
    )
    assert.equal(
      used.rowCount,
      0,
      'a failed attempt must not consume the challenge',
    )
    values[4] = existingId
    const linked = await complete(values)
    assert.equal(linked.rows[0]?.id, existingId)
    const credential = await client.query<{ password_hash: string }>(
      'select password_hash from app.auth_credentials where user_id=$1',
      [existingId],
    )
    assert.equal(credential.rows[0]?.password_hash, 'existing-hash')
  })

  void it('claims a concurrent challenge only once', async () => {
    const other = new Client({ connectionString })
    await other.connect()
    try {
      const values = command()
      const results = await Promise.allSettled([
        complete(values),
        complete(values, other),
      ])
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      )
      assert.equal(
        results.filter((result) => result.status === 'rejected').length,
        1,
      )
    } finally {
      await other.end()
    }
  })

  void it('serializes concurrent first sign-ins for the same subject', async () => {
    const other = new Client({ connectionString })
    await other.connect()
    try {
      const values = command()
      const next = command({
        subject: String(values[0]),
        email: String(values[1]),
      })
      const [first, second] = await Promise.all([
        complete(values),
        complete(next, other),
      ])
      assert.equal(first.rows[0]?.id, second.rows[0]?.id)
    } finally {
      await other.end()
    }
  })

  void it('rejects expired challenges and deleted accounts', async () => {
    await assert.rejects(
      complete(command({ expiresAt: new Date(0) })),
      /google_challenge_invalid/,
    )
    const values = command()
    await complete(values)
    await client.query('update app.users set deleted_at=now() where id=$1', [
      values[3],
    ])
    await assert.rejects(
      complete(command({ subject: String(values[0]) })),
      /google_account_unavailable/,
    )
  })

  void it('supports Google sign-in through the non-owner auth role without direct table access', async () => {
    const access = await client.query(`select
      has_table_privilege('authenticated', 'app.auth_google_identities', 'SELECT') as can_read,
      has_table_privilege('authenticated', 'app.auth_google_nonce_uses', 'INSERT') as can_write,
      has_function_privilege('authenticated', 'app.auth_complete_google_sign_in(text, public.citext, text, uuid, uuid, text, timestamptz)', 'EXECUTE') as can_sign_in`)
    assert.deepEqual(access.rows[0], {
      can_read: false,
      can_write: false,
      can_sign_in: true,
    })

    await client.query('begin')
    try {
      await client.query('set local role authenticated')
      const values = command()
      const created = await complete(values)
      assert.equal(created.rows[0]?.id, values[3])
      const found = await client.query<{ id: string }>(
        'select id from app.auth_find_google_user($1)',
        [values[0]],
      )
      assert.equal(found.rows[0]?.id, created.rows[0]?.id)
      const again = await complete(
        command({ subject: String(values[0]), email: String(values[1]) }),
      )
      assert.equal(again.rows[0]?.id, created.rows[0]?.id)
    } finally {
      await client.query('rollback')
    }
  })
})
