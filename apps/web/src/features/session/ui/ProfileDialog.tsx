import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'

import {
  getNativePlannerWidgetBackgroundOpacity,
  isAndroidPlannerWidgetRuntime,
  NATIVE_PLANNER_WIDGET_BACKGROUND_OPACITY_OPTIONS,
  type NativePlannerWidgetBackgroundOpacity,
  setNativePlannerWidgetBackgroundOpacity,
} from '@/features/planner'
import { cx } from '@/shared/lib/classnames'
import { CheckIcon, CloseIcon, TrashIcon, UploadIcon } from '@/shared/ui/Icon'

import {
  ACCEPTED_PROFILE_AVATAR_TYPES,
  prepareProfileAvatarUpload,
  validateProfileAvatarFile,
} from '../lib/profile-avatar-upload'
import { usePlannerSession } from '../lib/usePlannerSession'
import {
  getUpdateUserProfileErrorMessage,
  useUpdateUserProfile,
} from '../lib/useUserProfile'
import styles from './ProfileDialog.module.css'
import { UserAvatar } from './UserAvatar'

interface ProfileDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function ProfileDialog({ isOpen, onClose }: ProfileDialogProps) {
  if (!isOpen) {
    return null
  }

  return <ProfileDialogContent onClose={onClose} />
}

interface ProfileDialogContentProps {
  onClose: () => void
}

function ProfileDialogContent({ onClose }: ProfileDialogContentProps) {
  const avatarInputId = useId()
  const session = usePlannerSession().data
  const updateUserProfile = useUpdateUserProfile()
  const { isPending, mutateAsync } = updateUserProfile
  const [displayName, setDisplayName] = useState(
    () => session?.actor.displayName ?? '',
  )
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [widgetBackgroundOpacity, setWidgetBackgroundOpacity] =
    useState<NativePlannerWidgetBackgroundOpacity>(100)
  const isWidgetSettingsAvailable = useMemo(
    () => isAndroidPlannerWidgetRuntime(),
    [],
  )

  useEffect(() => {
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
  }, [onClose])

  useEffect(() => {
    if (!isWidgetSettingsAvailable) {
      return
    }

    let isActive = true

    void getNativePlannerWidgetBackgroundOpacity()
      .then((opacity) => {
        if (isActive) {
          setWidgetBackgroundOpacity(opacity)
        }
      })
      .catch((error) => {
        console.warn('Failed to read Android planner widget settings.', error)
      })

    return () => {
      isActive = false
    }
  }, [isWidgetSettingsAvailable])

  const resolvedAvatarUrl = useMemo(() => {
    if (avatarDataUrl) {
      return avatarDataUrl
    }

    if (removeAvatar) {
      return null
    }

    return session?.actor.avatarUrl ?? null
  }, [avatarDataUrl, removeAvatar, session?.actor.avatarUrl])

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const validationError = validateProfileAvatarFile(file)

    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    try {
      const preparedAvatar = await prepareProfileAvatarUpload(file)
      setAvatarDataUrl(preparedAvatar)
      setRemoveAvatar(false)
      setErrorMessage(null)
    } catch (error) {
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
      return
    }

    const hasDisplayNameChange =
      trimmedDisplayName !== session.actor.displayName.trim()
    const hasAvatarUpload = Boolean(avatarDataUrl)
    const hasAvatarRemoval =
      !hasAvatarUpload && removeAvatar && Boolean(session.actor.avatarUrl)

    if (!hasDisplayNameChange && !hasAvatarUpload && !hasAvatarRemoval) {
      onClose()
      return
    }

    setErrorMessage(null)

    try {
      await mutateAsync({
        ...(hasAvatarRemoval ? { removeAvatar: true } : {}),
        ...(hasAvatarUpload && avatarDataUrl ? { avatarDataUrl } : {}),
        ...(hasDisplayNameChange ? { displayName: trimmedDisplayName } : {}),
      })
      onClose()
    } catch (error) {
      setErrorMessage(getUpdateUserProfileErrorMessage(error))
    }
  }

  async function handleWidgetBackgroundOpacityChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const nextOpacity = Number(event.target.value)

    setErrorMessage(null)

    try {
      setWidgetBackgroundOpacity(
        await setNativePlannerWidgetBackgroundOpacity(nextOpacity),
      )
    } catch (error) {
      console.warn('Failed to update Android planner widget settings.', error)
      setErrorMessage('Не удалось обновить фон виджета.')
    }
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={() => {
        onClose()
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <p className={styles.kicker}>Профиль</p>
            <h2 id="profile-dialog-title">Аккаунт</h2>
            <p>Никнейм и аватар используются в вашем workspace.</p>
          </div>

          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть профиль"
            onClick={() => {
              onClose()
            }}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
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
                  setErrorMessage(null)
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
                  setErrorMessage(null)
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

          {isWidgetSettingsAvailable ? (
            <section
              className={cx(styles.fields, styles.widgetPanel)}
              aria-labelledby="profile-widget-settings-title"
            >
              <div className={styles.rangeHeader}>
                <h3 id="profile-widget-settings-title">Виджет Android</h3>
                <output
                  className={styles.rangeValue}
                  htmlFor="planner-widget-background-opacity"
                >
                  {widgetBackgroundOpacity}%
                </output>
              </div>

              <label className={cx(styles.field, styles.rangeField)}>
                <span>Непрозрачность фона</span>
                <input
                  id="planner-widget-background-opacity"
                  className={styles.rangeInput}
                  type="range"
                  min={NATIVE_PLANNER_WIDGET_BACKGROUND_OPACITY_OPTIONS[0]}
                  max={
                    NATIVE_PLANNER_WIDGET_BACKGROUND_OPACITY_OPTIONS[
                      NATIVE_PLANNER_WIDGET_BACKGROUND_OPACITY_OPTIONS.length -
                        1
                    ]
                  }
                  step={15}
                  value={widgetBackgroundOpacity}
                  onChange={(event) => {
                    void handleWidgetBackgroundOpacityChange(event)
                  }}
                />
              </label>
            </section>
          ) : null}

          {errorMessage ? (
            <p className={styles.errorText}>{errorMessage}</p>
          ) : null}

          <footer className={styles.footer}>
            <button
              className={styles.ghostButton}
              type="button"
              disabled={isPending}
              onClick={() => {
                onClose()
              }}
            >
              <CloseIcon size={16} strokeWidth={2.1} />
              <span>Отмена</span>
            </button>

            <button
              className={styles.primaryButton}
              type="submit"
              disabled={isPending || !session}
            >
              <CheckIcon size={16} strokeWidth={2.1} />
              <span>{isPending ? 'Сохраняем...' : 'Сохранить'}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
