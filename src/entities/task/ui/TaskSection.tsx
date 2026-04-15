import type { Task, TaskStatus } from '../model/task.types'
import { TaskCard } from './TaskCard'
import styles from './TaskSection.module.css'

interface TaskSectionProps {
  title: string
  tasks: Task[]
  emptyMessage: string
  tone?: 'default' | 'warning' | 'success'
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onRemove: (taskId: string) => void
}

export function TaskSection({
  title,
  tasks,
  emptyMessage,
  tone = 'default',
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
