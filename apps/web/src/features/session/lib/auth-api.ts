import {
  apiErrorSchema,
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
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/sign-in',
    authSignInInputSchema.parse(input),
  )
}

export function signUpWithPassword(
  input: AuthSignUpInput,
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/sign-up',
    authSignUpInputSchema.parse(input),
  )
}

export function refreshAuthSession(
  input: AuthRefreshInput,
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/refresh',
    authRefreshInputSchema.parse(input),
  )
}

export async function signOutAuthSession(
  input: AuthSignOutInput,
): Promise<void> {
  await postAuthNoContent(
    '/api/v1/auth/sign-out',
    authSignOutInputSchema.parse(input),
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
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/password-reset/confirm',
    authPasswordResetConfirmInputSchema.parse(input),
  )
}

export async function updatePassword(
  input: AuthPasswordUpdateInput,
  accessToken: string,
): Promise<void> {
  const response = await fetch(
    new URL('/api/v1/auth/password', plannerApiConfig.apiBaseUrl),
    {
      body: JSON.stringify(authPasswordUpdateInputSchema.parse(input)),
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throwAuthApiError(response, payload, 'Failed to update password.')
  }
}

async function postAuthJson<TInput>(
  path: string,
  input: TInput,
): Promise<AuthTokenResponse> {
  const response = await fetch(new URL(path, plannerApiConfig.apiBaseUrl), {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
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
): Promise<void> {
  const response = await fetch(new URL(path, plannerApiConfig.apiBaseUrl), {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throwAuthApiError(response, payload, 'Auth request failed.')
  }
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text()

  if (!text) {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function throwAuthApiError(
  response: Response,
  payload: unknown,
  fallbackMessage: string,
): never {
  const parsedError = apiErrorSchema.safeParse(payload)

  if (parsedError.success) {
    throw new AuthApiError(parsedError.data.error.message, {
      code: parsedError.data.error.code,
      details: parsedError.data.error.details,
      status: response.status,
    })
  }

  throw new AuthApiError(fallbackMessage, {
    code: 'auth_request_failed',
    details: payload,
    status: response.status,
  })
}
