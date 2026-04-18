import {
  apiErrorSchema,
  type SessionResponse,
  sessionResponseSchema,
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

export interface ResolvePlannerSessionOptions {
  accessToken?: string
  signal?: AbortSignal
}

export async function resolvePlannerSession(
  options: ResolvePlannerSessionOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<SessionResponse> {
  const headers = getPlannerSessionOverrideHeaders(options.accessToken)
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
    const parsedError = apiErrorSchema.safeParse(payload)

    if (parsedError.success) {
      throw new SessionApiError(parsedError.data.error.message, {
        code: parsedError.data.error.code,
        details: parsedError.data.error.details,
        status: response.status,
      })
    }

    throw new SessionApiError('Failed to resolve planner session.', {
      code: 'session_request_failed',
      details: payload,
      status: response.status,
    })
  }

  return sessionResponseSchema.parse(payload)
}
