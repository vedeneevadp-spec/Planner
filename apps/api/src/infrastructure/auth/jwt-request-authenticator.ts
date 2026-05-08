import type { FastifyRequest } from 'fastify'
import { errors as joseErrors, type JWTPayload, jwtVerify } from 'jose'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  AuthenticatedRequestClaims,
  AuthenticatedRequestContext,
  RequestAuthenticator,
} from '../../bootstrap/request-auth.js'

const verifiedJwtClaimsSchema = z.object({
  email: z.string().email().optional(),
  role: z.literal('authenticated'),
  session_id: z.string().uuid().optional(),
  sub: z.string().uuid(),
})

export interface JwtAuthRuntimeConfig {
  audience: string
  issuer: string
  secret: string
}

export class JwtRequestAuthenticator implements RequestAuthenticator {
  constructor(private readonly config: JwtAuthRuntimeConfig) {}

  async authenticate(
    request: FastifyRequest,
  ): Promise<AuthenticatedRequestContext> {
    const accessToken = readBearerToken(request.headers.authorization)

    if (!accessToken) {
      throw new HttpError(
        401,
        'authentication_required',
        'A valid bearer token is required for this request.',
      )
    }

    return {
      accessToken,
      claims: await this.verifyAccessToken(accessToken),
    }
  }

  private async verifyAccessToken(
    accessToken: string,
  ): Promise<AuthenticatedRequestClaims> {
    return verifyJwtAccessToken(accessToken, this.config)
  }
}

export async function verifyJwtAccessToken(
  accessToken: string,
  config: JwtAuthRuntimeConfig,
): Promise<AuthenticatedRequestClaims> {
  const secretKey = new TextEncoder().encode(config.secret)

  try {
    const { payload } = await jwtVerify(accessToken, secretKey, {
      algorithms: ['HS256'],
      audience: config.audience,
      issuer: config.issuer,
    })

    return normalizeVerifiedClaims(payload)
  } catch (error) {
    if (isJoseAuthError(error)) {
      throw invalidAccessTokenError()
    }

    throw error
  }
}

function normalizeVerifiedClaims(
  payload: JWTPayload,
): AuthenticatedRequestClaims {
  const parsedClaims = verifiedJwtClaimsSchema.safeParse(payload)

  if (!parsedClaims.success) {
    throw invalidAccessTokenError()
  }

  return {
    email: parsedClaims.data.email,
    payload: payload as Record<string, unknown>,
    role: 'authenticated',
    sessionId: parsedClaims.data.session_id,
    sub: parsedClaims.data.sub,
  }
}

function readBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (!authorizationHeader) {
    return undefined
  }

  const [scheme, token] = authorizationHeader.split(' ')

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined
  }

  return token
}

function invalidAccessTokenError(): HttpError {
  return new HttpError(
    401,
    'invalid_access_token',
    'The provided access token is invalid or expired.',
  )
}

function isJoseAuthError(error: unknown): boolean {
  return (
    error instanceof joseErrors.JWTExpired ||
    error instanceof joseErrors.JOSEAlgNotAllowed ||
    error instanceof joseErrors.JWTInvalid ||
    error instanceof joseErrors.JWSInvalid ||
    error instanceof joseErrors.JWSSignatureVerificationFailed
  )
}
