import type {
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

const SHARED_WRITE_GROUP_ROLES = new Set<WorkspaceGroupRole>([
  'group_admin',
  'senior_member',
  'member',
])

export interface WorkspaceAccessContext {
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
}

export function canManageSharedWorkspaceParticipants(
  context: WorkspaceAccessContext,
): boolean {
  return (
    context.workspaceKind === 'shared' &&
    (context.role === 'owner' || context.groupRole === 'group_admin')
  )
}

export function canWriteWorkspaceContent(
  context: WorkspaceAccessContext,
): boolean {
  if (context.workspaceKind === 'shared') {
    return (
      context.role === 'owner' ||
      (context.groupRole ? SHARED_WRITE_GROUP_ROLES.has(context.groupRole) : false)
    )
  }

  return context.role !== 'guest'
}
