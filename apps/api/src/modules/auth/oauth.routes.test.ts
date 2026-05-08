import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { sessionResponseSchema } from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { buildApiApp } from '../../bootstrap/build-app.js'
import { createApiConfig } from '../../bootstrap/config.js'
import { JwtRequestAuthenticator } from '../../infrastructure/auth/jwt-request-authenticator.js'
import { MemoryProjectRepository, ProjectService } from '../projects/index.js'
import { MemorySessionRepository, SessionService } from '../session/index.js'
import { MemoryTaskRepository, TaskService } from '../tasks/index.js'
import { NoopAuthEmailSender } from './auth.email.js'
import type {
  AuthCredentialRecord,
  AuthSessionTokenRecord,
  AuthUserRecord,
  CompletePasswordResetCommand,
  CreateAuthUserCommand,
  CreateOAuthAuthorizationCodeCommand,
  CreatePasswordResetTokenCommand,
  CreateRefreshTokenCommand,
  CreateRefreshTokenPayload,
  ExchangeOAuthAuthorizationCodeCommand,
  UpdatePasswordCommand,
} from './auth.model.js'
import type { AuthRepository } from './auth.repository.js'
import { AuthService } from './auth.service.js'

const JWT_SECRET = 'planner-test-jwt-secret-with-at-least-32-chars'
const ALICE_CLIENT_ID = 'alice-client'
const ALICE_CLIENT_SECRET = 'alice-secret'
const ALICE_REDIRECT_URI = 'https://social.yandex.net/broker/redirect'

const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().nonnegative(),
  refresh_token: z.string().min(1),
  token_type: z.literal('Bearer'),
})

const oauthErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
})

