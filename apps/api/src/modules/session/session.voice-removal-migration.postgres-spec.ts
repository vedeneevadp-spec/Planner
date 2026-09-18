import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

import { Client } from 'pg'

// Explicit opt-in: never create, migrate or remove databases using the normal
// application DATABASE_URL. The owner URL must target an isolated test cluster.
const testOwnerUrl = process.env.VOICE_REMOVAL_MIGRATION_TEST_DATABASE_URL
const migrationDirectory = new URL(
  '../../../../../db/migrations/',
  import.meta.url,
)
const removalMigration = '20260918_000106_remove_builtin_voice_settings.sql'
const oauthMigration = '20260918_000107_qualify_alice_oauth_code_claim.sql'

for (const mode of ['fresh', 'upgrade'] as const) {
  void test(
    `voice removal migration: ${mode} schema preserves data, RLS and Alice OAuth`,
    { skip: !testOwnerUrl },
    async () => {
      const ownerUrl = new URL(testOwnerUrl!)
      assert.match(ownerUrl.pathname, /^\/voice_[a-z0-9_]+$/)
      assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(ownerUrl.hostname))
      const databaseName = `voice_migration_${mode}_${randomUUID().replaceAll('-', '')}`
      const admin = new Client({ connectionString: ownerUrl.toString() })
      const databaseUrl = new URL(ownerUrl)
      databaseUrl.pathname = `/${databaseName}`
      const client = new Client({ connectionString: databaseUrl.toString() })

      await admin.connect()
      try {
        await admin.query(`create database ${databaseName}`)
        await client.connect()
        await client.query(
          `create schema app; create table app.schema_migrations (id bigserial primary key, name text not null unique, checksum text, statement_count integer, applied_at timestamptz not null default now())`,
        )
        const files = (await readdir(migrationDirectory))
          .filter((file) => file.endsWith('.sql'))
          .sort()
        assert.ok(files.includes(removalMigration))
        for (const file of files.filter((file) => file < removalMigration)) {
          await applyMigration(client, file)
        }

        const oauthBefore = await readOAuthCatalog(client)
        const dependencies = await client.query(`
        select distinct p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.prosrc ~ 'voice_assistant_enabled|wake_word_training_mode_enabled'
      `)
        assert.deepEqual(dependencies.rows, [
          { proname: 'update_current_user_preferences' },
        ])
        const columnDependencies = await client.query<{
          kind: string
          constraintType: string | null
          description: string
        }>(`
          select distinct d.classid::regclass::text as kind, c.contype as "constraintType", pg_describe_object(d.classid, d.objid, d.objsubid) as description
          from pg_depend d join pg_attribute a
            on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
          left join pg_constraint c on d.classid = 'pg_constraint'::regclass and c.oid = d.objid
          where a.attrelid in ('app.users'::regclass, 'app.workspaces'::regclass)
            and a.attname in ('voice_assistant_enabled', 'wake_word_training_mode_enabled')
        `)
        assert.ok(
          columnDependencies.rows.every(
            (dependency) =>
              dependency.kind === 'pg_attrdef' ||
              (dependency.kind === 'pg_constraint' &&
                dependency.constraintType === 'n'),
          ),
          `Retired columns have unknown catalog dependents: ${JSON.stringify(columnDependencies.rows)}`,
        )
        const subjects = createSubjects()
        if (mode === 'upgrade') await seedLegacyData(client, subjects, true)
        await applyMigration(client, removalMigration)
        if (mode === 'fresh') await seedLegacyData(client, subjects, false)

        assert.deepEqual(await readOAuthCatalog(client), oauthBefore)
        await applyMigration(client, oauthMigration)
        const expectedOAuth = structuredClone(oauthBefore)
        for (const fn of expectedOAuth.functions) {
          if (
            fn.signature.startsWith(
              'app.auth_exchange_oauth_authorization_code(',
            )
          ) {
            fn.definition = fn.definition.replace(
              '  update oauth_authorization_codes\n  set consumed_at = now()\n  where id = authorization_code.code_id\n    and consumed_at is null;',
              '  update oauth_authorization_codes as code_row\n  set consumed_at = now()\n  where code_row.id = authorization_code.code_id\n    and code_row.consumed_at is null;',
            )
          }
        }
        assert.deepEqual(await readOAuthCatalog(client), expectedOAuth)
        const columns = await client.query(
          `select column_name from information_schema.columns where table_schema = 'app' and column_name in ('voice_assistant_enabled', 'wake_word_training_mode_enabled')`,
        )
        assert.equal(columns.rowCount, 0)
        const overloads = await client.query(
          `select oid::regprocedure::text as signature from pg_proc where pronamespace = 'app'::regnamespace and proname = 'update_current_user_preferences'`,
        )
        assert.deepEqual(overloads.rows, [
          { signature: 'app.update_current_user_preferences(text,text)' },
        ])
        assert.equal(
          (
            await client.query<{ count: number }>(
              `select count(*)::int as count from pg_proc where pronamespace = 'app'::regnamespace and prosrc ~ 'voice_assistant_enabled|wake_word_training_mode_enabled'`,
            )
          ).rows[0]?.count,
          0,
        )
        const privileges = await client.query(
          `select has_function_privilege('authenticated', 'app.update_current_user_preferences(text,text)', 'execute') as allowed, exists (select 1 from pg_proc, lateral aclexplode(proacl) acl where oid = 'app.update_current_user_preferences(text,text)'::regprocedure and acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as public_execute`,
        )
        assert.deepEqual(privileges.rows[0], {
          allowed: true,
          public_execute: false,
        })
        const roles = await client.query<{ role: string }>(
          `select app_role::text as role from app.users where id = $1`,
          [subjects.otherUser],
        )
        assert.equal(roles.rows[0]?.role, 'test')
        const data = await client.query(
          `select (select title from app.tasks where id = $1) as task, (select source from app.chaos_inbox_items where id = $2) as source, (select calendar_view_mode from app.users where id = $3) as calendar, (select energy_mode from app.users where id = $3) as energy, (select default_time_zone from app.users where id = $3) as zone, (select task_completion_confetti_enabled from app.workspaces where id = $4) as confetti`,
          [subjects.task, subjects.purchase, subjects.user, subjects.workspace],
        )
        assert.deepEqual(data.rows[0], {
          task: 'Existing task',
          source: 'voice',
          calendar: 'month',
          energy: 'minimum',
          zone: 'Asia/Novosibirsk',
          confetti: false,
        })
        await checkRuntime(client, subjects)
      } finally {
        await client.end()
        await admin.query(`drop database if exists ${databaseName}`)
        await admin.end()
      }
    },
  )
}

