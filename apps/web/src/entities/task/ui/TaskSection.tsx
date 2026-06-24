import type {
  WorkspaceGroupRole,
  WorkspaceRole,
  WorkspaceUserRecord,
} from '@planner/contracts'
import { type ReactNode, useCallback, useId, useState } from 'react'

import type { Sphere } from '@/entities/sphere'
import type { Task, TaskStatus, TaskUpdateInput } from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import type { UploadedIconAsset } from '@/shared/ui/Icon'

import { TaskCard } from './TaskCard'
import styles from './TaskSection.module.css'

type TaskCardVariant = 'card' | 'compact'

interface TaskSectionProps {
  title: string
  tasks: Task[]
  allTasks?: Task[] | undefined
  currentActorUserId?: string | undefined
  isSharedWorkspace?: boolean | undefined
  sharedWorkspaceGroupRole?: WorkspaceGroupRole | null | undefined
  sharedWorkspaceRole?: WorkspaceRole | undefined
  spheres?: Sphere[] | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  workspaceUsers?: WorkspaceUserRecord[] | undefined
  emptyMessage: string
  defaultCollapsed?: boolean | undefined
  extraItemCount?: number | undefined
  extraItems?: ReactNode | undefined
  taskCardVariant?: TaskCardVariant | undefined
  todayKey: string
  tomorrowKey: string
  tone?: 'default' | 'warning' | 'success'
  isTaskPending?: ((taskId: string) => boolean) | undefined
  onCreateNextStage?:
    | ((
        taskId: string,
        input: {
          completeCurrent: boolean
          plannedDate?: string | null | undefined
          title: string
        },
      ) => Promise<unknown> | undefined)
    | undefined
  onCopyToPersonal?: ((taskId: string) => void) | undefined
  onDetachFromChain?: ((taskId: string) => void) | undefined
  onMoveToPersonal?: ((taskId: string) => void) | undefined
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
  onRemove: (taskId: string) => void
}

export function TaskSection({
  title,
  tasks,
  allTasks = tasks,
  currentActorUserId,
  isSharedWorkspace = false,
  sharedWorkspaceGroupRole,
  sharedWorkspaceRole,
  spheres = [],
  uploadedIcons = [],
  workspaceUsers = [],
  emptyMessage,
  defaultCollapsed = false,
  extraItemCount = 0,
  extraItems,
  taskCardVariant = 'card',
  todayKey,
  tomorrowKey,
  tone = 'default',
  isTaskPending,
  onCreateNextStage,
  onCopyToPersonal,
  onDetachFromChain,
  onMoveToPersonal,
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
  const itemCount = tasks.length + extraItemCount
  const isCompactList = taskCardVariant === 'compact'
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
      className={cx(
        styles.panel,
        isCompactList && styles.compactPanel,
        openActionMenuTaskId && styles.panelMenuOpen,
      )}
    >
      <h3 className={styles.headerHeading}>
        <button
          className={styles.header}
          type="button"
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
          aria-labelledby={headingId}
          onClick={() => setIsCollapsed((value) => !value)}
        >
          <span className={styles.headingGroup}>
            <span id={headingId} className={styles.headingText}>
              {title}
            </span>
            <span className={styles.countChip} aria-hidden="true">
              {itemCount}
            </span>
          </span>
          <span className={styles.collapseButton} aria-hidden="true">
            <span
              className={cx(
                styles.collapseChevron,
                isCollapsed && styles.collapseChevronCollapsed,
              )}
              aria-hidden="true"
            />
          </span>
        </button>
      </h3>

      {!isCollapsed ? (
        <div id={contentId}>
          {itemCount === 0 ? (
            <p className={styles.emptyCopy}>{emptyMessage}</p>
          ) : (
            <div
              className={cx(styles.stack, isCompactList && styles.compactStack)}
            >
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  allTasks={allTasks}
                  task={task}
                  variant={taskCardVariant}
                  todayKey={todayKey}
                  tomorrowKey={tomorrowKey}
                  spheres={spheres}
                  sphere={spheres.find(
                    (sphere) => sphere.id === task.projectId,
                  )}
                  isPending={isTaskPending?.(task.id)}
                  isSharedWorkspace={isSharedWorkspace}
                  currentActorUserId={currentActorUserId}
                  sharedWorkspaceGroupRole={sharedWorkspaceGroupRole}
                  sharedWorkspaceRole={sharedWorkspaceRole}
                  uploadedIcons={uploadedIcons}
                  workspaceUsers={workspaceUsers}
                  tone={tone}
                  onCreateNextStage={onCreateNextStage}
                  onCopyToPersonal={onCopyToPersonal}
                  onDetachFromChain={onDetachFromChain}
                  onMoveToPersonal={onMoveToPersonal}
                  onRemove={onRemove}
                  onSetPlannedDate={onSetPlannedDate}
                  onSetStatus={onSetStatus}
                  onUpdate={onUpdate}
                  onActionMenuOpenChange={handleActionMenuOpenChange}
                />
              ))}
              {extraItems}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
