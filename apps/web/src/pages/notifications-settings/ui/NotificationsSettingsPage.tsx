import { useEffect, useState } from 'react'

import {
  createPushNotificationsApiClient,
  usePlannerSession,
  useSessionFeatureReadiness,
  useUpdateUserPreferences,
} from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'
import { useBrowserOffline } from '@/shared/lib/offline-sync'
import { BellIcon } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageStateView, PageStatusBanner } from '@/shared/ui/PageState'

import styles from './NotificationsSettingsPage.module.css'

type NotificationPreferenceKey =
  | 'sharedTaskAssignedNotificationsEnabled'
  | 'sharedTaskCreatedNotificationsEnabled'
  | 'sharedTaskReadyForReviewNotificationsEnabled'

type NativePushPermissionStatus =
  'denied' | 'granted' | 'prompt' | 'prompt-with-rationale' | 'unavailable'

type Feedback = {
  kind: 'error' | 'info'
  text: string
}

const NOTIFICATION_SETTINGS: Array<{
  description: string
  key: NotificationPreferenceKey
  label: string
}> = [
  {
    description:
      'Сообщать о каждой новой задаче участникам общего пространства.',
    key: 'sharedTaskCreatedNotificationsEnabled',
    label: 'Новые задачи в общих пространствах',
  },
  {
    description:
      'Присылать приоритетное уведомление, когда исполнителем выбрали вас.',
    key: 'sharedTaskAssignedNotificationsEnabled',
    label: 'Задачи, назначенные мне',
  },
  {
    description: 'Сообщать, когда задача перешла в статус «Готово к проверке».',
    key: 'sharedTaskReadyForReviewNotificationsEnabled',
    label: 'Задачи, готовые к проверке',
  },
]

