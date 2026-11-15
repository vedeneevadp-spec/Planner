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
  writeEpochs?: Record<string, string> | undefined
  integrationIssuedAt?: string | undefined
  accessToken: string
  claims: AuthenticatedRequestClaims
}

export interface RequestAuthenticator {
  authenticate: (
    request: Pick<FastifyRequest, 'headers'>,
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
  const auth = request.authContext
  const workspaceId = request.headers['x-workspace-id']
  const additionalEpochs = parseWorkspaceEpochScopes(
    request.headers['x-workspace-epochs'],
  )
  const epoch = request.headers['x-workspace-epoch'] ?? '0'
  if (typeof epoch !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(epoch)) {
    throw new HttpError(
      400,
      'invalid_workspace_epoch',
      'Invalid workspace epoch.',
    )
  }
  return auth && typeof workspaceId === 'string'
    ? { ...auth, writeEpochs: { ...additionalEpochs, [workspaceId]: epoch } }
    : (auth ?? null)
}

function parseWorkspaceEpochScopes(
  value: string | string[] | undefined,
): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value === 'string' && value.length <= 2048) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed)
        if (
          entries.length <= 4 &&
          entries.every(
            ([id, epoch]) =>
              /^[a-zA-Z0-9_-]{1,128}$/.test(id) &&
              typeof epoch === 'string' &&
              /^(0|[1-9][0-9]{0,18})$/.test(epoch),
          )
        )
          return Object.fromEntries(entries)
      }
    } catch {
      /* Invalid metadata must fail closed. */
    }
  }
  throw new HttpError(
    400,
    'invalid_workspace_epoch',
    'Invalid workspace epoch scopes.',
  )
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
