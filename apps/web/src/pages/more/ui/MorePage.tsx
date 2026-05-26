import { type FormEvent, type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'

import { usePlanner } from '@/features/planner'
import {
  getCreateSharedWorkspaceErrorMessage,
  getSessionReadinessConnectionView,
  useCreateSharedWorkspace,
  usePlannerSession,
  UserAvatar,
  useSessionAuth,
  WorkspaceParticipantsDialog,
} from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { useColorTheme } from '@/shared/lib/theme'
import {
  EditIcon,
  GearIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  UserIcon,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import styles from './MorePage.module.css'

export function MorePage() {
  const { data: session } = usePlannerSession()
  const auth = useSessionAuth()
  const planner = usePlanner()
  const { isDark, toggleTheme } = useColorTheme()
  const createSharedWorkspace = useCreateSharedWorkspace()
  const [isWorkspaceActionsOpen, setIsWorkspaceActionsOpen] = useState(false)
  const [isCreateWorkspaceFormOpen, setIsCreateWorkspaceFormOpen] =
    useState(false)
  const [createWorkspaceName, setCreateWorkspaceName] = useState('')
  const [createWorkspaceError, setCreateWorkspaceError] = useState<
    string | null
  >(null)
  const [isWorkspaceParticipantsOpen, setIsWorkspaceParticipantsOpen] =
    useState(false)
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const isPersonalWorkspace = session?.workspace.kind === 'personal'
  const isProfileVisible = Boolean(session && isPersonalWorkspace)
  const isAdminVisible =
    isPersonalWorkspace &&
    (session?.appRole === 'admin' || session?.appRole === 'owner')
  const hasSectionLinks = isProfileVisible || isAdminVisible
  const connectionView = getSessionReadinessConnectionView(planner.readiness, {
    featureErrorMessage: planner.errorMessage,
    isFeatureLoading: planner.isLoading,
    isFeatureSyncing: planner.isSyncing,
  })
  const hasConnectionIssue = connectionView.label === 'Connection issue'
  const connectionIssueMessage = hasConnectionIssue
    ? (connectionView.errorMessage ??
      planner.errorMessage ??
      'Не удалось синхронизировать данные.')
    : null
  const isGlobalOwner = session?.appRole === 'owner'
  const connectionIssueDebugDetails =
    isGlobalOwner && hasConnectionIssue
      ? getConnectionIssueDebugDetails({
          conflictedMutationCount: planner.conflictedMutationCount,
          debugErrorDetails: planner.debugErrorDetails,
          message: connectionIssueMessage,
          queuedMutationCount: planner.queuedMutationCount,
          readiness: planner.readiness,
        })
      : null
  const accountLabel =
    auth.email ??
    session?.actor.email ??
    (auth.canUseProtectedApi && auth.accessToken ? 'Chaotika session' : null)
  const themeLabel = isDark ? 'Светлая тема' : 'Темная тема'
  const sharedWorkspaceCount =
    session?.workspaces.filter((workspace) => workspace.kind === 'shared')
      .length ?? 0
  const isCreateWorkspaceDisabled =
    createSharedWorkspace.isPending || sharedWorkspaceCount >= 3

  function closeCreateWorkspaceForm() {
    setIsCreateWorkspaceFormOpen(false)
    setCreateWorkspaceName('')
    setCreateWorkspaceError(null)
    createSharedWorkspace.reset()
  }

  function toggleCreateWorkspaceForm() {
    if (isCreateWorkspaceFormOpen) {
      closeCreateWorkspaceForm()
      return
    }

    setIsCreateWorkspaceFormOpen(true)
    setCreateWorkspaceError(null)
    createSharedWorkspace.reset()
  }

  async function handleCreateWorkspaceSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    const name = createWorkspaceName.trim()

    if (!name) {
      setCreateWorkspaceError('Введите название пространства.')
      return
    }

    setCreateWorkspaceError(null)

    try {
      await createSharedWorkspace.mutateAsync({ name })
      closeCreateWorkspaceForm()
    } catch (error) {
      setCreateWorkspaceError(getCreateSharedWorkspaceErrorMessage(error))
    }
  }

  function handleSignOut() {
    const isConfirmed =
      typeof window === 'undefined' ||
      window.confirm(
        'Выйти из аккаунта? Текущая сессия на этом устройстве будет завершена.',
      )

    if (!isConfirmed) {
      return
    }

    void auth.signOut()
  }

  return (
    <section className={cx(pageStyles.page, styles.morePage)}>
      <section className={styles.workspacePanel} aria-label="Workspace">
        <div className={styles.workspaceHeader}>
          <div className={styles.workspaceCopy}>
            <h2>{session?.workspace.name ?? 'Определяем workspace'}</h2>
            <p>{session?.actor.displayName ?? 'Загружаем профиль'}</p>
          </div>

          <div className={styles.workspaceHeaderActions}>
            <span
              className={cx(
                styles.stateBadge,
                connectionView.errorMessage
                  ? styles.stateBadgeError
                  : planner.isLoading || planner.isSyncing
                    ? styles.stateBadgePending
                    : styles.stateBadgeOk,
              )}
            >
              {connectionView.label}
            </span>
            {session ? (
              <button
                className={styles.workspaceSettingsButton}
                type="button"
                aria-label="Действия с workspace"
                aria-expanded={isWorkspaceActionsOpen}
                aria-controls="more-workspace-actions"
                onClick={() => {
                  setIsWorkspaceActionsOpen((value) => !value)
                }}
              >
                <GearIcon size={16} strokeWidth={2.1} />
              </button>
            ) : null}
          </div>
        </div>

        {isWorkspaceActionsOpen && session ? (
          <div id="more-workspace-actions" className={styles.workspaceActions}>
            <button
              className={styles.createWorkspaceButton}
              type="button"
              aria-expanded={isCreateWorkspaceFormOpen}
              disabled={isCreateWorkspaceDisabled}
              onClick={toggleCreateWorkspaceForm}
            >
              <PlusIcon size={18} strokeWidth={2.1} />
              <span>Создать пространство</span>
            </button>

            {isCreateWorkspaceFormOpen ? (
              <form
                className={styles.workspaceForm}
                onSubmit={(event) => void handleCreateWorkspaceSubmit(event)}
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
                      setCreateWorkspaceError(null)
                    }}
                  />
                </label>

                <div className={styles.workspaceFormActions}>
                  <button
                    className={styles.formPrimaryButton}
                    type="submit"
                    disabled={createSharedWorkspace.isPending}
                  >
                    {createSharedWorkspace.isPending ? 'Создаём...' : 'Создать'}
                  </button>
                  <button
                    className={styles.formGhostButton}
                    type="button"
                    disabled={createSharedWorkspace.isPending}
                    onClick={closeCreateWorkspaceForm}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            ) : null}

            {createWorkspaceError ? (
              <p className={styles.workspaceError}>{createWorkspaceError}</p>
            ) : null}

            {isSharedWorkspace ? (
              <button
                className={styles.createWorkspaceButton}
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

        {connectionIssueMessage ? (
          <ConnectionIssuePanel
            debugDetails={connectionIssueDebugDetails}
            message={connectionIssueMessage}
            onRetry={() => {
              void planner.refresh()
            }}
          />
        ) : null}
      </section>

      {accountLabel ? (
        <>
          <p className={styles.sectionLabel}>Аккаунт</p>
          <section className={styles.accountPanel} aria-label="Аккаунт">
            {session ? (
              <UserAvatar
                avatarUrl={session.actor.avatarUrl}
                displayName={session.actor.displayName}
                email={session.actor.email}
                size="sm"
              />
            ) : (
              <span className={styles.accountIcon} aria-hidden="true">
                <UserIcon size={18} strokeWidth={2.1} />
              </span>
            )}
            <div className={styles.accountCopy}>
              <strong>{session?.actor.displayName ?? 'Профиль'}</strong>
              <span>{accountLabel}</span>
            </div>
          </section>
        </>
      ) : null}

      {accountLabel ? (
        <button
          className={styles.signOutButton}
          type="button"
          onClick={handleSignOut}
        >
          Выйти
        </button>
      ) : null}

      {isWorkspaceParticipantsOpen && isSharedWorkspace ? (
        <WorkspaceParticipantsDialog
          isOpen={isWorkspaceParticipantsOpen}
          onClose={() => {
            setIsWorkspaceParticipantsOpen(false)
          }}
        />
      ) : null}

      <section className={styles.controlList} aria-label="Настройки">
        <button
          className={styles.listAction}
          type="button"
          aria-pressed={isDark}
          onClick={toggleTheme}
        >
          <span className={styles.listIcon} aria-hidden="true">
            {isDark ? (
              <SunIcon size={19} strokeWidth={2} />
            ) : (
              <MoonIcon size={19} strokeWidth={2} />
            )}
          </span>
          <span>{themeLabel}</span>
        </button>
      </section>

      {hasSectionLinks ? (
        <>
          <p className={styles.sectionLabel}>Разделы</p>
          <section className={styles.controlList} aria-label="Разделы">
            {isProfileVisible ? (
              <MoreActionLink
                icon={<EditIcon size={19} strokeWidth={2} />}
                label="Профиль"
                to="/profile"
              />
            ) : null}
            {isAdminVisible ? (
              <MoreActionLink
                icon={<GearIcon size={19} strokeWidth={2} />}
                label="Admin"
                to="/admin"
              />
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  )
}

interface MoreActionLinkProps {
  icon: ReactNode
  label: string
  to: string
}

function MoreActionLink({ icon, label, to }: MoreActionLinkProps) {
  return (
    <Link className={styles.listAction} to={to}>
      <span className={styles.listIcon} aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  )
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
