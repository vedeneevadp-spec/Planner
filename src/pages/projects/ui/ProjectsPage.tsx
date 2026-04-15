import { usePlanner } from '@/app/providers/usePlanner'
import { groupTasksByProject } from '@/entities/task/model/planner'
import { TaskCard } from '@/entities/task/ui/TaskCard'
import { TaskComposer } from '@/features/task-create/ui/TaskComposer'
import pageStyles from '@/shared/ui/Page/Page.module.css'
import { PageHeader } from '@/shared/ui/PageHeader/PageHeader'

import styles from './ProjectsPage.module.css'

export function ProjectsPage() {
  const { tasks } = usePlanner()
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
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
