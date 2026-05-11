import type {
  HabitEntryRecord,
  HabitEntryUpsertInput,
  HabitRecord,
  HabitStatsResponse,
  HabitTodayResponse,
  HabitUpdateInput,
  NewHabitInput,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredHabitRecord = HabitRecord
export type StoredHabitEntryRecord = HabitEntryRecord

export interface HabitReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface HabitWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface CreateHabitCommand {
  context: HabitWriteContext
  input: NewHabitInput
}

export interface UpdateHabitCommand {
  context: HabitWriteContext
  habitId: string
  input: HabitUpdateInput
}

export interface DeleteHabitCommand {
  context: HabitWriteContext
  habitId: string
}

export interface UpsertHabitEntryCommand {
  context: HabitWriteContext
  date: string
  habitId: string
  input: HabitEntryUpsertInput
}

export interface DeleteHabitEntryCommand {
  context: HabitWriteContext
  expectedVersion?: number | undefined
  date: string
  habitId: string
}

export interface GetHabitTodayCommand {
  context: HabitReadContext
  date: string
}

export interface GetHabitStatsCommand {
  context: HabitReadContext
  from: string
  to: string
}

export type HabitTodayResult = HabitTodayResponse
export type HabitStatsResult = HabitStatsResponse
