import { canUseVoiceAssistant } from '@planner/contracts'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  usePlannerSession,
  useUpdateUserPreferences,
  useUpdateWorkspaceSettings,
} from '@/features/session'
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
  stopAndroidVoiceAssistant,
  type VoiceAssistantNativeStatus,
} from '../lib/native-voice-assistant'
import {
  DEFAULT_WAKE_WORD_SENSITIVITY,
  VOICE_ASSISTANT_WAKE_PHRASE,
} from '../model/voice-assistant-settings'
import styles from './VoiceAssistantSettingsPanel.module.css'

export function VoiceAssistantSettingsPanel() {
  const session = usePlannerSession().data
  const updateUserPreferences = useUpdateUserPreferences()
  const updateWorkspaceSettings = useUpdateWorkspaceSettings()
  const [nativeStatus, setNativeStatus] =
    useState<VoiceAssistantNativeStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isNativeActionPending, setIsNativeActionPending] = useState(false)
  const isVoiceAvailable = canUseVoiceAssistant(session?.appRole)
  const voiceAssistantEnabled =
    session?.userPreferences.voiceAssistantEnabled ?? true
  const isAndroid = nativeStatus?.isAndroid ?? isAndroidVoiceAssistantRuntime()
  const isMasterPending = updateUserPreferences.isPending
  const isWorkspaceSettingsPending = updateWorkspaceSettings.isPending
  const status = nativeStatus ?? null
  const workspaceSettings = session?.workspaceSettings ?? {
    taskCompletionConfettiEnabled: true,
    wakeWordTrainingModeEnabled: false,
  }
  const canUpdateWakeWordTrainingMode = session?.appRole === 'owner'
  const canShowRuntimeDiagnostics =
    isAndroid && (session?.appRole === 'owner' || session?.appRole === 'test')
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

  async function handleWakeWordTrainingModeToggle(enabled: boolean) {
    if (!session) {
      return
    }

    setMessage(null)

    try {
      await updateWorkspaceSettings.mutateAsync({
        taskCompletionConfettiEnabled:
          workspaceSettings.taskCompletionConfettiEnabled,
        wakeWordTrainingModeEnabled: enabled,
      })
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось обновить режим дообучения.',
      )
    }
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
        <ReadonlyRow label="Режим подтверждений" value="Всегда подтверждать" />
      </div>

      <section className={styles.group} aria-label="Приватность голоса">
        <h3>Приватность</h3>
        <p className={styles.note}>
          "{VOICE_ASSISTANT_WAKE_PHRASE}" распознается локально на устройстве.
          До фразы активации аудио не отправляется на сервер. После активации
          или нажатия микрофона отправляется только короткая команда.
        </p>
      </section>

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
            <p className={styles.note}>
              Для фонового режима нужны доступ к микрофону и постоянное
              уведомление. Фоновый режим можно выключить в любой момент.
            </p>

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

          <section
            className={styles.group}
            aria-label="Wake word model threshold"
          >
            <h3>Порог модели "{VOICE_ASSISTANT_WAKE_PHRASE}"</h3>
            <div className={styles.readonlyGrid}>
              <ReadonlyRow
                label="Порог"
                value={formatSensitivity(status?.wakeWordSensitivity)}
              />
            </div>
          </section>

          <section className={styles.group} aria-label="Wake word review mode">
            <h3>Режим дообучения "{VOICE_ASSISTANT_WAKE_PHRASE}"</h3>
            <SettingsSwitch
              checked={workspaceSettings.wakeWordTrainingModeEnabled}
              disabled={
                androidControlsDisabled ||
                isWorkspaceSettingsPending ||
                !canUpdateWakeWordTrainingMode ||
                !status
              }
              label={`Показывать окно оценки срабатывания "${VOICE_ASSISTANT_WAKE_PHRASE}"`}
              onCheckedChange={(enabled) => {
                void handleWakeWordTrainingModeToggle(enabled)
              }}
            />
            <p className={styles.note}>
              {canUpdateWakeWordTrainingMode
                ? 'Аудио для обучения сохраняется только после отдельного согласия.'
                : 'Режим дообучения может менять только owner.'}
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

          {canShowRuntimeDiagnostics ? (
            <section
              className={styles.group}
              aria-label="Android voice runtime"
            >
              <h3>Android voice runtime</h3>
              <div className={styles.runtimeGrid}>
                <ReadonlyRow
                  label="Status"
                  value={status?.runtimeStatus ?? 'stopped'}
                />
                <ReadonlyRow
                  label="Wake model"
                  value={status?.wakeWordModelStatus ?? 'missing'}
                />
                <ReadonlyRow
                  label="Foreground service"
                  value={status?.foregroundServiceStatus ?? 'stopped'}
                />
                <ReadonlyRow
                  label="Last error"
                  value={status?.runtimeLastError ?? 'none'}
                />
                <ReadonlyRow
                  label="Runtime"
                  value={formatRuntimeDuration(status?.runtimeDurationMs)}
                />
                <ReadonlyRow
                  label="Battery sample"
                  value={formatBatterySample(status)}
                />
                <ReadonlyRow
                  label="CPU sample"
                  value={formatCpuSample(status)}
                />
                <ReadonlyRow
                  label="Memory sample"
                  value={formatMemorySample(status)}
                />
                <ReadonlyRow
                  label="Push-to-talk fallback"
                  value={status?.pushToTalkFallbackStatus ?? 'available'}
                />
              </div>
            </section>
          ) : null}
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
  return (value ?? DEFAULT_WAKE_WORD_SENSITIVITY).toFixed(2)
}

function formatRuntimeDuration(durationMs: number | undefined): string {
  const totalSeconds = Math.max(0, Math.floor((durationMs ?? 0) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, '0'))
    .join(':')
}

function formatBatterySample(
  status: VoiceAssistantNativeStatus | null,
): string {
  const sample = status?.batterySample

  if (!sample || sample.levelPercent < 0) {
    return 'unknown'
  }

  const flags = [
    sample.isCharging ? 'charging' : null,
    sample.isPowerSaveMode ? 'battery saver' : null,
  ].filter(Boolean)

  return `${sample.levelPercent}%${flags.length > 0 ? `, ${flags.join(', ')}` : ''}`
}

function formatCpuSample(status: VoiceAssistantNativeStatus | null): string {
  const value = status?.cpuSample?.processCpuPercent

  if (value === undefined || !Number.isFinite(value)) {
    return 'unknown'
  }

  return `${value.toFixed(1)}% process`
}

function formatMemorySample(status: VoiceAssistantNativeStatus | null): string {
  const sample = status?.memorySample

  if (!sample) {
    return 'unknown'
  }

  return `${sample.usedMb} / ${sample.maxMb} MB`
}
