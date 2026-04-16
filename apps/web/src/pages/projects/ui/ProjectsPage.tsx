import { groupTasksByProject, TaskCard } from '@/entities/task'
import { usePlanner } from '@/features/planner'
import { TaskComposer } from '@/features/task-create'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './ProjectsPage.module.css'

export function ProjectsPage() {
  const {
    tasks,
    isTaskPending,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
  } = usePlanner()
  const projectGroups = groupTasksByProject(tasks)

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Review"
        title="Projects"
        description="Проектные группы помогают увидеть, где копится долг и что реально движется."
      />

      <TaskComposer initialPlannedDate={null} />

      {projectGroups.length === 0 ? (
        <div className={pageStyles.emptyPanel}>
          <p>
            Проекты появятся автоматически, когда ты начнёшь указывать поле
            `Проект` у задач.
          </p>
        </div>
      ) : (
        <div className={pageStyles.autoGrid}>
          {projectGroups.map(([projectName, projectTasks]) => (
            <section key={projectName} className={styles.panel}>
              <div className={styles.header}>
                <div>
                  <p className={styles.eyebrow}>Project</p>
                  <h3>{projectName}</h3>
                </div>
                <span className={styles.countChip}>
                  {projectTasks.filter((task) => task.status === 'todo').length}
                </span>
              </div>

              <div className={styles.stack}>
                {projectTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isPending={isTaskPending(task.id)}
                    onRemove={(taskId) => {
                      void removeTask(taskId)
                    }}
                    onSetPlannedDate={(taskId, plannedDate) => {
                      void setTaskPlannedDate(taskId, plannedDate)
                    }}
                    onSetStatus={(taskId, status) => {
                      void setTaskStatus(taskId, status)
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
