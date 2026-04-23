import type { WorkspaceRole } from '@planner/contracts'

import type {
  SessionContext,
  SessionSnapshot,
  WorkspaceUserRecord,
} from './session.model.js'

export interface SessionRepository {
  resolve(context: SessionContext): Promise<SessionSnapshot>
  listWorkspaceUsers(session: SessionSnapshot): Promise<WorkspaceUserRecord[]>
  updateWorkspaceUserRole(
    session: SessionSnapshot,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceUserRecord>
}
