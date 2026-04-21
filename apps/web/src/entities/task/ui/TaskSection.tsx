import type { Project } from '@/entities/project'
import type { Task, TaskStatus } from '@/entities/task'

import { TaskCard } from './TaskCard'
import styles from './TaskSection.module.css'

interface TaskSectionProps {
  title: string
  tasks: Task[]
  projects?: Project[] | undefined
  emptyMessage: string
  tone?: 'default' | 'warning' | 'success'
  isTaskPending?: ((taskId: string) => boolean) | undefined
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onRemove: (taskId: string) => void
}

export function TaskSection({
  title,
  tasks,
  projects = [],
  emptyMessage,
  tone = 'default',
  isTaskPending,
  onSetStatus,
  onSetPlannedDate,
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
              project={projects.find(
                (project) => project.id === task.projectId,
              )}
              isPending={isTaskPending?.(task.id)}
              tone={tone}
              onRemove={onRemove}
              onSetPlannedDate={onSetPlannedDate}
              onSetStatus={onSetStatus}
            />
          ))}
        </div>
      )}
    </section>
  )
}
