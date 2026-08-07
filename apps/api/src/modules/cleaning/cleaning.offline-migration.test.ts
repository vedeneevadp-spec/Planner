import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../../../../db/migrations/20260806_000091_cleaning_offline_commands.sql',
  import.meta.url,
)

void test('cleaning operation ledger remains scoped and works without JWT claims in disabled RLS mode', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(
    sql,
    /primary key \(workspace_id, actor_user_id, operation_id\)/i,
  )
  assert.match(sql, /set search_path = pg_catalog, app/gi)
  assert.match(
    sql,
    /claims_user_id is not null and claims_user_id <> input_actor_user_id/gi,
  )
  assert.match(sql, /membership\.user_id = input_actor_user_id/gi)
  assert.match(sql, /membership\.role <> 'guest'/gi)
  assert.match(
    sql,
    /membership\.group_role in \('group_admin', 'senior_member', 'member'\)/gi,
  )
  assert.match(
    sql,
    /revoke all on table app\.cleaning_operations from public, authenticated/i,
  )
})

void test('cleaning offline migration does not rewrite historical task actions', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.doesNotMatch(sql, /delete from app\.cleaning_task_history/i)
  assert.doesNotMatch(
    sql,
    /create unique index[^;]+\(workspace_id, task_id, date\)/is,
  )
})
