import type {
  UserBackupArchive,
  UserBackupPreviewResponse,
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

export type UserBackupExportResult = UserBackupArchive
export type UserBackupPreviewResult = UserBackupPreviewResponse
