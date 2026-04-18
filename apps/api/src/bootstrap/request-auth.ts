import type { FastifyRequest } from 'fastify'

import { HttpError } from './http-error.js'

export interface AuthenticatedRequestClaims {
  email?: string | undefined
  payload: Record<string, unknown>
  role: 'authenticated'
  sessionId?: string | undefined
  sub: string
}

export interface AuthenticatedRequestContext {
  accessToken: string
  claims: AuthenticatedRequestClaims
}

export interface RequestAuthenticator {
  authenticate: (
    request: FastifyRequest,
  ) => Promise<AuthenticatedRequestContext | null>
}

export class NoopRequestAuthenticator implements RequestAuthenticator {
  authenticate(): Promise<null> {
    return Promise.resolve(null)
  }
}

export function getRequestAuth(
  request: FastifyRequest,
): AuthenticatedRequestContext | null {
  return request.authContext ?? null
}

export function requireRequestAuth(
  request: FastifyRequest,
): AuthenticatedRequestContext {
  const authContext = getRequestAuth(request)

  if (!authContext) {
    throw new HttpError(
      401,
      'authentication_required',
      'A valid bearer token is required for this request.',
    )
  }

  return authContext
}
