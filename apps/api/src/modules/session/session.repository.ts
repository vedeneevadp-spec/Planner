import type {
  AssignableAppRole,
  CreateSharedWorkspaceInput,
} from '@planner/contracts'

import type {
  AdminUserRecord,
  SessionContext,
  SessionSnapshot,
  SessionWorkspaceMembership,
} from './session.model.js'

export interface SessionRepository {
  resolve(context: SessionContext): Promise<SessionSnapshot>
  createSharedWorkspace(
    session: SessionSnapshot,
    input: CreateSharedWorkspaceInput,
  ): Promise<SessionWorkspaceMembership>
  listAdminUsers(session: SessionSnapshot): Promise<AdminUserRecord[]>
  updateAdminUserRole(
    session: SessionSnapshot,
    userId: string,
    role: AssignableAppRole,
  ): Promise<AdminUserRecord>
}
