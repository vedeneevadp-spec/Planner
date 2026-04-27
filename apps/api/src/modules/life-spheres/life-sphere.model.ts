import type {
  LifeSphereRecord,
  LifeSphereUpdateInput,
  NewLifeSphereInput,
  SphereStatsWeekly,
  WeeklySphereStatsResponse,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredLifeSphereRecord = LifeSphereRecord

export interface LifeSphereReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface LifeSphereWriteContext {
  actorUserId: string
  auth: AuthenticatedRequestContext | null
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface CreateLifeSphereCommand {
  context: LifeSphereWriteContext
  input: NewLifeSphereInput
}

export interface UpdateLifeSphereCommand {
  context: LifeSphereWriteContext
  input: LifeSphereUpdateInput
  sphereId: string
}

export interface DeleteLifeSphereCommand {
  context: LifeSphereWriteContext
  sphereId: string
}

export interface WeeklySphereStatsCommand {
  context: LifeSphereReadContext
  from: string
  to: string
}

export type WeeklySphereStatsResult = WeeklySphereStatsResponse

export type StoredSphereStatsWeekly = SphereStatsWeekly
