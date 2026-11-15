import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { Client } from 'pg'

const owner = new Client({ connectionString: process.env.DATABASE_URL })
const runtimeUrl =
  process.env.DB_RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL
const userId = randomUUID()
const workspaceId = randomUUID()
const otherWorkspaceId = randomUUID()
const projectId = randomUUID()
const clients: Client[] = []

before(async () => {
  await owner.connect()
  await owner.query(
    'insert into app.users (id, email, display_name) values ($1,$2,$3)',
    [userId, `${userId}@epoch.test`, 'Epoch'],
  )
  for (const id of [workspaceId, otherWorkspaceId]) {
    await owner.query(
      "insert into app.workspaces (id, owner_user_id, name, slug, kind) values ($1::uuid,$2,'Epoch',$1::text,$3)",
      [id, userId, id === workspaceId ? 'personal' : 'shared'],
    )
    await owner.query(
      "insert into app.workspace_members (workspace_id,user_id,role) values ($1,$2,'owner')",
      [id, userId],
    )
  }
  await owner.query(
    "insert into app.projects (id,workspace_id,title,slug,created_by,updated_by) values ($1,$2,'Before','before',$3,$3)",
    [projectId, workspaceId, userId],
  )
})
after(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await owner.query('delete from app.workspace_members where user_id=$1', [
    userId,
  ])
  await owner.query('delete from app.workspaces where owner_user_id=$1', [
    userId,
  ])
  await owner.query('delete from app.users where id=$1', [userId])
  await owner.end()
})

async function connection(epoch?: string, integrationIssuedAt?: string) {
  const client = new Client({ connectionString: runtimeUrl })
  clients.push(client)
  await client.connect()
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({
      sub: userId,
      role: 'authenticated',
      planner_write_epochs: epoch === undefined ? {} : { [workspaceId]: epoch },
      planner_integration_issued_at: integrationIssuedAt,
    }),
  ])
  return client
}
async function restore() {
  await owner.query('begin')
  await owner.query(
    'select pg_advisory_xact_lock(hashtextextended($1,7334202607))',
    [workspaceId],
  )
  await owner.query(
    'insert into app.workspace_write_epochs(workspace_id,epoch,restored_at) values ($1,1,clock_timestamp()) on conflict(workspace_id) do update set epoch=workspace_write_epochs.epoch+1, restored_at=clock_timestamp()',
    [workspaceId],
  )
  await owner.query("update app.projects set title='Restored' where id=$1", [
    projectId,
  ])
}
async function waitsForLock(client: Client) {
  const { rows } = await client.query<{ pid: number }>(
    'select pg_backend_pid() as pid',
  )
  return rows[0]!.pid
}
async function assertWaiting(pid: number) {
  const observer = new Client({ connectionString: process.env.DATABASE_URL })
  await observer.connect()
  try {
    for (let i = 0; i < 100; i++) {
      const result = await observer.query<{ wait_event: string | null }>(
        'select wait_event from pg_stat_activity where pid=$1',
        [pid],
      )
      if (result.rows[0]?.wait_event === 'advisory') return
      await delay(10)
    }
    assert.fail('Expected actual advisory lock contention')
  } finally {
    await observer.end()
  }
}

