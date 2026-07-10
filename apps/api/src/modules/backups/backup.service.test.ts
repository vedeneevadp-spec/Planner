import assert from 'node:assert/strict'
import test from 'node:test'

import {
  type UserBackupArchive,
  userBackupArchiveSchema,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import type { UserBackupContext } from './backup.model.js'
import type { UserBackupRepository } from './backup.repository.js'
import {
  normalizeUserBackupTableReferences,
  USER_BACKUP_EXPORTED_TABLE_NAMES,
} from './backup.repository.postgres.js'
import { UserBackupService } from './backup.service.js'

const AUTH_CONTEXT: AuthenticatedRequestContext = {
  accessToken: 'token',
  claims: {
    payload: {},
    role: 'authenticated',
    sub: 'user-1',
  },
}

const PERSONAL_CONTEXT: UserBackupContext = {
  actorUserId: 'user-1',
  auth: AUTH_CONTEXT,
  workspaceId: 'workspace-1',
  workspaceKind: 'personal',
  workspaceName: 'Personal',
}

void test('UserBackupService exports authenticated personal workspaces', async () => {
  const repository = new FakeUserBackupRepository()
  const service = new UserBackupService(repository, '1.2.3')

  const archive = await service.exportBackup(PERSONAL_CONTEXT)

  assert.equal(repository.exportCount, 1)
  assert.equal(archive.source.appVersion, '1.2.3')
  assert.equal(archive.scope.userId, 'user-1')
})

void test('UserBackupService rejects unauthenticated export', async () => {
  const service = new UserBackupService(new FakeUserBackupRepository(), '1.2.3')

  await assert.rejects(
    Promise.resolve().then(() =>
      service.exportBackup({
        ...PERSONAL_CONTEXT,
        auth: null,
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError && error.code === 'authentication_required',
  )
})

void test('UserBackupService rejects shared workspace export', async () => {
  const service = new UserBackupService(new FakeUserBackupRepository(), '1.2.3')

  await assert.rejects(
    Promise.resolve().then(() =>
      service.exportBackup({
        ...PERSONAL_CONTEXT,
        workspaceKind: 'shared',
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'backup_personal_workspace_required',
  )
})

void test('UserBackupService previews archive warnings', () => {
  const service = new UserBackupService(new FakeUserBackupRepository(), '1.2.3')
  const archive = createArchive({
    userId: 'user-2',
    workspaceId: 'workspace-2',
  })
  const preview = service.previewImport(PERSONAL_CONTEXT, archive)

  assert.equal(preview.canRestore, false)
  assert.deepEqual(preview.warnings, [
    'Archive belongs to a different user.',
    'Archive belongs to a different workspace.',
  ])
  assert.deepEqual(preview.tables, [
    {
      count: 1,
      name: 'tasks',
    },
    {
      count: 1,
      name: 'users',
    },
    {
      count: 1,
      name: 'workspaces',
    },
  ])
})

void test('UserBackupService previews archive integrity warnings', () => {
  const service = new UserBackupService(new FakeUserBackupRepository(), '1.2.3')
  const archive = createArchive({
    assets: [
      {
        base64: Buffer.from('asset').toString('base64'),
        byteLength: 100,
        contentType: 'image/png',
        kind: 'emoji_asset',
        path: '/api/v1/icon-assets/asset.png',
      },
    ],
    tables: {
      tasks: [
        {
          id: 'task-1',
          project_id: 'missing-project',
          title: 'Task',
        },
      ],
      users: [
        {
          avatar_url: '/api/v1/profile-assets/missing-avatar.webp',
          id: 'user-1',
        },
      ],
    },
  })
  const preview = service.previewImport(PERSONAL_CONTEXT, archive)

  assert.equal(preview.canRestore, false)
  assert.deepEqual(preview.warnings, [
    'Archive has 1 row(s) with missing parent references: tasks.project_id -> projects.id.',
    'Archive references 1 local asset file(s) without payload.',
    'Archive contains 1 asset payload(s) with invalid byte length.',
    'Archive contains 1 asset payload(s) whose bytes do not match content type.',
  ])
})

void test('user backup v1 schema rejects unknown columns and malformed payloads', () => {
  const result = userBackupArchiveSchema.safeParse({
    ...createArchive({
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }),
    assets: [
      {
        base64: '!!!!',
        byteLength: 3,
        contentType: 'image/png',
        kind: 'profile_avatar',
        path: '/api/v1/profile-assets/avatar.png',
      },
    ],
    tables: {
      tasks: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          title: { malformed: true },
          unknown_future_column: 'must not drift into v1',
        },
      ],
    },
  })

  assert.equal(result.success, false)
  assert.match(
    result.error?.issues.map((issue) => issue.message).join('\n') ?? '',
    /Unrecognized key|Invalid string/,
  )
})

void test('UserBackupService rejects duplicate and cross-scope rows in preview', () => {
  const service = new UserBackupService(new FakeUserBackupRepository(), '1.2.3')
  const archive = createArchive({
    tables: {
      tasks: [
        {
          id: 'task-1',
          title: 'First',
          created_by: 'user-2',
          workspace_id: 'workspace-2',
        },
        {
          id: 'task-1',
          title: 'Duplicate',
        },
      ],
    },
  })
  const preview = service.previewImport(PERSONAL_CONTEXT, archive)

  assert.equal(preview.canRestore, false)
  assert.deepEqual(preview.warnings, [
    'Archive table tasks contains 1 duplicate identifier(s).',
    'Archive contains 1 row(s) outside its user scope.',
    'Archive contains 1 row(s) outside its workspace scope.',
  ])
})

void test('user backup export excludes the global emoji library', () => {
  assert.equal(USER_BACKUP_EXPORTED_TABLE_NAMES.includes('emoji_sets'), false)
  assert.equal(USER_BACKUP_EXPORTED_TABLE_NAMES.includes('emoji_assets'), false)
})

void test('user backup export removes daily plan references to excluded tasks', () => {
  const tables = normalizeUserBackupTableReferences({
    daily_plans: [
      {
        focus_task_ids: ['task-exported', 'task-excluded'],
        id: 'plan-1',
        routine_task_ids: [],
        support_task_ids: ['task-excluded'],
      },
    ],
    tasks: [{ id: 'task-exported' }],
  })

  assert.deepEqual(tables.daily_plans, [
    {
      focus_task_ids: ['task-exported'],
      id: 'plan-1',
      routine_task_ids: [],
      support_task_ids: [],
    },
  ])
})

class FakeUserBackupRepository implements UserBackupRepository {
  exportCount = 0

  exportPersonalWorkspace(): Promise<UserBackupArchive> {
    this.exportCount += 1

    return Promise.resolve(createArchive())
  }
}

function createArchive(
  overrides: {
    assets?: UserBackupArchive['assets']
    tables?: UserBackupArchive['tables']
    userId?: string
    workspaceId?: string
  } = {},
): UserBackupArchive {
  return {
    assets: overrides.assets ?? [],
    exportedAt: '2026-07-07T00:00:00.000Z',
    format: 'planner.user-backup',
    scope: {
      userId: overrides.userId ?? 'user-1',
      workspaceId: overrides.workspaceId ?? 'workspace-1',
      workspaceKind: 'personal',
      workspaceName: 'Personal',
    },
    source: {
      appVersion: '1.2.3',
    },
    tables: {
      tasks: overrides.tables?.tasks ?? [{ id: 'task-1', title: 'Task' }],
      users: overrides.tables?.users ?? [{ id: overrides.userId ?? 'user-1' }],
      workspaces: overrides.tables?.workspaces ?? [
        {
          id: overrides.workspaceId ?? 'workspace-1',
          owner_user_id: overrides.userId ?? 'user-1',
        },
      ],
      ...overrides.tables,
    },
    version: 1,
  }
}
