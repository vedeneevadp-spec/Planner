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
    const accessToken = await new SignJWT({
      email: 'user@example.com',
      role: 'authenticated',
      session_id: '22222222-2222-4222-8222-222222222222',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setAudience(jwtConfig.audience)
      .setExpirationTime('5m')
      .setIssuedAt()
      .setIssuer(jwtConfig.issuer)
      .setSubject('11111111-1111-4111-8111-111111111111')
      .sign(new TextEncoder().encode(jwtConfig.secret))
    const authenticator = new JwtRequestAuthenticator(jwtConfig)

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
