import type { Task } from '@/entities/task/model/task.types'
import { TaskCard } from '@/entities/task/ui/TaskCard'

import styles from './TaskSection.module.css'

interface TaskSectionProps {
  title: string
  tasks: Task[]
  emptyMessage: string
  tone?: 'default' | 'warning' | 'success'
}

export function TaskSection({
  title,
  tasks,
  emptyMessage,
  tone = 'default',
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
            <TaskCard key={task.id} task={task} tone={tone} />
          ))}
        </div>
      )}
    </section>
  )
}
