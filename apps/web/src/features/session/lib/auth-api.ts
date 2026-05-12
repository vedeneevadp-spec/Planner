import {
  type AuthPasswordResetConfirmInput,
  authPasswordResetConfirmInputSchema,
  type AuthPasswordResetRequestInput,
  authPasswordResetRequestInputSchema,
  type AuthPasswordUpdateInput,
  authPasswordUpdateInputSchema,
  type AuthRefreshInput,
  authRefreshInputSchema,
  type AuthSignInInput,
  authSignInInputSchema,
  type AuthSignOutInput,
  authSignOutInputSchema,
  type AuthSignUpInput,
  authSignUpInputSchema,
  type AuthTokenResponse,
  authTokenResponseSchema,
} from '@planner/contracts'

import { plannerApiConfig } from '@/shared/config/planner-api'
import { readResponsePayload, throwApiError } from '@/shared/lib/api-client'

export type AuthTokenTransport = 'body' | 'cookie'

interface AuthRequestOptions {
  rememberSession?: boolean | undefined
  tokenTransport?: AuthTokenTransport | undefined
}

export class AuthApiError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly status: number

  constructor(
    message: string,
    options: {
      code: string
      details?: unknown
      status: number
    },
  ) {
    super(message)
    this.name = 'AuthApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export function isUnauthorizedAuthApiError(
  error: unknown,
): error is AuthApiError {
  return error instanceof AuthApiError && error.status === 401
}

export function signInWithPassword(
  input: AuthSignInInput,
  options: AuthRequestOptions = {},
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/sign-in',
    authSignInInputSchema.parse(input),
    options,
  )
}

export function signUpWithPassword(
  input: AuthSignUpInput,
  options: AuthRequestOptions = {},
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/sign-up',
    authSignUpInputSchema.parse(input),
    options,
  )
}

export function refreshAuthSession(
  input: AuthRefreshInput = {},
  options: AuthRequestOptions = {},
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/refresh',
    authRefreshInputSchema.parse(input),
    options,
  )
}

export async function signOutAuthSession(
  input: AuthSignOutInput = {},
  options: AuthRequestOptions = {},
): Promise<void> {
  await postAuthNoContent(
    '/api/v1/auth/sign-out',
    authSignOutInputSchema.parse(input),
    options,
  )
}

export async function requestPasswordReset(
  input: AuthPasswordResetRequestInput,
): Promise<void> {
  await postAuthNoContent(
    '/api/v1/auth/password-reset/request',
    authPasswordResetRequestInputSchema.parse(input),
  )
}

export function confirmPasswordReset(
  input: AuthPasswordResetConfirmInput,
  options: AuthRequestOptions = {},
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/password-reset/confirm',
    authPasswordResetConfirmInputSchema.parse(input),
    options,
  )
}

export async function updatePassword(
  input: AuthPasswordUpdateInput,
  accessToken: string,
  options: AuthRequestOptions = {},
): Promise<AuthTokenResponse> {
  const response = await fetch(
    new URL('/api/v1/auth/password', plannerApiConfig.apiBaseUrl),
    {
      body: JSON.stringify(authPasswordUpdateInputSchema.parse(input)),
      credentials: 'include',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...createAuthHeaders(options),
      },
      method: 'PATCH',
    },
  )
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throwAuthApiError(response, payload, 'Failed to update password.')
  }

  return authTokenResponseSchema.parse(payload)
}

async function postAuthJson<TInput>(
  path: string,
  input: TInput,
  options: AuthRequestOptions = {},
): Promise<AuthTokenResponse> {
  const response = await fetch(new URL(path, plannerApiConfig.apiBaseUrl), {
    body: JSON.stringify(input),
    credentials: 'include',
    headers: createAuthHeaders(options),
    method: 'POST',
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throwAuthApiError(response, payload, 'Auth request failed.')
  }

  return authTokenResponseSchema.parse(payload)
}

async function postAuthNoContent<TInput>(
  path: string,
  input: TInput,
  options: AuthRequestOptions = {},
): Promise<void> {
  const response = await fetch(new URL(path, plannerApiConfig.apiBaseUrl), {
    body: JSON.stringify(input),
    credentials: 'include',
    headers: createAuthHeaders(options),
    method: 'POST',
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throwAuthApiError(response, payload, 'Auth request failed.')
  }
}

function createAuthHeaders(options: AuthRequestOptions): HeadersInit {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (options.tokenTransport === 'body') {
    headers['x-auth-token-transport'] = 'body'
  }

  if (options.rememberSession === false) {
    headers['x-auth-session-persistence'] = 'session'
  }

  return headers
}

function throwAuthApiError(
  response: Response,
  payload: unknown,
  fallbackMessage: string,
): never {
  throwApiError({
    createError: (message, options) => new AuthApiError(message, options),
    fallbackCode: 'auth_request_failed',
    fallbackMessage,
    payload,
    response,
  })
}
