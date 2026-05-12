import { apiErrorSchema } from '@planner/contracts'

export type ApiClientFetch = typeof fetch
export type ApiRequestSignal = AbortSignal | undefined

export interface ApiClientErrorOptions {
  code: string
  details?: unknown
  status: number
}

export interface ApiClientConfig {
  accessToken?: string | undefined
  actorUserId?: string | undefined
  apiBaseUrl: string
  workspaceId?: string | undefined
}

export interface ApiClientRequestOptions<TResponse> {
  actorHeader?: 'always' | 'never' | 'write'
  body?: unknown
  credentials?: RequestCredentials | undefined
  fallbackErrorCode?: string | undefined
  fallbackErrorMessage?: string | undefined
  headers?: HeadersInit | undefined
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  path: string
  query?: Record<string, string | number | undefined> | undefined
  responseSchema?: { parse: (value: unknown) => TResponse } | undefined
  signal?: ApiRequestSignal
  writeAccess?: boolean | undefined
}

export function createApiRequester<TError extends Error>(
  config: ApiClientConfig,
  createError: (message: string, options: ApiClientErrorOptions) => TError,
  fetchFn: ApiClientFetch = fetch,
  defaults: {
    fallbackErrorCode?: string | undefined
    fallbackErrorMessage?: string | undefined
  } = {},
) {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(
    options: ApiClientRequestOptions<TResponse>,
  ): Promise<TResponse> {
    const response = await send(options)

    if (response.status === 204) {
      return undefined as TResponse
    }

    const payload = await readResponsePayload(response)

    if (!response.ok) {
      throwApiError({
        createError,
        fallbackCode:
          options.fallbackErrorCode ??
          defaults.fallbackErrorCode ??
          'request_failed',
        fallbackMessage:
          options.fallbackErrorMessage ??
          defaults.fallbackErrorMessage ??
          'Request failed.',
        payload,
        response,
      })
    }

    return options.responseSchema
      ? options.responseSchema.parse(payload)
      : (payload as TResponse)
  }

  function send(options: ApiClientRequestOptions<unknown>): Promise<Response> {
    const url = new URL(`${baseUrl}${options.path}`)

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    return fetchFn(url.href, {
      body: options.body === undefined ? null : JSON.stringify(options.body),
      headers: createRequestHeaders(config, options),
      method: options.method ?? 'GET',
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }

  return {
    baseUrl,
    request,
    send,
  }
}

export async function readResponsePayload(
  response: Response,
): Promise<unknown> {
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

export function throwApiError<TError extends Error>(input: {
  createError: (message: string, options: ApiClientErrorOptions) => TError
  fallbackCode: string
  fallbackMessage: string
  payload: unknown
  response: Response
}): never {
  const parsedError = apiErrorSchema.safeParse(input.payload)

  if (parsedError.success) {
    throw input.createError(parsedError.data.error.message, {
      code: parsedError.data.error.code,
      details: parsedError.data.error.details,
      status: input.response.status,
    })
  }

  throw input.createError(input.fallbackMessage, {
    code: input.fallbackCode,
    details: input.payload,
    status: input.response.status,
  })
}

function createRequestHeaders(
  config: ApiClientConfig,
  options: ApiClientRequestOptions<unknown>,
): Headers {
  const headers = new Headers(options.headers)

  if (config.workspaceId) {
    headers.set('x-workspace-id', config.workspaceId)
  }

  if (config.accessToken) {
    headers.set('authorization', `Bearer ${config.accessToken}`)
  }

  const actorHeader =
    options.actorHeader ?? (options.writeAccess ? 'write' : 'never')

  if (
    !config.accessToken &&
    config.actorUserId &&
    (actorHeader === 'always' ||
      (actorHeader === 'write' && options.writeAccess === true))
  ) {
    headers.set('x-actor-user-id', config.actorUserId)
  }

  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
  }

  return headers
}