void test('workspace epoch serializes writes with restore, rejects delayed writes and isolates workspaces', async () => {
  const first = await connection('0')
  await first.query("update app.projects set title='In flight' where id=$1", [
    projectId,
  ])
  const ownerPid = await waitsForLock(owner)
  const pendingRestore = restore()
  await assertWaiting(ownerPid)
  await first.query('commit')
  await pendingRestore
  await owner.query('commit')

  for (const epoch of [undefined, '0']) {
    const late = await connection(epoch)
    await assert.rejects(
      late.query("update app.projects set title='Late' where id=$1", [
        projectId,
      ]),
      { code: 'P4009' },
    )
    await late.query('rollback')
  }
  const current = await connection('1')
  await current.query("update app.projects set title='Fresh' where id=$1", [
    projectId,
  ])
  await current.query('commit')
  const unaffected = await connection('0')
  await unaffected.query(
    "insert into app.projects(workspace_id,title,slug,created_by,updated_by) values ($1,'Unaffected','unaffected',$2,$2)",
    [otherWorkspaceId, userId],
  )
  await unaffected.query('commit')
  assert.equal(
    (
      await owner.query<{ title: string }>(
        'select title from app.projects where id=$1',
        [projectId],
      )
    ).rows[0]?.title,
    'Fresh',
  )

  await restore()
  const waiting = await connection('1')
  const pid = await waitsForLock(waiting)
  const delayed = waiting
    .query(
      'select pg_advisory_xact_lock_shared(hashtextextended($1,7334202607))',
      [workspaceId],
    )
    .then(() =>
      waiting.query(
        "insert into app.projects(workspace_id,title,slug,created_by,updated_by) values ($1,'Delayed','delayed',$2,$2)",
        [workspaceId, userId],
      ),
    )
  const rejected = assert.rejects(delayed, { code: 'P4009' })
  await assertWaiting(pid)
  await owner.query('commit')
  await rejected
  await waiting.query('rollback')

  await restore()
  await owner.query('rollback')
  assert.equal(
    (
      await owner.query<{ epoch: string }>(
        'select epoch::text from app.workspace_write_epochs where workspace_id=$1',
        [workspaceId],
      )
    ).rows[0]?.epoch,
    '2',
  )
  const oldIntegration = await connection(undefined, '2000-01-01T00:00:00Z')
  await assert.rejects(
    oldIntegration.query(
      "update app.projects set title='Old integration' where id=$1",
      [projectId],
    ),
    { code: 'P4009' },
  )
  await oldIntegration.query('rollback')
  const freshIntegration = await connection(
    undefined,
    new Date(Date.now() + 1000).toISOString(),
  )
  await freshIntegration.query(
    "update app.projects set title='New integration' where id=$1",
    [projectId],
  )
  await freshIntegration.query('commit')
  const profile = await connection('0')
  await assert.rejects(
    profile.query(
      "update app.users set display_name='Late profile' where id=$1",
      [userId],
    ),
    { code: 'P4009' },
  )
  await profile.query('rollback')
  const protectedMetadata = await connection('2')
  await assert.rejects(
    protectedMetadata.query(
      'update app.workspace_write_epochs set epoch=0 where workspace_id=$1',
      [workspaceId],
    ),
    { code: '42501' },
  )
  await protectedMetadata.query('rollback')

  await owner.query('begin')
  await owner.query(
    'select pg_advisory_xact_lock(hashtextextended($1,7334202607))',
    [workspaceId],
  )
  const directRpc = await connection(undefined, '2000-01-01T00:00:00Z')
  await directRpc.query("set local statement_timeout = '1000ms'")
  await assert.rejects(
    directRpc.query("update app.projects set title='Late RPC' where id=$1", [
      projectId,
    ]),
    { code: 'P4009' },
  )
  await directRpc.query('rollback')
  await owner.query(
    "update app.projects set title='Restored without deadlock' where id=$1",
    [projectId],
  )
  const issuer = new Client({ connectionString: process.env.DATABASE_URL })
  clients.push(issuer)
  await issuer.connect()
  for (const statement of [
    "insert into app.api_keys(id,user_id,workspace_id,name,prefix,token_hash,scopes,expires_at) values(gen_random_uuid(),$1,$2,'Race','hkt_test',repeat('a',64),array['tasks:write'],now()+interval '1 day')",
    "insert into app.auth_refresh_tokens(user_id,session_id,token_hash,expires_at) values($1,$2,'epoch-refresh-race',now()+interval '1 day')",
    "insert into app.mcp_oauth_tokens(user_id,id,access_token_hash,expires_at) values($1,$2,'epoch-mcp-race',now()+interval '1 day')",
  ]) {
    await assert.rejects(issuer.query(statement, [userId, workspaceId]), {
      code: 'P4009',
    })
  }
  await owner.query('rollback')

  // Production restore may use a dedicated BYPASSRLS maintenance role instead
  // of the table owner; it still has no end-user claims.
  const maintenanceRole = `epoch_maintenance_${randomUUID().replaceAll('-', '')}`
  await owner.query(`create role ${maintenanceRole} nologin bypassrls`)
  try {
    await owner.query(`grant usage on schema app to ${maintenanceRole}`)
    await owner.query(
      `grant select, update on app.projects to ${maintenanceRole}`,
    )
    await owner.query('begin')
    await owner.query(`set local role ${maintenanceRole}`)
    await owner.query(
      "update app.projects set title='Maintenance restore' where id=$1",
      [projectId],
    )
    await owner.query('commit')
  } finally {
    await owner.query('rollback')
    await owner.query(`drop owned by ${maintenanceRole}`)
    await owner.query(`drop role ${maintenanceRole}`)
  }
})
