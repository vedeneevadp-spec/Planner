import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { userBackupArchiveSchema } from '@planner/contracts'

import {
  createDatabaseConnection,
  type DatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import { createSessionAuthContext } from '../session/session.repository.contract.js'
import { PostgresUserBackupRepository } from './backup.repository.postgres.js'

let assetDirectory: string
let connection: DatabaseConnection

void before(async () => {
  connection = createDatabaseConnection(createDatabaseConfig())
  assetDirectory = await mkdtemp(path.join(tmpdir(), 'planner-backup-test-'))
})

void after(async () => {
  if (connection) {
    await destroyDatabaseConnection(connection)
  }

  if (assetDirectory) {
    await rm(assetDirectory, { force: true, recursive: true })
  }
})

void test('PostgresUserBackupRepository exports a strict runtime-RLS snapshot', async () => {
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const membershipId = randomUUID()
  const email = `backup-contract-${userId}@example.test`

  try {
    await connection.pool.query(
      `
        insert into app.users (id, email, display_name)
        values ($1, $2, 'Backup contract')
      `,
      [userId, email],
    )
    await connection.pool.query(
      `
        insert into app.workspaces (
          id,
          owner_user_id,
          name,
          slug,
          kind,
          description
        )
        values ($1, $2, 'Backup contract', $3, 'personal', '')
      `,
      [workspaceId, userId, `backup-${userId.replaceAll('-', '')}`],
    )
    await connection.pool.query(
      `
        insert into app.workspace_members (
          id,
          workspace_id,
          user_id,
          role
        )
        values ($1, $2, $3, 'owner')
      `,
      [membershipId, workspaceId, userId],
    )

    const repository = new PostgresUserBackupRepository(
      connection.db,
      assetDirectory,
    )
    const archive = await repository.exportPersonalWorkspace({
      appVersion: '1.2.3',
      context: {
        actorUserId: userId,
        auth: createSessionAuthContext({ email, userId }),
        workspaceId,
        workspaceKind: 'personal',
        workspaceName: 'Backup contract',
      },
    })

    assert.equal(userBackupArchiveSchema.safeParse(archive).success, true)
    assert.equal(archive.scope.userId, userId)
    assert.equal(archive.scope.workspaceId, workspaceId)
    assert.equal(archive.tables.users?.length, 1)
    assert.equal(archive.tables.workspaces?.length, 1)
  } finally {
    await connection.pool.query(
      `delete from app.workspace_members where user_id = $1`,
      [userId],
    )
    await connection.pool.query(
      `delete from app.workspaces where owner_user_id = $1`,
      [userId],
    )
    await connection.pool.query(`delete from app.users where id = $1`, [userId])
  }
})
