import {
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

import {
  type ApiClientFetch,
  type ApiRequestSignal,
  createApiRequester,
} from '@/shared/lib/api-client'

type FetchFn = ApiClientFetch
type RequestSignal = ApiRequestSignal

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
  listWorkspaceUsers: (
    signal?: RequestSignal,
  ) => Promise<WorkspaceUserListResponse>
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
  const { request } = createApiRequester(
    config,
    (message, options) => new WorkspaceParticipantsApiError(message, options),
    fetchFn,
  )

  return {
    createWorkspaceInvitation(input) {
      return request({
        actorHeader: 'always',
        body: workspaceInvitationCreateInputSchema.parse(input),
        method: 'POST',
        path: '/api/v1/workspace-invitations',
        responseSchema: workspaceInvitationRecordSchema,
      })
    },
    listWorkspaceInvitations(signal) {
      return request({
        actorHeader: 'always',
        path: '/api/v1/workspace-invitations',
        responseSchema: workspaceInvitationListResponseSchema,
        signal,
      })
    },
    listWorkspaceUsers(signal) {
      return request({
        actorHeader: 'always',
        path: '/api/v1/workspace-users',
        responseSchema: workspaceUserListResponseSchema,
        signal,
      })
    },
    removeWorkspaceUser(membershipId) {
      return request({
        actorHeader: 'always',
        method: 'DELETE',
        path: `/api/v1/workspace-users/${encodeURIComponent(membershipId)}`,
      })
    },
    revokeWorkspaceInvitation(invitationId) {
      return request({
        actorHeader: 'always',
        method: 'DELETE',
        path: `/api/v1/workspace-invitations/${encodeURIComponent(invitationId)}`,
      })
    },
    updateWorkspaceUserGroupRole(membershipId, groupRole) {
      return request({
        actorHeader: 'always',
        body: workspaceUserGroupRoleUpdateInputSchema.parse({ groupRole }),
        method: 'PATCH',
        path: `/api/v1/workspace-users/${encodeURIComponent(membershipId)}/group-role`,
        responseSchema: workspaceUserRecordSchema,
      })
    },
  }
}
