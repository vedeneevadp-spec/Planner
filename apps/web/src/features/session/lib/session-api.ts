import {
  type CreateSharedWorkspaceInput,
  createSharedWorkspaceInputSchema,
  type SessionResponse,
  sessionResponseSchema,
  type SessionWorkspaceMembership,
  sessionWorkspaceMembershipSchema,
  type UpdateSharedWorkspaceInput,
  updateSharedWorkspaceInputSchema,
  type UpdateUserProfileInput,
  updateUserProfileInputSchema,
  type UserProfile,
  userProfileSchema,
} from '@planner/contracts'

import { plannerApiConfig } from '@/shared/config/planner-api'
import { createApiRequester } from '@/shared/lib/api-client'

export class SessionApiError extends Error {
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
    this.name = 'SessionApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export function isUnauthorizedSessionApiError(
  error: unknown,
): error is SessionApiError {
  return error instanceof SessionApiError && error.status === 401
}

export interface ResolvePlannerSessionOptions {
  accessToken?: string
  actorUserId?: string | undefined
  signal?: AbortSignal
  workspaceId?: string | undefined
}

export async function resolvePlannerSession(
  options: ResolvePlannerSessionOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<SessionResponse> {
  const request = createSessionRequest(options, fetchFn)
  const session = await request({
    actorHeader: 'always',
    fallbackErrorMessage: 'Failed to resolve planner session.',
    path: '/api/v1/session',
    responseSchema: sessionResponseSchema,
    signal: options.signal,
  })

  return resolveSessionAssetUrls(session)
}

export interface CreateSharedWorkspaceOptions {
  accessToken?: string
  actorUserId?: string | undefined
  input?: CreateSharedWorkspaceInput | undefined
  workspaceId?: string | undefined
}

export async function createSharedWorkspace(
  options: CreateSharedWorkspaceOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<SessionWorkspaceMembership> {
  const request = createSessionRequest(options, fetchFn)
  const input = createSharedWorkspaceInputSchema.parse(options.input ?? {})

  return request({
    actorHeader: 'always',
    body: input,
    fallbackErrorMessage: 'Failed to create workspace.',
    method: 'POST',
    path: '/api/v1/workspaces/shared',
    responseSchema: sessionWorkspaceMembershipSchema,
  })
}

export interface UpdateSharedWorkspaceOptions {
  accessToken?: string
  actorUserId?: string | undefined
  input: UpdateSharedWorkspaceInput
  workspaceId?: string | undefined
}

export interface UpdateUserProfileOptions {
  accessToken?: string
  actorUserId?: string | undefined
  input: UpdateUserProfileInput
  workspaceId?: string | undefined
}

export async function updateSharedWorkspace(
  options: UpdateSharedWorkspaceOptions,
  fetchFn: typeof fetch = fetch,
): Promise<SessionWorkspaceMembership> {
  const request = createSessionRequest(options, fetchFn)
  const input = updateSharedWorkspaceInputSchema.parse(options.input)

  return request({
    actorHeader: 'always',
    body: input,
    fallbackErrorMessage: 'Failed to rename workspace.',
    method: 'PATCH',
    path: '/api/v1/workspaces/shared',
    responseSchema: sessionWorkspaceMembershipSchema,
  })
}

export async function updateUserProfile(
  options: UpdateUserProfileOptions,
  fetchFn: typeof fetch = fetch,
): Promise<UserProfile> {
  const request = createSessionRequest(options, fetchFn)
  const input = updateUserProfileInputSchema.parse(options.input)
  const profile = await request({
    actorHeader: 'always',
    body: input,
    fallbackErrorMessage: 'Failed to update profile.',
    method: 'PATCH',
    path: '/api/v1/profile',
    responseSchema: userProfileSchema,
  })

  return resolveUserProfileAssetUrls(profile)
}

export interface DeleteSharedWorkspaceOptions {
  accessToken?: string
  actorUserId?: string | undefined
  workspaceId?: string | undefined
}

export async function deleteSharedWorkspace(
  options: DeleteSharedWorkspaceOptions,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const request = createSessionRequest(options, fetchFn)

  await request({
    actorHeader: 'always',
    fallbackErrorMessage: 'Failed to delete workspace.',
    method: 'DELETE',
    path: '/api/v1/workspaces/shared',
  })
}

export async function leaveSharedWorkspace(
  options: DeleteSharedWorkspaceOptions,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const request = createSessionRequest(options, fetchFn)

  await request({
    actorHeader: 'always',
    fallbackErrorMessage: 'Failed to leave workspace.',
    method: 'POST',
    path: '/api/v1/workspaces/shared/leave',
  })
}

function createSessionRequest(
  options: {
    accessToken?: string | undefined
    actorUserId?: string | undefined
    workspaceId?: string | undefined
  },
  fetchFn: typeof fetch,
) {
  const accessToken = options.accessToken ?? plannerApiConfig.apiAccessToken
  const workspaceId =
    options.workspaceId ?? plannerApiConfig.workspaceIdOverride
  const actorUserId = workspaceId
    ? (options.actorUserId ?? plannerApiConfig.actorUserIdOverride)
    : undefined

  const { request } = createApiRequester(
    {
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      ...(accessToken ? { accessToken } : {}),
      ...(actorUserId ? { actorUserId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    },
    (message, errorOptions) => new SessionApiError(message, errorOptions),
    fetchFn,
    {
      fallbackErrorCode: 'session_request_failed',
    },
  )

  return request
}

function resolveSessionAssetUrls(session: SessionResponse): SessionResponse {
  return {
    ...session,
    actor: resolveUserProfileAssetUrls(session.actor),
  }
}

function resolveUserProfileAssetUrls<T extends { avatarUrl: string | null }>(
  profile: T,
): T {
  return {
    ...profile,
    avatarUrl: resolveAssetUrl(profile.avatarUrl),
  }
}

function resolveAssetUrl(value: string | null): string | null {
  if (!value || !value.startsWith('/api/')) {
    return value
  }

  return `${plannerApiConfig.apiBaseUrl.replace(/\/$/, '')}${value}`
}
