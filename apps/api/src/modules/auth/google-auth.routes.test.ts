import assert from 'node:assert/strict'
import { it } from 'node:test'

import Fastify from 'fastify'

import { HttpError } from '../../bootstrap/http-error.js'
import { MemoryRateLimiter } from '../../bootstrap/rate-limit.js'
import { registerAuthRoutes } from './auth.routes.js'
import type { AuthService } from './auth.service.js'
import type { GoogleAuthService } from './google-auth.service.js'

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: '2026-11-14T12:00:00.000Z',
  user: {
    id: '019d0000-0000-7000-8000-000000000001',
    email: 'user@example.test',
  },
}
const input = { challengeToken: 'challenge', idToken: 'google-token' }

function appFixture(enabled = true) {
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ code: error.code })
    return reply.code(500).send()
  })
  const google = {
    clientId: '123-web.apps.googleusercontent.com',
    createChallenge: () =>
      Promise.resolve({
        clientId: '123-web.apps.googleusercontent.com',
        challengeToken: 'challenge',
        nonce: 'nonce',
        expiresAt: '2026-11-14T12:00:00.000Z',
      }),
    signIn: () => Promise.resolve(session),
  } as unknown as GoogleAuthService
  registerAuthRoutes(app, {} as AuthService, {
    googleAuthService: enabled ? google : undefined,
    isSecureCookie: true,
    rateLimiter: new MemoryRateLimiter(),
    refreshCookieMaxAgeSeconds: 86400,
  })
  return app
}

void it('uses HttpOnly cookie transport for web Google sign-in and body transport for native', async () => {
  const app = appFixture()
  try {
    const web = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/sign-in',
      payload: input,
    })
    assert.equal(web.statusCode, 200)
    assert.equal(web.json<{ refreshToken?: string }>().refreshToken, undefined)
    assert.match(String(web.headers['set-cookie']), /HttpOnly/)
    assert.match(String(web.headers['set-cookie']), /Secure/)
    const native = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/sign-in',
      payload: input,
      headers: { 'x-auth-token-transport': 'body' },
    })
    assert.equal(native.statusCode, 200)
    assert.equal(
      native.json<{ refreshToken: string }>().refreshToken,
      'refresh',
    )
    assert.equal(native.headers['set-cookie'], undefined)
    assert.equal(native.headers['cache-control'], 'no-store')
  } finally {
    await app.close()
  }
})

void it('reports disabled Google and never issues a session when no client is configured', async () => {
  const app = appFixture(false)
  try {
    const config = await app.inject('/api/v1/auth/google/config')
    assert.deepEqual(config.json(), { clientId: null })
    for (const path of ['challenge', 'sign-in']) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/auth/google/${path}`,
        payload: input,
      })
      assert.equal(response.statusCode, 503)
    }
  } finally {
    await app.close()
  }
})

void it('rejects malformed inputs and rate-limits sign-in attempts', async () => {
  const app = appFixture()
  try {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/sign-in',
      payload: {},
    })
    assert.equal(malformed.statusCode, 400)
    for (let count = 0; count < 20; count++) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/google/sign-in',
        payload: input,
      })
      assert.equal(result.statusCode, 200)
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google/sign-in',
      payload: input,
    })
    assert.equal(limited.statusCode, 429)
  } finally {
    await app.close()
  }
})
