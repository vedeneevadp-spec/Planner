import { canUseVoiceAssistant } from '@planner/contracts'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { usePlannerSession, useUpdateUserPreferences } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { BellIcon, GearIcon, MicIcon } from '@/shared/ui/Icon'

import {
  addVoiceAssistantSettingsChangedListener,
  getVoiceAssistantNativeStatus,
  isAndroidVoiceAssistantRuntime,
  openAndroidBatteryOptimizationSettings,
  openAndroidSystemAppSettings,
  requestAndroidMicrophonePermission,
  requestAndroidNotificationPermission,
  setAndroidBackgroundWakeWordEnabled,
  setAndroidVoiceCuesEnabled,
  setAndroidWakeWordEnabled,
  setAndroidWakeWordReviewModeEnabled,
  setAndroidWakeWordSensitivity,
  stopAndroidVoiceAssistant,
  type VoiceAssistantNativeStatus,
} from '../lib/native-voice-assistant'
import {
  MAX_WAKE_WORD_SENSITIVITY,
  MIN_WAKE_WORD_SENSITIVITY,
  VOICE_ASSISTANT_WAKE_PHRASE,
  WAKE_WORD_SENSITIVITY_STEP,
} from '../model/voice-assistant-settings'
import styles from './VoiceAssistantSettingsPanel.module.css'

