import {
  googlePlayTestingAdminSchema,
  googlePlayTestingInputSchema,
  googlePlayTestingRequestSchema,
  type GooglePlayTestingReview,
  googlePlayTestingSettingsSchema,
  googlePlayTestingStateSchema,
} from '@planner/contracts'

import {
  type ApiClientConfig,
  createApiRequester,
} from '@/shared/lib/api-client'

export function createGooglePlayTestingClient(config: ApiClientConfig) {
  const { request } = createApiRequester(
    config,
    (message) => new Error(message),
    fetch,
    {
      fallbackErrorMessage:
        'Не удалось обновить данные тестирования. Попробуйте ещё раз.',
    },
  )
  return {
    state: (signal?: AbortSignal) =>
      request({
        path: '/api/v1/google-play-testing',
        responseSchema: googlePlayTestingStateSchema,
        signal,
      }),
    submit: (googleEmail: string) =>
      request({
        path: '/api/v1/google-play-testing/request',
        method: 'PUT',
        body: googlePlayTestingInputSchema.parse({ googleEmail }),
        responseSchema: googlePlayTestingStateSchema,
      }),
    admin: (signal?: AbortSignal) =>
      request({
        path: '/api/v1/admin/google-play-testing',
        responseSchema: googlePlayTestingAdminSchema,
        signal,
      }),
    setOpen: (isOpen: boolean) =>
      request({
        path: '/api/v1/admin/google-play-testing',
        method: 'PATCH',
        body: { isOpen },
        responseSchema: googlePlayTestingSettingsSchema,
      }),
    review: (userId: string, input: GooglePlayTestingReview) =>
      request({
        path: `/api/v1/admin/google-play-testing/requests/${encodeURIComponent(userId)}`,
        method: 'PATCH',
        body: input,
        responseSchema: googlePlayTestingRequestSchema,
      }),
  }
}
