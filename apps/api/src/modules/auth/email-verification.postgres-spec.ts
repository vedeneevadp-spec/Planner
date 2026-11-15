import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { sql } from 'kysely'

import { MemoryRateLimiter } from '../../bootstrap/rate-limit.js'
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import { withOptionalRls } from '../../infrastructure/db/rls.js'
import { createSessionAuthContext } from '../session/session.repository.contract.js'
import { PostgresSessionRepository } from '../session/session.repository.postgres.js'
import { SessionService } from '../session/session.service.js'
import { PostgresAuthRepository } from './auth.repository.postgres.js'
import { PostgresEmailVerificationRepository } from './email-verification.repository.js'
import { EmailVerificationService } from './email-verification.service.js'

void test('mailbox proof gates invitation discovery, raw RLS membership and acceptance; code is single use', async () => {
  const connection = createDatabaseConnection(createDatabaseConfig())
  const runtimeConnection = process.env.TEST_RUNTIME_DATABASE_URL
    ? createDatabaseConnection({
        connectionString: process.env.TEST_RUNTIME_DATABASE_URL,
      })
    : null
  const runtimeDb = runtimeConnection?.db ?? connection.db
  const ids = [randomUUID(), randomUUID()]
  const ownerId = ids[0]!
  const inviteeId = ids[1]!
  const ownerEmail = `verify-owner-${ownerId}@example.test`
  const inviteeEmail = `verify-invitee-${inviteeId}@example.test`
  const auth = new PostgresAuthRepository(connection.db)
  const repository = new PostgresEmailVerificationRepository(runtimeDb)
  let mailboxCode = ''
  const verifier = new EmailVerificationService(
    repository,
    {
      sendEmailVerificationEmail: ({ code }) => {
        mailboxCode = code
        return Promise.resolve()
      },
    },
    new MemoryRateLimiter(),
  )
  const sessions = new SessionService(
    new PostgresSessionRepository(runtimeDb),
    undefined,
    verifier,
  )
  const ownerContext = {
    actorUserId: undefined,
    workspaceId: undefined,
    auth: createSessionAuthContext({ email: ownerEmail, userId: ownerId }),
  }
  const inviteeContext = {
    actorUserId: undefined,
    workspaceId: undefined,
    auth: createSessionAuthContext({ email: inviteeEmail, userId: inviteeId }),
  }
  try {
    for (const [userId, email] of [
      [ownerId, ownerEmail],
      [inviteeId, inviteeEmail],
    ] as const)
      await auth.createUserWithCredential({
        userId,
        email,
        displayName: 'Verification fixture',
        passwordHash: 'unusable-test-hash',
      })
    const shared = await sessions.createSharedWorkspace(ownerContext, {
      name: 'Verified members only',
    })
    const invitation = await sessions.createWorkspaceInvitation(
      { ...ownerContext, workspaceId: shared.id },
      { email: inviteeEmail, groupRole: 'member' },
    )
    assert.equal(await verifier.isVerified(inviteeId), false)
    assert.deepEqual(
      await sessions.listReceivedWorkspaceInvitations(inviteeContext),
      [],
    )
    await assert.rejects(
      sessions.acceptWorkspaceInvitation(inviteeContext, invitation.id),
      { code: 'email_verification_required' },
    )

    const visible = await withOptionalRls(
      connection.db,
      inviteeContext.auth,
      (db) =>
        sql<{
          id: string
        }>`select id from app.workspace_invitations where id = ${invitation.id}::uuid`.execute(
          db,
        ),
    )
    assert.equal(visible.rows.length, 0)
    await assert.rejects(
      withOptionalRls(connection.db, inviteeContext.auth, (db) =>
        sql`insert into app.workspace_members (id, workspace_id, user_id, role, group_role) values (${randomUUID()}::uuid, ${shared.id}::uuid, ${inviteeId}::uuid, 'user', 'member')`.execute(
          db,
        ),
      ),
      { code: '42501' },
    )
    const direct = await withOptionalRls(
      connection.db,
      inviteeContext.auth,
      (db) =>
        sql<{
          accepted: boolean
        }>`select app.accept_workspace_invitation(${invitation.id}::uuid) as accepted`.execute(
          db,
        ),
    )
    assert.equal(direct.rows[0]?.accepted, false)
    await assert.rejects(
      withOptionalRls(connection.db, inviteeContext.auth, (db) =>
        sql`update app.users set email_verified_at = now() where id = ${inviteeId}::uuid`.execute(
          db,
        ),
      ),
      { code: '42501' },
    )
    await assert.rejects(
      withOptionalRls(connection.db, inviteeContext.auth, (db) =>
        sql`select app.auth_request_email_verification(${inviteeId}::uuid, 'forged-proof', now() + interval '10 minutes')`.execute(
          db,
        ),
      ),
      { code: '42501' },
    )
    await assert.rejects(
      withOptionalRls(connection.db, inviteeContext.auth, (db) =>
        sql`select app.auth_confirm_email_verification(${inviteeId}::uuid, 'forged-proof')`.execute(
          db,
        ),
      ),
      { code: '42501' },
    )
    await assert.rejects(
      withOptionalRls(connection.db, inviteeContext.auth, (db) =>
        sql`select * from app.auth_complete_google_sign_in(${randomUUID()}, ${inviteeEmail}::public.citext, 'Forged provider', ${randomUUID()}::uuid, ${inviteeId}::uuid, ${randomUUID()}, now() + interval '5 minutes')`.execute(
          db,
        ),
      ),
      { code: '42501' },
    )

    // Managed deployments connect directly as authenticated, without user RLS
    // claims during auth operations. This must remain a working runtime mode.
    await connection.db.transaction().execute(async (db) => {
      await sql`set local role authenticated`.execute(db)
      const managed = new PostgresEmailVerificationRepository(db)
      assert.equal((await managed.getStatus(ownerId))?.verified, false)
      await managed.request(
        ownerId,
        'synthetic-managed-proof',
        new Date(Date.now() + 60_000),
      )
      assert.equal(await managed.confirm(ownerId, 'wrong-proof'), false)
      assert.equal(
        await managed.confirm(ownerId, 'synthetic-managed-proof'),
        true,
      )
      assert.equal((await managed.getStatus(ownerId))?.verified, true)
    })

    await verifier.request(inviteeId, 'test-ip')
    assert.match(mailboxCode, /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/)
    await assert.rejects(verifier.confirm(ownerId, mailboxCode, 'other-ip'), {
      code: 'email_verification_code_invalid',
    })
    const outcomes = await Promise.allSettled([
      verifier.confirm(inviteeId, mailboxCode, 'test-ip'),
      verifier.confirm(inviteeId, mailboxCode, 'test-ip'),
    ])
    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      1,
    )
    assert.deepEqual(
      (await sessions.listReceivedWorkspaceInvitations(inviteeContext)).map(
        (item) => item.id,
      ),
      [invitation.id],
    )
    await sessions.acceptWorkspaceInvitation(inviteeContext, invitation.id)
    const member = await sessions.resolveSession({
      ...inviteeContext,
      workspaceId: shared.id,
    })
    assert.equal(member.groupRole, 'member')
  } finally {
    await connection.pool.query(
      'delete from app.workspaces where owner_user_id = any($1::uuid[])',
      [ids],
    )
    await connection.pool.query(
      'delete from app.users where id = any($1::uuid[])',
      [ids],
    )
    await destroyDatabaseConnection(connection)
    if (runtimeConnection) await destroyDatabaseConnection(runtimeConnection)
  }
})
