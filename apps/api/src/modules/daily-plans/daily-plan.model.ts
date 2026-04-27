import type {
  DailyPlanAutoBuildInput,
  DailyPlanRecord,
  DailyPlanUnloadResponse,
  DailyPlanUpsertInput,
  EnergyMode,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredDailyPlanRecord = DailyPlanRecord

export interface DailyPlanReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface DailyPlanWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface GetDailyPlanCommand {
  context: DailyPlanReadContext
  date: string
}

export interface UpsertDailyPlanCommand {
  context: DailyPlanWriteContext
  date: string
  input: DailyPlanUpsertInput
}

export interface AutoBuildDailyPlanCommand {
  context: DailyPlanWriteContext
  input: DailyPlanAutoBuildInput
}

export interface UnloadDailyPlanCommand {
  context: DailyPlanReadContext
  date: string
}

export type DailyPlanUnloadResult = DailyPlanUnloadResponse

export type DailyPlanEnergyMode = EnergyMode
