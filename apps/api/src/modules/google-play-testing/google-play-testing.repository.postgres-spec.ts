import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import { withOptionalRls } from '../../infrastructure/db/rls.js'
import {
  PostgresGooglePlayTestingRepository,
  type TestingActor,
} from './google-play-testing.repository.js'

void test('Postgres testing persists requests, isolates emails, and rejects stale or unauthorized approval', async (t) => {
  const connection = createDatabaseConnection(createDatabaseConfig())
  const repository = new PostgresGooglePlayTestingRepository(connection.db)
  const users = [randomUUID(), randomUUID(), randomUUID()]
  const actor = (id: string): TestingActor => ({
    userId: id,
    auth: {
      accessToken: 'test',
      claims: {
        sub: id,
        role: 'authenticated',
        payload: { sub: id, role: 'authenticated' },
      },
    },
  })
  const admin = actor(users[0]!)
  const user = actor(users[1]!)
  const other = actor(users[2]!)
  const wasOpen = await repository.isOpen(admin)
  t.after(async () => {
    await repository.setOpen(admin, wasOpen)
    await sql`delete from app.users where id = any(${users}::uuid[])`.execute(
      connection.db,
    )
    await destroyDatabaseConnection(connection)
  })
  for (const id of users) {
    await sql`insert into app.users (id, email, display_name, app_role, locale, timezone)
      values (${id}::uuid, ${`testing-${id}@example.test`}::public.citext, 'Testing', ${id === admin.userId ? 'admin' : 'user'}::app.app_role, 'ru-RU', 'Asia/Novosibirsk')`.execute(
      connection.db,
    )
  }
  await assert.rejects(
    repository.setOpen(user, true),
    (error: unknown) => (error as { code: string }).code === '42501',
  )
  await repository.setOpen(admin, true)
  const saved = await repository.submit(user, 'test@example.test')
  assert.equal(saved.status, 'pending')
  assert.deepEqual(await repository.list(other), [])
  assert.equal((await repository.list(user)).length, 1)
  assert.ok(
    (await repository.list(admin)).some(
      (entry) => entry.userId === user.userId,
    ),
  )
  await assert.rejects(
    repository.review(user, user.userId, {
      status: 'invited',
      revision: saved.revision,
    }),
    (error: unknown) => (error as { code: string }).code === '42501',
  )
  await assert.rejects(
    withOptionalRls(connection.db, user.auth, (trx) =>
      sql`update app.google_play_testing_requests set status = 'invited' where user_id = ${user.userId}::uuid`.execute(
        trx,
      ),
    ),
    (error: unknown) => (error as { code: string }).code === '42501',
  )
  const invited = await repository.review(admin, user.userId, {
    status: 'invited',
    revision: saved.revision,
  })
  assert.equal(
    (await repository.submit(user, 'test@example.test')).status,
    'invited',
  )
  const changed = await repository.submit(user, 'changed@example.test')
  assert.equal(changed.status, 'pending')
  await assert.rejects(
    repository.review(admin, user.userId, {
      status: 'invited',
      revision: invited.revision,
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  )
  await Promise.allSettled([
    repository.review(admin, user.userId, {
      status: 'invited',
      revision: changed.revision,
    }),
    repository.submit(user, 'concurrent@example.test'),
  ])
  const latest = (
    await new PostgresGooglePlayTestingRepository(connection.db).list(user)
  )[0]!
  assert.equal(latest.googleEmail, 'concurrent@example.test')
  assert.equal(latest.status, 'pending')
  await repository.review(admin, user.userId, {
    status: 'invited',
    revision: latest.revision,
  })
  await repository.setOpen(admin, false)
  await assert.rejects(
    repository.submit(other, 'new@example.test'),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  )
  assert.equal((await repository.list(user))[0]?.status, 'invited')
  await sql`delete from app.users where id = ${user.userId}::uuid`.execute(
    connection.db,
  )
  assert.equal(
    (await repository.list(admin)).some(
      (entry) => entry.userId === user.userId,
    ),
    false,
  )
})
