import { useCallback, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { getPlannerSummary, isActiveTaskStatus } from '@/entities/task'
import { useCleaningSummary } from '@/features/cleaning'
import { usePlanner } from '@/features/planner'
import { useSelfCareDashboard } from '@/features/self-care'
import {
  getSessionReadinessConnectionView,
  setSelectedWorkspaceIdForActors,
  usePlannerSession,
  UserAvatar,
  useSessionAuth,
  WorkspaceParticipantsDialog,
} from '@/features/session'
import { useShoppingListSummary } from '@/features/shopping-list'
import { getVisibleNavigationRouteDefinitions } from '@/shared/config/routes'
import { cx } from '@/shared/lib/classnames'
import { getDateKey } from '@/shared/lib/date'
import { useColorTheme } from '@/shared/lib/theme'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  GearIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import { PlannerSideTabs } from './PlannerSideTabs'
import styles from './Sidebar.module.css'
import { MoreIcon, SidebarNavIcon } from './SidebarIcons'
import { SidebarNavigation } from './SidebarNavigation'
import { SidebarTodaySummary } from './SidebarTodaySummary'
import { SidebarWorkspaceActions } from './SidebarWorkspaceActions'
import { SidebarWorkspaceHeader } from './SidebarWorkspaceHeader'

interface MobileMoreSheetLocation {
  key: string
  pathname: string
}

interface SidebarProps {
  isCollapsed?: boolean
  navigationMode?: 'full' | 'service'
  onCollapsedChange?: (isCollapsed: boolean) => void
}

export function Sidebar({
  isCollapsed = false,
  navigationMode = 'full',
  onCollapsedChange,
}: SidebarProps) {
  const {
    conflictedMutationCount,
    debugErrorDetails,
    errorMessage,
    isLoading,
    isSyncing,
    queuedMutationCount,
    readiness,
    refresh,
    spheres,
    tasks,
  } = usePlanner()
  const cleaningSummary = useCleaningSummary()
  const shoppingListSummary = useShoppingListSummary()
  const location = useLocation()
  const auth = useSessionAuth()
  const { isDark, toggleTheme } = useColorTheme()
  const { data: session } = usePlannerSession()
  const [moreSheetLocation, setMoreSheetLocation] =
    useState<MobileMoreSheetLocation | null>(null)
  const [isDesktopWorkspaceActionsOpen, setIsDesktopWorkspaceActionsOpen] =
    useState(false)
  const [isMobileWorkspaceActionsOpen, setIsMobileWorkspaceActionsOpen] =
    useState(false)
  const [isWorkspaceParticipantsOpen, setIsWorkspaceParticipantsOpen] =
    useState(false)
  const todayKey = getDateKey(new Date())
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const summary = getPlannerSummary(tasks, todayKey)
  const plannedTaskCount = tasks.filter(
    (task) => isActiveTaskStatus(task.status) && task.plannedDate !== null,
  ).length
  const selfCareDashboardQuery = useSelfCareDashboard(todayKey, {
    enabled: !isSharedWorkspace,
  })
  const pendingSelfCareTodayCount = countPendingSelfCare(
    selfCareDashboardQuery.data,
  )
  const navigationCounts = {
    appRoleLabel: session?.appRole ?? 'Admin',
    cleaningDueCount: cleaningSummary.dueCount,
    cleaningUrgentCount: cleaningSummary.urgentCount,
    pendingSelfCareTodayCount,
    plannedTaskCount,
    shoppingActiveItemCount: shoppingListSummary.activeItemCount,
    sphereCount: spheres.length,
    summary,
  }
  const visibleNavigation = getVisibleNavigationRouteDefinitions(
    isSharedWorkspace ? 'shared' : 'personal',
  ).filter(
    (item) =>
      item.id !== 'admin' ||
      session?.appRole === 'admin' ||
      session?.appRole === 'owner',
  )
  const connectionView = getSessionReadinessConnectionView(readiness, {
    featureErrorMessage: errorMessage,
    isFeatureLoading: isLoading,
    isFeatureSyncing: isSyncing,
  })
  const syncStateLabel = connectionView.label
  const connectionStateErrorMessage = connectionView.errorMessage
  const hasConnectionIssue = syncStateLabel === 'Connection issue'
  const connectionIssueMessage = hasConnectionIssue
    ? (connectionStateErrorMessage ??
      errorMessage ??
      'Не удалось синхронизировать данные.')
    : null
  const isGlobalOwner = session?.appRole === 'owner'
  const connectionIssueDebugDetails =
    isGlobalOwner && hasConnectionIssue
      ? getConnectionIssueDebugDetails({
          conflictedMutationCount,
          debugErrorDetails,
          message: connectionIssueMessage,
          queuedMutationCount,
          readiness,
        })
      : null
  const accountLabel =
    auth.email ??
    session?.actor.email ??
    (auth.canUseProtectedApi && auth.accessToken ? 'Chaotika session' : null)
  const isProfileNavigationVisible = Boolean(session && !isSharedWorkspace)
  const mobilePrimaryNavigation = visibleNavigation
    .filter((item) => item.mobilePlacement === 'primary')
    .sort((left, right) => (left.mobileOrder ?? 0) - (right.mobileOrder ?? 0))
  const mobileMoreNavigation = visibleNavigation
    .filter((item) => item.mobilePlacement === 'more')
    .sort((left, right) => (left.mobileOrder ?? 0) - (right.mobileOrder ?? 0))
  const mobileSheetNavigation = mobileMoreNavigation.filter(
    (item) => item.plannerTabPlacement === 'more',
  )
  const isMoreOpen =
    moreSheetLocation?.pathname === location.pathname &&
    moreSheetLocation.key === location.key
  const isMoreActive =
    isMoreOpen ||
    matchesRoute(location.pathname, '/more') ||
    (isProfileNavigationVisible &&
      matchesRoute(location.pathname, '/profile')) ||
    mobileSheetNavigation.some((item) =>
      matchesRoute(location.pathname, item.to),
    )
  const isPlannerMoreActive =
    isMoreOpen ||
    matchesRoute(location.pathname, '/more') ||
    (isProfileNavigationVisible &&
      matchesRoute(location.pathname, '/profile')) ||
    visibleNavigation
      .filter((item) => item.plannerTabPlacement === 'more')
      .some((item) => matchesRoute(location.pathname, item.to))
  const themeToggleLabel = isDark
    ? 'Включить светлую тему'
    : 'Включить темную тему'

  const closeMobileMoreSheet = useCallback(() => {
    setMoreSheetLocation(null)
    setIsMobileWorkspaceActionsOpen(false)
  }, [])

  const toggleMobileMoreSheet = useCallback(() => {
    if (
      moreSheetLocation?.pathname === location.pathname &&
      moreSheetLocation.key === location.key
    ) {
      closeMobileMoreSheet()
      return
    }

    setMoreSheetLocation({
      key: location.key,
      pathname: location.pathname,
    })
  }, [closeMobileMoreSheet, location.key, location.pathname, moreSheetLocation])

  const handleSignOut = useCallback(
    (options: { closeMobileSheet?: boolean } = {}) => {
      const isConfirmed =
        typeof window === 'undefined' ||
        window.confirm(
          'Выйти из аккаунта? Текущая сессия на этом устройстве будет завершена.',
        )

      if (!isConfirmed) {
        return
      }

      if (options.closeMobileSheet) {
        closeMobileMoreSheet()
      }

      void auth.signOut()
    },
    [auth, closeMobileMoreSheet],
  )

  const handleMobileSignOut = useCallback(() => {
    handleSignOut({ closeMobileSheet: true })
  }, [handleSignOut])

  const handleDesktopSignOut = useCallback(() => {
    handleSignOut()
  }, [handleSignOut])

  useEffect(() => {
    if (!isMoreOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeMobileMoreSheet()
      }
    }

    function handleResize() {
      if (window.innerWidth > 820) {
        closeMobileMoreSheet()
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
  }, [closeMobileMoreSheet, isMoreOpen])

  const openWorkspaceParticipants = useCallback(() => {
    setIsMobileWorkspaceActionsOpen(false)
    setIsDesktopWorkspaceActionsOpen(false)
    closeMobileMoreSheet()
    setIsWorkspaceParticipantsOpen(true)
  }, [closeMobileMoreSheet])
  const shouldRenderMobileChrome = navigationMode === 'full' || isMoreOpen

  return (
    <>
      {shouldRenderMobileChrome ? (
        <div className={styles.mobileChrome}>
          {navigationMode === 'full' ? (
            <header className={styles.mobileTopBar}>
              <h1>Chaotika</h1>

              <SelectPicker
                className={styles.mobileWorkspaceSelect}
                ariaLabel="Workspace"
                value={session?.workspaceId ?? ''}
                disabled={!session}
                placeholder="Workspace"
                options={
                  session
                    ? session.workspaces.map((workspace) => ({
                        label: workspace.name,
                        value: workspace.id,
                      }))
                    : []
                }
                onChange={(nextWorkspaceId) => {
                  setSelectedWorkspaceIdForActors(nextWorkspaceId, [
                    auth.userId,
                    session?.actorUserId,
                  ])
                }}
              />
            </header>
          ) : null}

          {navigationMode === 'full' ? (
            <nav aria-label="Mobile navigation" className={styles.mobileTabBar}>
              {mobilePrimaryNavigation.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cx(
                      styles.mobileTabItem,
                      isActive && styles.mobileTabItemActive,
                    )
                  }
                >
                  <span className={styles.mobileTabIcon} aria-hidden="true">
                    <SidebarNavIcon route={item.to} />
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
                onClick={toggleMobileMoreSheet}
              >
                <span className={styles.mobileTabIcon} aria-hidden="true">
                  <MoreIcon />
                </span>
                <span className={styles.mobileTabLabel}>Ещё</span>
              </button>
            </nav>
          ) : null}

          {isMoreOpen ? (
            <div
              className={styles.mobileSheetBackdrop}
              role="presentation"
              onClick={() => {
                closeMobileMoreSheet()
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
                <div className={styles.mobileSheetHeader}>
                  <div
                    className={styles.mobileSheetHandle}
                    aria-hidden="true"
                  />
                  <button
                    className={styles.mobileSheetCloseButton}
                    type="button"
                    aria-label="Закрыть меню"
                    onClick={() => {
                      closeMobileMoreSheet()
                    }}
                  >
                    <CloseIcon size={18} strokeWidth={2.1} />
                  </button>
                </div>

                <div className={styles.mobileSheetCard}>
                  <SidebarWorkspaceHeader
                    actionAriaLabel="Действия с workspace в мобильном меню"
                    actionsControlId="mobile-workspace-actions"
                    errorMessage={connectionStateErrorMessage}
                    isActionsOpen={isMobileWorkspaceActionsOpen}
                    isLoading={isLoading}
                    isSyncing={isSyncing}
                    onToggleActions={() => {
                      setIsMobileWorkspaceActionsOpen((value) => !value)
                    }}
                    session={session}
                    syncStateLabel={syncStateLabel}
                  />

                  {isMobileWorkspaceActionsOpen ? (
                    <div id="mobile-workspace-actions">
                      {session ? (
                        <SidebarWorkspaceActions
                          isMobile
                          onCloseMobileMoreSheet={closeMobileMoreSheet}
                          onOpenParticipants={openWorkspaceParticipants}
                          session={session}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {accountLabel ? (
                  <section className={styles.mobileSheetSection}>
                    <p className={styles.mobileSectionLabel}>Аккаунт</p>

                    <div className={styles.mobileInfoRow}>
                      {session ? (
                        <UserAvatar
                          avatarUrl={session.actor.avatarUrl}
                          displayName={session.actor.displayName}
                          email={session.actor.email}
                          size="sm"
                        />
                      ) : (
                        <UserIcon size={18} strokeWidth={2.1} />
                      )}
                      <div className={styles.mobileInfoCopy}>
                        <strong>
                          {session?.actor.displayName ?? 'Профиль'}
                        </strong>
                        <span>{accountLabel}</span>
                      </div>
                    </div>

                    {auth.isAuthEnabled ? (
                      <button
                        className={styles.mobileSignOutButton}
                        type="button"
                        onClick={handleMobileSignOut}
                      >
                        Выйти
                      </button>
                    ) : null}

                    <button
                      className={cx(
                        styles.mobileSheetLink,
                        styles.mobileThemeButton,
                      )}
                      type="button"
                      aria-pressed={isDark}
                      onClick={toggleTheme}
                    >
                      {isDark ? (
                        <SunIcon size={18} strokeWidth={2.1} />
                      ) : (
                        <MoonIcon size={18} strokeWidth={2.1} />
                      )}
                      <span>{isDark ? 'Светлая тема' : 'Темная тема'}</span>
                    </button>
                  </section>
                ) : null}

                {mobileSheetNavigation.length > 0 ||
                isProfileNavigationVisible ? (
                  <section className={styles.mobileSheetSection}>
                    <p className={styles.mobileSectionLabel}>Разделы</p>

                    {mobileSheetNavigation
                      .filter((item) => item.to !== '/admin')
                      .map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) =>
                            cx(
                              styles.mobileSheetLink,
                              isActive && styles.mobileSheetLinkActive,
                            )
                          }
                          onClick={() => {
                            closeMobileMoreSheet()
                          }}
                        >
                          <SidebarNavIcon route={item.to} />
                          <span>{item.label}</span>
                        </NavLink>
                      ))}

                    {isProfileNavigationVisible ? (
                      <NavLink
                        to="/profile"
                        className={({ isActive }) =>
                          cx(
                            styles.mobileSheetLink,
                            isActive && styles.mobileSheetLinkActive,
                          )
                        }
                        onClick={() => {
                          closeMobileMoreSheet()
                        }}
                      >
                        <EditIcon size={18} strokeWidth={2.1} />
                        <span>Профиль</span>
                      </NavLink>
                    ) : null}

                    {mobileSheetNavigation
                      .filter((item) => item.to === '/admin')
                      .map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) =>
                            cx(
                              styles.mobileSheetLink,
                              isActive && styles.mobileSheetLinkActive,
                            )
                          }
                          onClick={() => {
                            closeMobileMoreSheet()
                          }}
                        >
                          <GearIcon size={18} strokeWidth={2.1} />
                          <span>{item.label}</span>
                        </NavLink>
                      ))}
                  </section>
                ) : null}

                {connectionIssueMessage ? (
                  <section className={styles.mobileSheetSection}>
                    <ConnectionIssuePanel
                      debugDetails={connectionIssueDebugDetails}
                      message={connectionIssueMessage}
                      onRetry={() => {
                        void refresh()
                      }}
                    />
                  </section>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      ) : null}

      {navigationMode === 'full' ? (
        <aside
          className={cx(styles.sidebar, isCollapsed && styles.sidebarCollapsed)}
        >
          <div className={styles.brandBlock}>
            <h1>Chaotika</h1>
            <div className={styles.brandActions}>
              <button
                className={styles.iconButton}
                type="button"
                aria-label={themeToggleLabel}
                aria-pressed={isDark}
                title={themeToggleLabel}
                onClick={toggleTheme}
              >
                {isDark ? (
                  <SunIcon size={18} strokeWidth={2.15} />
                ) : (
                  <MoonIcon size={18} strokeWidth={2.15} />
                )}
              </button>

              <button
                className={styles.iconButton}
                type="button"
                aria-label={
                  isCollapsed ? 'Развернуть сайдбар' : 'Свернуть сайдбар'
                }
                aria-pressed={isCollapsed}
                title={isCollapsed ? 'Развернуть сайдбар' : 'Свернуть сайдбар'}
                onClick={() => {
                  onCollapsedChange?.(!isCollapsed)
                }}
              >
                {isCollapsed ? (
                  <ChevronRightIcon size={18} strokeWidth={2.15} />
                ) : (
                  <ChevronLeftIcon size={18} strokeWidth={2.15} />
                )}
              </button>
            </div>
          </div>

          <section className={styles.connectionCard}>
            <SidebarWorkspaceHeader
              actionAriaLabel="Действия с workspace"
              actionsControlId="desktop-workspace-actions"
              errorMessage={connectionStateErrorMessage}
              isActionsOpen={isDesktopWorkspaceActionsOpen}
              isLoading={isLoading}
              isSyncing={isSyncing}
              onToggleActions={() => {
                setIsDesktopWorkspaceActionsOpen((value) => !value)
              }}
              session={session}
              syncStateLabel={syncStateLabel}
            />

            {session ? (
              <div className={styles.workspaceControls}>
                <SelectPicker
                  className={styles.workspaceSelect}
                  ariaLabel="Workspace"
                  value={session.workspaceId}
                  options={session.workspaces.map((workspace) => ({
                    label: workspace.name,
                    value: workspace.id,
                  }))}
                  onChange={(nextWorkspaceId) => {
                    setSelectedWorkspaceIdForActors(nextWorkspaceId, [
                      auth.userId,
                      session.actorUserId,
                    ])
                  }}
                />

                {isDesktopWorkspaceActionsOpen ? (
                  <div id="desktop-workspace-actions">
                    <SidebarWorkspaceActions
                      onCloseMobileMoreSheet={closeMobileMoreSheet}
                      onOpenParticipants={openWorkspaceParticipants}
                      session={session}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {auth.isAuthEnabled && accountLabel ? (
              <div className={styles.accountBlock}>
                <div className={styles.accountRow}>
                  {session ? (
                    <UserAvatar
                      avatarUrl={session.actor.avatarUrl}
                      displayName={session.actor.displayName}
                      email={session.actor.email}
                    />
                  ) : (
                    <div className={styles.accountAvatarPlaceholder}>
                      <UserIcon size={18} strokeWidth={2.1} />
                    </div>
                  )}

                  <div className={styles.accountCopy}>
                    <strong>{session?.actor.displayName ?? 'Профиль'}</strong>
                    <span className={styles.accountEmail}>{accountLabel}</span>
                  </div>

                  {isProfileNavigationVisible ? (
                    <NavLink
                      to="/profile"
                      className={cx(styles.accountIconButton)}
                      aria-label="Открыть профиль"
                    >
                      <EditIcon size={16} strokeWidth={2.1} />
                    </NavLink>
                  ) : null}
                </div>

                <button
                  className={styles.signOutButton}
                  type="button"
                  onClick={handleDesktopSignOut}
                >
                  Выйти
                </button>
              </div>
            ) : null}

            {connectionIssueMessage ? (
              <ConnectionIssuePanel
                debugDetails={connectionIssueDebugDetails}
                message={connectionIssueMessage}
                onRetry={() => {
                  void refresh()
                }}
              />
            ) : null}
          </section>

          <SidebarNavigation
            counts={navigationCounts}
            isCollapsed={isCollapsed}
            items={visibleNavigation}
          />

          <SidebarTodaySummary summary={summary} todayKey={todayKey} />
        </aside>
      ) : null}

      {navigationMode === 'service' ? (
        <PlannerSideTabs
          isMoreActive={isPlannerMoreActive}
          items={visibleNavigation}
        />
      ) : null}

      {isWorkspaceParticipantsOpen && isSharedWorkspace ? (
        <WorkspaceParticipantsDialog
          isOpen={isWorkspaceParticipantsOpen}
          onClose={() => {
            setIsWorkspaceParticipantsOpen(false)
          }}
        />
      ) : null}
    </>
  )
}

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}

function countPendingSelfCare(
  dashboard: ReturnType<typeof useSelfCareDashboard>['data'] | undefined,
): number {
  const todayItems = dashboard?.todayItems ?? []
  const flexibleGoals = dashboard?.flexibleGoals ?? []
  const pendingTodayItems = todayItems.filter((entry) => {
    const status = entry.occurrence?.status

    return (
      status !== 'done' &&
      status !== 'partial' &&
      status !== 'skipped' &&
      status !== 'cancelled' &&
      !entry.completion
    )
  }).length
  const pendingFlexibleGoals = flexibleGoals.filter(
    (entry) => (entry.flexibleProgress?.remainingCount ?? 0) > 0,
  ).length

  return pendingTodayItems + pendingFlexibleGoals
}

function ConnectionIssuePanel({
  debugDetails,
  message,
  onRetry,
}: {
  debugDetails: string | null
  message: string
  onRetry: () => void
}) {
  return (
    <div className={styles.connectionIssuePanel}>
      <p className={styles.connectionError}>{message}</p>

      {debugDetails ? (
        <details className={styles.connectionDebugDetails}>
          <summary>Детали ошибки</summary>
          <pre>{debugDetails}</pre>
        </details>
      ) : null}

      <button className={styles.retryButton} type="button" onClick={onRetry}>
        Повторить синхронизацию
      </button>
    </div>
  )
}

function getConnectionIssueDebugDetails({
  conflictedMutationCount,
  debugErrorDetails,
  message,
  queuedMutationCount,
  readiness,
}: {
  conflictedMutationCount: number
  debugErrorDetails: string | null
  message: string | null
  queuedMutationCount: number
  readiness: {
    canReadCachedData: boolean
    canRenderAppContent: boolean
    canUseProtectedApi: boolean
    canWriteProtectedData: boolean
    reason: string
    status: string
  }
}): string {
  const details = [
    'connection.label=Connection issue',
    `message=${message ?? 'none'}`,
    `readiness.status=${readiness.status}`,
    `readiness.reason=${readiness.reason}`,
    `readiness.canReadCachedData=${readiness.canReadCachedData}`,
    `readiness.canRenderAppContent=${readiness.canRenderAppContent}`,
    `readiness.canUseProtectedApi=${readiness.canUseProtectedApi}`,
    `readiness.canWriteProtectedData=${readiness.canWriteProtectedData}`,
    `queuedMutations=${queuedMutationCount}`,
    `conflictedMutations=${conflictedMutationCount}`,
  ]

  if (debugErrorDetails) {
    details.push('', debugErrorDetails)
  }

  return details.join('\n')
}