async function applyMigration(client: Client, file: string) {
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

function createSubjects() {
  return {
    user: randomUUID(),
    otherUser: randomUUID(),
    workspace: randomUUID(),
    otherWorkspace: randomUUID(),
    task: randomUUID(),
    otherTask: randomUUID(),
    purchase: randomUUID(),
    code: randomUUID(),
    session: randomUUID(),
    refresh: randomUUID(),
  }
}

type Subjects = ReturnType<typeof createSubjects>

async function seedLegacyData(client: Client, ids: Subjects, legacy: boolean) {
  for (const [user, workspace, task, role] of [
    [ids.user, ids.workspace, ids.task, 'admin'],
    [ids.otherUser, ids.otherWorkspace, ids.otherTask, 'test'],
  ]) {
    await client.query(
      `insert into app.users(id,email,display_name,app_role,calendar_view_mode,energy_mode,default_time_zone) values ($1,$2,'Migration fixture',$3,'month','minimum','Asia/Novosibirsk')`,
      [user, `${user}@example.test`, role],
    )
    await client.query(
      `insert into app.workspaces(id,owner_user_id,name,slug,kind,task_completion_confetti_enabled) values ($1,$2,'Migration fixture',$3,'personal',false)`,
      [workspace, user, workspace],
    )
    await client.query(
      `insert into app.workspace_members(id,user_id,workspace_id,role) values ($1,$2,$3,'owner')`,
      [randomUUID(), user, workspace],
    )
    await client.query(
      `insert into app.tasks(id,workspace_id,title,created_by,updated_by) values ($1,$2,'Existing task',$3,$3)`,
      [task, workspace, user],
    )
  }
  await client.query(
    `insert into app.chaos_inbox_items(id,workspace_id,user_id,text,source,kind,created_by,updated_by) values ($1,$2,$3,'Молоко','voice','shopping',$3,$3)`,
    [ids.purchase, ids.workspace, ids.user],
  )
  await client.query(
    `insert into app.auth_refresh_tokens(id,user_id,token_hash,session_id,expires_at) values ($1,$2,$3,$4,now()+interval '1 day')`,
    [ids.refresh, ids.user, ids.refresh, ids.session],
  )
  await client.query(
    `select app.auth_create_oauth_authorization_code($1,$2,$3,'alice-test','https://example.test/alice','planner',now()+interval '1 day',null,null)`,
    [ids.code, ids.user, ids.code],
  )
  if (legacy) {
    await client.query(
      `update app.users set voice_assistant_enabled = true where id = any($1::uuid[])`,
      [[ids.user, ids.otherUser]],
    )
    await client.query(
      `update app.workspaces set wake_word_training_mode_enabled = true where id = any($1::uuid[])`,
      [[ids.workspace, ids.otherWorkspace]],
    )
  }
}

interface OAuthCatalog {
  functions: Array<{ signature: string; acl: unknown; definition: string }>
  table: unknown
  indexes: unknown
  policies: unknown
}

async function readOAuthCatalog(client: Client) {
  const result = await client.query<{ catalog: OAuthCatalog }>(`
    select jsonb_build_object(
      'functions', (select jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text, 'acl', p.proacl, 'definition', pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('auth_create_oauth_authorization_code', 'auth_exchange_oauth_authorization_code')),
      'table', (select jsonb_build_object('rls', relrowsecurity, 'forced', relforcerowsecurity, 'acl', relacl) from pg_class where oid = 'app.oauth_authorization_codes'::regclass),
      'indexes', (select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname = 'app' and tablename = 'oauth_authorization_codes'),
      'policies', (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname = 'app' and tablename = 'oauth_authorization_codes')
    ) as catalog
  `)
  const catalog = result.rows[0]?.catalog
  assert.ok(catalog)
  return catalog
}

async function checkRuntime(client: Client, ids: Subjects) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claims',$1,true)`, [
      JSON.stringify({ sub: ids.user, role: 'authenticated' }),
    ])
    assert.equal(
      (await client.query<{ role: string }>('select current_user as role'))
        .rows[0]?.role,
      'authenticated',
    )
    assert.equal(
      (
        await client.query<{ active: boolean }>(
          `select app.auth_is_session_active($1,$2) as active`,
          [ids.user, ids.session],
        )
      ).rows[0]?.active,
      true,
    )
    const preferences = await client.query(
      `select * from app.update_current_user_preferences('schedule','normal')`,
    )
    assert.deepEqual(preferences.rows, [
      { calendar_view_mode: 'schedule', energy_mode: 'normal' },
    ])
    await client.query(
      `update app.users set default_time_zone='UTC',last_seen_time_zone='Europe/Moscow',time_zone_mode='manual' where id=$1`,
      [ids.user],
    )
    await client.query(
      `update app.workspaces set task_completion_confetti_enabled=true,default_time_zone='UTC' where id=$1`,
      [ids.workspace],
    )
    assert.deepEqual((await client.query('select id from app.tasks')).rows, [
      { id: ids.task },
    ])
    assert.equal(
      (
        await client.query(
          `update app.tasks set title='Unauthorized' where id=$1`,
          [ids.otherTask],
        )
      ).rowCount,
      0,
    )
    assert.equal(
      (
        await client.query(
          `update app.workspaces set task_completion_confetti_enabled=true where id=$1`,
          [ids.otherWorkspace],
        )
      ).rowCount,
      0,
    )
    await client.query(
      `insert into app.chaos_inbox_items(id,workspace_id,user_id,text,source,kind,created_by,updated_by) values ($1,$2,$3,'Хлеб','voice','shopping',$3,$3)`,
      [randomUUID(), ids.workspace, ids.user],
    )
    await client.query(
      `update app.chaos_inbox_items set text='Молоко и хлеб' where id=$1`,
      [ids.purchase],
    )
    const issuedSession = randomUUID()
    const issuedRefreshHash = randomUUID()
    const exchange = await client.query<{ id: string; session_id: string }>(
      `select * from app.auth_exchange_oauth_authorization_code($1,'alice-test','https://example.test/alice',$2,$3,$4,now()+interval '1 day','migration-test',null,null)`,
      [ids.code, randomUUID(), issuedRefreshHash, issuedSession],
    )
    assert.equal(exchange.rows[0]?.id, ids.user)
    assert.equal(exchange.rows[0]?.session_id, issuedSession)
    assert.equal(
      (
        await client.query<{ active: boolean }>(
          `select app.auth_is_session_active($1,$2) as active`,
          [ids.user, issuedSession],
        )
      ).rows[0]?.active,
      true,
    )
    const rotatedRefreshHash = randomUUID()
    const refreshed = await client.query<{ id: string; session_id: string }>(
      `select * from app.auth_rotate_refresh_token($1,$2,$3,now()+interval '1 day','migration-test',null,null)`,
      [issuedRefreshHash, randomUUID(), rotatedRefreshHash],
    )
    assert.equal(refreshed.rows[0]?.id, ids.user)
    assert.equal(refreshed.rows[0]?.session_id, issuedSession)
    await client.query('select app.auth_revoke_refresh_token($1)', [
      rotatedRefreshHash,
    ])
    assert.equal(
      (
        await client.query<{ active: boolean }>(
          'select app.auth_is_session_active($1,$2) as active',
          [ids.user, issuedSession],
        )
      ).rows[0]?.active,
      false,
    )
    assert.equal(
      (
        await client.query<{ active: boolean }>(
          'select app.auth_is_session_active($1,$2) as active',
          [ids.user, ids.session],
        )
      ).rows[0]?.active,
      true,
    )
    const legacyCode = randomUUID()
    await client.query(
      `select app.auth_create_oauth_authorization_code($1,$2,$3,'alice-test','https://example.test/alice','planner',now()+interval '1 day',null,null)`,
      [legacyCode, ids.user, legacyCode],
    )
    const legacyExchange = await client.query<{ id: string }>(
      `select * from app.auth_exchange_oauth_authorization_code($1,'alice-test','https://example.test/alice',$2,$3,$4,now()+interval '1 day',null,null)`,
      [legacyCode, randomUUID(), randomUUID(), randomUUID()],
    )
    assert.equal(legacyExchange.rows[0]?.id, ids.user)
    const replay = await client.query(
      `select * from app.auth_exchange_oauth_authorization_code($1,'alice-test','https://example.test/alice',$2,$3,$4,now()+interval '1 day',null,null)`,
      [legacyCode, randomUUID(), randomUUID(), randomUUID()],
    )
    assert.equal(replay.rowCount, 0)
    await client.query(
      `select app.auth_create_oauth_authorization_code($1,$2,$3,'alice-test','https://example.test/alice','planner',now()+interval '1 day',null,null)`,
      [randomUUID(), ids.user, randomUUID()],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
  assert.equal(
    (
      await client.query<{ calendar_view_mode: string }>(
        'select calendar_view_mode from app.users where id=$1',
        [ids.otherUser],
      )
    ).rows[0]?.calendar_view_mode,
    'month',
  )
  assert.equal(
    (
      await client.query<{ title: string }>(
        'select title from app.tasks where id=$1',
        [ids.otherTask],
      )
    ).rows[0]?.title,
    'Existing task',
  )
}