void describe('OAuth routes', () => {
  let app: FastifyInstance | null = null

  void afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  void it('exchanges an Alice account-linking authorization code for planner tokens', async () => {
    const setup = await createOAuthTestApp()

    app = setup.app

    const authorizeResponse = await app.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      payload: createFormBody({
        client_id: ALICE_CLIENT_ID,
        email: 'alice@planner.local',
        password: 'secret-password',
        redirect_uri: ALICE_REDIRECT_URI,
        response_type: 'code',
        scope: 'tasks shopping',
        state: 'yandex-state',
      }),
      url: '/api/v1/oauth/alice/authorize',
    })

    assert.equal(authorizeResponse.statusCode, 302)

    const redirectLocationHeader = authorizeResponse.headers.location

    if (typeof redirectLocationHeader !== 'string') {
      throw new Error('OAuth authorize response must include Location header.')
    }

    const redirectUrl = new URL(redirectLocationHeader)
    const code = redirectUrl.searchParams.get('code')

    assert.equal(redirectUrl.origin + redirectUrl.pathname, ALICE_REDIRECT_URI)
    assert.equal(redirectUrl.searchParams.get('state'), 'yandex-state')

    if (!code) {
      throw new Error('OAuth redirect must include authorization code.')
    }

    const tokenResponse = await app.inject({
      headers: {
        authorization: `Basic ${Buffer.from(
          `${ALICE_CLIENT_ID}:${ALICE_CLIENT_SECRET}`,
        ).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      payload: createFormBody({
        client_id: ALICE_CLIENT_ID,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ALICE_REDIRECT_URI,
      }),
      url: '/api/v1/oauth/alice/token',
    })

    assert.equal(tokenResponse.statusCode, 200)

    const token = oauthTokenResponseSchema.parse(tokenResponse.json())

    assert.equal(token.token_type, 'Bearer')

    const sessionResponse = await app.inject({
      headers: {
        authorization: `Bearer ${token.access_token}`,
      },
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(sessionResponse.statusCode, 200)

    const session = sessionResponseSchema.parse(sessionResponse.json())

    assert.equal(session.actor.email, 'alice@planner.local')

    const reuseResponse = await app.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      payload: createFormBody({
        client_id: ALICE_CLIENT_ID,
        client_secret: ALICE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ALICE_REDIRECT_URI,
      }),
      url: '/api/v1/oauth/alice/token',
    })

    assert.equal(reuseResponse.statusCode, 400)
    assert.equal(
      oauthErrorResponseSchema.parse(reuseResponse.json()).error,
      'invalid_grant',
    )
  })

  void it('refreshes Alice account-linking tokens', async () => {
    const setup = await createOAuthTestApp()

    app = setup.app

    const code = await setup.service.createOAuthAuthorizationCode(
      {
        clientId: ALICE_CLIENT_ID,
        email: 'alice@planner.local',
        expiresAt: new Date(Date.now() + 300_000),
        password: 'secret-password',
        redirectUri: ALICE_REDIRECT_URI,
        scope: '',
      },
      {},
    )
    const initialTokenResponse = await app.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      payload: createFormBody({
        client_id: ALICE_CLIENT_ID,
        client_secret: ALICE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ALICE_REDIRECT_URI,
      }),
      url: '/api/v1/oauth/alice/token',
    })
    const initialToken = oauthTokenResponseSchema.parse(
      initialTokenResponse.json(),
    )
    const refreshResponse = await app.inject({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      payload: createFormBody({
        client_id: ALICE_CLIENT_ID,
        client_secret: ALICE_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: initialToken.refresh_token,
      }),
      url: '/api/v1/oauth/alice/token',
    })

    assert.equal(refreshResponse.statusCode, 200)

    const refreshedToken = oauthTokenResponseSchema.parse(
      refreshResponse.json(),
    )

    assert.notEqual(refreshedToken.access_token, initialToken.access_token)
    assert.notEqual(refreshedToken.refresh_token, initialToken.refresh_token)
  })
})

async function createOAuthTestApp(): Promise<{
  app: FastifyInstance
  service: AuthService
}> {
  const config = createApiConfig({
    ALICE_OAUTH_CLIENT_ID: ALICE_CLIENT_ID,
    ALICE_OAUTH_CLIENT_SECRET: ALICE_CLIENT_SECRET,
    API_AUTH_MODE: 'jwt',
    API_STORAGE_DRIVER: 'memory',
    AUTH_JWT_SECRET: JWT_SECRET,
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv)
  const repository = new TestAuthRepository()
  const service = new AuthService(
    repository,
    new NoopAuthEmailSender(config.appEnv),
    config.plannerAuth!,
  )

  await service.signUp(
    {
      email: 'alice@planner.local',
      password: 'secret-password',
    },
    {},
  )

  return {
    app: buildApiApp({
      authService: service,
      config,
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: new JwtRequestAuthenticator(config.jwtAuth!),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    }),
    service,
  }
}

function createFormBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString()
}

interface StoredRefreshToken {
  expiresAt: Date
  refreshTokenHash: string
  revokedAt: Date | null
  sessionId: string
  userId: string
}

interface StoredOAuthCode {
  clientId: string
  codeHash: string
  consumedAt: Date | null
  expiresAt: Date
  redirectUri: string
  scope: string
  userId: string
}

class TestAuthRepository implements AuthRepository {
  private readonly oauthCodes: StoredOAuthCode[] = []
  private readonly refreshTokens: StoredRefreshToken[] = []
  private readonly users: AuthCredentialRecord[] = []

  private storeRefreshToken(command: CreateRefreshTokenCommand): void {
    this.refreshTokens.push({
      expiresAt: command.expiresAt,
      refreshTokenHash: command.refreshTokenHash,
      revokedAt: null,
      sessionId: command.sessionId,
      userId: command.userId,
    })
  }

  completePasswordReset(
    _command: CompletePasswordResetCommand,
  ): Promise<AuthSessionTokenRecord | null> {
    return Promise.resolve(null)
  }

  createOAuthAuthorizationCode(
    command: CreateOAuthAuthorizationCodeCommand,
  ): Promise<void> {
    this.oauthCodes.push({
      clientId: command.clientId,
      codeHash: command.codeHash,
      consumedAt: null,
      expiresAt: command.expiresAt,
      redirectUri: command.redirectUri,
      scope: command.scope,
      userId: command.userId,
    })

    return Promise.resolve()
  }

  createPasswordResetToken(
    _command: CreatePasswordResetTokenCommand,
  ): Promise<void> {
    return Promise.resolve()
  }

  createRefreshToken(command: CreateRefreshTokenCommand): Promise<void> {
    this.storeRefreshToken(command)

    return Promise.resolve()
  }

  createUserWithCredential(
    command: CreateAuthUserCommand,
  ): Promise<AuthUserRecord> {
    const user: AuthCredentialRecord = {
      displayName: command.displayName,
      email: command.email.trim().toLowerCase(),
      id: command.userId,
      passwordHash: command.passwordHash,
    }

    this.users.push(user)

    return Promise.resolve({
      displayName: user.displayName,
      email: user.email,
      id: user.id,
    })
  }

  exchangeOAuthAuthorizationCode(
    command: ExchangeOAuthAuthorizationCodeCommand,
  ): Promise<AuthSessionTokenRecord | null> {
    const code = this.oauthCodes.find(
      (candidate) => candidate.codeHash === command.codeHash,
    )

    if (
      !code ||
      code.clientId !== command.clientId ||
      code.redirectUri !== command.redirectUri ||
      code.consumedAt ||
      code.expiresAt.getTime() <= Date.now()
    ) {
      return Promise.resolve(null)
    }

    const user = this.users.find((candidate) => candidate.id === code.userId)

    if (!user) {
      return Promise.resolve(null)
    }

    code.consumedAt = new Date()
    this.storeRefreshToken({
      ...command.refreshToken,
      userId: user.id,
    })

    return Promise.resolve({
      displayName: user.displayName,
      email: user.email,
      id: user.id,
      sessionId: command.refreshToken.sessionId,
    })
  }

  findCredentialByEmail(email: string): Promise<AuthCredentialRecord | null> {
    return Promise.resolve(
      this.users.find((user) => user.email === email.trim().toLowerCase()) ??
        null,
    )
  }

  findCredentialByUserId(userId: string): Promise<AuthCredentialRecord | null> {
    return Promise.resolve(
      this.users.find((user) => user.id === userId) ?? null,
    )
  }

  findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return Promise.resolve(
      this.users.find((user) => user.email === email.trim().toLowerCase()) ??
        null,
    )
  }

  revokeRefreshToken(refreshTokenHash: string): Promise<void> {
    for (const token of this.refreshTokens) {
      if (token.refreshTokenHash === refreshTokenHash) {
        token.revokedAt = new Date()
      }
    }

    return Promise.resolve()
  }

  rotateRefreshToken(
    currentRefreshTokenHash: string,
    nextRefreshToken: CreateRefreshTokenPayload,
  ): Promise<AuthSessionTokenRecord | null> {
    const currentToken = this.refreshTokens.find(
      (token) => token.refreshTokenHash === currentRefreshTokenHash,
    )

    if (
      !currentToken ||
      currentToken.revokedAt ||
      currentToken.expiresAt.getTime() <= Date.now()
    ) {
      return Promise.resolve(null)
    }

    const user = this.users.find(
      (candidate) => candidate.id === currentToken.userId,
    )

    if (!user) {
      return Promise.resolve(null)
    }

    currentToken.revokedAt = new Date()
    this.storeRefreshToken({
      ...nextRefreshToken,
      userId: user.id,
    })

    return Promise.resolve({
      displayName: user.displayName,
      email: user.email,
      id: user.id,
      sessionId: nextRefreshToken.sessionId,
    })
  }

  updatePassword(_command: UpdatePasswordCommand): Promise<void> {
    return Promise.resolve()
  }
}
