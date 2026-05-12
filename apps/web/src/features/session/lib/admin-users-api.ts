import {
  type AdminUserListResponse,
  adminUserListResponseSchema,
  type AdminUserRecord,
  adminUserRecordSchema,
  adminUserRoleUpdateInputSchema,
  type AssignableAppRole,
} from '@planner/contracts'

import {
  type ApiClientFetch,
  type ApiRequestSignal,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch
type RequestSignal = ApiRequestSignal

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
  const { request } = createApiRequester(
    config,
    (message, options) => new AdminUsersApiError(message, options),
    fetchFn,
  )

  return {
    listAdminUsers(signal) {
      return request({
        actorHeader: 'always',
        path: '/api/v1/admin/users',
        responseSchema: adminUserListResponseSchema,
        signal,
      })
    },
    updateAdminUserRole(userId, role) {
      const input = adminUserRoleUpdateInputSchema.parse({ role })

      return request({
        actorHeader: 'always',
        body: input,
        method: 'PATCH',
        path: `/api/v1/admin/users/${encodeURIComponent(userId)}/role`,
        responseSchema: adminUserRecordSchema,
      })
    },
  }
}
