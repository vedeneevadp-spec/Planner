import {
  type UserPreferences,
  userPreferencesSchema,
  type UserPreferencesUpdateInput,
  userPreferencesUpdateInputSchema,
} from '@planner/contracts'

import {
  type ApiClientFetch,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch

export class UserPreferencesApiError extends Error {
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
    this.name = 'UserPreferencesApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface UserPreferencesApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface UserPreferencesApiClient {
  updateUserPreferences: (
    input: UserPreferencesUpdateInput,
  ) => Promise<UserPreferences>
}

export function createUserPreferencesApiClient(
  config: UserPreferencesApiClientConfig,
  fetchFn: FetchFn = fetch,
): UserPreferencesApiClient {
  const { request } = createApiRequester(
    config,
    (message, options) => new UserPreferencesApiError(message, options),
    fetchFn,
  )

  return {
    updateUserPreferences(input) {
      return request({
        actorHeader: 'always',
        body: userPreferencesUpdateInputSchema.parse(input),
        method: 'PATCH',
        path: '/api/v1/preferences',
        responseSchema: userPreferencesSchema,
      })
    },
  }
}
