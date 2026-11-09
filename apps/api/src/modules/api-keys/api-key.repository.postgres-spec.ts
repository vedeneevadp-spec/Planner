import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import { PostgresSessionRepository } from '../session/index.js'
import { hashApiKey, PostgresApiKeyRepository } from './api-key.repository.js'
import { ApiKeyService } from './api-key.service.js'

void test('Postgres API keys persist hashes, isolate owners, enforce grants and live membership', async (t) => {
  const connection = createDatabaseConnection(createDatabaseConfig())
  const userIds = [randomUUID(), randomUUID()]
  t.after(async () => {
    await connection.db
      .deleteFrom('app.workspaces')
      .where('owner_user_id', 'in', userIds)
      .execute()
    await connection.db
      .deleteFrom('app.users')
      .where('id', 'in', userIds)
      .execute()
    await destroyDatabaseConnection(connection)
  })
  const sessions = new PostgresSessionRepository(connection.db)
  const owners = await Promise.all(
    userIds.map(async (userId) => {
      const email = `api-key-test-${userId}@example.test`
      await sql`insert into app.users (id, email, display_name, app_role, locale, timezone) values (${userId}::uuid, ${email}::public.citext, 'API test', 'user', 'ru-RU', 'Asia/Novosibirsk')`.execute(
        connection.db,
      )
      const auth: AuthenticatedRequestContext = {
        accessToken: 'test-session',
        claims: {
          sub: userId,
          email,
          role: 'authenticated',
          payload: { sub: userId, email, role: 'authenticated' },
        },
      }
      const session = await sessions.resolve({
        auth,
        actorUserId: undefined,
        workspaceId: undefined,
      })
      return {
        userId: session.actorUserId,
        auth,
        workspaceId: session.workspaceId,
      }
    }),
  )
  const owner = owners[0]!
  const other = owners[1]!
  const repository = new PostgresApiKeyRepository(connection.db)
  const service = new ApiKeyService(repository)
  const created = await service.create(owner, owner.workspaceId, {
    name: 'Persistent bot',
    scopes: ['tasks:read', 'shopping:write'],
    expiresInDays: 30,
  })
  const stored = await sql<{
    token_hash: string
  }>`select token_hash from app.api_keys where id = ${created.key.id}::uuid`.execute(
    connection.db,
  )
  assert.equal(stored.rows[0]?.token_hash, hashApiKey(created.secret))
  assert.equal(
    JSON.stringify(await repository.list(owner)).includes(created.secret),
    false,
  )
  assert.deepEqual(await repository.list(other), [])
  await assert.rejects(
    repository.revoke(other, created.key.id),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  )
  assert.ok(await repository.authenticate(hashApiKey(created.secret)))
  assert.ok((await repository.list(owner))[0]?.lastUsedAt)
  const grants = await sql<{
    table_access: boolean
    anonymous_lookup: boolean
  }>`select
    has_table_privilege('authenticated', 'app.api_keys', 'select') as table_access,
    exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where p.oid = 'app.api_keys_authenticate(text)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as anonymous_lookup`.execute(
    connection.db,
  )
  assert.equal(grants.rows[0]?.table_access, false)
  assert.equal(grants.rows[0]?.anonymous_lookup, false)
  await sql`update app.workspace_members set deleted_at = now() where user_id = ${owner.userId}::uuid and workspace_id = ${owner.workspaceId}::uuid`.execute(
    connection.db,
  )
  assert.equal(await repository.authenticate(hashApiKey(created.secret)), null)
  await sql`update app.workspace_members set deleted_at = null where user_id = ${owner.userId}::uuid and workspace_id = ${owner.workspaceId}::uuid`.execute(
    connection.db,
  )
  await repository.revoke(owner, created.key.id)
  assert.equal(await repository.authenticate(hashApiKey(created.secret)), null)
  const expiring = await service.create(owner, owner.workspaceId, {
    name: 'Expired',
    scopes: ['tasks:read'],
    expiresInDays: 1,
  })
  await sql`update app.api_keys set expires_at = now() - interval '1 second' where id = ${expiring.key.id}::uuid`.execute(
    connection.db,
  )
  assert.equal(await repository.authenticate(hashApiKey(expiring.secret)), null)
  const results = await Promise.allSettled(
    Array.from({ length: 22 }, (_, index) =>
      service.create(owner, owner.workspaceId, {
        name: `Concurrent ${index}`,
        scopes: ['tasks:read'],
        expiresInDays: 1,
      }),
    ),
  )
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    20,
  )
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    2,
  )
})
