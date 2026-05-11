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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { HttpError } from '../../bootstrap/http-error.js'
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

interface AuthRouteOptions {
  isSecureCookie: boolean
  refreshCookieMaxAgeSeconds: number
}

const REFRESH_TOKEN_COOKIE_NAME = 'planner_refresh_token'
const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth'
const REFRESH_TOKEN_PERSISTENCE_HEADER = 'x-auth-session-persistence'
const REFRESH_TOKEN_TRANSPORT_HEADER = 'x-auth-token-transport'

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
  options: AuthRouteOptions,
): void {
  app.post('/api/v1/auth/sign-in', async (request, reply) => {
    const input = parseOrThrow(
      authSignInInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    assertAuthRateLimit(request, 'sign-in', input.email)

    const response = await service.signIn(input, getRequestMetadata(request))

    return sendAuthTokenResponse(reply, request, response, options)
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

    return sendAuthTokenResponse(reply, request, response, options)
  })

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const input = parseOrThrow(
      authRefreshInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const refreshToken = resolveRefreshToken(request, input.refreshToken)
    const response = await service.refresh(
      refreshToken,
      getRequestMetadata(request),
    )

    return sendAuthTokenResponse(reply, request, response, options)
  })

  app.post('/api/v1/auth/sign-out', async (request, reply) => {
    const input = parseOrThrow(
      authSignOutInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const refreshToken = resolveRefreshToken(request, input.refreshToken, false)

    clearRefreshTokenCookie(reply, options)

    if (refreshToken) {
      await service.signOut(refreshToken)
    }

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

  app.post('/api/v1/auth/password-reset/confirm', async (request, reply) => {
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

    return sendAuthTokenResponse(reply, request, response, options)
  })

  app.patch('/api/v1/auth/password', async (request, reply) => {
    const authContext = requireRequestAuth(request)
    const input = parseOrThrow(
      authPasswordUpdateInputSchema,
      request.body ?? {},
      'invalid_body',
    )

    const response = await service.updatePassword(
      authContext.claims.sub,
      input,
      getRequestMetadata(request),
    )

    return sendAuthTokenResponse(reply, request, response, options)
  })
}

function sendAuthTokenResponse(
  reply: FastifyReply,
  request: FastifyRequest,
  response: {
    accessToken: string
    expiresAt: string
    refreshToken?: string | undefined
    user: {
      email: string
      id: string
    }
  },
  options: AuthRouteOptions,
) {
  if (!response.refreshToken) {
    throw new HttpError(
      500,
      'auth_refresh_token_missing',
      'Auth service did not issue a refresh token.',
    )
  }

  if (shouldReturnRefreshTokenInBody(request)) {
    return authTokenResponseSchema.parse(response)
  }

  setRefreshTokenCookie(reply, request, response.refreshToken, options)

  return authTokenResponseSchema.parse({
    accessToken: response.accessToken,
    expiresAt: response.expiresAt,
    user: response.user,
  })
}

function shouldReturnRefreshTokenInBody(request: FastifyRequest): boolean {
  return request.headers[REFRESH_TOKEN_TRANSPORT_HEADER] === 'body'
}

function resolveRefreshToken(
  request: FastifyRequest,
  bodyRefreshToken: string | undefined,
  isRequired = true,
): string {
  const refreshToken =
    bodyRefreshToken ??
    readCookie(request.headers.cookie, REFRESH_TOKEN_COOKIE_NAME)

  if (!refreshToken && isRequired) {
    throw new HttpError(
      401,
      'auth_refresh_token_invalid',
      'Refresh token is invalid or expired.',
    )
  }

  return refreshToken ?? ''
}

function setRefreshTokenCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  refreshToken: string,
  options: AuthRouteOptions,
): void {
  reply.header(
    'set-cookie',
    serializeRefreshTokenCookie(
      `${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`,
      shouldPersistRefreshTokenCookie(request)
        ? [`Max-Age=${options.refreshCookieMaxAgeSeconds}`]
        : [],
      options,
    ),
  )
}

function shouldPersistRefreshTokenCookie(request: FastifyRequest): boolean {
  return request.headers[REFRESH_TOKEN_PERSISTENCE_HEADER] !== 'session'
}

function clearRefreshTokenCookie(
  reply: FastifyReply,
  options: AuthRouteOptions,
): void {
  reply.header(
    'set-cookie',
    serializeRefreshTokenCookie(
      `${REFRESH_TOKEN_COOKIE_NAME}=`,
      ['Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Max-Age=0'],
      options,
    ),
  )
}

function serializeRefreshTokenCookie(
  value: string,
  lifetimeAttributes: string[],
  options: AuthRouteOptions,
): string {
  return [
    value,
    ...lifetimeAttributes,
    `Path=${REFRESH_TOKEN_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(options.isSecureCookie ? ['Secure'] : []),
  ].join('; ')
}

function readCookie(
  cookieHeader: string | undefined,
  cookieName: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined
  }

  for (const cookie of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = cookie.trim().split('=')

    if (rawName !== cookieName) {
      continue
    }

    const rawValue = rawValueParts.join('=')

    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }

  return undefined
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
