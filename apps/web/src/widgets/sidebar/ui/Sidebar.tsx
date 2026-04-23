import { NavLink } from 'react-router-dom'

import { getPlannerSummary } from '@/entities/task'
import { usePlanner } from '@/features/planner'
import {
  getCreateSharedWorkspaceErrorMessage,
  setSelectedWorkspaceId,
  useCreateSharedWorkspace,
  usePlannerSession,
  useSessionAuth,
} from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { formatLongDate, getDateKey } from '@/shared/lib/date'

import styles from './Sidebar.module.css'

const navigation = [
  { to: '/today', label: 'Сегодня' },
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
  const auth = useSessionAuth()
  const { data: session } = usePlannerSession()
  const createSharedWorkspaceMutation = useCreateSharedWorkspace()
  const todayKey = getDateKey(new Date())
  const summary = getPlannerSummary(tasks, todayKey)
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const sharedWorkspaceCount =
    session?.workspaces.filter((workspace) => workspace.kind === 'shared')
      .length ?? 0
  const visibleNavigation = navigation.filter(
    (item) =>
      (!isSharedWorkspace || item.to === '/today') &&
      (item.to !== '/admin' ||
        session?.role === 'admin' ||
        session?.role === 'owner'),
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
            ? `${session.actor.displayName} · ${getWorkspaceRoleLabel(session.role)}${
                session.groupRole
                  ? ` · ${getWorkspaceGroupRoleLabel(session.groupRole)}`
                  : ''
              }`
            : 'Session bootstrap'}
        </p>

        {session ? (
          <div className={styles.workspaceSwitcher}>
            <label className={styles.workspaceSelectLabel}>
              <span>Workspace</span>
              <select
                value={session.workspaceId}
                onChange={(event) => {
                  setSelectedWorkspaceId(event.target.value)
                }}
              >
                {session.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name} ·{' '}
                    {workspace.kind === 'shared' ? 'общий' : 'личный'}
                  </option>
                ))}
              </select>
            </label>

            <button
              className={styles.createWorkspaceButton}
              type="button"
              disabled={
                createSharedWorkspaceMutation.isPending ||
                sharedWorkspaceCount >= 3
              }
              onClick={() => {
                createSharedWorkspaceMutation.mutate()
              }}
            >
              + Общий
            </button>
          </div>
        ) : null}

        {createSharedWorkspaceMutation.error ? (
          <p className={styles.connectionError}>
            {getCreateSharedWorkspaceErrorMessage(
              createSharedWorkspaceMutation.error,
            )}
          </p>
        ) : null}

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
            <span>Done</span>
            <strong>{summary.doneTodayCount}</strong>
          </div>
        </div>
      </section>
    </aside>
  )
}

function getWorkspaceRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Admin',
    guest: 'Guest',
    owner: 'Owner',
    user: 'User',
  }

  return labels[role] ?? role
}

function getWorkspaceGroupRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    group_admin: 'Администратор группы',
    member: 'Участник',
    senior_member: 'Старший участник',
  }

  return labels[role] ?? role
}