export function VoiceAssistantSettingsPanel() {
  const session = usePlannerSession().data
  const updateUserPreferences = useUpdateUserPreferences()
  const [nativeStatus, setNativeStatus] =
    useState<VoiceAssistantNativeStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isNativeActionPending, setIsNativeActionPending] = useState(false)
  const isVoiceAvailable = canUseVoiceAssistant(session?.appRole)
  const voiceAssistantEnabled =
    session?.userPreferences.voiceAssistantEnabled ?? true
  const isAndroid = nativeStatus?.isAndroid ?? isAndroidVoiceAssistantRuntime()
  const isMasterPending = updateUserPreferences.isPending
  const status = nativeStatus ?? null
  const wakeWordModelMissing = status?.wakeWordModelStatus === 'missing'
  const androidControlsDisabled =
    !voiceAssistantEnabled || isNativeActionPending || isMasterPending
  const wakeWordDisabled =
    androidControlsDisabled || wakeWordModelMissing || !status
  const backgroundDisabled =
    androidControlsDisabled ||
    wakeWordModelMissing ||
    !status?.wakeWordEnabled ||
    !status

  const refreshStatus = useCallback(async () => {
    try {
      setNativeStatus(await getVoiceAssistantNativeStatus())
    } catch (error) {
      console.warn('Failed to load voice assistant native status.', error)
      setMessage('Не удалось прочитать статус голосового помощника.')
    }
  }, [])

  useEffect(() => {
    void refreshStatus()

    return addVoiceAssistantSettingsChangedListener(() => {
      void refreshStatus()
    })
  }, [refreshStatus])

  const permissionRows = useMemo(
    () => [
      {
        action: requestAndroidMicrophonePermission,
        icon: <MicIcon size={17} strokeWidth={2.1} />,
        label: 'Микрофон',
        status: status?.microphonePermission ?? 'unknown',
        buttonLabel: 'Разрешить микрофон',
      },
      {
        action: requestAndroidNotificationPermission,
        icon: <BellIcon size={17} strokeWidth={2.1} />,
        label: 'Уведомления',
        status: status?.notificationPermission ?? 'unknown',
        buttonLabel: 'Разрешить уведомления',
      },
    ],
    [status?.microphonePermission, status?.notificationPermission],
  )

  async function handleVoiceAssistantToggle(enabled: boolean) {
    if (!session) {
      return
    }

    setMessage(null)
    updateUserPreferences.mutate({ voiceAssistantEnabled: enabled })

    if (!enabled) {
      await stopAndroidVoiceAssistant().catch((error) => {
        console.warn('Failed to stop Android voice assistant.', error)
      })
    }
  }

  async function runNativeAction(action: () => Promise<void>) {
    setIsNativeActionPending(true)
    setMessage(null)

    try {
      await action()
      await refreshStatus()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось обновить настройки голосового помощника.',
      )
    } finally {
      setIsNativeActionPending(false)
    }
  }

  async function handleWakeWordToggle(enabled: boolean) {
    if (enabled && status?.wakeWordModelStatus === 'missing') {
      setMessage(
        `Модель "${VOICE_ASSISTANT_WAKE_PHRASE}" не установлена. Кнопка микрофона остается доступной.`,
      )
      return
    }

    await runNativeAction(() => setAndroidWakeWordEnabled(enabled))
  }

  async function handleBackgroundToggle(enabled: boolean) {
    if (!enabled) {
      await runNativeAction(() => setAndroidBackgroundWakeWordEnabled(false))
      return
    }

    const currentStatus = status ?? (await getVoiceAssistantNativeStatus())
    const blocker = getBackgroundWakeWordBlocker(
      currentStatus,
      voiceAssistantEnabled,
    )

    if (blocker) {
      setMessage(blocker)
      return
    }

    await runNativeAction(() => setAndroidBackgroundWakeWordEnabled(true))
  }

  if (!session) {
    return null
  }

  if (!isVoiceAvailable) {
    return (
      <section className={styles.panel} aria-label="Голосовой помощник">
        <PanelHeader />
        <p className={styles.unavailable}>
          Голосовой помощник пока недоступен для вашей роли.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.panel} aria-label="Голосовой помощник">
      <PanelHeader />

      <SettingsSwitch
        checked={voiceAssistantEnabled}
        disabled={isMasterPending}
        label="Включить голосовой помощник"
        onCheckedChange={(enabled) => {
          void handleVoiceAssistantToggle(enabled)
        }}
      />

      <div className={styles.readonlyGrid}>
        <ReadonlyRow
          label="Фраза активации"
          value={VOICE_ASSISTANT_WAKE_PHRASE}
        />
        <ReadonlyRow label="Язык" value="Русский" />
        <ReadonlyRow label="Режим подтверждений" value="Всегда подтверждать" />
      </div>

      {!isAndroid ? (
        <p className={styles.platformNote}>
          В web-версии доступна только кнопка микрофона. Wake word и звуки
          помощника доступны только на Android.
        </p>
      ) : null}

      {isAndroid ? (
        <>
          <section className={styles.group} aria-label="Android voice settings">
            <h3>Активация голосом</h3>
            <SettingsSwitch
              checked={Boolean(status?.wakeWordEnabled)}
              disabled={wakeWordDisabled}
              label={`Wake word "${VOICE_ASSISTANT_WAKE_PHRASE}"`}
              onCheckedChange={(enabled) => {
                void handleWakeWordToggle(enabled)
              }}
            />

            <SettingsSwitch
              checked={Boolean(status?.backgroundWakeWordEnabled)}
              disabled={backgroundDisabled}
              label={`Слушать "${VOICE_ASSISTANT_WAKE_PHRASE}" в фоне`}
              onCheckedChange={(enabled) => {
                void handleBackgroundToggle(enabled)
              }}
            />

            {wakeWordModelMissing ? (
              <p className={styles.warning} role="status">
                Модель "{VOICE_ASSISTANT_WAKE_PHRASE}" не установлена. Wake word
                недоступен, кнопка микрофона остается доступной.
              </p>
            ) : null}
          </section>

          <section className={styles.group} aria-label="Android voice cues">
            <h3>Звуки помощника</h3>
            <SettingsSwitch
              checked={Boolean(status?.voiceCuesEnabled)}
              disabled={androidControlsDisabled || !status}
              label={'Проигрывать "Слушаю" и "Готово"'}
              onCheckedChange={(enabled) => {
                void runNativeAction(() => setAndroidVoiceCuesEnabled(enabled))
              }}
            />
          </section>

          <section className={styles.group} aria-label="Wake word sensitivity">
            <div className={styles.rangeHeader}>
              <h3>Чувствительность "{VOICE_ASSISTANT_WAKE_PHRASE}"</h3>
              <span>{formatSensitivity(status?.wakeWordSensitivity)}</span>
            </div>
            <input
              className={styles.rangeInput}
              type="range"
              min={MIN_WAKE_WORD_SENSITIVITY}
              max={MAX_WAKE_WORD_SENSITIVITY}
              step={WAKE_WORD_SENSITIVITY_STEP}
              value={status?.wakeWordSensitivity ?? MAX_WAKE_WORD_SENSITIVITY}
              disabled={androidControlsDisabled || !status}
              aria-label={`Чувствительность "${VOICE_ASSISTANT_WAKE_PHRASE}"`}
              onChange={(event) => {
                const sensitivity = Number(event.target.value)
                void runNativeAction(() =>
                  setAndroidWakeWordSensitivity(sensitivity),
                )
              }}
            />
          </section>

          <section className={styles.group} aria-label="Wake word review mode">
            <h3>Режим дообучения "{VOICE_ASSISTANT_WAKE_PHRASE}"</h3>
            <SettingsSwitch
              checked={Boolean(status?.wakeWordReviewModeEnabled)}
              disabled={androidControlsDisabled || !status}
              label={`Показывать окно оценки срабатывания "${VOICE_ASSISTANT_WAKE_PHRASE}"`}
              onCheckedChange={(enabled) => {
                void runNativeAction(() =>
                  setAndroidWakeWordReviewModeEnabled(enabled),
                )
              }}
            />
            <p className={styles.note}>
              Аудио для обучения сохраняется только после отдельного согласия.
            </p>
          </section>

          <section className={styles.group} aria-label="Разрешения">
            <h3>Разрешения</h3>
            <div className={styles.permissionList}>
              {permissionRows.map((row) => (
                <PermissionRow
                  key={row.label}
                  buttonLabel={row.buttonLabel}
                  disabled={isNativeActionPending}
                  icon={row.icon}
                  label={row.label}
                  status={formatPermissionStatus(row.status)}
                  onClick={() => {
                    void runNativeAction(async () => {
                      await row.action()
                    })
                  }}
                />
              ))}
              <div className={styles.statusRow}>
                <span className={styles.rowIcon} aria-hidden="true">
                  <GearIcon size={17} strokeWidth={2.1} />
                </span>
                <span className={styles.rowCopy}>
                  <strong>Фоновый сервис</strong>
                  <span>
                    {formatForegroundServiceStatus(
                      status?.foregroundServiceStatus,
                    )}
                  </span>
                </span>
              </div>
            </div>
            <div className={styles.inlineActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => {
                  void openAndroidSystemAppSettings()
                }}
              >
                Открыть настройки
              </button>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => {
                  void openAndroidBatteryOptimizationSettings()
                }}
              >
                Настройки батареи
              </button>
            </div>
          </section>
        </>
      ) : null}

      {message ? (
        <p className={styles.message} role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}

function PanelHeader() {
  return (
    <div className={styles.header}>
      <span className={styles.headerIcon} aria-hidden="true">
        <MicIcon size={18} strokeWidth={2.1} />
      </span>
      <div>
        <h2>Голосовой помощник</h2>
      </div>
    </div>
  )
}

function SettingsSwitch({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean
  disabled?: boolean | undefined
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <button
      className={cx(styles.switchButton, checked && styles.switchButtonChecked)}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onCheckedChange(!checked)
      }}
    >
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      <span className={styles.switchLabel}>{label}</span>
    </button>
  )
}

