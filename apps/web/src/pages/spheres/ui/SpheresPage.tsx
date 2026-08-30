import { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { type SessionReadiness, usePlannerTimeZone } from '@/features/session'
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
import { formatShortDate } from '@/shared/lib/date'
import { useBrowserOffline } from '@/shared/lib/offline-sync'
import { getTodayDate } from '@/shared/time/time.service'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageStateView, PageStatusBanner } from '@/shared/ui/PageState'

import {
  buildSphereStats,
  getCurrentWeekRange,
  getSphereActivityLabel,
  type SphereStats,
} from '../lib/sphere-stats'
import { SphereComposer } from './SphereComposer'
import styles from './SpheresPage.module.css'

const SPHERES_ACTION_REQUEST_SEARCH_PARAM = 'spheresActionRequest'
const SPHERES_ACTION_SEARCH_PARAM = 'spheresAction'
const TASK_CREATE_SEARCH_PARAM = 'createTask'

type SpheresBlockingState = 'error' | 'loading' | 'offline' | null

function resolveSpheresBlockingState(input: {
  hasCompleteRecords: boolean
  isCacheHydrating: boolean
  isOffline: boolean
  isLoading: boolean
  readiness: SessionReadiness
}): SpheresBlockingState {
  if (input.hasCompleteRecords) {
    return null
  }

  if (
    input.readiness.reason === 'unauthorized' ||
    input.readiness.reason === 'auth_deferred' ||
    input.readiness.reason === 'no_session'
  ) {
    return 'error'
  }

  if (input.isCacheHydrating) {
    return 'loading'
  }

  if (input.isOffline) {
    return 'offline'
  }

  if (input.readiness.reason === 'auth_restoring') {
    return 'loading'
  }

  if (input.readiness.reason === 'planner_pending') {
    return 'loading'
  }

  if (input.readiness.reason === 'planner_error') {
    return 'error'
  }

  if (input.isLoading) {
    return 'loading'
  }

  return 'error'
}

function getSpheresErrorDescription(readiness: SessionReadiness): string {
  if (isSpheresAccessUnavailable(readiness)) {
    return 'Не удалось подтвердить доступ к данным. Повторите попытку, чтобы восстановить сессию.'
  }

  return 'Сферы и связанные задачи не загрузились. Проверьте подключение и повторите попытку.'
}

function isSpheresAccessUnavailable(readiness: SessionReadiness): boolean {
  return (
    readiness.reason === 'unauthorized' ||
    readiness.reason === 'auth_deferred' ||
    readiness.reason === 'no_session'
  )
}

function getSpheresLastSuccessfulSyncAt(
  taskLastSuccessfulSyncAt: string | null,
  lifeSphereLastSuccessfulSyncAt: string | null,
): string | null {
  if (!taskLastSuccessfulSyncAt || !lifeSphereLastSuccessfulSyncAt) {
    return null
  }

  const taskTimestamp = new Date(taskLastSuccessfulSyncAt).getTime()
  const lifeSphereTimestamp = new Date(lifeSphereLastSuccessfulSyncAt).getTime()

  if (Number.isNaN(taskTimestamp) || Number.isNaN(lifeSphereTimestamp)) {
    return null
  }

  return taskTimestamp <= lifeSphereTimestamp
    ? taskLastSuccessfulSyncAt
    : lifeSphereLastSuccessfulSyncAt
}

function buildHeadline(stats: SphereStats[]): string {
  const sphereStats = stats.filter((stat) => !stat.isUnassigned)

  if (
    sphereStats.length > 0 &&
    sphereStats.every((stat) => stat.weeklyLoad === 0)
  ) {
    return 'На этой неделе задач по сферам пока нет'
  }

  const dominantSphere = stats.find(
    (stat) => !stat.isUnassigned && stat.weeklyShare >= 50,
  )
  const attentionCount = stats.filter(
    (stat) => !stat.isUnassigned && stat.activityState === 'attention',
  ).length

  if (dominantSphere) {
    return `Большая часть задач недели — «${dominantSphere.title}»`
  }

  if (attentionCount > 0) {
    return `В ${attentionCount} ${
      attentionCount === 1 ? 'сфере есть' : 'сферах есть'
    } задачи с прошедшей датой`
  }

  return 'Задачи недели распределены по сферам'
}

function getLastActivityLabel(
  stat: Pick<SphereStats, 'idleDays' | 'lastActivityAt'>,
): string {
  if (!stat.lastActivityAt || stat.idleDays === null) {
    return 'пока без задач'
  }

  return stat.idleDays === 0
    ? 'активность сегодня'
    : `последняя активность ${stat.idleDays} дн. назад`
}

