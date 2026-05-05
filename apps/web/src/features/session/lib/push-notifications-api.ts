import {
  apiErrorSchema,
  type PushDeviceRecord,
  pushDeviceRecordSchema,
  type PushDeviceUpsertInput,
  pushDeviceUpsertInputSchema,
  type PushTestNotificationInput,
  pushTestNotificationInputSchema,
  type PushTestNotificationResponse,
  pushTestNotificationResponseSchema,
} from '@planner/contracts'

type FetchFn = typeof fetch

export class PushNotificationsApiError extends Error {
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
    this.name = 'PushNotificationsApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface PushNotificationsApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface PushNotificationsApiClient {
  removeDevice: (installationId: string) => Promise<void>
  sendTestNotification: (
    input: PushTestNotificationInput,
  ) => Promise<PushTestNotificationResponse>
  upsertDevice: (input: PushDeviceUpsertInput) => Promise<PushDeviceRecord>
}

export function createPushNotificationsApiClient(
  config: PushNotificationsApiClientConfig,
  fetchFn: FetchFn = fetch,
): PushNotificationsApiClient {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method: 'DELETE' | 'POST' | 'PUT'
    path: string
    responseSchema?: { parse: (value: unknown) => TResponse }
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
      method: options.method,
    })

    if (response.status === 204) {
      return undefined as TResponse
    }

    const payload = await readResponsePayload(response)

    if (!response.ok) {
      throwApiError(response, payload)
    }

    return options.responseSchema
      ? options.responseSchema.parse(payload)
      : (payload as TResponse)
  }

  return {
    removeDevice(installationId) {
      return request({
        method: 'DELETE',
        path: `/api/v1/push/devices/${encodeURIComponent(installationId)}`,
      })
    },
    sendTestNotification(input) {
      return request({
        body: pushTestNotificationInputSchema.parse(input),
        method: 'POST',
        path: '/api/v1/push/test',
        responseSchema: pushTestNotificationResponseSchema,
      })
    },
    upsertDevice(input) {
      return request({
        body: pushDeviceUpsertInputSchema.parse(input),
        method: 'PUT',
        path: '/api/v1/push/devices',
        responseSchema: pushDeviceRecordSchema,
      })
    },
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

function throwApiError(response: Response, payload: unknown): never {
  const parsedError = apiErrorSchema.safeParse(payload)

  if (parsedError.success) {
    throw new PushNotificationsApiError(parsedError.data.error.message, {
      code: parsedError.data.error.code,
      details: parsedError.data.error.details,
      status: response.status,
    })
  }

  throw new PushNotificationsApiError('Request failed.', {
    code: 'request_failed',
    details: payload,
    status: response.status,
  })
}
