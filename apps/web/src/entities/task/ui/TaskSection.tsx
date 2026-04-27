import type { WorkspaceUserRecord } from '@planner/contracts'

import type { Project } from '@/entities/project'
import type { Task, TaskStatus, TaskUpdateInput } from '@/entities/task'
import type { UploadedIconAsset } from '@/shared/ui/Icon'

import { TaskCard } from './TaskCard'
import styles from './TaskSection.module.css'

interface TaskSectionProps {
  title: string
  tasks: Task[]
  isSharedWorkspace?: boolean | undefined
  projects?: Project[] | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  workspaceUsers?: WorkspaceUserRecord[] | undefined
  emptyMessage: string
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
  isSharedWorkspace = false,
  projects = [],
  uploadedIcons = [],
  workspaceUsers = [],
  emptyMessage,
  tone = 'default',
  isTaskPending,
  onSetStatus,
  onSetPlannedDate,
  onUpdate,
  onRemove,
}: TaskSectionProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h3>{title}</h3>
        <span className={styles.countChip}>{tasks.length}</span>
      </div>

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
              uploadedIcons={uploadedIcons}
              workspaceUsers={workspaceUsers}
              tone={tone}
              onRemove={onRemove}
              onSetPlannedDate={onSetPlannedDate}
              onSetStatus={onSetStatus}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </section>
  )
}
