import { Link } from 'react-router-dom'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import { ProjectForm } from './ProjectForm'
import styles from './ProjectsPage.module.css'

export function ProjectsPage() {
  const { addProject, projects, tasks } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const taskCountsByProjectId = new Map<string, number>()

  for (const task of tasks) {
    if (!task.projectId || task.status !== 'todo') {
      continue
    }

    taskCountsByProjectId.set(
      task.projectId,
      (taskCountsByProjectId.get(task.projectId) ?? 0) + 1,
    )
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Projects"
        title="Проекты"
        description="Проекты заводятся отдельно от задач: у каждого есть название, описание, маркер и иконка."
      />

      <ProjectForm
        submitLabel="Создать проект"
        uploadedIcons={uploadedIcons}
        onSubmit={(values) => addProject(values)}
      />

      {projects.length === 0 ? (
        <div className={pageStyles.emptyPanel}>
          <p>
            Создайте первый проект, чтобы выбирать его при добавлении задач.
          </p>
        </div>
      ) : (
        <div className={pageStyles.autoGrid}>
          {projects.map((project) => {
            const activeTaskCount = taskCountsByProjectId.get(project.id) ?? 0

            return (
              <Link
                key={project.id}
                className={styles.projectCard}
                to={`/projects/${project.id}`}
              >
                <div className={styles.projectCardHeader}>
                  <span
                    className={styles.projectIcon}
                    style={{ backgroundColor: project.color }}
                  >
                    <IconMark
                      value={project.icon}
                      uploadedIcons={uploadedIcons}
                    />
                  </span>
                  <span className={styles.countChip}>{activeTaskCount}</span>
                </div>
                <div>
                  <p className={styles.eyebrow}>Project</p>
                  <h3>{project.title}</h3>
                </div>
                {project.description ? (
                  <p className={styles.projectDescription}>
                    {project.description}
                  </p>
                ) : null}
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
