import assert from 'node:assert/strict'
import { test } from 'node:test'

import Fastify from 'fastify'

import { MemoryRateLimiter } from '../../bootstrap/rate-limit.js'
import { registerEmailVerificationRoutes } from './email-verification.routes.js'
import { EmailVerificationService } from './email-verification.service.js'

void test('verification routes require authentication and bind all actions to the authenticated user', async (context) => {
  const users: string[] = []
  const delivered: Array<{ email: string; code: string }> = []
  const hashes = new Map<string, string>()
  let verified = false
  const service = new EmailVerificationService(
    {
      getStatus(userId) {
        users.push(userId)
        return Promise.resolve({ email: 'alice@example.test', verified })
      },
      request(userId, hash) {
        users.push(userId)
        hashes.set(userId, hash)
        return Promise.resolve()
      },
      confirm(userId, hash) {
        users.push(userId)
        verified = hashes.get(userId) === hash
        hashes.delete(userId)
        return Promise.resolve(verified)
      },
    },
    {
      sendEmailVerificationEmail(message) {
        delivered.push(message)
        return Promise.resolve()
      },
    },
    new MemoryRateLimiter(),
  )
  const app = Fastify()
  context.after(() => app.close())
  app.addHook('onRequest', (request, _reply, done) => {
    request.authContext =
      request.headers.authorization === 'Bearer alice'
        ? {
            accessToken: 'alice',
            claims: { sub: 'alice', role: 'authenticated', payload: {} },
          }
        : null
    done()
  })
  registerEmailVerificationRoutes(app, service)
  for (const [method, url] of [
    ['GET', '/api/v1/email-verification'],
    ['POST', '/api/v1/email-verification/request'],
    ['POST', '/api/v1/email-verification/confirm'],
  ] as const) {
    const denied = await app.inject({ method, url })
    assert.equal(denied.statusCode, 401)
  }
  assert.equal(users.length, 0)
  const headers = { authorization: 'Bearer alice' }
  const sent = await app.inject({
    method: 'POST',
    url: '/api/v1/email-verification/request',
    headers,
    payload: { userId: 'bob', email: 'bob@example.test' },
  })
  assert.equal(sent.statusCode, 204)
  assert.equal(delivered[0]?.email, 'alice@example.test')
  const malformed = await app.inject({
    method: 'POST',
    url: '/api/v1/email-verification/confirm',
    headers,
    payload: { code: 'wrong' },
  })
  assert.equal(malformed.statusCode, 400)
  const confirmed = await app.inject({
    method: 'POST',
    url: '/api/v1/email-verification/confirm',
    headers,
    payload: { userId: 'bob', code: delivered[0].code },
  })
  assert.equal(confirmed.statusCode, 200)
  assert.equal(confirmed.headers['cache-control'], 'no-store')
  assert.deepEqual(confirmed.json(), {
    email: 'alice@example.test',
    verified: true,
  })
  assert.ok(users.every((userId) => userId === 'alice'))
})
