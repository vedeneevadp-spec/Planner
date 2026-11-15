import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MemoryRateLimiter } from '../../bootstrap/rate-limit.js'
import { MemorySessionRepository } from '../session/session.repository.memory.js'
import { SessionService } from '../session/session.service.js'
import {
  type EmailVerificationRepository,
  EmailVerificationService,
} from './email-verification.service.js'

function setup() {
  const verified = new Set<string>()
  const tokens = new Map<string, { hash: string; expires: Date }>()
  const sent: Array<{ email: string; code: string }> = []
  const repository: EmailVerificationRepository = {
    getStatus: (userId) =>
      Promise.resolve({
        email: `${userId}@example.test`,
        verified: verified.has(userId),
      }),
    request: (userId, hash, expires) => {
      tokens.set(userId, { hash, expires })
      return Promise.resolve()
    },
    confirm: (userId, hash) => {
      const token = tokens.get(userId)
      if (
        !token ||
        token.hash !== hash ||
        token.expires.getTime() <= Date.now()
      )
        return Promise.resolve(false)
      tokens.delete(userId)
      verified.add(userId)
      return Promise.resolve(true)
    },
  }
  const service = new EmailVerificationService(
    repository,
    {
      sendEmailVerificationEmail: (message) => {
        sent.push(message)
        return Promise.resolve()
      },
    },
    new MemoryRateLimiter(),
  )
  return { service, sent, tokens, verified }
}

void test('verification needs mailbox code bound to user, expires, and is single use', async () => {
  const { service, sent, tokens } = setup()
  await service.request('alice', 'ip1')
  const code = sent[0]!.code
  assert.notEqual(tokens.get('alice')?.hash, code)
  assert.equal(await service.isVerified('alice'), false)
  await assert.rejects(service.confirm('bob', code, 'ip2'), {
    code: 'email_verification_code_invalid',
  })
  await service.confirm('alice', code.toLowerCase(), 'ip1')
  assert.equal(await service.isVerified('alice'), true)
  await assert.rejects(service.confirm('alice', code, 'ip1'), {
    code: 'email_verification_code_invalid',
  })
  await service.request('bob', 'ip2')
  tokens.get('bob')!.expires = new Date(0)
  await assert.rejects(service.confirm('bob', sent[1]!.code, 'ip2'), {
    code: 'email_verification_code_invalid',
  })
})

void test('resending invalidates the previous code and repeated guessing is rate limited', async () => {
  const { service, sent } = setup()
  await service.request('alice', 'ip1')
  await service.request('alice', 'ip1')
  await assert.rejects(service.confirm('alice', sent[0]!.code, 'ip1'), {
    code: 'email_verification_code_invalid',
  })
  await service.confirm('alice', sent[1]!.code, 'ip1')
  for (let i = 0; i < 8; i++)
    await assert.rejects(service.confirm('alice', '000000000000', 'ip1'))
  await assert.rejects(service.confirm('alice', sent[1]!.code, 'ip1'), {
    statusCode: 429,
  })
})

void test('invitation service fails closed when mailbox verifier is missing or rejects proof', async () => {
  const repository = new MemorySessionRepository()
  const context = {
    actorUserId: undefined,
    workspaceId: undefined,
    auth: {
      accessToken: 'test',
      claims: {
        sub: '11111111-1111-4111-8111-111111111111',
        email: 'dev@planner.local',
        role: 'authenticated' as const,
        payload: {},
      },
    },
  }
  for (const verifier of [
    undefined,
    { isVerified: () => Promise.resolve(false) },
  ]) {
    const sessions = new SessionService(repository, undefined, verifier)
    assert.deepEqual(
      await sessions.listReceivedWorkspaceInvitations(context),
      [],
    )
    await assert.rejects(
      sessions.acceptWorkspaceInvitation(context, 'not-an-invitation'),
      { code: 'email_verification_required' },
    )
    await assert.rejects(
      sessions.declineWorkspaceInvitation(context, 'not-an-invitation'),
      { code: 'email_verification_required' },
    )
  }
})
