import type {
  WorkspaceGroupRole,
  WorkspaceRole,
  WorkspaceUserRecord,
} from '@planner/contracts'
import { useCallback, useId, useState } from 'react'

import type { Project } from '@/entities/project'
import type { Task, TaskStatus, TaskUpdateInput } from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import type { UploadedIconAsset } from '@/shared/ui/Icon'

import { TaskCard } from './TaskCard'
import styles from './TaskSection.module.css'

interface TaskSectionProps {
  title: string
  tasks: Task[]
  currentActorUserId?: string | undefined
  isSharedWorkspace?: boolean | undefined
  sharedWorkspaceGroupRole?: WorkspaceGroupRole | null | undefined
  sharedWorkspaceRole?: WorkspaceRole | undefined
  projects?: Project[] | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  workspaceUsers?: WorkspaceUserRecord[] | undefined
  emptyMessage: string
  defaultCollapsed?: boolean | undefined
  tone?: 'default' | 'warning' | 'success'
  isTaskPending?: ((taskId: string) => boolean) | undefined
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
  onRemove: (taskId: string) => void
}

export function TaskSection({
  title,
  tasks,
  currentActorUserId,
  isSharedWorkspace = false,
  sharedWorkspaceGroupRole,
  sharedWorkspaceRole,
  projects = [],
  uploadedIcons = [],
  workspaceUsers = [],
  emptyMessage,
  defaultCollapsed = false,
  tone = 'default',
  isTaskPending,
  onSetStatus,
  onSetPlannedDate,
  onUpdate,
  onRemove,
}: TaskSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const [openActionMenuTaskId, setOpenActionMenuTaskId] = useState<
    string | null
  >(null)
  const contentId = useId()
  const headingId = useId()
  const handleActionMenuOpenChange = useCallback(
    (taskId: string, isOpen: boolean) => {
      setOpenActionMenuTaskId((currentTaskId) => {
        if (isOpen) {
          return taskId
        }

        return currentTaskId === taskId ? null : currentTaskId
      })
    },
    [],
  )

  return (
    <section
      className={cx(styles.panel, openActionMenuTaskId && styles.panelMenuOpen)}
    >
      <div className={styles.header}>
        <h3 id={headingId}>{title}</h3>
        <button
          className={styles.collapseButton}
          type="button"
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
          aria-labelledby={headingId}
          onClick={() => setIsCollapsed((value) => !value)}
        >
          <span className={styles.countChip}>{tasks.length}</span>
          <span
            className={cx(
              styles.collapseChevron,
              isCollapsed && styles.collapseChevronCollapsed,
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {!isCollapsed ? (
        <div id={contentId}>
          {tasks.length === 0 ? (
            <p className={styles.emptyCopy}>{emptyMessage}</p>
          ) : (
            <div className={styles.stack}>
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  projects={projects}
                  project={projects.find(
                    (project) => project.id === task.projectId,
                  )}
                  isPending={isTaskPending?.(task.id)}
                  isSharedWorkspace={isSharedWorkspace}
                  currentActorUserId={currentActorUserId}
                  sharedWorkspaceGroupRole={sharedWorkspaceGroupRole}
                  sharedWorkspaceRole={sharedWorkspaceRole}
                  uploadedIcons={uploadedIcons}
                  workspaceUsers={workspaceUsers}
                  tone={tone}
                  onRemove={onRemove}
                  onSetPlannedDate={onSetPlannedDate}
                  onSetStatus={onSetStatus}
                  onUpdate={onUpdate}
                  onActionMenuOpenChange={handleActionMenuOpenChange}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
