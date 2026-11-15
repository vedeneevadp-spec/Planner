import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { plannerSearchQuerySchema } from '@planner/contracts'

import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import { createSessionAuthContext } from '../session/session.repository.contract.js'
import { PostgresPlannerSearchRepository } from './planner-search.repository.postgres.js'

void test('SQL search bounds 2000-row sources, escapes wildcards and enforces personal data scope', async (t) => {
  const connection = createDatabaseConnection(createDatabaseConfig())
  const userId = randomUUID(),
    workspaceId = randomUUID(),
    zoneId = randomUUID()
  try {
    await connection.pool.query(
      "insert into app.users(id,email,display_name) values($1,$2,'Search')",
      [userId, `${userId}@search.test`],
    )
    await connection.pool.query(
      "insert into app.workspaces(id,owner_user_id,name,slug,kind) values($1::uuid,$2,'Search',$1::text,'personal')",
      [workspaceId, userId],
    )
    await connection.pool.query(
      "insert into app.workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",
      [workspaceId, userId],
    )
    await connection.pool.query(
      "insert into app.cleaning_zones(id,workspace_id,user_id,title,day_of_week) values($1,$2,$3,'Zone',1)",
      [zoneId, workspaceId, userId],
    )
    await connection.pool.query(
      "insert into app.cleaning_tasks(workspace_id,user_id,zone_id,title,description) select $1,$2,$3,'Тест '||lpad(n::text,4,'0'),'100%_literal' from generate_series(1,2000) n",
      [workspaceId, userId, zoneId],
    )
    await connection.pool.query(
      "insert into app.self_care_items(workspace_id,user_id,title,type,category,description,created_by,updated_by) select $1,$2,'Тест '||lpad(n::text,4,'0'),'ritual','daily_base','100%_literal',$2,$2 from generate_series(1,2000) n",
      [workspaceId, userId],
    )
    const repository = new PostgresPlannerSearchRepository(connection.db)
    const context = {
      actorUserId: userId,
      auth: createSessionAuthContext({
        userId,
        email: `${userId}@search.test`,
      }),
      workspaceId,
      workspaceKind: 'personal' as const,
    }
    for (const source of ['cleaning', 'care'] as const) {
      const start = performance.now()
      const first = await repository.search(
        source,
        context,
        plannerSearchQuerySchema.parse({ query: 'тест', limit: 20 }),
      )
      const next = await repository.search(
        source,
        context,
        plannerSearchQuerySchema.parse({ query: 'тест', limit: 20, page: 2 }),
      )
      assert.equal(first.items.length, 20)
      assert.equal(first.hasMore, true)
      assert.equal(next.items.length, 20)
      assert.equal(
        new Set([...first.items, ...next.items].map((i) => i.id)).size,
        40,
      )
      assert.equal(
        (
          await repository.search(
            source,
            context,
            plannerSearchQuerySchema.parse({ query: '100%_', limit: 20 }),
          )
        ).items.length,
        20,
      )
      assert.equal(
        (
          await repository.search(
            source,
            context,
            plannerSearchQuerySchema.parse({ query: '100__', limit: 20 }),
          )
        ).items.length,
        0,
      )
      t.diagnostic(
        `${source}: 2,000 rows, bounded pages + literal wildcard probes: ${(performance.now() - start).toFixed(1)}ms`,
      )
    }
    assert.deepEqual(
      await repository.search(
        'care',
        { ...context, workspaceKind: 'shared' },
        plannerSearchQuerySchema.parse({ query: 'тест' }),
      ),
      { items: [], hasMore: false },
    )
    assert.equal(
      (
        await repository.search(
          'care',
          { ...context, actorUserId: randomUUID() },
          plannerSearchQuerySchema.parse({ query: 'тест' }),
        )
      ).items.length,
      0,
    )
  } finally {
    await connection.pool.query(
      'delete from app.workspace_members where user_id=$1',
      [userId],
    )
    await connection.pool.query('delete from app.workspaces where id=$1', [
      workspaceId,
    ])
    await connection.pool.query('delete from app.users where id=$1', [userId])
    await destroyDatabaseConnection(connection)
  }
})
