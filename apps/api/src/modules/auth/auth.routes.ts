import {
  authPasswordResetConfirmInputSchema,
  authPasswordResetRequestInputSchema,
  authPasswordUpdateInputSchema,
  authRefreshInputSchema,
  authSignInInputSchema,
  authSignOutInputSchema,
  authSignUpInputSchema,
  authTokenResponseSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  assertInMemoryRateLimit,
  getClientAddress,
} from '../../bootstrap/rate-limit.js'
import { requireRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { AuthRequestMetadata } from './auth.model.js'
import type { AuthService } from './auth.service.js'

type AuthRateLimitedAction =
  | 'password-reset-confirm'
  | 'password-reset-request'
  | 'sign-in'
  | 'sign-up'

const AUTH_RATE_LIMITS: Record<
  AuthRateLimitedAction,
  { limit: number; windowMs: number }
> = {
  'password-reset-confirm': {
    limit: 5,
    windowMs: 15 * 60_000,
  },
  'password-reset-request': {
    limit: 3,
    windowMs: 60 * 60_000,
  },
  'sign-in': {
    limit: 5,
    windowMs: 15 * 60_000,
  },
  'sign-up': {
    limit: 3,
    windowMs: 60 * 60_000,
  },
}

export function registerAuthRoutes(
  app: FastifyInstance,
  service: AuthService,
): void {
  app.post('/api/v1/auth/sign-in', async (request) => {
    const input = parseOrThrow(
      authSignInInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    assertAuthRateLimit(request, 'sign-in', input.email)

    const response = await service.signIn(input, getRequestMetadata(request))

    return authTokenResponseSchema.parse(response)
  })

  app.post('/api/v1/auth/sign-up', async (request, reply) => {
    const input = parseOrThrow(
      authSignUpInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    assertAuthRateLimit(request, 'sign-up', input.email)

    const response = await service.signUp(
      {
        ...(input.displayName ? { displayName: input.displayName } : {}),
        email: input.email,
        password: input.password,
      },
      getRequestMetadata(request),
    )

    reply.code(201)

    return authTokenResponseSchema.parse(response)
  })

  app.post('/api/v1/auth/refresh', async (request) => {
    const input = parseOrThrow(
      authRefreshInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const response = await service.refresh(
      input.refreshToken,
      getRequestMetadata(request),
    )

    return authTokenResponseSchema.parse(response)
  })

  app.post('/api/v1/auth/sign-out', async (request, reply) => {
    const input = parseOrThrow(
      authSignOutInputSchema,
      request.body ?? {},
      'invalid_body',
    )

    await service.signOut(input.refreshToken)

    return reply.code(204).send()
  })

  app.post('/api/v1/auth/password-reset/request', async (request, reply) => {
    const input = parseOrThrow(
      authPasswordResetRequestInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    assertAuthRateLimit(request, 'password-reset-request', input.email)

    await service.requestPasswordReset(input.email, getRequestMetadata(request))

    return reply.code(204).send()
  })

  app.post('/api/v1/auth/password-reset/confirm', async (request) => {
    const input = parseOrThrow(
      authPasswordResetConfirmInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    assertAuthRateLimit(request, 'password-reset-confirm')

    const response = await service.confirmPasswordReset(
      input,
      getRequestMetadata(request),
    )

    return authTokenResponseSchema.parse(response)
  })

  app.patch('/api/v1/auth/password', async (request, reply) => {
    const authContext = requireRequestAuth(request)
    const input = parseOrThrow(
      authPasswordUpdateInputSchema,
      request.body ?? {},
      'invalid_body',
    )

    await service.updatePassword(authContext.claims.sub, input)

    return reply.code(204).send()
  })
}

function getRequestMetadata(request: FastifyRequest): AuthRequestMetadata {
  return {
    ipAddress: request.ip,
    userAgent:
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : undefined,
  }
}

function assertAuthRateLimit(
  request: FastifyRequest,
  action: AuthRateLimitedAction,
  discriminator = 'global',
): void {
  const options = AUTH_RATE_LIMITS[action]
  const clientAddress = getClientAddress(request)
  const normalizedDiscriminator = discriminator.trim().toLowerCase() || 'global'

  assertInMemoryRateLimit({
    key: `auth:${action}:${clientAddress}:${normalizedDiscriminator}`,
    limit: options.limit,
    windowMs: options.windowMs,
  })
}
