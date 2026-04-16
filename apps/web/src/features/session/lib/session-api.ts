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

export async function resolvePlannerSession(
  signalOrFetchFn?: AbortSignal | typeof fetch,
  fetchFn: typeof fetch = fetch,
): Promise<SessionResponse> {
  const signal =
    typeof signalOrFetchFn === 'function' ? undefined : signalOrFetchFn
  const resolvedFetchFn =
    typeof signalOrFetchFn === 'function' ? signalOrFetchFn : fetchFn
  const headers = getPlannerSessionOverrideHeaders()
  const requestInit = {
    ...(headers ? { headers } : {}),
    ...(signal ? { signal } : {}),
  }
  const response = await resolvedFetchFn(
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
