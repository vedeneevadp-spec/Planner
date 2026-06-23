import type {
  AppRole,
  CalendarViewMode,
  EnergyMode,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

export interface SessionRow {
  actorAvatarUrl: string | null
  calendarViewMode: CalendarViewMode
  defaultTimeZone: string | null
  energyMode: EnergyMode
  lastSeenTimeZone: string | null
  timeZoneMode: 'device' | 'manual' | 'workspace'
  voiceAssistantEnabled: boolean
  actorDisplayName: string
  actorEmail: string
  actorId: string
  appRole: AppRole
  groupRole: WorkspaceGroupRole | null
  role: WorkspaceRole
  taskCompletionConfettiEnabled: boolean
  workspaceDefaultTimeZone: string | null
  wakeWordTrainingModeEnabled: boolean
  workspaceId: string
  workspaceKind: WorkspaceKind
  workspaceName: string
  workspaceSlug: string
}

export interface AdminUserRow {
  appRole: AppRole
  displayName: string
  email: string
  id: string
  lastSeenAt: unknown
  taskCount: number
  updatedAt: unknown
}

export interface WorkspaceMembershipRow {
  groupRole: WorkspaceGroupRole | null
  id: string
  kind: WorkspaceKind
  name: string
  role: WorkspaceRole
  slug: string
}

export interface WorkspaceUserRow {
  displayName: string
  email: string
  groupRole: WorkspaceGroupRole | null
  id: string
  isOwner: boolean
  joinedAt: unknown
  membershipId: string
  updatedAt: unknown
  userId: string
}

export interface WorkspaceInvitationRow {
  declinedAt: unknown
  email: string
  groupRole: WorkspaceGroupRole
  id: string
  invitedAt: unknown
  updatedAt: unknown
}

export interface ReceivedWorkspaceInvitationRow {
  groupRole: WorkspaceGroupRole
  id: string
  invitedBy: string | null
  invitedAt: unknown
  updatedAt: unknown
  workspaceId: string
  workspaceKind: WorkspaceKind
  workspaceName: string
  workspaceSlug: string
}

export interface UserProfileRow {
  avatarUrl: string | null
  displayName: string
  email: string
  id: string
  updatedAt: unknown
}

export interface ExistingWorkspaceMemberRow {
  deletedAt: string | null
  id: string
  role: WorkspaceRole
}

export interface AppActorRow {
  appRole: AppRole
  avatarUrl: string | null
  calendarViewMode: CalendarViewMode
  defaultTimeZone: string | null
  energyMode: EnergyMode
  lastSeenTimeZone: string | null
  timeZoneMode: 'device' | 'manual' | 'workspace'
  voiceAssistantEnabled: boolean
  displayName: string
  email: string
  id: string
  locale: string
  timezone: string
}
