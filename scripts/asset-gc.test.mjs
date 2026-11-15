import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { Client } from 'pg'

import {
  applyAssetCollection,
  assertNoOtherDatabaseSessions,
  planAssetCollection,
  readOtherDatabaseSessions,
} from './asset-gc.mjs'
import { createPgConnectionConfig } from './pg-connection-config.mjs'

void test('GC protects live, retained backup and recent files; only collects unchanged old orphans', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'planner-gc-'))
  try {
    await mkdir(path.join(root, 'profiles'))
    for (const file of [
      'live.png',
      'backup.png',
      'profiles/orphan.png',
      'recent.png',
    ]) {
      await writeFile(path.join(root, file), file)
      if (file !== 'recent.png') await utimes(path.join(root, file), 0, 0)
    }
    const plan = await planAssetCollection({
      assetDirectory: root,
      liveReferences: ['live.png'],
      backupReferences: ['backup.png'],
    })
    assert.deepEqual(
      plan.map((file) => file.path),
      ['profiles/orphan.png'],
    )
    await applyAssetCollection(root, plan)
    assert.equal(
      await readFile(path.join(root, 'live.png'), 'utf8'),
      'live.png',
    )
    assert.equal(
      await readFile(path.join(root, 'backup.png'), 'utf8'),
      'backup.png',
    )
    await assert.rejects(readFile(path.join(root, 'profiles/orphan.png')), {
      code: 'ENOENT',
    })
    assert.throws(
      () => assertNoOtherDatabaseSessions([{ pid: 42 }]),
      /requires/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
void test('GC fails closed on symlinks and a changed file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'planner-gc-'))
  try {
    await writeFile(path.join(root, 'old.png'), 'old')
    await utimes(path.join(root, 'old.png'), 0, 0)
    const plan = await planAssetCollection({
      assetDirectory: root,
      liveReferences: [],
      backupReferences: [],
    })
    await writeFile(path.join(root, 'old.png'), 'changed')
    await assert.rejects(applyAssetCollection(root, plan), /changed/)
    await symlink(path.join(root, 'old.png'), path.join(root, 'link'))
    await assert.rejects(
      planAssetCollection({
        assetDirectory: root,
        liveReferences: [],
        backupReferences: [],
      }),
      /Symlink/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

void test(
  'GC sees a new database connection even after a stats snapshot was cached',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const config = createPgConnectionConfig(process.env.DATABASE_URL)
    const observer = new Client(config)
    const newcomer = new Client(config)
    try {
      await observer.connect()
      await observer.query('begin isolation level repeatable read read only')
      await readOtherDatabaseSessions(observer)
      await newcomer.connect()
      const {
        rows: [{ pid }],
      } = await newcomer.query('select pg_backend_pid() as pid')
      const cached = await observer.query(
        'select pid from pg_stat_activity where pid=$1',
        [pid],
      )
      assert.equal(
        cached.rows.length,
        0,
        'the initial snapshot must not already contain the new connection',
      )
      const fresh = await readOtherDatabaseSessions(observer)
      assert.ok(fresh.some((row) => row.pid === pid))
      assert.throws(() => assertNoOtherDatabaseSessions(fresh), /requires/)
    } finally {
      await newcomer.end()
      await observer.end()
    }
  },
)
