import {
  type AuthTokenResponse,
  type GoogleAuthChallenge,
  googleAuthChallengeSchema,
  googleAuthConfigSchema,
  type GoogleAuthSignInInput,
  googleAuthSignInInputSchema,
} from '@planner/contracts'

import { plannerApiConfig } from '@/shared/config/planner-api'

import {
  type AuthRequestOptions,
  createAuthHeaders,
  fetchAuth,
  postAuthJson,
  throwAuthApiError,
} from './auth-api'

export async function getGoogleAuthClientId(): Promise<string | null> {
  const path = '/api/v1/auth/google/config'
  const { response, payload } = await fetchAuth(
    new URL(path, plannerApiConfig.apiBaseUrl),
    { method: 'GET' },
    { path },
  )
  if (!response.ok)
    throwAuthApiError(response, payload, 'Google sign-in is unavailable.')
  return googleAuthConfigSchema.parse(payload).clientId
}

export async function createGoogleAuthChallenge(
  options: AuthRequestOptions,
): Promise<GoogleAuthChallenge> {
  const path = '/api/v1/auth/google/challenge'
  const { response, payload } = await fetchAuth(
    new URL(path, plannerApiConfig.apiBaseUrl),
    {
      body: '{}',
      credentials: 'include',
      headers: createAuthHeaders(options),
      method: 'POST',
    },
    { path },
  )
  if (!response.ok)
    throwAuthApiError(response, payload, 'Google sign-in is unavailable.')
  return googleAuthChallengeSchema.parse(payload)
}

export function signInWithGoogle(
  input: GoogleAuthSignInInput,
  options: AuthRequestOptions,
): Promise<AuthTokenResponse> {
  return postAuthJson(
    '/api/v1/auth/google/sign-in',
    googleAuthSignInInputSchema.parse(input),
    options,
  )
}
