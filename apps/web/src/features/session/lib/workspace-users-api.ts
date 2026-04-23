import {
  apiErrorSchema,
  type WorkspaceRole,
  type WorkspaceUserListResponse,
  workspaceUserListResponseSchema,
  type WorkspaceUserRecord,
  workspaceUserRecordSchema,
  workspaceUserRoleUpdateInputSchema,
} from '@planner/contracts'

type FetchFn = typeof fetch
type RequestSignal = AbortSignal | undefined

export class WorkspaceUsersApiError extends Error {
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
    this.name = 'WorkspaceUsersApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface WorkspaceUsersApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface WorkspaceUsersApiClient {
  listWorkspaceUsers: (
    signal?: RequestSignal,
  ) => Promise<WorkspaceUserListResponse>
  updateWorkspaceUserRole: (
    userId: string,
    role: WorkspaceRole,
  ) => Promise<WorkspaceUserRecord>
}

export function createWorkspaceUsersApiClient(
  config: WorkspaceUsersApiClientConfig,
  fetchFn: FetchFn = fetch,
): WorkspaceUsersApiClient {
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
      throw new WorkspaceUsersApiError(parsedError.data.error.message, {
        code: parsedError.data.error.code,
        details: parsedError.data.error.details,
        status: response.status,
      })
    }

    throw new WorkspaceUsersApiError('Request failed.', {
      code: 'request_failed',
      details: payload,
      status: response.status,
    })
  }

  return {
    listWorkspaceUsers(signal) {
      return request({
        path: '/api/v1/admin/users',
        responseSchema: workspaceUserListResponseSchema,
        signal,
      })
    },
    updateWorkspaceUserRole(userId, role) {
      const input = workspaceUserRoleUpdateInputSchema.parse({ role })

      return request({
        body: input,
        method: 'PATCH',
        path: `/api/v1/admin/users/${encodeURIComponent(userId)}/role`,
        responseSchema: workspaceUserRecordSchema,
      })
    },
  }
}
