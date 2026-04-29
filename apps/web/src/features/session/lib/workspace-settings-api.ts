import {
  apiErrorSchema,
  type WorkspaceSettings,
  workspaceSettingsSchema,
  type WorkspaceSettingsUpdateInput,
  workspaceSettingsUpdateInputSchema,
} from '@planner/contracts'

type FetchFn = typeof fetch

export class WorkspaceSettingsApiError extends Error {
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
    this.name = 'WorkspaceSettingsApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface WorkspaceSettingsApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface WorkspaceSettingsApiClient {
  updateWorkspaceSettings: (
    input: WorkspaceSettingsUpdateInput,
  ) => Promise<WorkspaceSettings>
}

export function createWorkspaceSettingsApiClient(
  config: WorkspaceSettingsApiClientConfig,
  fetchFn: FetchFn = fetch,
): WorkspaceSettingsApiClient {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method?: 'PATCH'
    path: string
    responseSchema: { parse: (value: unknown) => TResponse }
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
      method: options.method ?? 'PATCH',
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
      throw new WorkspaceSettingsApiError(parsedError.data.error.message, {
        code: parsedError.data.error.code,
        details: parsedError.data.error.details,
        status: response.status,
      })
    }

    throw new WorkspaceSettingsApiError('Request failed.', {
      code: 'request_failed',
      details: payload,
      status: response.status,
    })
  }

  return {
    updateWorkspaceSettings(input) {
      return request({
        body: workspaceSettingsUpdateInputSchema.parse(input),
        method: 'PATCH',
        path: '/api/v1/admin/workspace-settings',
        responseSchema: workspaceSettingsSchema,
      })
    },
  }
}
