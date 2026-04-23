import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { TaskSection } from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import { SphereForm } from './SphereForm'
import styles from './SpheresPage.module.css'

export function SpherePage() {
  const { sphereId } = useParams()
  const {
    isLoading,
    isTaskPending,
    projects: spheres,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
    tasks,
    updateProject,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const [isEditing, setIsEditing] = useState(false)
  const sphere = spheres.find((candidate) => candidate.id === sphereId)
  const sphereTasks = useMemo(
    () => tasks.filter((task) => task.projectId === sphereId),
    [sphereId, tasks],
  )

  if (!sphere) {
    return (
      <section className={pageStyles.page}>
        <PageHeader
          kicker="Spheres"
          title={isLoading ? 'Загружаем сферу' : 'Сфера не найдена'}
          description={
            isLoading
              ? 'Проверяем список сфер в текущем workspace.'
              : 'В этом workspace нет сферы с таким идентификатором.'
          }
        />
        <Link className={styles.secondaryButton} to="/spheres">
          К сферам
        </Link>
      </section>
    )
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Sphere"
        title={sphere.title}
        description={sphere.description || 'Описание сферы пока пустое.'}
      />

      <section className={styles.detailPanel}>
        <div className={styles.detailHeader}>
          <div className={styles.sphereIdentity}>
            <span
              className={styles.sphereIconLarge}
              style={{ backgroundColor: sphere.color }}
            >
              <IconMark value={sphere.icon} uploadedIcons={uploadedIcons} />
            </span>
            <div>
              <p className={styles.eyebrow}>Marker</p>
              <h3>{sphere.title}</h3>
            </div>
          </div>

          <div className={styles.detailActions}>
            <Link className={styles.secondaryButton} to="/spheres">
              К сферам
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
          <SphereForm
            sphere={sphere}
            submitLabel="Сохранить"
            uploadedIcons={uploadedIcons}
            onCancel={() => setIsEditing(false)}
            onSubmit={async (values) => {
              const isSaved = await updateProject(sphere.id, {
                ...values,
                expectedVersion: sphere.version,
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
        title="Задачи сферы"
        tasks={sphereTasks}
        projects={spheres}
        uploadedIcons={uploadedIcons}
        emptyMessage="В этой сфере пока нет задач."
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
