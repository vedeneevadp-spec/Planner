import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { TaskSection } from '@/entities/task/ui'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import {
  usePlannerSession,
  usePlannerTimeZone,
  useWorkspaceUsers,
} from '@/features/session'
import { useBrowserOffline } from '@/shared/lib/offline-sync'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PageStateView, PageStatusBanner } from '@/shared/ui/PageState'

import { SphereForm } from './SphereForm'
import styles from './SpheresPage.module.css'

export function SpherePage() {
  const { sphereId } = useParams()
  const navigate = useNavigate()
  const {
    copyTaskToPersonal,
    createNextTaskStage,
    detachTaskFromChain,
    hasLifeSphereRecords,
    hasLifeSphereReadError,
    hasTaskRecords,
    hasTaskReadError,
    isLifeSphereCacheHydrating,
    isLifeSphereOffline,
    isLoading,
    isTaskPending,
    isTaskCacheHydrating,
    isTaskOffline,
    moveTaskToPersonal,
    readiness,
    refresh,
    removeSphere,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
    spheres,
    tasks,
    updateSphere,
    updateTask,
  } = usePlanner()
  const { data: session } = usePlannerSession()
  const isBrowserOffline = useBrowserOffline()
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const tomorrowKey = addDateDays(todayKey, 1)
  const { uploadedIcons } = useUploadedIconAssets()
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const workspaceUsersQuery = useWorkspaceUsers({
    enabled: isSharedWorkspace,
  })
  const workspaceUsers = workspaceUsersQuery.data?.users ?? []
  const [isEditing, setIsEditing] = useState(false)
  const sphere = spheres.find((candidate) => candidate.id === sphereId)
  const isOffline = isBrowserOffline || isLifeSphereOffline || isTaskOffline
  const hasReadError = hasLifeSphereReadError || hasTaskReadError
  const isAccessUnavailable =
    readiness.reason === 'unauthorized' ||
    readiness.reason === 'auth_deferred' ||
    readiness.reason === 'no_session'
  function refreshSphere() {
    void refresh({ retryDeniedAuth: isAccessUnavailable })
  }
  const sphereTasks = useMemo(
    () => tasks.filter((task) => task.projectId === sphereId),
    [sphereId, tasks],
  )

  async function handleRemoveSphere() {
    if (!sphere) {
      return
    }

    const confirmed = window.confirm(
      `Удалить сферу «${sphere.name}»? Задачи останутся без сферы.`,
    )

    if (!confirmed) {
      return
    }

    const isRemoved = await removeSphere(sphere.id)

    if (isRemoved) {
      void navigate('/spheres')
    }
  }

  if (!sphere) {
    const isHydrating =
      isLifeSphereCacheHydrating || (isLoading && !hasLifeSphereRecords)
    const isUnavailable =
      isOffline ||
      hasLifeSphereReadError ||
      isAccessUnavailable ||
      (!hasLifeSphereRecords && !isHydrating)
    return (
      <section className={pageStyles.page}>
        {isHydrating ? (
          <PageStateView
            kind="loading"
            title="Загружаем сферу"
            skeletonVariant="cards"
          />
        ) : isUnavailable ? (
          <PageStateView
            kind={isOffline ? 'offline' : 'error'}
            title={
              isOffline
                ? 'Сфера недоступна без подключения'
                : 'Не удалось загрузить сферу'
            }
            description="Не удалось получить список сфер. Восстановите подключение и повторите попытку."
            action={{ label: 'Повторить', onClick: refreshSphere }}
          />
        ) : (
          <PageHeader
            kicker="Сферы"
            title="Сфера не найдена"
            description="В текущем пространстве нет такой сферы."
          />
        )}
        <Link className={styles.secondaryButton} to="/spheres">
          К сферам
        </Link>
      </section>
    )
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Сфера"
        title={sphere.name}
        description={sphere.description || 'Описание сферы пока пустое.'}
      />
      {isOffline || hasReadError || isAccessUnavailable ? (
        <PageStatusBanner
          kind={isOffline ? 'offline' : 'error'}
          title={isOffline ? 'Нет подключения' : 'Не удалось обновить данные'}
          description="Показываем последние загруженные данные."
          action={{ label: 'Повторить', onClick: refreshSphere }}
        />
      ) : null}

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
              <h3>{sphere.name}</h3>
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
            <button
              className={styles.dangerButton}
              type="button"
              onClick={() => {
                void handleRemoveSphere()
              }}
            >
              Удалить
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
              const isSaved = await updateSphere(sphere.id, {
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

      {!hasTaskRecords ? (
        <PageStateView
          kind={
            isTaskCacheHydrating || isLoading
              ? 'loading'
              : isOffline
                ? 'offline'
                : 'error'
          }
          title={
            isTaskCacheHydrating || isLoading
              ? 'Загружаем задачи сферы'
              : 'Не удалось загрузить задачи сферы'
          }
          action={{ label: 'Повторить', onClick: refreshSphere }}
        />
      ) : (
        <TaskSection
          title="Задачи сферы"
          tasks={sphereTasks}
          allTasks={tasks}
          currentActorUserId={session?.actorUserId}
          isSharedWorkspace={isSharedWorkspace}
          sharedWorkspaceGroupRole={session?.groupRole}
          sharedWorkspaceRole={session?.role}
          spheres={spheres}
          uploadedIcons={uploadedIcons}
          workspaceUsers={workspaceUsers}
          emptyMessage="В этой сфере пока нет задач."
          isTaskPending={isTaskPending}
          todayKey={todayKey}
          tomorrowKey={tomorrowKey}
          onRemove={(taskId) => {
            void removeTask(taskId)
          }}
          onCreateNextStage={(taskId, input) =>
            createNextTaskStage(taskId, input)
          }
          onCopyToPersonal={(taskId) => {
            void copyTaskToPersonal(taskId)
          }}
          onDetachFromChain={(taskId) => {
            void detachTaskFromChain(taskId)
          }}
          onMoveToPersonal={(taskId) => {
            void moveTaskToPersonal(taskId)
          }}
          onSetPlannedDate={(taskId, plannedDate) => {
            void setTaskPlannedDate(taskId, plannedDate)
          }}
          onSetStatus={(taskId, status) => {
            void setTaskStatus(taskId, status)
          }}
          onUpdate={updateTask}
        />
      )}
    </section>
  )
}
