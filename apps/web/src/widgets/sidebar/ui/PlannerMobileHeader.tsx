import {
  setSelectedWorkspaceIdForActors,
  usePlannerSession,
  useSessionAuth,
} from '@/features/session'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import styles from './PlannerTabs.module.css'

export function PlannerMobileHeader() {
  const auth = useSessionAuth()
  const { data: session } = usePlannerSession()

  return (
    <header className={styles.mobilePlannerHeader}>
      <SelectPicker
        className={styles.mobilePlannerWorkspaceSelect}
        ariaLabel="Workspace"
        value={session?.workspaceId ?? ''}
        disabled={!session}
        placeholder="Workspace"
        options={
          session
            ? session.workspaces.map((workspace) => ({
                label: workspace.name,
                value: workspace.id,
              }))
            : []
        }
        onChange={(nextWorkspaceId) => {
          setSelectedWorkspaceIdForActors(nextWorkspaceId, [
            auth.userId,
            session?.actorUserId,
          ])
        }}
      />
    </header>
  )
}
