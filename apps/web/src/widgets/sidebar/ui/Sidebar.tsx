import { useQuery } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'

import { getPlannerSummary } from '@/entities/task'
import { usePlanner, usePlannerApiClient } from '@/features/planner'
import { usePlannerSession, useSessionAuth } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { formatLongDate, getDateKey } from '@/shared/lib/date'

import styles from './Sidebar.module.css'

const navigation = [
  { to: '/today', label: 'Сегодня' },
  { to: '/inbox', label: 'Сброс' },
  { to: '/spheres', label: 'Сферы' },
  { to: '/timeline', label: 'Таймлайн' },
  { to: '/admin', label: 'Admin' },
] as const

export function Sidebar() {
  const {
    conflictedMutationCount,
    errorMessage,
    isLoading,
    isSyncing,
    projects,
    queuedMutationCount,
    refresh,
    tasks,
  } = usePlanner()
  const api = usePlannerApiClient()
  const auth = useSessionAuth()
  const { data: session } = usePlannerSession()
  const todayKey = getDateKey(new Date())
  const summary = getPlannerSummary(tasks, todayKey)
  const chaosInboxCountQuery = useQuery({
    enabled: api !== null,
    queryFn: async ({ signal }) => {
      const [newItems, inReviewItems] = await Promise.all([
        api!.listChaosInboxItems({ limit: 1, status: 'new' }, signal),
        api!.listChaosInboxItems({ limit: 1, status: 'in_review' }, signal),
      ])

      return newItems.total + inReviewItems.total
    },
    queryKey: [
      'chaos-inbox',
      'active-count',
      session?.workspaceId ?? 'pending',
    ],
    staleTime: 30_000,
  })
  const chaosInboxCount = chaosInboxCountQuery.data ?? 0
  const visibleNavigation = navigation.filter(
    (item) =>
      item.to !== '/admin' ||
      session?.role === 'admin' ||
      session?.role === 'owner',
  )
  const syncStateLabel = errorMessage
    ? 'Connection issue'
    : isLoading
      ? 'Loading'
      : isSyncing
        ? 'Syncing'
        : 'Connected'

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandBlock}>
        <p className={styles.eyebrow}>{session?.workspace.name ?? 'Planner'}</p>
        <h1>Chaotika</h1>
        <p className={styles.copy}>
          {session
            ? `${session.actor.displayName} собирает хаос в workspace ${session.workspace.slug}. Данные синхронизируются через backend API и кэшируются на клиенте.`
            : 'Определяем текущий workspace и пользователя перед загрузкой задач.'}
        </p>
      </div>

      <section className={styles.connectionCard}>
        <div className={styles.connectionHeader}>
          <div>
            <p className={styles.summaryLabel}>Workspace</p>
            <strong>{session?.workspace.name ?? 'Определяем...'}</strong>
          </div>
          <span
            className={cx(
              styles.stateBadge,
              errorMessage
                ? styles.stateBadgeError
                : isSyncing || isLoading
                  ? styles.stateBadgePending
                  : styles.stateBadgeOk,
            )}
          >
            {syncStateLabel}
          </span>
        </div>

        <p className={styles.connectionMeta}>
          {session
            ? `${session.actor.displayName} · ${session.role}`
            : 'Session bootstrap'}
        </p>

        {queuedMutationCount > 0 || conflictedMutationCount > 0 ? (
          <div className={styles.queueState}>
            {queuedMutationCount > 0 ? (
              <span>{queuedMutationCount} в offline-очереди</span>
            ) : null}
            {conflictedMutationCount > 0 ? (
              <span>{conflictedMutationCount} конфликтов</span>
            ) : null}
          </div>
        ) : null}

        {auth.isAuthEnabled && (auth.email || auth.accessToken) ? (
          <div className={styles.accountRow}>
            <span className={styles.accountEmail}>
              {auth.email ?? 'Supabase session'}
            </span>
            <button
              className={styles.signOutButton}
              type="button"
              onClick={() => {
                void auth.signOut()
              }}
            >
              Выйти
            </button>
          </div>
        ) : null}

        {errorMessage ? (
          <>
            <p className={styles.connectionError}>{errorMessage}</p>
            <button
              className={styles.retryButton}
              type="button"
              onClick={() => {
                void refresh()
              }}
            >
              Повторить синхронизацию
            </button>
          </>
        ) : null}
      </section>

      <nav aria-label="Main navigation" className={styles.navList}>
        {visibleNavigation.map((item) => {
          const count =
            item.to === '/today'
              ? summary.focusCount + summary.overdueCount
              : item.to === '/timeline'
                ? summary.timelineCount
                : item.to === '/inbox'
                  ? chaosInboxCount
                  : item.to === '/spheres'
                    ? projects.length
                    : (session?.role ?? 'Admin')

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cx(styles.navItem, isActive && styles.navItemActive)
              }
            >
              <span>{item.label}</span>
              <strong>{count}</strong>
            </NavLink>
          )
        })}
      </nav>

      <section className={styles.summaryCard}>
        <p className={styles.summaryLabel}>Сегодня</p>
        <strong>{formatLongDate(todayKey)}</strong>
        <div className={styles.summaryGrid}>
          <div>
            <span>Focus</span>
            <strong>{summary.focusCount}</strong>
          </div>
          <div>
            <span>Timeline</span>
            <strong>{summary.timelineCount}</strong>
          </div>
          <div>
            <span>Tomorrow</span>
            <strong>{summary.tomorrowCount}</strong>
          </div>
          <div>
            <span>Сброс</span>
            <strong>{chaosInboxCount}</strong>
          </div>
          <div>
            <span>Done</span>
            <strong>{summary.doneTodayCount}</strong>
          </div>
        </div>
      </section>
    </aside>
  )
}
