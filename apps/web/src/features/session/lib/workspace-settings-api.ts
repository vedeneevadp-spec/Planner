import {
  type WorkspaceSettings,
  workspaceSettingsSchema,
  type WorkspaceSettingsUpdateInput,
  workspaceSettingsUpdateInputSchema,
} from '@planner/contracts'

import {
  type ApiClientFetch,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch

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
  const { request } = createApiRequester(
    config,
    (message, options) => new WorkspaceSettingsApiError(message, options),
    fetchFn,
  )

  return {
    updateWorkspaceSettings(input) {
      return request({
        actorHeader: 'always',
        body: workspaceSettingsUpdateInputSchema.parse(input),
        method: 'PATCH',
        path: '/api/v1/admin/workspace-settings',
        responseSchema: workspaceSettingsSchema,
      })
    },
  }
}
