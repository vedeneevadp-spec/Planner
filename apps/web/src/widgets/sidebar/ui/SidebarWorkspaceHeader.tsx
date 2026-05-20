import type { SessionResponse } from '@planner/contracts'

import { cx } from '@/shared/lib/classnames'

import styles from './Sidebar.module.css'
import { WorkspaceGearIcon } from './SidebarIcons'

interface SidebarWorkspaceHeaderProps {
  actionAriaLabel: string
  actionsControlId: string
  errorMessage: string | null
  isActionsOpen: boolean
  isLoading: boolean
  isSyncing: boolean
  onToggleActions: () => void
  session: SessionResponse | undefined
  syncStateLabel: string
}

export function SidebarWorkspaceHeader({
  actionAriaLabel,
  actionsControlId,
  errorMessage,
  isActionsOpen,
  isLoading,
  isSyncing,
  onToggleActions,
  session,
  syncStateLabel,
}: SidebarWorkspaceHeaderProps) {
  return (
    <div className={styles.connectionHeader}>
      <div className={styles.workspaceIntro}>
        <h6 className={styles.workspaceTitle}>
          {session?.workspace.name ?? 'Определяем...'}
        </h6>
        <p className={styles.workspaceSubtitle}>
          {session?.actor.displayName ?? 'Загружаем профиль'}
        </p>
      </div>
      <div className={styles.connectionHeaderActions}>
        <span
          className={cx(
            styles.stateBadge,
            errorMessage
              ? styles.stateBadgeError
              : isSyncing || isLoading
                ? styles.stateBadgePending
                : styles.stateBadgeOk,
          )}
        >
          {syncStateLabel}
        </span>

        {session ? (
          <button
            className={styles.workspaceSettingsButton}
            type="button"
            aria-label={actionAriaLabel}
            aria-expanded={isActionsOpen}
            aria-controls={actionsControlId}
            onClick={onToggleActions}
          >
            <WorkspaceGearIcon />
          </button>
        ) : null}
      </div>
    </div>
  )
}