function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readonlyRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PermissionRow({
  buttonLabel,
  disabled,
  icon,
  label,
  status,
  onClick,
}: {
  buttonLabel: string
  disabled: boolean
  icon: ReactNode
  label: string
  status: string
  onClick: () => void
}) {
  return (
    <div className={styles.permissionRow}>
      <span className={styles.rowIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.rowCopy}>
        <strong>{label}</strong>
        <span>{status}</span>
      </span>
      <button
        className={styles.permissionButton}
        type="button"
        disabled={disabled}
        onClick={onClick}
      >
        {buttonLabel}
      </button>
    </div>
  )
}

function getBackgroundWakeWordBlocker(
  status: VoiceAssistantNativeStatus,
  voiceAssistantEnabled: boolean,
): string | null {
  if (!voiceAssistantEnabled) {
    return 'Сначала включите голосовой помощник.'
  }

  if (!status.wakeWordEnabled) {
    return `Сначала включите wake word "${VOICE_ASSISTANT_WAKE_PHRASE}".`
  }

  if (status.wakeWordModelStatus !== 'ready') {
    return `Модель "${VOICE_ASSISTANT_WAKE_PHRASE}" не готова. Кнопка микрофона остается доступной.`
  }

  if (status.microphonePermission !== 'granted') {
    return 'Для фонового режима нужен доступ к микрофону.'
  }

  if (status.notificationPermission !== 'granted') {
    return 'Для фонового режима нужно разрешение уведомлений.'
  }

  return null
}

function formatPermissionStatus(
  status: VoiceAssistantNativeStatus['microphonePermission'],
): string {
  switch (status) {
    case 'granted':
      return 'разрешен'
    case 'denied':
      return 'не разрешен'
    case 'unknown':
      return 'неизвестно'
  }
}

function formatForegroundServiceStatus(
  status: VoiceAssistantNativeStatus['foregroundServiceStatus'] | undefined,
): string {
  switch (status) {
    case 'blocked':
      return 'заблокирован'
    case 'missing_permission':
      return 'нет разрешений'
    case 'running':
      return 'работает'
    case 'stopped':
      return 'остановлен'
    case undefined:
      return 'неизвестно'
  }
}

function formatSensitivity(value: number | undefined): string {
  return (value ?? MAX_WAKE_WORD_SENSITIVITY).toFixed(2)
}
