import {
  type AdminUserListResponse,
  adminUserListResponseSchema,
  type AdminUserRecord,
  adminUserRecordSchema,
  adminUserRoleUpdateInputSchema,
  apiErrorSchema,
  type AssignableAppRole,
} from '@planner/contracts'

type FetchFn = typeof fetch
type RequestSignal = AbortSignal | undefined

export class AdminUsersApiError extends Error {
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
    this.name = 'AdminUsersApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface AdminUsersApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface AdminUsersApiClient {
  listAdminUsers: (signal?: RequestSignal) => Promise<AdminUserListResponse>
  updateAdminUserRole: (
    userId: string,
    role: AssignableAppRole,
  ) => Promise<AdminUserRecord>
}

export function createAdminUsersApiClient(
  config: AdminUsersApiClientConfig,
  fetchFn: FetchFn = fetch,
): AdminUsersApiClient {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method?: 'GET' | 'PATCH'
    path: string
    responseSchema: { parse: (value: unknown) => TResponse }
    signal?: RequestSignal
  }): Promise<TResponse> {
    const headers = new Headers({
      'x-workspace-id': config.workspaceId,
    })

    if (config.accessToken) {
      headers.set('authorization', `Bearer ${config.accessToken}`)
    } else {
      headers.set('x-actor-user-id', config.actorUserId)
    }

    if (options.body !== undefined) {
      headers.set('content-type', 'application/json')
    }

    const response = await fetchFn(`${baseUrl}${options.path}`, {
      body: options.body === undefined ? null : JSON.stringify(options.body),
      headers,
      method: options.method ?? 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const payload = await readResponsePayload(response)

    if (!response.ok) {
      throwApiError(response, payload)
    }

    return options.responseSchema.parse(payload)
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

  function throwApiError(response: Response, payload: unknown): never {
    const parsedError = apiErrorSchema.safeParse(payload)

    if (parsedError.success) {
      throw new AdminUsersApiError(parsedError.data.error.message, {
        code: parsedError.data.error.code,
        details: parsedError.data.error.details,
        status: response.status,
      })
    }

    throw new AdminUsersApiError('Request failed.', {
      code: 'request_failed',
      details: payload,
      status: response.status,
    })
  }

  return {
    listAdminUsers(signal) {
      return request({
        path: '/api/v1/admin/users',
        responseSchema: adminUserListResponseSchema,
        signal,
      })
    },
    updateAdminUserRole(userId, role) {
      const input = adminUserRoleUpdateInputSchema.parse({ role })

      return request({
        body: input,
        method: 'PATCH',
        path: `/api/v1/admin/users/${encodeURIComponent(userId)}/role`,
        responseSchema: adminUserRecordSchema,
      })
    },
  }
}
