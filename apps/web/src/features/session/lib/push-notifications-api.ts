import {
  type PushDeviceRecord,
  pushDeviceRecordSchema,
  type PushDeviceUpsertInput,
  pushDeviceUpsertInputSchema,
  type PushTestNotificationInput,
  pushTestNotificationInputSchema,
  type PushTestNotificationResponse,
  pushTestNotificationResponseSchema,
} from '@planner/contracts'

import {
  type ApiClientFetch,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch

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
  const { request } = createApiRequester(
    config,
    (message, options) => new PushNotificationsApiError(message, options),
    fetchFn,
  )

  return {
    removeDevice(installationId) {
      return request({
        actorHeader: 'always',
        method: 'DELETE',
        path: `/api/v1/push/devices/${encodeURIComponent(installationId)}`,
      })
    },
    sendTestNotification(input) {
      return request({
        actorHeader: 'always',
        body: pushTestNotificationInputSchema.parse(input),
        method: 'POST',
        path: '/api/v1/push/test',
        responseSchema: pushTestNotificationResponseSchema,
      })
    },
    upsertDevice(input) {
      return request({
        actorHeader: 'always',
        body: pushDeviceUpsertInputSchema.parse(input),
        method: 'PUT',
        path: '/api/v1/push/devices',
        responseSchema: pushDeviceRecordSchema,
      })
    },
  }
}
