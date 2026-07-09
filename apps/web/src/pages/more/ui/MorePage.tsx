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
  saveUserBackupFile,
  type SaveUserBackupFileResult,
  useCreateSharedWorkspace,
  usePlannerSession,
  UserAvatar,
  type UserBackupTransferProgress,
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
  const [backupOperation, setBackupOperation] = useState<BackupOperation>(null)
  const [backupProgress, setBackupProgress] =
    useState<BackupProgressState | null>(null)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const isBackupBusy = backupOperation !== null
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
  const downloadBackupLabel =
    backupOperation === 'download' ? 'Готовим копию...' : 'Скачать копию'
  const previewBackupLabel =
    backupOperation === 'preview' ? 'Проверяем файл...' : 'Проверить файл'

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

    setBackupOperation('download')
    setBackupProgress({ label: 'Готовим архив...', loadedBytes: 0 })
    setBackupStatus(null)
    setBackupError(null)

    try {
      const backup = await downloadUserBackup({
        accessToken: auth.accessToken,
        actorUserId: session.actorUserId,
        onProgress: (progress) => {
          setBackupProgress({
            ...progress,
            label: 'Скачиваем архив...',
          })
        },
        workspaceId: session.workspaceId,
      })

      setBackupProgress({ label: 'Сохраняем файл...', loadedBytes: 0 })
      const result = await saveUserBackupFile(backup)

      setBackupProgress(null)
      setBackupStatus(getBackupSaveMessage(result))
    } catch (error) {
      setBackupProgress(null)
      setBackupError(getUserBackupErrorMessage(error))
    } finally {
      setBackupOperation(null)
    }
  }

  function handleOpenBackupFilePicker() {
    if (isBackupBusy) {
      return
    }

    setBackupStatus(
      'Открылся выбор файла. На телефоне архив обычно лежит в «Мои файлы» или «Загрузки».',
    )
    setBackupError(null)
    backupFileInputRef.current?.click()
  }

  async function handlePreviewBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file || !session || !auth.accessToken) {
      return
    }

    setBackupOperation('preview')
    setBackupProgress({
      label: `Читаем файл ${file.name}...`,
      loadedBytes: 0,
      totalBytes: file.size,
    })
    setBackupStatus(null)
    setBackupError(null)

    try {
      const archiveText = await readFileTextWithProgress(file, (progress) => {
        setBackupProgress({
          ...progress,
          label: `Читаем файл ${file.name}...`,
        })
      })
      const archive = parseUserBackupArchiveText(archiveText)

      setBackupProgress({ label: 'Проверяем архив...', loadedBytes: 0 })
      const preview = await previewUserBackupImport({
        accessToken: auth.accessToken,
        actorUserId: session.actorUserId,
        archive,
        workspaceId: session.workspaceId,
      })

      setBackupProgress(null)
      setBackupStatus(getBackupPreviewMessage(preview))
      setBackupError(
        preview.warnings.length > 0
          ? preview.warnings.map(getBackupWarningText).join(' ')
          : null,
      )
    } catch (error) {
      setBackupProgress(null)
      setBackupError(getUserBackupErrorMessage(error))
    } finally {
      setBackupOperation(null)
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
              <span className={styles.listText}>{downloadBackupLabel}</span>
            </button>
            <button
              className={styles.listAction}
              type="button"
              disabled={isBackupBusy}
              onClick={handleOpenBackupFilePicker}
            >
              <span className={styles.listIcon} aria-hidden="true">
                <UploadIcon size={19} strokeWidth={2} />
              </span>
              <span className={styles.listText}>{previewBackupLabel}</span>
            </button>
            <input
              ref={backupFileInputRef}
              className={styles.fileInput}
              type="file"
              aria-label="Файл резервной копии"
              accept=".json,application/json,text/json,text/plain,application/octet-stream,*/*"
              disabled={isBackupBusy}
              onChange={(event) => void handlePreviewBackupFile(event)}
            />
            {backupProgress ? (
              <BackupProgressView progress={backupProgress} />
            ) : null}
            <div className={styles.backupMessages} aria-live="polite">
              {backupStatus ? (
                <p className={styles.backupStatus}>{backupStatus}</p>
              ) : null}
              {backupError ? (
                <p className={styles.backupError}>{backupError}</p>
              ) : null}
            </div>
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

type BackupOperation = 'download' | 'preview' | null

interface BackupProgressState extends UserBackupTransferProgress {
  label: string
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

function BackupProgressView({ progress }: { progress: BackupProgressState }) {
  const percent =
    progress.totalBytes && progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round((progress.loadedBytes / progress.totalBytes) * 100),
        )
      : null

  return (
    <div className={styles.backupProgress} role="status" aria-live="polite">
      <div className={styles.backupProgressHeader}>
        <span>{progress.label}</span>
        {percent !== null ? <span>{percent}%</span> : null}
      </div>
      {percent !== null && progress.totalBytes ? (
        <progress
          className={styles.backupProgressBar}
          aria-label={progress.label}
          max={progress.totalBytes}
          value={Math.min(progress.loadedBytes, progress.totalBytes)}
        />
      ) : (
        <progress
          className={styles.backupProgressBar}
          aria-label={progress.label}
        />
      )}
      {progress.loadedBytes > 0 ? (
        <span className={styles.backupProgressBytes}>
          {formatBytes(progress.loadedBytes)}
          {progress.totalBytes ? ` из ${formatBytes(progress.totalBytes)}` : ''}
        </span>
      ) : null}
    </div>
  )
}

function getBackupPreviewMessage(preview: UserBackupPreviewResponse): string {
  const rowCount = preview.tables.reduce(
    (total, table) => total + table.count,
    0,
  )

  return `Архив проверен: ${rowCount} записей, ${preview.assets.count} файлов.`
}

function getBackupSaveMessage(result: SaveUserBackupFileResult): string {
  if (result.destination === 'android-downloads') {
    return `Резервная копия сохранена: ${result.displayPath ?? result.fileName}.`
  }

  if (result.destination === 'share-sheet') {
    return `Файл ${result.fileName} передан в системное меню сохранения.`
  }

  return `Файл ${result.fileName} передан браузеру для сохранения.`
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

async function readFileTextWithProgress(
  file: File,
  onProgress: (progress: UserBackupTransferProgress) => void,
): Promise<string> {
  if (!file.stream) {
    const text = await file.text()

    onProgress({
      loadedBytes: new TextEncoder().encode(text).byteLength,
      totalBytes: file.size,
    })

    return text
  }

  const reader = file.stream().getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)
    loadedBytes += value.byteLength
    onProgress({ loadedBytes, totalBytes: file.size })
  }

  return new TextDecoder().decode(concatChunks(chunks, loadedBytes))
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} КБ`
  }

  return `${bytes} Б`
}
