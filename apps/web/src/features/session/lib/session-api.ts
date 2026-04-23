import {
  apiErrorSchema,
  type CreateSharedWorkspaceInput,
  createSharedWorkspaceInputSchema,
  type SessionResponse,
  sessionResponseSchema,
  type SessionWorkspaceMembership,
  sessionWorkspaceMembershipSchema,
} from '@planner/contracts'

import {
  getPlannerSessionOverrideHeaders,
  plannerApiConfig,
} from '@/shared/config/planner-api'

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
  const headers = getPlannerSessionOverrideHeaders({
    accessToken: options.accessToken,
    actorUserId: options.actorUserId,
    workspaceId: options.workspaceId,
  })
  const requestInit = {
    ...(headers ? { headers } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  }
  const response = await fetchFn(
    new URL('/api/v1/session', plannerApiConfig.apiBaseUrl),
    requestInit,
  )
  const payload = (await response.json()) as unknown

  if (!response.ok) {
    throwSessionApiError(response, payload, 'Failed to resolve planner session.')
  }

  return sessionResponseSchema.parse(payload)
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
  const headers = getPlannerSessionOverrideHeaders({
    accessToken: options.accessToken,
    actorUserId: options.actorUserId,
    workspaceId: options.workspaceId,
  })
  const requestHeaders = new Headers(headers)
  requestHeaders.set('content-type', 'application/json')
  const input = createSharedWorkspaceInputSchema.parse(options.input ?? {})
  const response = await fetchFn(
    new URL('/api/v1/workspaces/shared', plannerApiConfig.apiBaseUrl),
    {
      body: JSON.stringify(input),
      headers: requestHeaders,
      method: 'POST',
    },
  )
  const payload = (await response.json()) as unknown

  if (!response.ok) {
    throwSessionApiError(response, payload, 'Failed to create workspace.')
  }

  return sessionWorkspaceMembershipSchema.parse(payload)
}

function throwSessionApiError(
  response: Response,
  payload: unknown,
  fallbackMessage: string,
): never {
  const parsedError = apiErrorSchema.safeParse(payload)

  if (parsedError.success) {
    throw new SessionApiError(parsedError.data.error.message, {
      code: parsedError.data.error.code,
      details: parsedError.data.error.details,
      status: response.status,
    })
  }

  throw new SessionApiError(fallbackMessage, {
    code: 'session_request_failed',
    details: payload,
    status: response.status,
  })
}
