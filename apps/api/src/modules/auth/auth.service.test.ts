import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HttpError } from '../../bootstrap/http-error.js'
import { MemoryRateLimiter } from '../../bootstrap/rate-limit.js'
import type { AuthEmailSender } from './auth.email.js'
import type {
  PlannerAuthRuntimeConfig,
  RotateRefreshTokenPayload,
} from './auth.model.js'
import type { AuthRepository } from './auth.repository.js'
import { AuthService } from './auth.service.js'

const ROTATION_REQUEST_ID = '0198f5f2-01d0-7a3f-88cb-9cb66f8f8585'

void test('derives the same replacement for an exact refresh rotation retry', async () => {
  const calls: Array<{
    currentRefreshTokenHash: string
    nextRefreshToken: RotateRefreshTokenPayload
  }> = []
  const repository = {
    rotateRefreshToken(
      currentRefreshTokenHash: string,
      nextRefreshToken: RotateRefreshTokenPayload,
    ) {
      calls.push({ currentRefreshTokenHash, nextRefreshToken })

      return Promise.resolve({
        displayName: 'Mobile User',
        email: 'mobile@example.test',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      })
    },
  } as unknown as AuthRepository
  const service = new AuthService(
    repository,
    {
      sendPasswordResetEmail: () => Promise.resolve(),
    } satisfies AuthEmailSender,
    createAuthConfig(),
    new MemoryRateLimiter(),
  )

  const firstResponse = await service.refresh(
    'persisted-current-refresh-token',
    { deviceId: 'native-device-1' },
    ROTATION_REQUEST_ID,
  )
  const retriedResponse = await service.refresh(
    'persisted-current-refresh-token',
    { deviceId: 'native-device-1' },
    ROTATION_REQUEST_ID,
  )

  assert.equal(firstResponse.refreshToken, retriedResponse.refreshToken)
  assert.equal(calls.length, 2)
  assert.equal(
    calls[0]?.currentRefreshTokenHash,
    calls[1]?.currentRefreshTokenHash,
  )
  assert.equal(
    calls[0]?.nextRefreshToken.refreshTokenHash,
    calls[1]?.nextRefreshToken.refreshTokenHash,
  )
  assert.equal(
    calls[0]?.nextRefreshToken.refreshTokenId,
    calls[1]?.nextRefreshToken.refreshTokenId,
  )
  assert.match(
    calls[0]?.nextRefreshToken.refreshTokenId ?? '',
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

void test('derives a different replacement for a different rotation request', async () => {
  const calls: RotateRefreshTokenPayload[] = []
  const repository = {
    rotateRefreshToken(
      _currentRefreshTokenHash: string,
      nextRefreshToken: RotateRefreshTokenPayload,
    ) {
      calls.push(nextRefreshToken)

      return Promise.resolve({
        displayName: 'Mobile User',
        email: 'mobile@example.test',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      })
    },
  } as unknown as AuthRepository
  const service = new AuthService(
    repository,
    {
      sendPasswordResetEmail: () => Promise.resolve(),
    } satisfies AuthEmailSender,
    createAuthConfig(),
    new MemoryRateLimiter(),
  )

  const firstResponse = await service.refresh(
    'persisted-current-refresh-token',
    { deviceId: 'native-device-1' },
    ROTATION_REQUEST_ID,
  )
  const differentResponse = await service.refresh(
    'persisted-current-refresh-token',
    { deviceId: 'native-device-1' },
    '0198f5f2-01d1-7a3f-88cb-9cb66f8f8585',
  )

  assert.notEqual(firstResponse.refreshToken, differentResponse.refreshToken)
  assert.notEqual(calls[0]?.refreshTokenId, calls[1]?.refreshTokenId)
  assert.notEqual(calls[0]?.refreshTokenHash, calls[1]?.refreshTokenHash)
})

void test('shares credential-attempt limits across every password sign-in caller', async () => {
  const repository = {
    findCredentialByEmail: () => Promise.resolve(null),
  } as unknown as AuthRepository
  const service = new AuthService(
    repository,
    {
      sendPasswordResetEmail: () => Promise.resolve(),
    } satisfies AuthEmailSender,
    createAuthConfig(),
    new MemoryRateLimiter(),
  )
  const metadata = { ipAddress: '198.51.100.10' }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const request =
      attempt % 2 === 0
        ? service.signIn(
            { email: 'Owner@Example.Test', password: 'wrong-password' },
            metadata,
          )
        : service.createOAuthAuthorizationCode(
            {
              clientId: 'oauth-client',
              email: 'owner@example.test',
              expiresAt: new Date(Date.now() + 60_000),
              password: 'wrong-password',
              redirectUri: 'https://client.example.test/callback',
              scope: 'planner.read',
            },
            metadata,
          )

    await assert.rejects(
      request,
      (error) =>
        error instanceof HttpError && error.code === 'auth_invalid_credentials',
    )
  }

  await assert.rejects(
    service.signIn(
      { email: 'owner@example.test', password: 'wrong-password' },
      { ipAddress: '203.0.113.20' },
    ),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 429 &&
      error.code === 'rate_limit_exceeded',
  )
})

function createAuthConfig(): PlannerAuthRuntimeConfig {
  return {
    accessTokenTtlSeconds: 900,
    emailFrom: 'planner@example.test',
    jwt: {
      audience: 'planner-test',
      issuer: 'planner-test',
      secret: 'test-secret-that-is-long-enough-for-auth-service',
    },
    passwordResetTtlSeconds: 900,
    publicAppUrl: 'https://planner.example.test',
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
    smtp: null,
  }
}
