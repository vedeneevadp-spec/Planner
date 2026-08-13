import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { FastifyRequest } from 'fastify'
import { SignJWT } from 'jose'

import { HttpError } from '../bootstrap/http-error.js'
import { JwtRequestAuthenticator } from './auth/jwt-request-authenticator.js'

const jwtConfig = {
  audience: 'authenticated',
  issuer: 'planner-api',
  secret: 'planner-test-jwt-secret-with-at-least-32-chars',
} as const

void describe('JwtRequestAuthenticator', () => {
  void it('verifies HS256 access tokens issued by Chaotika Auth', async () => {
    const accessToken = await createAccessToken(
      '22222222-2222-4222-8222-222222222222',
    )
    const authenticator = new JwtRequestAuthenticator(jwtConfig, {
      isSessionActive: (userId, sessionId) => {
        assert.equal(userId, '11111111-1111-4111-8111-111111111111')
        assert.equal(sessionId, '22222222-2222-4222-8222-222222222222')

        return Promise.resolve(true)
      },
    })

    const authContext = await authenticator.authenticate(
      createRequest(accessToken),
    )

    assert.equal(authContext.claims.sub, '11111111-1111-4111-8111-111111111111')
    assert.equal(
      authContext.claims.sessionId,
      '22222222-2222-4222-8222-222222222222',
    )
    assert.equal(authContext.claims.email, 'user@example.com')
  })

  void it('rejects a cryptographically valid token after its session is revoked', async () => {
    const accessToken = await createAccessToken(
      '22222222-2222-4222-8222-222222222222',
    )
    const authenticator = new JwtRequestAuthenticator(jwtConfig, {
      isSessionActive: () => Promise.resolve(false),
    })

    await assert.rejects(
      authenticator.authenticate(createRequest(accessToken)),
      (error) =>
        error instanceof HttpError &&
        error.statusCode === 401 &&
        error.code === 'invalid_access_token',
    )
  })

  void it('requires a session_id when server-side session validation is enabled', async () => {
    const accessToken = await createAccessToken()
    let validationCalls = 0
    const authenticator = new JwtRequestAuthenticator(jwtConfig, {
      isSessionActive: () => {
        validationCalls += 1

        return Promise.resolve(true)
      },
    })

    await assert.rejects(
      authenticator.authenticate(createRequest(accessToken)),
      (error) =>
        error instanceof HttpError && error.code === 'invalid_access_token',
    )
    assert.equal(validationCalls, 0)
  })

  void it('rejects non-HS256 tokens as invalid access tokens', async () => {
    const authenticator = new JwtRequestAuthenticator(jwtConfig)

    await assert.rejects(
      authenticator.authenticate(createRequest(createUnsignedEs256Token())),
      (error) =>
        error instanceof HttpError &&
        error.statusCode === 401 &&
        error.code === 'invalid_access_token',
    )
  })
})

async function createAccessToken(sessionId?: string): Promise<string> {
  return new SignJWT({
    email: 'user@example.com',
    role: 'authenticated',
    ...(sessionId ? { session_id: sessionId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience(jwtConfig.audience)
    .setExpirationTime('5m')
    .setIssuedAt()
    .setIssuer(jwtConfig.issuer)
    .setSubject('11111111-1111-4111-8111-111111111111')
    .sign(new TextEncoder().encode(jwtConfig.secret))
}

function createRequest(accessToken: string): FastifyRequest {
  return {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  } as FastifyRequest
}

function createUnsignedEs256Token(): string {
  const header = base64UrlEncode(
    JSON.stringify({
      alg: 'ES256',
      typ: 'JWT',
    }),
  )
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: jwtConfig.audience,
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: jwtConfig.issuer,
      role: 'authenticated',
      sub: '11111111-1111-4111-8111-111111111111',
    }),
  )

  return `${header}.${payload}.signature`
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString('base64url')
}
