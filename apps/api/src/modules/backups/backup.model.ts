import type {
  UserBackupArchive,
  UserBackupPreviewResponse,
  UserBackupRestoreResponse,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export interface UserBackupContext {
  actorUserId: string | undefined
  auth: AuthenticatedRequestContext | null
  workspaceId: string
  workspaceKind?: 'personal' | 'shared'
  workspaceName?: string
}

export interface UserBackupExportInput {
  appVersion: string
  context: UserBackupContext
}

export interface UserBackupPreviewInput {
  archive: UserBackupArchive
  context: UserBackupContext
}

export interface UserBackupRestoreInput {
  archive: UserBackupArchive
  archiveDigest: string
  context: UserBackupContext & {
    actorUserId: string
    workspaceKind: 'personal'
  }
  idempotencyKey: string
  restoreProfile: boolean
  restoreWorkspaceSettings: boolean
}

export type UserBackupExportResult = UserBackupArchive
export type UserBackupPreviewResult = UserBackupPreviewResponse
export type UserBackupRestoreResult = UserBackupRestoreResponse
