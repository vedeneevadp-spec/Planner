import type {
  AdminUserRecord,
  ReceivedWorkspaceInvitationRecord,
  UserProfile,
} from '@planner/contracts'

import type {
  WorkspaceInvitationRecord,
  WorkspaceUserRecord,
} from './session.model.js'
import type {
  AdminUserRow,
  ReceivedWorkspaceInvitationRow,
  UserProfileRow,
  WorkspaceInvitationRow,
  WorkspaceUserRow,
} from './session.repository.postgres.rows.js'

export function mapAdminUserRecord(row: AdminUserRow): AdminUserRecord {
  return {
    appRole: row.appRole,
    displayName: row.displayName,
    email: row.email,
    id: row.id,
    lastSeenAt: serializeNullableTimestamp(row.lastSeenAt),
    taskCount: row.taskCount,
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

export function mapWorkspaceUserRecord(
  row: WorkspaceUserRow,
): WorkspaceUserRecord {
  return {
    displayName: row.displayName,
    email: row.email,
    groupRole: row.groupRole,
    id: row.id,
    isOwner: row.isOwner,
    joinedAt: serializeTimestamp(row.joinedAt),
    membershipId: row.membershipId,
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

export function mapWorkspaceInvitationRecord(
  row: WorkspaceInvitationRow,
): WorkspaceInvitationRecord {
  return {
    email: row.email,
    groupRole: row.groupRole,
    id: row.id,
    invitedAt: serializeTimestamp(row.invitedAt),
    status: row.declinedAt ? 'declined' : 'pending',
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

export function mapReceivedWorkspaceInvitationRecord(
  row: ReceivedWorkspaceInvitationRow,
): ReceivedWorkspaceInvitationRecord {
  return {
    groupRole: row.groupRole,
    id: row.id,
    invitedAt: serializeTimestamp(row.invitedAt),
    status: 'pending',
    updatedAt: serializeTimestamp(row.updatedAt),
    workspace: {
      id: row.workspaceId,
      kind: row.workspaceKind,
      name: row.workspaceName,
      slug: row.workspaceSlug,
    },
  }
}

export function mapUserProfileRecord(row: UserProfileRow): UserProfile {
  return {
    avatarUrl: row.avatarUrl,
    displayName: row.displayName,
    email: row.email,
    id: row.id,
    updatedAt: serializeTimestamp(row.updatedAt),
  }
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}