export function SpheresPage() {
  const isBrowserOffline = useBrowserOffline()
  const {
    addSphere,
    hasLifeSphereRecords,
    hasLifeSphereReadError,
    hasTaskRecords,
    hasTaskReadError,
    isLifeSphereCacheHydrating,
    isLifeSphereOffline,
    isLoading,
    isTaskOffline,
    isTaskCacheHydrating,
    lifeSphereLastSuccessfulSyncAt,
    readiness,
    refresh,
    spheres,
    taskLastSuccessfulSyncAt,
    tasks,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const [searchParams, setSearchParams] = useSearchParams()
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const week = getCurrentWeekRange(todayKey)
  const createTaskRequestId = searchParams.get(TASK_CREATE_SEARCH_PARAM)
  const spheresAction = searchParams.get(SPHERES_ACTION_SEARCH_PARAM)
  const spheresActionRequestId = searchParams.get(
    SPHERES_ACTION_REQUEST_SEARCH_PARAM,
  )
  const sphereComposerOpenRequestId =
    spheresAction === 'sphere' ? spheresActionRequestId : null
  const taskComposerDraft = useMemo<TaskComposerDraft | null>(
    () =>
      createTaskRequestId
        ? {
            plannedDate: null,
            requestId: createTaskRequestId,
          }
        : null,
    [createTaskRequestId],
  )
  const hasCompleteRecords = hasLifeSphereRecords && hasTaskRecords
  const hasSpheresReadError = hasTaskReadError || hasLifeSphereReadError
  const isSpheresOffline =
    isBrowserOffline || isTaskOffline || isLifeSphereOffline
  const spheresLastSuccessfulSyncAt = getSpheresLastSuccessfulSyncAt(
    taskLastSuccessfulSyncAt,
    lifeSphereLastSuccessfulSyncAt,
  )
  const blockingState = resolveSpheresBlockingState({
    hasCompleteRecords,
    isCacheHydrating: isLifeSphereCacheHydrating || isTaskCacheHydrating,
    isOffline: isSpheresOffline,
    isLoading,
    readiness,
  })
  const stats = useMemo(
    () =>
      hasCompleteRecords
        ? buildSphereStats(spheres, tasks, week, todayKey, plannerTimeZone)
        : [],
    [hasCompleteRecords, plannerTimeZone, spheres, tasks, todayKey, week],
  )
  const statsBySphereId = useMemo(
    () => new Map(stats.map((stat) => [stat.sphereId, stat])),
    [stats],
  )
  const quietStats = stats.filter(
    (stat) => !stat.isUnassigned && stat.activityState === 'quiet',
  )
  const statusBannerKind =
    blockingState === null && isSpheresOffline
      ? ('offline' as const)
      : blockingState === null &&
          (readiness.reason === 'auth_restoring' ||
            readiness.reason === 'planner_pending')
        ? ('info' as const)
        : blockingState === null && hasSpheresReadError
          ? ('error' as const)
          : null
  const isSpheresAccessIssue = isSpheresAccessUnavailable(readiness)
  const isSpheresAccessRestoring =
    readiness.reason === 'auth_restoring' ||
    readiness.reason === 'planner_pending'
  const canUseSphereActions =
    blockingState === null && !isSpheresAccessIssue && !isSpheresAccessRestoring

  function openSphereComposer() {
    const nextSearchParams = new URLSearchParams(searchParams)
    const requestId = `sphere-empty-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
    nextSearchParams.set(SPHERES_ACTION_SEARCH_PARAM, 'sphere')
    nextSearchParams.set(SPHERES_ACTION_REQUEST_SEARCH_PARAM, requestId)
    setSearchParams(nextSearchParams)
  }

  function refreshSpheres() {
    void refresh({ retryDeniedAuth: isSpheresAccessIssue })
  }

  useEffect(() => {
    if (!createTaskRequestId || !canUseSphereActions) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete(TASK_CREATE_SEARCH_PARAM)
    setSearchParams(nextSearchParams, { replace: true })
  }, [canUseSphereActions, createTaskRequestId, searchParams, setSearchParams])

  return (
    <section className={pageStyles.page}>
      <h1 className={pageStyles.visuallyHidden}>Сферы жизни</h1>
      <TaskComposer
        desktopOpenButtonHidden
        hideOpenButton={!canUseSphereActions}
        initialPlannedDate={null}
        openButtonLabel="Действие"
        openDraft={canUseSphereActions ? taskComposerDraft : null}
      />

      <SphereComposer
        hideOpenButton
        openRequestId={canUseSphereActions ? sphereComposerOpenRequestId : null}
        uploadedIcons={uploadedIcons}
        onCreate={(values) => addSphere(values)}
      />

      {blockingState === 'loading' ? (
        <PageStateView
          kind="loading"
          title={
            isBrowserOffline ? 'Проверяем сохранённые сферы' : 'Загружаем сферы'
          }
          skeletonVariant="cards"
        />
      ) : blockingState === 'offline' ? (
        <PageStateView
          kind="offline"
          title="Сферы недоступны без подключения"
          description="На этом устройстве ещё нет полного сохранённого списка сфер и задач. Подключитесь к сети и попробуйте снова."
          lastSyncedAt={spheresLastSuccessfulSyncAt}
          showUnknownLastSync
          action={{ label: 'Повторить', onClick: refreshSpheres }}
        />
      ) : blockingState === 'error' ? (
        <PageStateView
          kind="error"
          title="Не удалось загрузить сферы"
          description={getSpheresErrorDescription(readiness)}
          action={{ label: 'Повторить', onClick: refreshSpheres }}
        />
      ) : (
        <>
          {statusBannerKind ? (
            <PageStatusBanner
              kind={statusBannerKind}
              title={
                statusBannerKind === 'offline'
                  ? 'Нет подключения'
                  : statusBannerKind === 'info'
                    ? 'Восстанавливаем доступ'
                    : isSpheresAccessIssue
                      ? 'Нужно восстановить доступ'
                      : 'Не удалось обновить сферы'
              }
              description={
                statusBannerKind === 'offline'
                  ? 'Показываем сохранённые данные. Новые сферы и задачи отправятся на сервер после подключения.'
                  : statusBannerKind === 'info'
                    ? 'Сохранённые данные доступны для просмотра. Изменения появятся после восстановления доступа.'
                    : isSpheresAccessIssue
                      ? 'Сохранённые данные доступны для просмотра. Обновите доступ, чтобы снова получать изменения.'
                      : 'Сохранённые данные остаются доступны. Повторите обновление.'
              }
              lastSyncedAt={spheresLastSuccessfulSyncAt}
              showUnknownLastSync
              action={
                isSpheresAccessRestoring
                  ? undefined
                  : {
                      label: isSpheresAccessIssue
                        ? 'Обновить доступ'
                        : 'Обновить',
                      onClick: refreshSpheres,
                    }
              }
            />
          ) : null}

          {spheres.length === 0 ? (
            <PageStateView
              kind="empty"
              title="Сфер пока нет"
              description="Создайте первую сферу, чтобы объединять связанные задачи и видеть их распределение."
              action={
                canUseSphereActions
                  ? {
                      label: 'Создать сферу',
                      onClick: openSphereComposer,
                    }
                  : undefined
              }
            />
          ) : (
            <>
              <section
                className={styles.balancePanel}
                aria-label="Доля задач по сферам за неделю"
              >
                <div className={styles.balanceSummary}>
                  <h3>{buildHeadline(stats)}</h3>
                  <p className={styles.balanceCaption}>
                    {formatShortDate(week.from)} - {formatShortDate(week.to)} ·
                    доля по задачам недели
                  </p>
                </div>
                <div className={styles.balanceBars}>
                  {stats.map((stat) => (
                    <div key={stat.sphereId} className={styles.balanceRow}>
                      <div className={styles.balanceLabel}>
                        <span
                          className={styles.tinyDot}
                          style={{ backgroundColor: stat.color }}
                          aria-hidden="true"
                        />
                        <span>{stat.title}</span>
                        <strong>{stat.weeklyShare}%</strong>
                      </div>
                      <div className={styles.barTrack} aria-hidden="true">
                        <span
                          className={styles.barFill}
                          style={{
                            backgroundColor: stat.color,
                            width: `${Math.max(
                              stat.weeklyShare,
                              stat.totalResource > 0 ? 4 : 0,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {quietStats.length > 0 ? (
                <section className={styles.quietPanel}>
                  <div>
                    <p className={styles.eyebrow}>Без недавней активности</p>
                    <h3>Здесь давно не было новых или завершённых задач</h3>
                  </div>
                  <div className={styles.quietList}>
                    {quietStats.slice(0, 4).map((stat) => (
                      <Link
                        key={stat.sphereId}
                        className={styles.quietChip}
                        to={`/spheres/${stat.sphereId}`}
                      >
                        {stat.title} · {getLastActivityLabel(stat)}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className={`${pageStyles.autoGrid} ${styles.spheresGrid}`}>
                {spheres.map((sphere) => {
                  const stat = statsBySphereId.get(sphere.id)

                  return (
                    <Link
                      key={sphere.id}
                      className={styles.sphereCard}
                      to={`/spheres/${sphere.id}`}
                    >
                      <div className={styles.cardHeader}>
                        <span
                          className={styles.sphereIcon}
                          style={{ backgroundColor: sphere.color }}
                        >
                          <IconMark
                            value={sphere.icon}
                            uploadedIcons={uploadedIcons}
                          />
                        </span>
                        <span
                          className={styles.activityBadge}
                          data-activity-state={stat?.activityState ?? 'empty'}
                        >
                          {getSphereActivityLabel(
                            stat?.activityState ?? 'empty',
                          )}
                        </span>
                      </div>

                      <div>
                        <p className={styles.eyebrow}>Сфера</p>
                        <h3>{sphere.name}</h3>
                        {sphere.description ? (
                          <p className={styles.sphereDescription}>
                            {sphere.description}
                          </p>
                        ) : null}
                        <p className={styles.cardCopy}>
                          {stat ? getLastActivityLabel(stat) : 'пока без задач'}
                        </p>
                      </div>

                      <div className={styles.statsGrid}>
                        <div>
                          <span>План</span>
                          <strong>{stat?.plannedCount ?? 0}</strong>
                        </div>
                        <div>
                          <span>Готово</span>
                          <strong>{stat?.completedCount ?? 0}</strong>
                        </div>
                        <div>
                          <span>Дата прошла</span>
                          <strong>{stat?.overdueCount ?? 0}</strong>
                        </div>
                        <div>
                          <span>Ресурс</span>
                          <strong>{stat?.totalResource ?? 0}</strong>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
