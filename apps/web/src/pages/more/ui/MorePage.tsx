import type { UserBackupPreviewResponse } from '@planner/contracts'
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'

import { usePlanner } from '@/features/planner'
import {
  downloadUserBackup,
  getCreateSharedWorkspaceErrorMessage,
  getSessionReadinessConnectionView,
  getUserBackupErrorMessage,
  parseUserBackupArchiveText,
  previewUserBackupImport,
  useCreateSharedWorkspace,
  usePlannerSession,
  UserAvatar,
  useSessionAuth,
  WorkspaceParticipantsDialog,
} from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { useColorTheme } from '@/shared/lib/theme'
import {
  ChatIcon,
  DownloadIcon,
  EditIcon,
  GearIcon,
  MicIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  UploadIcon,
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
  const backupFileInputRef = useRef<HTMLInputElement>(null)
  const [isWorkspaceActionsOpen, setIsWorkspaceActionsOpen] = useState(false)
  const [isCreateWorkspaceFormOpen, setIsCreateWorkspaceFormOpen] =
    useState(false)
  const [createWorkspaceName, setCreateWorkspaceName] = useState('')
  const [createWorkspaceError, setCreateWorkspaceError] = useState<
    string | null
  >(null)
  const [isWorkspaceParticipantsOpen, setIsWorkspaceParticipantsOpen] =
    useState(false)
  const [isBackupBusy, setIsBackupBusy] = useState(false)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const isPersonalWorkspace = session?.workspace.kind === 'personal'
  const isProfileVisible = Boolean(session && isPersonalWorkspace)
  const isBackupsVisible = Boolean(
    session && auth.accessToken && isPersonalWorkspace,
  )
  const isAdminVisible =
    isPersonalWorkspace &&
    (session?.appRole === 'admin' || session?.appRole === 'owner')
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

  async function handleDownloadBackup() {
    if (!session || !auth.accessToken) {
      return
    }

    setIsBackupBusy(true)
    setBackupStatus(null)
    setBackupError(null)

    try {
      const backup = await downloadUserBackup({
        accessToken: auth.accessToken,
        actorUserId: session.actorUserId,
        workspaceId: session.workspaceId,
      })

      saveTextFile(backup)
      setBackupStatus('Резервная копия скачана.')
    } catch (error) {
      setBackupError(getUserBackupErrorMessage(error))
    } finally {
      setIsBackupBusy(false)
    }
  }

  async function handlePreviewBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file || !session || !auth.accessToken) {
      return
    }

    setIsBackupBusy(true)
    setBackupStatus(null)
    setBackupError(null)

    try {
      const archive = parseUserBackupArchiveText(await file.text())
      const preview = await previewUserBackupImport({
        accessToken: auth.accessToken,
        actorUserId: session.actorUserId,
        archive,
        workspaceId: session.workspaceId,
      })

      setBackupStatus(getBackupPreviewMessage(preview))
      setBackupError(
        preview.warnings.length > 0
          ? preview.warnings.map(getBackupWarningText).join(' ')
          : null,
      )
    } catch (error) {
      setBackupError(getUserBackupErrorMessage(error))
    } finally {
      setIsBackupBusy(false)
    }
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

      {isBackupsVisible ? (
        <>
          <p className={styles.sectionLabel}>Резервные копии</p>
          <section className={styles.controlList} aria-label="Резервные копии">
            <button
              className={styles.listAction}
              type="button"
              disabled={isBackupBusy}
              onClick={() => void handleDownloadBackup()}
            >
              <span className={styles.listIcon} aria-hidden="true">
                <DownloadIcon size={19} strokeWidth={2} />
              </span>
              <span className={styles.listText}>Скачать копию</span>
            </button>
            <button
              className={styles.listAction}
              type="button"
              disabled={isBackupBusy}
              onClick={() => backupFileInputRef.current?.click()}
            >
              <span className={styles.listIcon} aria-hidden="true">
                <UploadIcon size={19} strokeWidth={2} />
              </span>
              <span className={styles.listText}>Проверить файл</span>
            </button>
            <input
              ref={backupFileInputRef}
              className={styles.fileInput}
              type="file"
              aria-label="Файл резервной копии"
              accept="application/json,.json"
              disabled={isBackupBusy}
              onChange={(event) => void handlePreviewBackupFile(event)}
            />
            {backupStatus ? (
              <p className={styles.backupStatus}>{backupStatus}</p>
            ) : null}
            {backupError ? (
              <p className={styles.backupError}>{backupError}</p>
            ) : null}
          </section>
        </>
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
        {session ? (
          <MoreActionLink
            icon={<MicIcon size={19} strokeWidth={2} />}
            label="Голосовой помощник"
            to="/voice-assistant/settings"
          />
        ) : null}
      </section>

      <p className={styles.sectionLabel}>Разделы</p>
      <section className={styles.controlList} aria-label="Разделы">
        {isProfileVisible ? (
          <MoreActionLink
            icon={<EditIcon size={19} strokeWidth={2} />}
            label="Профиль"
            to="/profile"
          />
        ) : null}
        <MoreActionLink
          icon={<ChatIcon size={19} strokeWidth={2} />}
          label="Контакты"
          to="/contacts"
        />
        {isAdminVisible ? (
          <MoreActionLink
            icon={<GearIcon size={19} strokeWidth={2} />}
            label="Admin"
            to="/admin"
          />
        ) : null}
      </section>
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
      <span className={styles.listText}>{label}</span>
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

function saveTextFile(file: { fileName: string; text: string }) {
  const blob = new Blob([file.text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = file.fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function getBackupPreviewMessage(preview: UserBackupPreviewResponse): string {
  const rowCount = preview.tables.reduce(
    (total, table) => total + table.count,
    0,
  )

  return `Архив проверен: ${rowCount} записей, ${preview.assets.count} файлов.`
}

function getBackupWarningText(warning: string): string {
  if (warning === 'Archive belongs to a different user.') {
    return 'Архив создан для другого пользователя.'
  }

  if (warning === 'Archive belongs to a different workspace.') {
    return 'Архив создан для другого пространства.'
  }

  if (warning === 'Only personal workspace archives can be restored.') {
    return 'Можно восстанавливать только архивы личного пространства.'
  }

  return warning
}
