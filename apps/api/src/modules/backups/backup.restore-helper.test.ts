import assert from 'node:assert/strict'
import test from 'node:test'

import type { UserBackupArchive } from '@planner/contracts/backup'

import { HttpError } from '../../bootstrap/http-error.js'
import type { DatabaseConnection } from '../../infrastructure/db/client.js'
import {
  createUserBackupRestoreSignature,
  HttpUserBackupRestoreClient,
  parseUserBackupRestoreHelperBody,
  USER_BACKUP_RESTORE_SIGNATURE_HEADER,
  USER_BACKUP_RESTORE_TIMESTAMP_HEADER,
  verifyUserBackupRestoreSignature,
} from './backup.restore-helper.js'
import { buildUserBackupRestoreHelperApp } from './backup.restore-helper-app.js'
import { createUserBackupArchiveDigest } from './backup.service.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const SECRET = 'planner-test-restore-helper-secret-32-chars'

void test('restore helper authenticates a fresh request and rejects tampering', () => {
  const body = createRequestBody()
  const timestamp = String(Date.now())
  const signature = createUserBackupRestoreSignature(SECRET, timestamp, body)

  assert.doesNotThrow(() =>
    verifyUserBackupRestoreSignature({
      body,
      secret: SECRET,
      signature,
      timestamp,
    }),
  )
  assert.throws(
    () =>
      verifyUserBackupRestoreSignature({
        body: Buffer.concat([body, Buffer.from(' ')]),
        secret: SECRET,
        signature,
        timestamp,
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'backup_restore_helper_unauthorized',
  )
  assert.throws(
    () =>
      verifyUserBackupRestoreSignature({
        body,
        now: Number(timestamp) + 60_001,
        secret: SECRET,
        signature,
        timestamp,
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'backup_restore_helper_unauthorized',
  )
})

void test('restore helper independently validates archive digest and scope', () => {
  const body = createRequestBody()
  const parsed = parseUserBackupRestoreHelperBody(body)

  assert.equal(parsed.context.actorUserId, USER_ID)
  assert.equal(parsed.context.auth, null)

  const tampered = JSON.parse(body.toString('utf8')) as Record<string, unknown>
  tampered.archiveDigest = '0'.repeat(64)

  assert.throws(
    () =>
      parseUserBackupRestoreHelperBody(
        Buffer.from(JSON.stringify(tampered), 'utf8'),
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === 'backup_restore_digest_mismatch',
  )
})

void test('restore helper endpoint rejects unsigned calls before execution', async () => {
  let executionCount = 0
  const app = buildUserBackupRestoreHelperApp({
    database: {} as DatabaseConnection,
    executor: {
      restorePersonalWorkspace: (input) => {
        executionCount += 1

        return Promise.resolve({
          archiveDigest: input.archiveDigest,
          assets: { restored: 0, reused: 0 },
          operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          status: 'completed',
          tables: [],
          totals: {
            inserted: 0,
            kept: 0,
            resurrected: 0,
            skipped: 0,
            updated: 0,
          },
        })
      },
    },
    secret: SECRET,
  })

  try {
    const unsigned = await app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload: createRequestBody(),
      url: '/internal/user-backup/restore',
    })

    assert.equal(unsigned.statusCode, 401)
    assert.equal(executionCount, 0)

    const body = createRequestBody()
    const timestamp = String(Date.now())
    const signed = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-planner-restore-signature': createUserBackupRestoreSignature(
          SECRET,
          timestamp,
          body,
        ),
        'x-planner-restore-timestamp': timestamp,
      },
      method: 'POST',
      payload: body,
      url: '/internal/user-backup/restore',
    })

    assert.equal(signed.statusCode, 200, signed.body)
    assert.equal(executionCount, 1)
  } finally {
    await app.close()
  }
})

void test('restore helper rate-limits requests before restore execution', async () => {
  let executionCount = 0
  const app = buildUserBackupRestoreHelperApp({
    database: {} as DatabaseConnection,
    executor: {
      restorePersonalWorkspace: () => {
        executionCount += 1

        throw new Error('Restore executor must not run for unsigned requests.')
      },
    },
    secret: SECRET,
  })

  try {
    for (let requestNumber = 1; requestNumber <= 5; requestNumber += 1) {
      const response = await app.inject({
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        payload: createRequestBody(),
        url: '/internal/user-backup/restore',
      })

      assert.equal(response.statusCode, 401)
    }

    const rateLimited = await app.inject({
      headers: { 'content-type': 'text/plain' },
      method: 'POST',
      payload: 'request must be rejected before body handling',
      url: '/internal/user-backup/restore',
    })

    assert.equal(rateLimited.statusCode, 429)
    assert.equal(
      rateLimited.json<{ error: { code: string } }>().error.code,
      'rate_limit_exceeded',
    )
    assert.equal(executionCount, 0)
  } finally {
    await app.close()
  }
})

void test('API restore client signs helper requests without forwarding auth context', async () => {
  const input = parseUserBackupRestoreHelperBody(createRequestBody())
  const fetchImplementation = ((
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (typeof init?.body !== 'string') {
      throw new Error('Expected the restore client to send a string body.')
    }

    const body = Buffer.from(init.body, 'utf8')
    const headers = new Headers(init.headers)

    verifyUserBackupRestoreSignature({
      body,
      secret: SECRET,
      signature: headers.get(USER_BACKUP_RESTORE_SIGNATURE_HEADER) ?? undefined,
      timestamp: headers.get(USER_BACKUP_RESTORE_TIMESTAMP_HEADER) ?? undefined,
    })
    assert.equal(body.toString('utf8').includes('accessToken'), false)

    return Promise.resolve(
      new Response(
        JSON.stringify({
          archiveDigest: input.archiveDigest,
          assets: { restored: 0, reused: 0 },
          operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          status: 'completed',
          tables: [],
          totals: {
            inserted: 0,
            kept: 0,
            resurrected: 0,
            skipped: 0,
            updated: 0,
          },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    )
  }) as typeof fetch
  const client = new HttpUserBackupRestoreClient(
    {
      secret: SECRET,
      url: 'http://127.0.0.1:3012/internal/user-backup/restore',
    },
    fetchImplementation,
  )

  const result = await client.restorePersonalWorkspace({
    ...input,
    context: {
      ...input.context,
      auth: {
        accessToken: 'must-not-cross-helper-boundary',
        claims: {
          payload: {},
          role: 'authenticated',
          sub: USER_ID,
        },
      },
    },
  })

  assert.equal(result.status, 'completed')
})

function createRequestBody(): Buffer {
  const archive = createArchive()

  return Buffer.from(
    JSON.stringify({
      archive,
      archiveDigest: createUserBackupArchiveDigest(archive),
      context: {
        actorUserId: USER_ID,
        workspaceId: WORKSPACE_ID,
        workspaceKind: 'personal',
        workspaceName: 'Personal',
      },
      idempotencyKey: 'restore-test-00000001',
      restoreProfile: true,
      restoreWorkspaceSettings: true,
    }),
    'utf8',
  )
}

function createArchive(): UserBackupArchive {
  return {
    assets: [],
    exportedAt: '2026-08-13T00:00:00.000Z',
    format: 'planner.user-backup',
    scope: {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceKind: 'personal',
      workspaceName: 'Personal',
    },
    source: { appVersion: '1.0.0' },
    tables: {
      users: [{ id: USER_ID }],
      workspaces: [{ id: WORKSPACE_ID, owner_user_id: USER_ID }],
    },
    version: 1,
  }
}
