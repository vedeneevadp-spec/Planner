import { NavLink } from 'react-router-dom'

import { getPlannerSummary } from '@/entities/task'
import { usePlanner } from '@/features/planner'
import { usePlannerSession, useSessionAuth } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { formatLongDate, getDateKey } from '@/shared/lib/date'

import styles from './Sidebar.module.css'

const navigation = [
  { to: '/today', label: 'Today' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/projects', label: 'Projects' },
] as const

export function Sidebar() {
  const { errorMessage, isLoading, isSyncing, refresh, tasks } = usePlanner()
  const auth = useSessionAuth()
  const { data: session } = usePlannerSession()
  const todayKey = getDateKey(new Date())
  const summary = getPlannerSummary(tasks, todayKey)
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
        <h1>Мой рабочий ритм</h1>
        <p className={styles.copy}>
          {session
            ? `${session.actor.displayName} работает в workspace ${session.workspace.slug}. Данные загружаются через backend API и кэшируются на клиенте.`
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

        {auth.isAuthEnabled && auth.email ? (
          <div className={styles.accountRow}>
            <span className={styles.accountEmail}>{auth.email}</span>
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
        {navigation.map((item) => {
          const count =
            item.to === '/today'
              ? summary.focusCount + summary.overdueCount
              : item.to === '/timeline'
                ? summary.timelineCount
                : item.to === '/inbox'
                  ? summary.inboxCount
                  : summary.projectCount

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
            <span>Inbox</span>
            <strong>{summary.inboxCount}</strong>
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
