import { type FormEvent, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { getPlannerSummary, isRoutineHabitTask } from '@/entities/task'
import { useCleaningSummary } from '@/features/cleaning'
import { usePlanner } from '@/features/planner'
import {
  getCreateSharedWorkspaceErrorMessage,
  getDeleteSharedWorkspaceErrorMessage,
  getUpdateSharedWorkspaceErrorMessage,
  setSelectedWorkspaceIdForActors,
  useCreateSharedWorkspace,
  useDeleteSharedWorkspace,
  usePlannerSession,
  UserAvatar,
  useSessionAuth,
  useUpdateSharedWorkspace,
  WorkspaceParticipantsDialog,
} from '@/features/session'
import { useShoppingListSummary } from '@/features/shopping-list'
import { cx } from '@/shared/lib/classnames'
import { formatLongDate, getDateKey } from '@/shared/lib/date'
import {
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  HomeIcon,
  PlusIcon,
  SettingsIcon,
  ShoppingBagIcon,
  SpheresIcon,
  TrashIcon,
  UserIcon,
} from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import styles from './Sidebar.module.css'

const navigation = [
  { to: '/today', label: 'Сегодня' },
  { to: '/shopping', label: 'Покупки' },
  { to: '/cleaning', label: 'Уборка' },
  { to: '/spheres', label: 'Сферы' },
  { to: '/habits', label: 'Привычки' },
  { to: '/timeline', label: 'Таймлайн' },
  { to: '/admin', label: 'Admin' },
] as const

type NavigationRoute = (typeof navigation)[number]['to']

interface MobileMoreSheetLocation {
  key: string
  pathname: string
}

const mobilePrimaryRoutes: readonly NavigationRoute[] = [
  '/today',
  '/shopping',
  '/cleaning',
]

const mobileMoreRoutes: readonly NavigationRoute[] = [
  '/timeline',
  '/spheres',
  '/habits',
  '/admin',
]

export function Sidebar() {
  const { errorMessage, isLoading, isSyncing, projects, refresh, tasks } =
    usePlanner()
  const cleaningSummary = useCleaningSummary()
  const shoppingListSummary = useShoppingListSummary()
  const location = useLocation()
  const auth = useSessionAuth()
  const { data: session } = usePlannerSession()
  const createSharedWorkspaceMutation = useCreateSharedWorkspace()
  const updateSharedWorkspaceMutation = useUpdateSharedWorkspace()
  const deleteSharedWorkspaceMutation = useDeleteSharedWorkspace()
  const [moreSheetLocation, setMoreSheetLocation] =
    useState<MobileMoreSheetLocation | null>(null)
  const [isWorkspaceParticipantsOpen, setIsWorkspaceParticipantsOpen] =
    useState(false)
  const [isCreateWorkspaceFormOpen, setIsCreateWorkspaceFormOpen] =
    useState(false)
  const [createWorkspaceName, setCreateWorkspaceName] = useState('')
  const [createWorkspaceFormError, setCreateWorkspaceFormError] = useState<
    string | null
  >(null)
  const [isRenameWorkspaceFormOpen, setIsRenameWorkspaceFormOpen] =
    useState(false)
  const [renameWorkspaceName, setRenameWorkspaceName] = useState('')
  const [workspaceManageError, setWorkspaceManageError] = useState<
    string | null
  >(null)
  const todayKey = getDateKey(new Date())
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const summary = getPlannerSummary(tasks, todayKey)
  const routineHabitTodayCount = tasks.filter(
    (task) =>
      task.status !== 'done' &&
      task.plannedDate === todayKey &&
      isRoutineHabitTask(task),
  ).length
  const canManageCurrentSharedWorkspace =
    session?.workspace.kind === 'shared' && session.role === 'owner'
  const sharedWorkspaceCount =
    session?.workspaces.filter((workspace) => workspace.kind === 'shared')
      .length ?? 0
  const visibleNavigation = navigation.filter(
    (item) =>
      (!isSharedWorkspace ||
        item.to === '/today' ||
        item.to === '/cleaning' ||
        item.to === '/shopping' ||
        item.to === '/timeline' ||
        item.to === '/spheres') &&
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
    (auth.accessToken ? 'Chaotika session' : null)
  const isProfileNavigationVisible = Boolean(session && !isSharedWorkspace)
  const mobilePrimaryNavigation = mobilePrimaryRoutes.flatMap((route) => {
    const item = visibleNavigation.find((candidate) => candidate.to === route)

    return item ? [item] : []
  })
  const mobileMoreNavigation = mobileMoreRoutes.flatMap((route) => {
    const item = visibleNavigation.find((candidate) => candidate.to === route)

    return item ? [item] : []
  })
  const isMoreOpen =
    moreSheetLocation?.pathname === location.pathname &&
    moreSheetLocation.key === location.key
  const isMoreActive =
    isMoreOpen ||
    (isProfileNavigationVisible &&
      matchesRoute(location.pathname, '/profile')) ||
    mobileMoreNavigation.some((item) =>
      matchesRoute(location.pathname, item.to),
    )
  const createWorkspaceError =
    createWorkspaceFormError ||
    (createSharedWorkspaceMutation.error
      ? getCreateSharedWorkspaceErrorMessage(
          createSharedWorkspaceMutation.error,
        )
      : null)
  const workspaceOwnerActionError =
    workspaceManageError ||
    (updateSharedWorkspaceMutation.error
      ? getUpdateSharedWorkspaceErrorMessage(
          updateSharedWorkspaceMutation.error,
        )
      : deleteSharedWorkspaceMutation.error
        ? getDeleteSharedWorkspaceErrorMessage(
            deleteSharedWorkspaceMutation.error,
          )
        : null)

  useEffect(() => {
    if (!isMoreOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMoreSheetLocation(null)
      }
    }

    function handleResize() {
      if (window.innerWidth > 820) {
        setMoreSheetLocation(null)
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

  function closeCreateWorkspaceForm() {
    setIsCreateWorkspaceFormOpen(false)
    setCreateWorkspaceName('')
    setCreateWorkspaceFormError(null)
    createSharedWorkspaceMutation.reset()
  }

  function openCreateWorkspaceForm() {
    setIsCreateWorkspaceFormOpen(true)
    setCreateWorkspaceFormError(null)
    createSharedWorkspaceMutation.reset()
  }

  async function handleCreateWorkspaceSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    const name = createWorkspaceName.trim()

    if (!name) {
      setCreateWorkspaceFormError('Введите название пространства.')
      return
    }

    setCreateWorkspaceFormError(null)

    try {
      await createSharedWorkspaceMutation.mutateAsync({ name })
      closeCreateWorkspaceForm()
    } catch (error) {
      setCreateWorkspaceFormError(getCreateSharedWorkspaceErrorMessage(error))
    }
  }

  function closeRenameWorkspaceForm() {
    setIsRenameWorkspaceFormOpen(false)
    setWorkspaceManageError(null)
    setRenameWorkspaceName(session?.workspace.name ?? '')
    updateSharedWorkspaceMutation.reset()
    deleteSharedWorkspaceMutation.reset()
  }

  function openRenameWorkspaceForm() {
    if (!session) {
      return
    }

    setIsRenameWorkspaceFormOpen(true)
    setWorkspaceManageError(null)
    setRenameWorkspaceName(session.workspace.name)
    updateSharedWorkspaceMutation.reset()
    deleteSharedWorkspaceMutation.reset()
  }

  async function handleRenameWorkspaceSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (!session) {
      return
    }

    const name = renameWorkspaceName.trim()

    if (!name) {
      setWorkspaceManageError('Введите новое название пространства.')
      return
    }

    if (name === session.workspace.name.trim()) {
      closeRenameWorkspaceForm()
      return
    }

    setWorkspaceManageError(null)

    try {
      await updateSharedWorkspaceMutation.mutateAsync({ name })
      closeRenameWorkspaceForm()
    } catch (error) {
      setWorkspaceManageError(getUpdateSharedWorkspaceErrorMessage(error))
    }
  }

  async function handleDeleteWorkspace() {
    if (!session) {
      return
    }

    if (
      !window.confirm(
        `Удалить пространство «${session.workspace.name}» вместе со всеми данными?`,
      )
    ) {
      return
    }

    setWorkspaceManageError(null)
    updateSharedWorkspaceMutation.reset()
    deleteSharedWorkspaceMutation.reset()

    try {
      await deleteSharedWorkspaceMutation.mutateAsync()
      setIsWorkspaceParticipantsOpen(false)
      setIsRenameWorkspaceFormOpen(false)
      setMoreSheetLocation(null)
    } catch (error) {
      setWorkspaceManageError(getDeleteSharedWorkspaceErrorMessage(error))
    }
  }

  function renderCreateWorkspaceControls(extraClassName?: string) {
    return (
      <>
        <button
          className={cx(styles.createWorkspaceButton, extraClassName)}
          type="button"
          aria-expanded={isCreateWorkspaceFormOpen}
          disabled={
            createSharedWorkspaceMutation.isPending || sharedWorkspaceCount >= 3
          }
          onClick={() => {
            if (isCreateWorkspaceFormOpen) {
              closeCreateWorkspaceForm()
              return
            }

            openCreateWorkspaceForm()
          }}
        >
          <PlusIcon size={18} strokeWidth={2.15} />
          <span>Создать пространство</span>
        </button>

        {isCreateWorkspaceFormOpen ? (
          <form
            className={styles.workspaceInlineForm}
            onSubmit={(event) => {
              void handleCreateWorkspaceSubmit(event)
            }}
          >
            <label className={styles.workspaceFormField}>
              <span>Название</span>
              <input
                type="text"
                value={createWorkspaceName}
                maxLength={80}
                placeholder="Например, Семья"
                onChange={(event) => {
                  setCreateWorkspaceName(event.target.value)
                  setCreateWorkspaceFormError(null)
                }}
              />
            </label>

            <div className={styles.workspaceFormActions}>
              <button
                className={styles.inlinePrimaryButton}
                type="submit"
                disabled={createSharedWorkspaceMutation.isPending}
              >
                <CheckIcon size={16} strokeWidth={2.15} />
                <span>
                  {createSharedWorkspaceMutation.isPending
                    ? 'Создаём...'
                    : 'Создать'}
                </span>
              </button>

              <button
                className={styles.inlineGhostButton}
                type="button"
                disabled={createSharedWorkspaceMutation.isPending}
                onClick={() => {
                  closeCreateWorkspaceForm()
                }}
              >
                <CloseIcon size={16} strokeWidth={2.15} />
                <span>Отмена</span>
              </button>
            </div>
          </form>
        ) : null}

        {createWorkspaceError ? (
          <p className={styles.connectionError}>{createWorkspaceError}</p>
        ) : null}
      </>
    )
  }

  function renderWorkspaceOwnerControls(extraClassName?: string) {
    if (!canManageCurrentSharedWorkspace || !session) {
      return null
    }

    return (
      <>
        <div className={styles.workspaceOwnerActions}>
          <button
            className={cx(
              styles.createWorkspaceButton,
              styles.secondaryWorkspaceButton,
              styles.workspaceActionButton,
              extraClassName,
            )}
            type="button"
            aria-expanded={isRenameWorkspaceFormOpen}
            disabled={updateSharedWorkspaceMutation.isPending}
            onClick={() => {
              if (isRenameWorkspaceFormOpen) {
                closeRenameWorkspaceForm()
                return
              }

              openRenameWorkspaceForm()
            }}
          >
            <EditIcon size={18} strokeWidth={2.1} />
            <span>Переименовать</span>
          </button>

          <button
            className={cx(
              styles.createWorkspaceButton,
              styles.workspaceDeleteButton,
              styles.workspaceActionButton,
              extraClassName,
            )}
            type="button"
            disabled={deleteSharedWorkspaceMutation.isPending}
            onClick={() => {
              void handleDeleteWorkspace()
            }}
          >
            <TrashIcon size={18} strokeWidth={2.1} />
            <span>
              {deleteSharedWorkspaceMutation.isPending
                ? 'Удаляем...'
                : 'Удалить'}
            </span>
          </button>
        </div>

        {isRenameWorkspaceFormOpen ? (
          <form
            className={styles.workspaceInlineForm}
            onSubmit={(event) => {
              void handleRenameWorkspaceSubmit(event)
            }}
          >
            <label className={styles.workspaceFormField}>
              <span>Новое название</span>
              <input
                type="text"
                value={renameWorkspaceName}
                maxLength={80}
                placeholder="Название пространства"
                onChange={(event) => {
                  setRenameWorkspaceName(event.target.value)
                  setWorkspaceManageError(null)
                }}
              />
            </label>

            <div className={styles.workspaceFormActions}>
              <button
                className={styles.inlinePrimaryButton}
                type="submit"
                disabled={updateSharedWorkspaceMutation.isPending}
              >
                <CheckIcon size={16} strokeWidth={2.15} />
                <span>
                  {updateSharedWorkspaceMutation.isPending
                    ? 'Сохраняем...'
                    : 'Сохранить'}
                </span>
              </button>

              <button
                className={styles.inlineGhostButton}
                type="button"
                disabled={updateSharedWorkspaceMutation.isPending}
                onClick={() => {
                  closeRenameWorkspaceForm()
                }}
              >
                <CloseIcon size={16} strokeWidth={2.15} />
                <span>Отмена</span>
              </button>
            </div>
          </form>
        ) : null}

        {workspaceOwnerActionError ? (
          <p className={styles.connectionError}>{workspaceOwnerActionError}</p>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className={styles.mobileChrome}>
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
              setMoreSheetLocation((current) =>
                current?.pathname === location.pathname &&
                current.key === location.key
                  ? null
                  : { key: location.key, pathname: location.pathname },
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
              setMoreSheetLocation(null)
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
                <div className={styles.mobileSheetHandle} aria-hidden="true" />
                <button
                  className={styles.mobileSheetCloseButton}
                  type="button"
                  aria-label="Закрыть меню"
                  onClick={() => {
                    setMoreSheetLocation(null)
                  }}
                >
                  <CloseIcon size={18} strokeWidth={2.1} />
                </button>
              </div>

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

                <div className={styles.mobileWorkspaceActions}>
                  {renderCreateWorkspaceControls(
                    styles.mobileCreateWorkspaceButton,
                  )}

                  {renderWorkspaceOwnerControls(
                    styles.mobileCreateWorkspaceButton,
                  )}

                  {isSharedWorkspace ? (
                    <button
                      className={cx(
                        styles.createWorkspaceButton,
                        styles.mobileCreateWorkspaceButton,
                        styles.secondaryWorkspaceButton,
                      )}
                      type="button"
                      onClick={() => {
                        setMoreSheetLocation(null)
                        setIsWorkspaceParticipantsOpen(true)
                      }}
                    >
                      <UserIcon size={18} strokeWidth={2.1} />
                      <span>Участники</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {accountLabel || mobileMoreNavigation.length > 0 ? (
                <section className={styles.mobileSheetSection}>
                  <p className={styles.mobileSectionLabel}>Аккаунт</p>

                  {accountLabel ? (
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
                  ) : null}

                  {mobileMoreNavigation
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
                          setMoreSheetLocation(null)
                        }}
                      >
                        {renderMobileNavIcon(item.to)}
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
                        setMoreSheetLocation(null)
                      }}
                    >
                      <EditIcon size={18} strokeWidth={2.1} />
                      <span>Профиль</span>
                    </NavLink>
                  ) : null}

                  {mobileMoreNavigation
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
                          setMoreSheetLocation(null)
                        }}
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
                        setMoreSheetLocation(null)
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

              {renderCreateWorkspaceControls()}

              {renderWorkspaceOwnerControls()}

              {isSharedWorkspace ? (
                <button
                  className={cx(
                    styles.createWorkspaceButton,
                    styles.secondaryWorkspaceButton,
                  )}
                  type="button"
                  onClick={() => {
                    setIsWorkspaceParticipantsOpen(true)
                  }}
                >
                  <UserIcon size={18} strokeWidth={2.1} />
                  <span>Участники</span>
                </button>
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
                : item.to === '/cleaning'
                  ? cleaningSummary.urgentCount || cleaningSummary.dueCount
                  : item.to === '/habits'
                    ? routineHabitTodayCount
                    : item.to === '/shopping'
                      ? shoppingListSummary.activeItemCount
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

function renderMobileNavIcon(route: string) {
  if (route === '/today') {
    return <CalendarIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/shopping') {
    return <ShoppingBagIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/cleaning') {
    return <HomeIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/habits') {
    return <CheckIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/spheres') {
    return <SpheresIcon size={20} strokeWidth={1.9} />
  }

  return <TimelineIcon />
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
