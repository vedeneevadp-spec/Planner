import type {
  CleaningListResponse,
  CleaningSeedInput,
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
  clientTimeZone?: string | undefined
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface CleaningWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  clientTimeZone?: string | undefined
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface CleaningOperationMetadata {
  fingerprint: string
  id: string
  type: string
}

export interface CreateCleaningZoneCommand {
  context: CleaningWriteContext
  input: NewCleaningZoneInput
  operation?: CleaningOperationMetadata | undefined
}

export interface UpdateCleaningZoneCommand {
  context: CleaningWriteContext
  input: CleaningZoneUpdateInput
  operation?: CleaningOperationMetadata | undefined
  zoneId: string
}

export interface DeleteCleaningZoneCommand {
  context: CleaningWriteContext
  expectedTaskVersions?: Array<{ taskId: string; version: number }> | undefined
  expectedVersion?: number | undefined
  operation?: CleaningOperationMetadata | undefined
  zoneId: string
}

export interface CreateCleaningTaskCommand {
  context: CleaningWriteContext
  input: NewCleaningTaskInput
  operation?: CleaningOperationMetadata | undefined
}

export interface UpdateCleaningTaskCommand {
  context: CleaningWriteContext
  input: CleaningTaskUpdateInput
  operation?: CleaningOperationMetadata | undefined
  taskId: string
}

export interface DeleteCleaningTaskCommand {
  context: CleaningWriteContext
  expectedVersion?: number | undefined
  operation?: CleaningOperationMetadata | undefined
  taskId: string
}

export interface RecordCleaningTaskActionCommand {
  action: CleaningTaskHistoryItemRecord['action']
  context: CleaningWriteContext
  input: CleaningTaskActionInput
  operation?: CleaningOperationMetadata | undefined
  taskId: string
}

export interface SeedCleaningCommand {
  context: CleaningWriteContext
  input: CleaningSeedInput
  operation?: CleaningOperationMetadata | undefined
}

export interface GetCleaningTodayCommand {
  context: CleaningReadContext
  date: string
}

export type CleaningListResult = CleaningListResponse
export type CleaningTodayResult = CleaningTodayResponse
export type CleaningTaskActionResult = CleaningTaskActionResponse
