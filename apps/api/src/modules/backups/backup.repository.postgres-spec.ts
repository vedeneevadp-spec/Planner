import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { userBackupArchiveSchema } from '@planner/contracts/backup'

import { HttpError } from '../../bootstrap/http-error.js'
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
  const selfCareItemId = randomUUID()
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
    await connection.pool.query(
      `
        insert into app.self_care_items (
          id,
          workspace_id,
          user_id,
          title,
          type,
          category,
          created_by,
          updated_by
        )
        values ($1, $2, $3, 'Backup state', 'ritual', 'daily_base', $3, $3)
      `,
      [selfCareItemId, workspaceId, userId],
    )
    await connection.pool.query(
      `
        insert into app.self_care_completions (
          item_id,
          user_id,
          status,
          completed_at
        )
        values ($1, $2, 'done', '2026-08-06T08:00:00.000Z')
      `,
      [selfCareItemId, userId],
    )
    await connection.pool.query(
      `
        insert into app.self_care_ritual_step_drafts (
          workspace_id,
          user_id,
          item_id,
          date
        )
        values ($1, $2, $3, '2026-08-06')
      `,
      [workspaceId, userId, selfCareItemId],
    )
    await connection.pool.query(
      `
        insert into app.self_care_daily_states (user_id, date)
        values ($1, '2026-08-06')
      `,
      [userId],
    )
    await connection.pool.query(
      `insert into app.self_care_settings (user_id) values ($1)`,
      [userId],
    )
    await connection.pool.query(
      `
        insert into app.self_care_minimum_items (user_id, title)
        values ($1, 'Минимум')
      `,
      [userId],
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
    for (const tableName of [
      'self_care_completions',
      'self_care_daily_states',
      'self_care_minimum_items',
      'self_care_ritual_step_drafts',
      'self_care_settings',
    ] as const) {
      assert.equal(archive.tables[tableName]?.[0]?.version, 1)
    }
    assert.equal(
      typeof archive.tables.self_care_completions?.[0]?.updated_at,
      'string',
    )
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

void test('PostgresUserBackupRepository restores missing rows idempotently', async () => {
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const membershipId = randomUUID()
  const projectId = randomUUID()
  const taskId = randomUUID()
  const email = `backup-restore-${userId}@example.test`
  const auth = createSessionAuthContext({ email, userId })
  const context = {
    actorUserId: userId,
    auth,
    workspaceId,
    workspaceKind: 'personal' as const,
    workspaceName: 'Backup restore',
  }

  try {
    await connection.pool.query(
      `
        insert into app.users (id, email, display_name)
        values ($1, $2, 'Backup restore')
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
        values ($1, $2, 'Backup restore', $3, 'personal', '')
      `,
      [workspaceId, userId, `restore-${userId.replaceAll('-', '')}`],
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
    await connection.pool.query(
      `
        insert into app.projects (
          id,
          workspace_id,
          title,
          slug,
          created_by,
          updated_by
        )
        values ($1, $2, 'Restored project', 'restored-project', $3, $3)
      `,
      [projectId, workspaceId, userId],
    )
    await connection.pool.query(
      `
        insert into app.tasks (
          id,
          workspace_id,
          project_id,
          title,
          created_by,
          updated_by
        )
        values ($1, $2, $3, 'Restored task', $4, $4)
      `,
      [taskId, workspaceId, projectId, userId],
    )
    await connection.pool.query(
      `
        insert into app.self_care_settings (user_id, version)
        values ($1, 7)
      `,
      [userId],
    )

    const repository = new PostgresUserBackupRepository(
      connection.db,
      assetDirectory,
    )
    const archive = await repository.exportPersonalWorkspace({
      appVersion: '1.2.3',
      context,
    })

    await connection.pool.query(`delete from app.tasks where id = $1`, [taskId])
    await connection.pool.query(`delete from app.projects where id = $1`, [
      projectId,
    ])
    await connection.pool.query(
      `delete from app.self_care_settings where user_id = $1`,
      [userId],
    )

    const input = {
      archive,
      archiveDigest: 'a'.repeat(64),
      context,
      idempotencyKey: `backup-restore-${randomUUID()}`,
      restoreProfile: true,
      restoreWorkspaceSettings: true,
    }
    const restored = await repository.restorePersonalWorkspace(input)
    const retried = await repository.restorePersonalWorkspace(input)
    const rows = await connection.pool.query<{
      project_title: string
      task_title: string
    }>(
      `
        select
          projects.title as project_title,
          tasks.title as task_title
        from app.tasks
        join app.projects on projects.id = tasks.project_id
        where tasks.id = $1
      `,
      [taskId],
    )
    const restoredSettings = await connection.pool.query<{ version: string }>(
      `select version::text from app.self_care_settings where user_id = $1`,
      [userId],
    )

    assert.deepEqual(retried, restored)
    assert.equal(rows.rows[0]?.project_title, 'Restored project')
    assert.equal(rows.rows[0]?.task_title, 'Restored task')
    assert.equal(Number(restoredSettings.rows[0]?.version), 7)
    assert.equal(
      restored.tables.find((table) => table.name === 'projects')?.inserted,
      1,
    )
    assert.equal(
      restored.tables.find((table) => table.name === 'tasks')?.inserted,
      1,
    )

    await assert.rejects(
      () =>
        repository.restorePersonalWorkspace({
          ...input,
          archiveDigest: 'b'.repeat(64),
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === 'backup_restore_idempotency_mismatch',
    )

    await connection.pool.query(
      `update app.projects set deleted_at = now() where id = $1`,
      [projectId],
    )
    const resurrected = await repository.restorePersonalWorkspace({
      ...input,
      idempotencyKey: `backup-restore-${randomUUID()}`,
    })
    const resurrectedProject = await connection.pool.query<{
      deleted_at: Date | null
    }>(`select deleted_at from app.projects where id = $1`, [projectId])

    assert.equal(resurrectedProject.rows[0]?.deleted_at, null)
    assert.equal(
      resurrected.tables.find((table) => table.name === 'projects')
        ?.resurrected,
      1,
    )

    await connection.pool.query(`delete from app.tasks where id = $1`, [taskId])
    await connection.pool.query(`delete from app.projects where id = $1`, [
      projectId,
    ])
    const conflictingProjectId = randomUUID()

    await connection.pool.query(
      `
        insert into app.projects (
          id,
          workspace_id,
          title,
          slug,
          created_by,
          updated_by
        )
        values ($1, $2, 'Conflicting project', 'restored-project', $3, $3)
      `,
      [conflictingProjectId, workspaceId, userId],
    )

    const rollbackIdempotencyKey = `backup-restore-${randomUUID()}`

    await assert.rejects(
      () =>
        repository.restorePersonalWorkspace({
          ...input,
          idempotencyKey: rollbackIdempotencyKey,
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === 'backup_restore_conflict',
    )

    const rolledBackState = await connection.pool.query<{
      operation_count: number
      project_count: number
      task_count: number
    }>(
      `
        select
          (
            select count(*)::int
            from app.user_backup_restore_operations
            where workspace_id = $1
              and idempotency_key = $4
          ) as operation_count,
          (
            select count(*)::int
            from app.projects
            where id = $2
          ) as project_count,
          (
            select count(*)::int
            from app.tasks
            where id = $3
          ) as task_count
      `,
      [workspaceId, projectId, taskId, rollbackIdempotencyKey],
    )

    assert.deepEqual(rolledBackState.rows[0], {
      operation_count: 0,
      project_count: 0,
      task_count: 0,
    })
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
