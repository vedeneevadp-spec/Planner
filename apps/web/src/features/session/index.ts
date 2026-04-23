export {
  createSharedWorkspace,
  isUnauthorizedSessionApiError,
  SessionApiError,
} from './lib/session-api'
export { getSupabaseBrowserClient } from './lib/supabase-browser'
export { usePlannerSession } from './lib/usePlannerSession'
export { useSessionAuth } from './lib/useSessionAuth'
export {
  getCreateSharedWorkspaceErrorMessage,
  useCreateSharedWorkspace,
} from './lib/useWorkspaceActions'
export {
  useUpdateWorkspaceUserRole,
  useWorkspaceUsers,
} from './lib/useWorkspaceUsers'
export {
  clearSelectedWorkspaceId,
  getSelectedWorkspaceId,
  setSelectedWorkspaceId,
  useSelectedWorkspaceId,
} from './lib/workspace-selection'
export {
  createWorkspaceUsersApiClient,
  WorkspaceUsersApiError,
} from './lib/workspace-users-api'
export { AuthGate } from './ui/AuthGate'
export { SessionProvider } from './ui/SessionProvider'
