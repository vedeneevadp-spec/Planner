import {
  apiErrorSchema,
  type AssignableWorkspaceGroupRole,
  type WorkspaceInvitationCreateInput,
  workspaceInvitationCreateInputSchema,
  type WorkspaceInvitationListResponse,
  workspaceInvitationListResponseSchema,
  type WorkspaceInvitationRecord,
  workspaceInvitationRecordSchema,
  workspaceUserGroupRoleUpdateInputSchema,
  type WorkspaceUserListResponse,
  workspaceUserListResponseSchema,
  type WorkspaceUserRecord,
  workspaceUserRecordSchema,
} from '@planner/contracts'

type FetchFn = typeof fetch
type RequestSignal = AbortSignal | undefined

export class WorkspaceParticipantsApiError extends Error {
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
    this.name = 'WorkspaceParticipantsApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface WorkspaceParticipantsApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface WorkspaceParticipantsApiClient {
  createWorkspaceInvitation: (
    input: WorkspaceInvitationCreateInput,
  ) => Promise<WorkspaceInvitationRecord>
  listWorkspaceInvitations: (
    signal?: RequestSignal,
  ) => Promise<WorkspaceInvitationListResponse>
  listWorkspaceUsers: (signal?: RequestSignal) => Promise<WorkspaceUserListResponse>
  removeWorkspaceUser: (membershipId: string) => Promise<void>
  revokeWorkspaceInvitation: (invitationId: string) => Promise<void>
  updateWorkspaceUserGroupRole: (
    membershipId: string,
    groupRole: AssignableWorkspaceGroupRole,
  ) => Promise<WorkspaceUserRecord>
}

export function createWorkspaceParticipantsApiClient(
  config: WorkspaceParticipantsApiClientConfig,
  fetchFn: FetchFn = fetch,
): WorkspaceParticipantsApiClient {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
    path: string
    responseSchema?: { parse: (value: unknown) => TResponse }
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

    if (!options.responseSchema) {
      return undefined as TResponse
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
      throw new WorkspaceParticipantsApiError(parsedError.data.error.message, {
        code: parsedError.data.error.code,
        details: parsedError.data.error.details,
        status: response.status,
      })
    }

    throw new WorkspaceParticipantsApiError('Request failed.', {
      code: 'request_failed',
      details: payload,
      status: response.status,
    })
  }

  return {
    createWorkspaceInvitation(input) {
      return request({
        body: workspaceInvitationCreateInputSchema.parse(input),
        method: 'POST',
        path: '/api/v1/workspace-invitations',
        responseSchema: workspaceInvitationRecordSchema,
      })
    },
    listWorkspaceInvitations(signal) {
      return request({
        path: '/api/v1/workspace-invitations',
        responseSchema: workspaceInvitationListResponseSchema,
        signal,
      })
    },
    listWorkspaceUsers(signal) {
      return request({
        path: '/api/v1/workspace-users',
        responseSchema: workspaceUserListResponseSchema,
        signal,
      })
    },
    removeWorkspaceUser(membershipId) {
      return request({
        method: 'DELETE',
        path: `/api/v1/workspace-users/${encodeURIComponent(membershipId)}`,
      })
    },
    revokeWorkspaceInvitation(invitationId) {
      return request({
        method: 'DELETE',
        path: `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}`,
      })
    },
    updateWorkspaceUserGroupRole(membershipId, groupRole) {
      return request({
        body: workspaceUserGroupRoleUpdateInputSchema.parse({ groupRole }),
        method: 'PATCH',
        path: `/api/v1/workspace-users/${encodeURIComponent(membershipId)}/group-role`,
        responseSchema: workspaceUserRecordSchema,
      })
    },
  }
}