export function NotificationsSettingsPage() {
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const { apiConfig, readiness } = useSessionFeatureReadiness({
    hasCachedData: Boolean(session),
  })
  const updatePreferences = useUpdateUserPreferences()
  const isBrowserOffline = useBrowserOffline()
  const isAndroid = isAndroidNativeRuntime()
  const [permissionStatus, setPermissionStatus] =
    useState<NativePushPermissionStatus | null>(
      isAndroid ? null : 'unavailable',
    )
  const [isNativeActionPending, setIsNativeActionPending] = useState(false)
  const [isTestPending, setIsTestPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const serverSettingsDisabled =
    isBrowserOffline || !readiness.canWriteProtectedData

  useEffect(() => {
    if (!isAndroid) {
      return
    }

    let isDisposed = false

    async function refreshPermission() {
      try {
        const status = await getNativePushPermissionStatus()

        if (!isDisposed) {
          setPermissionStatus(status)
        }
      } catch (error) {
        console.warn('Failed to read Android push permission.', error)

        if (!isDisposed) {
          setPermissionStatus(null)
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refreshPermission()
      }
    }

    function handleFocus() {
      void refreshPermission()
    }

    void refreshPermission()
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isDisposed = true
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isAndroid])

  async function updateNotificationPreference(
    key: NotificationPreferenceKey,
    enabled: boolean,
  ) {
    if (!session || serverSettingsDisabled) {
      return
    }

    setFeedback(null)

    try {
      await updatePreferences.mutateAsync({
        [key]: enabled,
      })
    } catch (error) {
      console.warn('Failed to update notification preference.', error)
      setFeedback({
        kind: 'error',
        text: 'Не удалось сохранить настройку. Повторите попытку.',
      })
    }
  }

  async function requestPermission() {
    setIsNativeActionPending(true)
    setFeedback(null)

    try {
      const status = await requestNativePushPermission()
      setPermissionStatus(status)
      setFeedback({
        kind: status === 'granted' ? 'info' : 'error',
        text:
          status === 'granted'
            ? 'Уведомления разрешены. Устройство регистрируется для получения push.'
            : 'Android не разрешил уведомления. Проверьте системные настройки приложения.',
      })
    } catch (error) {
      console.warn('Failed to request Android push permission.', error)
      setFeedback({
        kind: 'error',
        text: 'Не удалось запросить разрешение Android.',
      })
    } finally {
      setIsNativeActionPending(false)
    }
  }

  async function openSystemSettings() {
    setIsNativeActionPending(true)
    setFeedback(null)

    try {
      await openAndroidSystemAppSettings()
    } catch (error) {
      console.warn('Failed to open Android app settings.', error)
      setFeedback({
        kind: 'error',
        text: 'Не удалось открыть системные настройки Android.',
      })
    } finally {
      setIsNativeActionPending(false)
    }
  }

  async function sendTestNotification() {
    if (!apiConfig || permissionStatus !== 'granted') {
      return
    }

    setIsTestPending(true)
    setFeedback(null)

    try {
      const result = await createPushNotificationsApiClient(
        apiConfig,
      ).sendTestNotification({
        body: 'Уведомления Chaotika работают.',
        data: {
          path: '/notifications/settings',
          type: 'test-notification',
        },
        title: 'Тестовое уведомление',
      })

      if (result.deliveredCount > 0) {
        setFeedback({
          kind: 'info',
          text: 'Тестовое уведомление отправлено.',
        })
      } else {
        setFeedback({
          kind: 'error',
          text:
            result.failedCount > 0
              ? 'Не удалось доставить тестовое уведомление. Повторите попытку.'
              : 'Зарегистрированное Android-устройство не найдено. Повторите тест через несколько секунд.',
        })
      }
    } catch (error) {
      console.warn('Failed to send a test push notification.', error)
      setFeedback({
        kind: 'error',
        text: 'Не удалось отправить тестовое уведомление.',
      })
    } finally {
      setIsTestPending(false)
    }
  }

  if (!session) {
    if (sessionQuery.isPending) {
      return (
        <PageStateView
          kind="loading"
          skeletonVariant="settings"
          title="Загружаем настройки уведомлений"
        />
      )
    }

    return (
      <PageStateView
        action={{
          label: 'Повторить',
          onClick: () => {
            void sessionQuery.refetch()
          },
        }}
        description="Не удалось подтвердить сессию и получить настройки уведомлений."
        kind="error"
        title="Не удалось загрузить настройки"
      />
    )
  }

  return (
    <section className={cx(pageStyles.page, styles.page)}>
      <section className={styles.panel} aria-label="Уведомления">
        <div className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <BellIcon size={18} strokeWidth={2.1} />
          </span>
          <div>
            <h1>Уведомления</h1>
            <p>Настройки действуют для аккаунта во всех пространствах.</p>
          </div>
        </div>

        {serverSettingsDisabled ? (
          <PageStatusBanner
            description="Настройки доступны для просмотра. Изменить их можно после восстановления подключения и доступа к аккаунту."
            kind={isBrowserOffline ? 'offline' : 'error'}
            title={
              isBrowserOffline
                ? 'Нет подключения'
                : 'Изменения временно недоступны'
            }
          />
        ) : null}

        <section className={styles.group} aria-label="Общие пространства">
          <h2>Общие пространства</h2>
          <div className={styles.switchList}>
            {NOTIFICATION_SETTINGS.map((setting) => (
              <SettingsSwitch
                key={setting.key}
                checked={session.userPreferences[setting.key] ?? true}
                description={setting.description}
                disabled={serverSettingsDisabled || updatePreferences.isPending}
                label={setting.label}
                onCheckedChange={(enabled) => {
                  void updateNotificationPreference(setting.key, enabled)
                }}
              />
            ))}
          </div>
        </section>

        <section className={styles.group} aria-label="Доставка на Android">
          <h2>Доставка на Android</h2>
          {!isAndroid ? (
            <p className={styles.note}>
              Системное разрешение и тестовый push доступны в приложении
              Chaotika для Android. Настройки аккаунта выше действуют и в
              web-версии.
            </p>
          ) : (
            <>
              <div className={styles.permissionRow}>
                <span>
                  <strong>Системное разрешение</strong>
                  <small>{formatPermissionStatus(permissionStatus)}</small>
                </span>
                {permissionStatus === 'denied' ? (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={isNativeActionPending}
                    onClick={() => {
                      void openSystemSettings()
                    }}
                  >
                    Открыть настройки
                  </button>
                ) : permissionStatus !== 'granted' ? (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={
                      isNativeActionPending || permissionStatus === null
                    }
                    onClick={() => {
                      void requestPermission()
                    }}
                  >
                    Разрешить
                  </button>
                ) : (
                  <span className={styles.grantedStatus}>Разрешено</span>
                )}
              </div>
              <button
                className={styles.testButton}
                type="button"
                disabled={
                  isTestPending ||
                  !apiConfig ||
                  permissionStatus !== 'granted' ||
                  !readiness.canWriteProtectedData
                }
                onClick={() => {
                  void sendTestNotification()
                }}
              >
                {isTestPending
                  ? 'Отправляем…'
                  : 'Отправить тестовое уведомление'}
              </button>
            </>
          )}
        </section>

        {feedback ? (
          <PageStatusBanner
            description={feedback.text}
            kind={feedback.kind}
            title={
              feedback.kind === 'error'
                ? 'Не удалось выполнить действие'
                : 'Готово'
            }
          />
        ) : null}
      </section>
    </section>
  )
}

async function getNativePushPermissionStatus(): Promise<NativePushPermissionStatus> {
  const nativePushNotifications = await import('@/features/session/native-push')

  return nativePushNotifications.getNativePushPermissionStatus()
}

async function requestNativePushPermission(): Promise<NativePushPermissionStatus> {
  const nativePushNotifications = await import('@/features/session/native-push')

  return nativePushNotifications.requestNativePushPermission()
}

async function openAndroidSystemAppSettings(): Promise<void> {
  const nativeVoiceAssistant = await import('@/features/voice-assistant/native')

  await nativeVoiceAssistant.openAndroidSystemAppSettings()
}

function SettingsSwitch({
  checked,
  description,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean
  description: string
  disabled: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <button
      className={cx(styles.switchButton, checked && styles.switchButtonChecked)}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onCheckedChange(!checked)
      }}
    >
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      <span className={styles.switchCopy}>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </button>
  )
}

function formatPermissionStatus(
  status: Awaited<ReturnType<typeof getNativePushPermissionStatus>> | null,
): string {
  switch (status) {
    case 'denied':
      return 'запрещено в Android'
    case 'granted':
      return 'разрешено'
    case 'prompt':
    case 'prompt-with-rationale':
      return 'нужно разрешение'
    case 'unavailable':
      return 'недоступно'
    case null:
      return 'проверяем…'
  }
}
