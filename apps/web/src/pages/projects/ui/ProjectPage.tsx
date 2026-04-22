import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { TaskSection } from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import { ProjectForm } from './ProjectForm'
import styles from './ProjectsPage.module.css'

export function ProjectPage() {
  const { projectId } = useParams()
  const {
    isLoading,
    isTaskPending,
    projects,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
    tasks,
    updateProject,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const [isEditing, setIsEditing] = useState(false)
  const project = projects.find((candidate) => candidate.id === projectId)
  const projectTasks = useMemo(
    () => tasks.filter((task) => task.projectId === projectId),
    [projectId, tasks],
  )

  if (!project) {
    return (
      <section className={pageStyles.page}>
        <PageHeader
          kicker="Projects"
          title={isLoading ? 'Загружаем проект' : 'Проект не найден'}
          description={
            isLoading
              ? 'Проверяем список проектов в текущем workspace.'
              : 'В этом workspace нет проекта с таким идентификатором.'
          }
        />
        <Link className={styles.secondaryButton} to="/projects">
          К проектам
        </Link>
      </section>
    )
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Project"
        title={project.title}
        description={project.description || 'Описание проекта пока пустое.'}
      />

      <section className={styles.detailPanel}>
        <div className={styles.detailHeader}>
          <div className={styles.projectIdentity}>
            <span
              className={styles.projectIconLarge}
              style={{ backgroundColor: project.color }}
            >
              <IconMark value={project.icon} uploadedIcons={uploadedIcons} />
            </span>
            <div>
              <p className={styles.eyebrow}>Marker</p>
              <h3>{project.title}</h3>
            </div>
          </div>

          <div className={styles.detailActions}>
            <Link className={styles.secondaryButton} to="/projects">
              К проектам
            </Link>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => setIsEditing((value) => !value)}
            >
              {isEditing ? 'Закрыть' : 'Редактировать'}
            </button>
          </div>
        </div>

        {isEditing ? (
          <ProjectForm
            project={project}
            submitLabel="Сохранить"
            uploadedIcons={uploadedIcons}
            onCancel={() => setIsEditing(false)}
            onSubmit={async (values) => {
              const isSaved = await updateProject(project.id, {
                ...values,
                expectedVersion: project.version,
              })

              if (isSaved) {
                setIsEditing(false)
              }

              return isSaved
            }}
          />
        ) : null}
      </section>

      <TaskSection
        title="Задачи проекта"
        tasks={projectTasks}
        projects={projects}
        uploadedIcons={uploadedIcons}
        emptyMessage="В этом проекте пока нет задач."
        isTaskPending={isTaskPending}
        onRemove={(taskId) => {
          void removeTask(taskId)
        }}
        onSetPlannedDate={(taskId, plannedDate) => {
          void setTaskPlannedDate(taskId, plannedDate)
        }}
        onSetStatus={(taskId, status) => {
          void setTaskStatus(taskId, status)
        }}
        onUpdate={updateTask}
      />
    </section>
  )
}
