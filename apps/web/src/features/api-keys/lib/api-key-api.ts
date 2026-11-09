import {
  apiKeyListResponseSchema,
  type CreateApiKeyInput,
  createApiKeyInputSchema,
  createdApiKeyResponseSchema,
} from '@planner/contracts'

import {
  type ApiClientConfig,
  createApiRequester,
} from '@/shared/lib/api-client'

export function createApiKeyClient(config: ApiClientConfig) {
  const { request } = createApiRequester(
    config,
    (message) => new Error(message),
  )
  return {
    list: (signal?: AbortSignal) =>
      request({
        path: '/api/v1/api-keys',
        responseSchema: apiKeyListResponseSchema,
        signal,
      }),
    create: (input: CreateApiKeyInput) =>
      request({
        path: '/api/v1/api-keys',
        method: 'POST',
        body: createApiKeyInputSchema.parse(input),
        responseSchema: createdApiKeyResponseSchema,
      }),
    revoke: (id: string) =>
      request<void>({
        path: `/api/v1/api-keys/${encodeURIComponent(id)}`,
        method: 'DELETE',
      }),
  }
}
