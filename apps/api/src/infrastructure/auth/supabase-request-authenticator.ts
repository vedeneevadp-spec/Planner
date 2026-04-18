import type { FastifyRequest } from 'fastify'
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose'
import {
  createRemoteJWKSet,
  errors as joseErrors,
  type JWTPayload,
} from 'jose'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  AuthenticatedRequestClaims,
  AuthenticatedRequestContext,
  RequestAuthenticator,
} from '../../bootstrap/request-auth.js'

const verifiedJwtClaimsSchema = z.object({
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  email: z.string().email().optional(),
  role: z.literal('authenticated'),
  session_id: z.string().min(1).optional(),
  sub: z.string().uuid(),
})

interface SupabaseUserPayload {
  email?: string | undefined
  id?: string | undefined
}

export interface SupabaseAuthRuntimeConfig {
  issuer: string
  jwksUrl: string
  jwtSecret?: string | undefined
  projectUrl: string
  publishableKey?: string | undefined
}

export class SupabaseRequestAuthenticator implements RequestAuthenticator {
  private readonly jwks

  constructor(private readonly config: SupabaseAuthRuntimeConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 15_000,
    })
  }

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
    const { alg } = decodeProtectedHeader(accessToken)

    if (!alg) {
      throw invalidAccessTokenError()
    }

    if (alg.startsWith('HS')) {
      if (this.config.jwtSecret) {
        const { payload } = await verifyWithSharedSecret(
          accessToken,
          this.config.jwtSecret,
          this.config.issuer,
        )

        return normalizeVerifiedClaims(payload)
      }

      if (this.config.publishableKey) {
        return this.verifyViaAuthServer(accessToken)
      }

      throw new HttpError(
        500,
        'auth_config_invalid',
        'Supabase auth is configured for symmetric JWTs, but neither SUPABASE_JWT_SECRET nor SUPABASE_PUBLISHABLE_KEY is configured.',
      )
    }

    try {
      const { payload } = await jwtVerify(accessToken, this.jwks, {
        audience: 'authenticated',
        issuer: this.config.issuer,
      })

      return normalizeVerifiedClaims(payload)
    } catch (error) {
      if (
        error instanceof joseErrors.JWKSTimeout &&
        this.config.publishableKey
      ) {
        console.warn(
          '[auth] JWKS request timed out, falling back to Supabase auth server verification',
        )
        return this.verifyViaAuthServer(accessToken)
      }

      if (isJoseAuthError(error)) {
        throw invalidAccessTokenError()
      }

      throw error
    }
  }

  private async verifyViaAuthServer(
    accessToken: string,
  ): Promise<AuthenticatedRequestClaims> {
    const response = await fetch(new URL('/auth/v1/user', this.config.projectUrl), {
      headers: {
        apikey: this.config.publishableKey!,
        authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw invalidAccessTokenError()
    }

    const user = (await response.json()) as SupabaseUserPayload
    const decodedClaims = decodeJwt(accessToken)
    const fallbackSub =
      user.id ??
      (typeof decodedClaims.sub === 'string' ? decodedClaims.sub : undefined)
    const fallbackRole =
      typeof decodedClaims.role === 'string'
        ? decodedClaims.role
        : 'authenticated'

    if (!fallbackSub) {
      throw invalidAccessTokenError()
    }

    return normalizeVerifiedClaims({
      ...decodedClaims,
      email: user.email ?? decodedClaims.email,
      role: fallbackRole,
      sub: fallbackSub,
    })
  }
}

async function verifyWithSharedSecret(
  accessToken: string,
  jwtSecret: string,
  issuer: string,
) {
  try {
    return await jwtVerify(accessToken, new TextEncoder().encode(jwtSecret), {
      audience: 'authenticated',
      issuer,
    })
  } catch (error) {
    if (isJoseAuthError(error)) {
      throw invalidAccessTokenError()
    }

    throw error
  }
}

function normalizeVerifiedClaims(payload: JWTPayload): AuthenticatedRequestClaims {
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
    error instanceof joseErrors.JWTInvalid ||
    error instanceof joseErrors.JWKSInvalid ||
    error instanceof joseErrors.JWKSMultipleMatchingKeys ||
    error instanceof joseErrors.JWKSTimeout ||
    error instanceof joseErrors.JWSInvalid ||
    error instanceof joseErrors.JWSSignatureVerificationFailed
  )
}
