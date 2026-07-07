import type {
  UserBackupExportInput,
  UserBackupExportResult,
} from './backup.model.js'

export interface UserBackupRepository {
  exportPersonalWorkspace(
    input: UserBackupExportInput,
  ): Promise<UserBackupExportResult>
}
