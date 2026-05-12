import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'

import { cx } from '@/shared/lib/classnames'
import { CheckIcon, CloseIcon, TrashIcon, UploadIcon } from '@/shared/ui/Icon'

import {
  ACCEPTED_PROFILE_AVATAR_TYPES,
  prepareProfileAvatarUpload,
  validateProfileAvatarFile,
} from '../lib/profile-avatar-upload'
import { usePlannerSession } from '../lib/usePlannerSession'
import { useSessionAuth } from '../lib/useSessionAuth'
import {
  getUpdateUserProfileErrorMessage,
  useUpdateUserProfile,
} from '../lib/useUserProfile'
import styles from './ProfileDialog.module.css'
import { UserAvatar } from './UserAvatar'

const MIN_PASSWORD_LENGTH = 6

interface ProfileDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface ProfileAccountPanelProps {
  ariaModal?: boolean | undefined
  cancelLabel?: string | undefined
  role?: 'dialog' | undefined
  showCloseButton?: boolean | undefined
  variant?: 'dialog' | 'page' | undefined
  onCancel?: (() => void) | undefined
  onSaved?: (() => void) | undefined
}

export function ProfileDialog({ isOpen, onClose }: ProfileDialogProps) {
  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={() => {
        onClose()
      }}
    >
      <div
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <ProfileAccountPanel
          ariaModal
          role="dialog"
          onCancel={onClose}
          onSaved={onClose}
        />
      </div>
    </div>
  )
}

