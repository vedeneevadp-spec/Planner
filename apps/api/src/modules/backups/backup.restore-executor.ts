import type { UserBackupRestoreResponse } from '@planner/contracts/backup'

import type { UserBackupRestoreInput } from './backup.model.js'

export interface UserBackupRestoreExecutor {
  restorePersonalWorkspace(
    input: UserBackupRestoreInput,
  ): Promise<UserBackupRestoreResponse>
}
