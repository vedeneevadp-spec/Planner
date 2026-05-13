import type {
  CleaningListResponse,
  CleaningTaskActionInput,
  CleaningTaskActionResponse,
  CleaningTaskHistoryItemRecord,
  CleaningTaskRecord,
  CleaningTaskStateRecord,
  CleaningTaskUpdateInput,
  CleaningTodayResponse,
  CleaningZoneRecord,
  CleaningZoneUpdateInput,
  NewCleaningTaskInput,
  NewCleaningZoneInput,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredCleaningZoneRecord = CleaningZoneRecord
export type StoredCleaningTaskRecord = CleaningTaskRecord
export type StoredCleaningTaskStateRecord = CleaningTaskStateRecord
export type StoredCleaningTaskHistoryItemRecord = CleaningTaskHistoryItemRecord

export interface CleaningReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface CleaningWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface CreateCleaningZoneCommand {
  context: CleaningWriteContext
  input: NewCleaningZoneInput
}

export interface UpdateCleaningZoneCommand {
  context: CleaningWriteContext
  input: CleaningZoneUpdateInput
  zoneId: string
}

export interface DeleteCleaningZoneCommand {
  context: CleaningWriteContext
  zoneId: string
}

export interface CreateCleaningTaskCommand {
  context: CleaningWriteContext
  input: NewCleaningTaskInput
}

export interface UpdateCleaningTaskCommand {
  context: CleaningWriteContext
  input: CleaningTaskUpdateInput
  taskId: string
}

export interface DeleteCleaningTaskCommand {
  context: CleaningWriteContext
  taskId: string
}

export interface RecordCleaningTaskActionCommand {
  action: CleaningTaskHistoryItemRecord['action']
  context: CleaningWriteContext
  input: CleaningTaskActionInput
  taskId: string
}

export interface GetCleaningTodayCommand {
  context: CleaningReadContext
  date: string
}

export type CleaningListResult = CleaningListResponse
export type CleaningTodayResult = CleaningTodayResponse
export type CleaningTaskActionResult = CleaningTaskActionResponse
