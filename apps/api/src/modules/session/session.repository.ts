import type {
  CreateSharedWorkspaceInput,
  WorkspaceRole,
} from '@planner/contracts'

import type {
  SessionContext,
  SessionSnapshot,
  SessionWorkspaceMembership,
  WorkspaceUserRecord,
} from './session.model.js'

export interface SessionRepository {
  resolve(context: SessionContext): Promise<SessionSnapshot>
  createSharedWorkspace(
    session: SessionSnapshot,
    input: CreateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership>
  listWorkspaceUsers(session: SessionSnapshot): Promise<WorkspaceUserRecord[]>
  updateWorkspaceUserRole(
    session: SessionSnapshot,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceUserRecord>
}