export function ProfileAccountPanel({
  ariaModal = false,
  cancelLabel = 'Отмена',
  role,
  showCloseButton = true,
  variant = 'dialog',
  onCancel,
  onSaved,
}: ProfileAccountPanelProps) {
  const avatarInputId = useId()
  const headingId = useId()
  const session = usePlannerSession().data
  const { isAuthEnabled, updatePassword } = useSessionAuth()
  const updateUserProfile = useUpdateUserProfile()
  const { isPending, mutateAsync } = updateUserProfile
  const [displayName, setDisplayName] = useState(
    () => session?.actor.displayName ?? '',
  )
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const isSubmitting = isPending || isUpdatingPassword

  const resolvedAvatarUrl = useMemo(() => {
    if (avatarDataUrl) {
      return avatarDataUrl
    }

    if (removeAvatar) {
      return null
    }

    return session?.actor.avatarUrl ?? null
  }, [avatarDataUrl, removeAvatar, session?.actor.avatarUrl])

  function clearMessages() {
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const validationError = validateProfileAvatarFile(file)

    if (validationError) {
      setErrorMessage(validationError)
      setSuccessMessage(null)
      return
    }

    try {
      const preparedAvatar = await prepareProfileAvatarUpload(file)
      setAvatarDataUrl(preparedAvatar)
      setRemoveAvatar(false)
      clearMessages()
    } catch (error) {
      setSuccessMessage(null)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось подготовить аватарку.',
      )
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!session) {
      return
    }

    const trimmedDisplayName = displayName.trim()

    if (!trimmedDisplayName) {
      setErrorMessage('Введите никнейм.')
      setSuccessMessage(null)
      return
    }

    const hasDisplayNameChange =
      trimmedDisplayName !== session.actor.displayName.trim()
    const hasAvatarUpload = Boolean(avatarDataUrl)
    const hasAvatarRemoval =
      !hasAvatarUpload && removeAvatar && Boolean(session.actor.avatarUrl)
    const hasPasswordChange =
      isAuthEnabled &&
      (currentPassword.length > 0 ||
        newPassword.length > 0 ||
        newPasswordConfirmation.length > 0)
    const passwordValidationError = hasPasswordChange
      ? validatePasswordChange({
          currentPassword,
          newPassword,
          newPasswordConfirmation,
        })
      : null

    if (passwordValidationError) {
      setErrorMessage(passwordValidationError)
      setSuccessMessage(null)
      return
    }

    if (
      !hasDisplayNameChange &&
      !hasAvatarUpload &&
      !hasAvatarRemoval &&
      !hasPasswordChange
    ) {
      if (onSaved) {
        onSaved()
        return
      }

      setErrorMessage(null)
      setSuccessMessage('Изменений нет.')
      return
    }

    clearMessages()
    setIsUpdatingPassword(hasPasswordChange)

    try {
      if (hasDisplayNameChange || hasAvatarUpload || hasAvatarRemoval) {
        await mutateAsync({
          ...(hasAvatarRemoval ? { removeAvatar: true } : {}),
          ...(hasAvatarUpload && avatarDataUrl ? { avatarDataUrl } : {}),
          ...(hasDisplayNameChange ? { displayName: trimmedDisplayName } : {}),
        })
      }

      if (hasPasswordChange) {
        await updatePassword(newPassword, currentPassword)
        setCurrentPassword('')
        setNewPassword('')
        setNewPasswordConfirmation('')
      }

      setAvatarDataUrl(null)
      setRemoveAvatar(false)

      if (onSaved) {
        onSaved()
        return
      }

      setSuccessMessage('Профиль сохранен.')
    } catch (error) {
      setSuccessMessage(null)
      setErrorMessage(getProfileDialogErrorMessage(error))
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  return (
    <section
      className={cx(styles.dialog, variant === 'page' && styles.pageDialog)}
      {...(role ? { role } : {})}
      {...(ariaModal ? { 'aria-modal': true } : {})}
      aria-labelledby={headingId}
    >
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.kicker}>Профиль</p>
          <h2 id={headingId}>Аккаунт</h2>
          <p>Никнейм и аватар используются в вашем workspace.</p>
        </div>

        {showCloseButton && onCancel ? (
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть профиль"
            onClick={onCancel}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        ) : null}
      </header>

      <form
        className={styles.form}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <section className={styles.avatarPanel}>
          <UserAvatar
            avatarUrl={resolvedAvatarUrl}
            displayName={displayName || session?.actor.displayName || 'User'}
            email={session?.actor.email}
            size="lg"
          />

          <div className={styles.avatarActions}>
            <label className={styles.primaryButton} htmlFor={avatarInputId}>
              <UploadIcon size={17} strokeWidth={2.1} />
              <span>Загрузить</span>
            </label>
            <input
              id={avatarInputId}
              className={styles.hiddenInput}
              type="file"
              accept={ACCEPTED_PROFILE_AVATAR_TYPES}
              onChange={(event) => {
                void handleAvatarChange(event)
              }}
            />

            <button
              className={cx(styles.ghostButton, styles.removeButton)}
              type="button"
              disabled={!resolvedAvatarUrl}
              onClick={() => {
                setAvatarDataUrl(null)
                setRemoveAvatar(true)
                clearMessages()
              }}
            >
              <TrashIcon size={17} strokeWidth={2.05} />
              <span>Убрать</span>
            </button>
          </div>
        </section>

        <section className={styles.fields}>
          <label className={styles.field}>
            <span>Никнейм</span>
            <input
              type="text"
              value={displayName}
              maxLength={80}
              placeholder="Ваше имя"
              onChange={(event) => {
                setDisplayName(event.target.value)
                clearMessages()
              }}
            />
          </label>

          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              value={session?.actor.email ?? ''}
              disabled
              readOnly
            />
          </label>
        </section>

        {isAuthEnabled ? (
          <section className={styles.fields}>
            <div className={styles.sectionHeader}>
              <h3>Смена пароля</h3>
              <p>Заполните эти поля, если хотите обновить пароль.</p>
            </div>

            <label className={styles.field}>
              <span>Текущий пароль</span>
              <input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                placeholder="Введите текущий пароль"
                onChange={(event) => {
                  setCurrentPassword(event.target.value)
                  clearMessages()
                }}
              />
            </label>

            <label className={styles.field}>
              <span>Новый пароль</span>
              <input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                placeholder="Минимум 6 символов"
                onChange={(event) => {
                  setNewPassword(event.target.value)
                  clearMessages()
                }}
              />
            </label>

            <label className={styles.field}>
              <span>Повторите новый пароль</span>
              <input
                type="password"
                value={newPasswordConfirmation}
                autoComplete="new-password"
                placeholder="Повторите пароль"
                onChange={(event) => {
                  setNewPasswordConfirmation(event.target.value)
                  clearMessages()
                }}
              />
            </label>
          </section>
        ) : null}

        {errorMessage ? (
          <p className={styles.errorText}>{errorMessage}</p>
        ) : null}

        {successMessage ? (
          <p className={styles.successText}>{successMessage}</p>
        ) : null}

        <footer className={styles.footer}>
          {onCancel ? (
            <button
              className={styles.ghostButton}
              type="button"
              disabled={isSubmitting}
              onClick={onCancel}
            >
              <CloseIcon size={16} strokeWidth={2.1} />
              <span>{cancelLabel}</span>
            </button>
          ) : null}

          <button
            className={styles.primaryButton}
            type="submit"
            disabled={isSubmitting || !session}
          >
            <CheckIcon size={16} strokeWidth={2.1} />
            <span>{isSubmitting ? 'Сохраняем...' : 'Сохранить'}</span>
          </button>
        </footer>
      </form>
    </section>
  )
}

function validatePasswordChange({
  currentPassword,
  newPassword,
  newPasswordConfirmation,
}: {
  currentPassword: string
  newPassword: string
  newPasswordConfirmation: string
}): string | null {
  if (!currentPassword) {
    return 'Введите текущий пароль.'
  }

  if (!newPassword) {
    return 'Введите новый пароль.'
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов.`
  }

  if (!newPasswordConfirmation) {
    return 'Повторите новый пароль.'
  }

  if (newPassword !== newPasswordConfirmation) {
    return 'Пароли не совпадают.'
  }

  return null
}

function getProfileDialogErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'auth_invalid_credentials'
  ) {
    return 'Текущий пароль указан неверно.'
  }

  return getUpdateUserProfileErrorMessage(error)
}
