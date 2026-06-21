import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import type { AuthService } from '../auth/index.js'
import {
  createMcpResource,
  hashOpaqueToken,
  McpOAuthService,
  MemoryMcpOAuthTokenRepository,
} from './mcp-haotika.auth.js'
import { McpHaotikaError } from './mcp-haotika.types.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const CONFIG = {
  allowedRedirectUris: ['https://chatgpt.test/oauth/callback'],
  devNoAuth: false,
  enabled: true,
  oauthIssuer: 'https://chaotika.test',
  publicBaseUrl: 'https://chaotika.test',
  rateLimitPerMinute: 30,
}
const RESOURCE = createMcpResource(CONFIG.publicBaseUrl)

void describe('McpOAuthService', () => {
  void it('completes the authorization-code flow and stores hashed tokens only', async () => {
    const repository = new MemoryMcpOAuthTokenRepository()
    const service = new McpOAuthService(
      repository,
      CONFIG,
      createAuthServiceStub(),
    )
    const codeVerifier = 'test-code-verifier'
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url')
    const redirectUrl = await service.completeAuthorize({
      clientId: 'chatgpt',
      codeChallenge,
      codeChallengeMethod: 'S256',
      email: 'owner@example.test',
      password: 'password',
      redirectUri: 'https://chatgpt.test/oauth/callback',
      resource: RESOURCE,
      scope: 'haotika:tasks.read',
      state: 'state-1',
    })
    const code = new URL(redirectUrl).searchParams.get('code')

    assert.equal(Boolean(code), true)
    assert.equal(new URL(redirectUrl).searchParams.get('state'), 'state-1')

    const tokenResponse = await service.exchangeToken({
      clientId: 'chatgpt',
      code: code ?? undefined,
      codeVerifier,
      grantType: 'authorization_code',
      redirectUri: 'https://chatgpt.test/oauth/callback',
      resource: RESOURCE,
    })
    const storedToken = await repository.findByAccessTokenHash(
      hashOpaqueToken(tokenResponse.access_token),
    )
    const plainLookup = await repository.findByAccessTokenHash(
      tokenResponse.access_token,
    )
    const auth = await service.authenticateBearer(
      `Bearer ${tokenResponse.access_token}`,
      ['haotika:tasks.read'],
    )

    assert.equal(tokenResponse.token_type, 'Bearer')
    assert.equal(tokenResponse.scope, 'haotika:tasks.read')
    assert.equal(storedToken?.userId, USER_ID)
    assert.equal(plainLookup, null)
    assert.equal(auth.userId, USER_ID)
  })

  void it('rejects protected tools without a bearer token', async () => {
    const service = new McpOAuthService(
      new MemoryMcpOAuthTokenRepository(),
      CONFIG,
    )

    await assert.rejects(
      service.authenticateBearer(undefined, ['haotika:tasks.read']),
      (error) =>
        error instanceof McpHaotikaError &&
        error.code === 'UNAUTHORIZED' &&
        Boolean(error.wwwAuthenticate),
    )
  })

  void it('authenticates active tokens and updates last_used_at', async () => {
    const repository = new MemoryMcpOAuthTokenRepository()
    const service = new McpOAuthService(repository, CONFIG)

    await repository.createToken({
      accessTokenHash: hashOpaqueToken('access-token'),
      clientId: 'chatgpt',
      expiresAt: new Date(Date.now() + 60_000),
      issuer: CONFIG.oauthIssuer,
      refreshTokenHash: hashOpaqueToken('refresh-token'),
      resource: RESOURCE,
      scopes: ['haotika:tasks.read'],
      userId: USER_ID,
    })

    const auth = await service.authenticateBearer('Bearer access-token', [
      'haotika:tasks.read',
    ])
    const token = await repository.findByAccessTokenHash(
      hashOpaqueToken('access-token'),
    )

    assert.equal(auth.userId, USER_ID)
    assert.equal(token?.lastUsedAt !== null, true)
  })

  void it('rejects expired, revoked and insufficient-scope tokens', async () => {
    const repository = new MemoryMcpOAuthTokenRepository()
    const service = new McpOAuthService(repository, CONFIG)

    await repository.createToken({
      accessTokenHash: hashOpaqueToken('expired-token'),
      clientId: null,
      expiresAt: new Date(Date.now() - 1000),
      issuer: CONFIG.oauthIssuer,
      refreshTokenHash: null,
      resource: RESOURCE,
      scopes: ['haotika:tasks.read'],
      userId: USER_ID,
    })
    await repository.createToken({
      accessTokenHash: hashOpaqueToken('revoked-token'),
      clientId: null,
      expiresAt: new Date(Date.now() + 60_000),
      issuer: CONFIG.oauthIssuer,
      refreshTokenHash: null,
      resource: RESOURCE,
      scopes: ['haotika:tasks.read'],
      userId: USER_ID,
    })
    await repository.revokeByTokenHash(hashOpaqueToken('revoked-token'))
    await repository.createToken({
      accessTokenHash: hashOpaqueToken('limited-token'),
      clientId: null,
      expiresAt: new Date(Date.now() + 60_000),
      issuer: CONFIG.oauthIssuer,
      refreshTokenHash: null,
      resource: RESOURCE,
      scopes: ['haotika:tasks.read'],
      userId: USER_ID,
    })

    await assert.rejects(
      service.authenticateBearer('Bearer expired-token', [
        'haotika:tasks.read',
      ]),
      (error) =>
        error instanceof McpHaotikaError && error.code === 'TOKEN_EXPIRED',
    )
    await assert.rejects(
      service.authenticateBearer('Bearer revoked-token', [
        'haotika:tasks.read',
      ]),
      (error) =>
        error instanceof McpHaotikaError && error.code === 'UNAUTHORIZED',
    )
    await assert.rejects(
      service.authenticateBearer('Bearer limited-token', [
        'haotika:selfcare.read',
      ]),
      (error) =>
        error instanceof McpHaotikaError && error.code === 'FORBIDDEN_SCOPE',
    )
  })

  void it('rejects tokens minted for a different issuer or resource', async () => {
    const repository = new MemoryMcpOAuthTokenRepository()
    const service = new McpOAuthService(repository, CONFIG)

    await repository.createToken({
      accessTokenHash: hashOpaqueToken('wrong-resource-token'),
      clientId: null,
      expiresAt: new Date(Date.now() + 60_000),
      issuer: CONFIG.oauthIssuer,
      refreshTokenHash: null,
      resource: 'https://other.example/mcp',
      scopes: ['haotika:tasks.read'],
      userId: USER_ID,
    })
    await repository.createToken({
      accessTokenHash: hashOpaqueToken('wrong-issuer-token'),
      clientId: null,
      expiresAt: new Date(Date.now() + 60_000),
      issuer: 'https://issuer.example',
      refreshTokenHash: null,
      resource: RESOURCE,
      scopes: ['haotika:tasks.read'],
      userId: USER_ID,
    })

    await assert.rejects(
      service.authenticateBearer('Bearer wrong-resource-token', [
        'haotika:tasks.read',
      ]),
      (error) =>
        error instanceof McpHaotikaError && error.code === 'UNAUTHORIZED',
    )
    await assert.rejects(
      service.authenticateBearer('Bearer wrong-issuer-token', [
        'haotika:tasks.read',
      ]),
      (error) =>
        error instanceof McpHaotikaError && error.code === 'UNAUTHORIZED',
    )
  })
})

function createAuthServiceStub(): AuthService {
  return {
    signIn: () =>
      Promise.resolve({
        user: {
          id: USER_ID,
        },
      }),
  } as unknown as AuthService
}
