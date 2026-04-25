import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

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
import {
  CalendarIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon,
} from '@/shared/ui/Icon'

import styles from './Sidebar.module.css'

const navigation = [
  { to: '/today', label: 'Сегодня' },
  { to: '/spheres', label: 'Сферы' },
  { to: '/timeline', label: 'Таймлайн' },
  { to: '/admin', label: 'Admin' },
] as const

export function Sidebar() {
  const { errorMessage, isLoading, isSyncing, projects, refresh, tasks } =
    usePlanner()
  const location = useLocation()
  const auth = useSessionAuth()
  const { data: session } = usePlannerSession()
  const createSharedWorkspaceMutation = useCreateSharedWorkspace()
  const [moreSheetPathname, setMoreSheetPathname] = useState<string | null>(
    null,
  )
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
        session?.appRole === 'admin' ||
        session?.appRole === 'owner'),
  )
  const syncStateLabel = errorMessage
    ? 'Connection issue'
    : isLoading
      ? 'Loading'
      : isSyncing
        ? 'Syncing'
        : 'Connected'
  const accountLabel =
    auth.email ??
    session?.actor.email ??
    (auth.accessToken ? 'Supabase session' : null)
  const mobilePrimaryNavigation = visibleNavigation.filter(
    (item) => item.to !== '/admin',
  )
  const mobileSecondaryNavigation = visibleNavigation.filter(
    (item) => item.to === '/admin',
  )
  const isMoreOpen = moreSheetPathname === location.pathname
  const isMoreActive =
    isMoreOpen ||
    mobileSecondaryNavigation.some((item) =>
      matchesRoute(location.pathname, item.to),
    )

  useEffect(() => {
    if (!isMoreOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMoreSheetPathname(null)
      }
    }

    function handleResize() {
      if (window.innerWidth > 820) {
        setMoreSheetPathname(null)
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
    }
  }, [isMoreOpen])

  return (
    <>
      <div className={styles.mobileChrome}>
        <header className={styles.mobileTopBar}>
          <h1>Chaotika</h1>

          <label className={styles.mobileWorkspaceSelect}>
            <select
              value={session?.workspaceId ?? ''}
              disabled={!session}
              onChange={(event) => {
                setSelectedWorkspaceId(event.target.value)
              }}
            >
              {session ? (
                session.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))
              ) : (
                <option value="">Workspace</option>
              )}
            </select>
          </label>
        </header>

        <nav aria-label="Mobile navigation" className={styles.mobileTabBar}>
          {mobilePrimaryNavigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cx(styles.mobileTabItem, isActive && styles.mobileTabItemActive)
              }
            >
              <span className={styles.mobileTabIcon} aria-hidden="true">
                {renderMobileNavIcon(item.to)}
              </span>
              <span className={styles.mobileTabLabel}>{item.label}</span>
            </NavLink>
          ))}

          <button
            className={cx(
              styles.mobileTabItem,
              styles.mobileTabButton,
              isMoreActive && styles.mobileTabItemActive,
            )}
            type="button"
            aria-expanded={isMoreOpen}
            aria-controls="mobile-more-sheet"
            onClick={() => {
              setMoreSheetPathname((current) =>
                current === location.pathname ? null : location.pathname,
              )
            }}
          >
            <span className={styles.mobileTabIcon} aria-hidden="true">
              <MoreIcon />
            </span>
            <span className={styles.mobileTabLabel}>Ещё</span>
          </button>
        </nav>

        {isMoreOpen ? (
          <div
            className={styles.mobileSheetBackdrop}
            role="presentation"
            onClick={() => {
              setMoreSheetPathname(null)
            }}
          >
            <section
              id="mobile-more-sheet"
              className={styles.mobileSheet}
              role="dialog"
              aria-modal="true"
              aria-label="Ещё"
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <div className={styles.mobileSheetHandle} aria-hidden="true" />

              <div className={styles.mobileSheetCard}>
                <div className={styles.connectionHeader}>
                  <div className={styles.workspaceIntro}>
                    <h6 className={styles.workspaceTitle}>
                      {session?.workspace.name ?? 'Определяем...'}
                    </h6>
                    <p className={styles.workspaceSubtitle}>
                      {session?.actor.displayName ?? 'Загружаем профиль'}
                    </p>
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

                <button
                  className={cx(
                    styles.createWorkspaceButton,
                    styles.mobileCreateWorkspaceButton,
                  )}
                  type="button"
                  disabled={
                    createSharedWorkspaceMutation.isPending ||
                    sharedWorkspaceCount >= 3
                  }
                  onClick={() => {
                    createSharedWorkspaceMutation.mutate()
                  }}
                >
                  <PlusIcon size={18} strokeWidth={2.15} />
                  <span>Создать пространство</span>
                </button>

                {createSharedWorkspaceMutation.error ? (
                  <p className={styles.connectionError}>
                    {getCreateSharedWorkspaceErrorMessage(
                      createSharedWorkspaceMutation.error,
                    )}
                  </p>
                ) : null}
              </div>

              {accountLabel || mobileSecondaryNavigation.length > 0 ? (
                <section className={styles.mobileSheetSection}>
                  <p className={styles.mobileSectionLabel}>Аккаунт</p>

                  {accountLabel ? (
                    <div className={styles.mobileInfoRow}>
                      <UserIcon size={18} strokeWidth={2.1} />
                      <span>{accountLabel}</span>
                    </div>
                  ) : null}

                  {mobileSecondaryNavigation.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={cx(styles.mobileSheetLink)}
                    >
                      <SettingsIcon size={18} strokeWidth={2.1} />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}

                  {auth.isAuthEnabled && accountLabel ? (
                    <button
                      className={styles.mobileSignOutButton}
                      type="button"
                      onClick={() => {
                        setMoreSheetPathname(null)
                        void auth.signOut()
                      }}
                    >
                      Выйти
                    </button>
                  ) : null}
                </section>
              ) : null}

              {errorMessage ? (
                <section className={styles.mobileSheetSection}>
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
                </section>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>

      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <h1>Chaotika</h1>
        </div>

        <section className={styles.connectionCard}>
          <div className={styles.connectionHeader}>
            <div className={styles.workspaceIntro}>
              <h6 className={styles.workspaceTitle}>
                {session?.workspace.name ?? 'Определяем...'}
              </h6>
              <p className={styles.workspaceSubtitle}>
                {session?.actor.displayName ?? 'Загружаем профиль'}
              </p>
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

          {session ? (
            <div className={styles.workspaceControls}>
              <label className={styles.workspaceSelect}>
                <select
                  value={session.workspaceId}
                  onChange={(event) => {
                    setSelectedWorkspaceId(event.target.value)
                  }}
                >
                  {session.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
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
                + Создать пространство
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

          {auth.isAuthEnabled && accountLabel ? (
            <div className={styles.accountRow}>
              <span className={styles.accountEmail}>{accountLabel}</span>
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
                    : (session?.appRole ?? 'Admin')

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
    </>
  )
}

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}

function renderMobileNavIcon(route: string) {
  if (route === '/today') {
    return <CalendarIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/spheres') {
    return <SpheresIcon />
  }

  return <TimelineIcon />
}

function SpheresIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.25" />
      <circle cx="16" cy="8" r="2.25" />
      <circle cx="8" cy="16" r="2.25" />
      <circle cx="16" cy="16" r="2.25" />
    </svg>
  )
}

function TimelineIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7H20" />
      <path d="M4 17H20" />
      <circle cx="8" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="6" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18" cy="12" r="1.8" fill="currentColor" />
    </svg>
  )
}
