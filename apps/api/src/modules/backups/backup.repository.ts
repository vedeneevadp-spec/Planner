import type {
  UserBackupExportInput,
  UserBackupExportResult,
  UserBackupRestoreInput,
  UserBackupRestoreResult,
} from './backup.model.js'

export interface UserBackupRepository {
  exportPersonalWorkspace(
    input: UserBackupExportInput,
  ): Promise<UserBackupExportResult>
  restorePersonalWorkspace(
    input: UserBackupRestoreInput,
  ): Promise<UserBackupRestoreResult>
}
