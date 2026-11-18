import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

import { Client } from 'pg'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { PostgresAuthRepository } from './auth.repository.postgres.js'

// The shared test database almost always has an owner already, so the race is
// reproduced in a scratch database. Same explicit opt-in as the voice removal
// migration spec: the URL must point at an isolated local test cluster.
const testOwnerUrl = process.env.VOICE_REMOVAL_MIGRATION_TEST_DATABASE_URL
const migrationDirectory = new URL(
  '../../../../../db/migrations/',
  import.meta.url,
)
const concurrentSignups = 8

void test(
  'concurrent sign-ups into a database without an owner elect exactly one owner',
  { skip: !testOwnerUrl },
  async () => {
    const ownerUrl = new URL(testOwnerUrl!)
    assert.match(ownerUrl.pathname, /^\/voice_[a-z0-9_]+$/)
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(ownerUrl.hostname))
    const databaseName = `first_owner_${randomUUID().replaceAll('-', '')}`
    const databaseUrl = new URL(ownerUrl)
    databaseUrl.pathname = `/${databaseName}`
    const admin = new Client({ connectionString: ownerUrl.toString() })

    await admin.connect()
    try {
      await admin.query(`create database ${databaseName}`)
      await migrate(databaseUrl.toString())

      const connection = createDatabaseConnection({
        connectionString: databaseUrl.toString(),
      })
      try {
        const auth = new PostgresAuthRepository(connection.db)
        const userIds = Array.from({ length: concurrentSignups }, () =>
          randomUUID(),
        )
        const results = await Promise.allSettled(
          userIds.map((userId) =>
            auth.createUserWithCredential({
              userId,
              email: `first-owner-${userId}@example.test`,
              displayName: 'First owner race',
              passwordHash: 'unusable-test-hash',
            }),
          ),
        )

        assert.deepEqual(
          results.flatMap((result) =>
            result.status === 'rejected' ? [String(result.reason)] : [],
          ),
          [],
        )

        const roles = await connection.pool.query<{
          app_role: string
          count: number
        }>(
          `select app_role::text, count(*)::int as count
           from app.users
           where deleted_at is null
           group by app_role
           order by app_role`,
        )
        assert.deepEqual(roles.rows, [
          { app_role: 'owner', count: 1 },
          { app_role: 'user', count: concurrentSignups - 1 },
        ])

        const takenEmail = `first-owner-${userIds[0]}@example.test`
        await assert.rejects(
          auth.createUserWithCredential({
            userId: randomUUID(),
            email: takenEmail.toUpperCase(),
            displayName: 'Duplicate email',
            passwordHash: 'unusable-test-hash',
          }),
          (error) =>
            error instanceof HttpError &&
            error.statusCode === 409 &&
            error.code === 'auth_email_taken',
        )

        // A colliding user id is not an email conflict and must not be
        // reported to the client as "already registered".
        await assert.rejects(
          auth.createUserWithCredential({
            userId: userIds[1]!,
            email: `first-owner-${randomUUID()}@example.test`,
            displayName: 'Duplicate id',
            passwordHash: 'unusable-test-hash',
          }),
          (error) =>
            error instanceof Error &&
            !(error instanceof HttpError) &&
            Reflect.get(error, 'constraint') === 'users_pkey',
        )
      } finally {
        await destroyDatabaseConnection(connection)
      }
    } finally {
      await admin.query(`drop database if exists ${databaseName}`)
      await admin.end()
    }
  },
)

async function migrate(connectionString: string) {
  const client = new Client({ connectionString })

  await client.connect()
  try {
    await client.query(
      `create schema app; create table app.schema_migrations (id bigserial primary key, name text not null unique, checksum text, statement_count integer, applied_at timestamptz not null default now())`,
    )
    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort()

    for (const file of files) {
      await client.query('begin')
      try {
        await client.query(
          await readFile(new URL(file, migrationDirectory), 'utf8'),
        )
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw new Error(`Migration failed: ${file}`, { cause: error })
      }
    }
  } finally {
    await client.end()
  }
}
