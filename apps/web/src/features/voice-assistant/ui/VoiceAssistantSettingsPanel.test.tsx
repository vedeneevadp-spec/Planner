import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VoiceAssistantNativeStatus } from '../lib/native-voice-assistant'
import { VoiceAssistantSettingsPanel } from './VoiceAssistantSettingsPanel'

type AppRole = 'admin' | 'guest' | 'owner' | 'test' | 'user'

interface PlannerSessionHookResult {
  data:
    | {
        appRole: AppRole
        userPreferences: {
          calendarViewMode: 'week'
          energyMode: 'normal'
          voiceAssistantEnabled: boolean
        }
        workspaceSettings: {
          taskCompletionConfettiEnabled: boolean
          wakeWordTrainingModeEnabled: boolean
        }
      }
    | undefined
  error: Error | null
  isPending: boolean
  refetch: () => Promise<unknown>
}

interface UpdateUserPreferencesHookResult {
  isPending: boolean
  mutateAsync: (input: { voiceAssistantEnabled: boolean }) => Promise<void>
}

interface UpdateWorkspaceSettingsHookResult {
  isPending: boolean
  mutateAsync: (input: {
    taskCompletionConfettiEnabled: boolean
    wakeWordTrainingModeEnabled: boolean
  }) => Promise<void>
}

const mocks = vi.hoisted(() => ({
  browserOffline: false,
  getVoiceAssistantNativeStatus:
    vi.fn<() => Promise<VoiceAssistantNativeStatus>>(),
  isAndroidVoiceAssistantRuntime: vi.fn(() => false),
  openAndroidBatteryOptimizationSettings: vi.fn(() => Promise.resolve()),
  openAndroidSystemAppSettings: vi.fn(() => Promise.resolve()),
  requestAndroidMicrophonePermission: vi.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  requestAndroidNotificationPermission: vi.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  setAndroidBackgroundWakeWordEnabled: vi.fn<
    (enabled: boolean) => Promise<void>
  >(() => Promise.resolve()),
  setAndroidVoiceCuesEnabled: vi.fn<(enabled: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  setAndroidWakeWordEnabled: vi.fn<(enabled: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  stopAndroidVoiceAssistant: vi.fn(() => Promise.resolve()),
  readiness: {
    canWriteProtectedData: true,
    reason: 'ready',
  },
  usePlannerSession: vi.fn<() => PlannerSessionHookResult>(),
  useUpdateUserPreferences: vi.fn<() => UpdateUserPreferencesHookResult>(),
  useUpdateWorkspaceSettings: vi.fn<() => UpdateWorkspaceSettingsHookResult>(),
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
  useSessionFeatureReadiness: () => ({ readiness: mocks.readiness }),
  useUpdateUserPreferences: () => mocks.useUpdateUserPreferences(),
  useUpdateWorkspaceSettings: () => mocks.useUpdateWorkspaceSettings(),
}))

vi.mock('@/shared/lib/offline-sync', () => ({
  useBrowserOffline: () => mocks.browserOffline,
}))

vi.mock('../lib/native-voice-assistant', () => ({
  addVoiceAssistantSettingsChangedListener: () => () => {},
  getVoiceAssistantNativeStatus: () => mocks.getVoiceAssistantNativeStatus(),
  isAndroidVoiceAssistantRuntime: () => mocks.isAndroidVoiceAssistantRuntime(),
  openAndroidBatteryOptimizationSettings: () =>
    mocks.openAndroidBatteryOptimizationSettings(),
  openAndroidSystemAppSettings: () => mocks.openAndroidSystemAppSettings(),
  requestAndroidMicrophonePermission: () =>
    mocks.requestAndroidMicrophonePermission(),
  requestAndroidNotificationPermission: () =>
    mocks.requestAndroidNotificationPermission(),
  setAndroidBackgroundWakeWordEnabled: (enabled: boolean) =>
    mocks.setAndroidBackgroundWakeWordEnabled(enabled),
  setAndroidVoiceCuesEnabled: (enabled: boolean) =>
    mocks.setAndroidVoiceCuesEnabled(enabled),
  setAndroidWakeWordEnabled: (enabled: boolean) =>
    mocks.setAndroidWakeWordEnabled(enabled),
  stopAndroidVoiceAssistant: () => mocks.stopAndroidVoiceAssistant(),
}))

describe('VoiceAssistantSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.browserOffline = false
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(false)
    mocks.openAndroidBatteryOptimizationSettings.mockResolvedValue(undefined)
    mocks.openAndroidSystemAppSettings.mockResolvedValue(undefined)
    mocks.requestAndroidMicrophonePermission.mockResolvedValue({
      status: 'granted',
    })
    mocks.requestAndroidNotificationPermission.mockResolvedValue({
      status: 'granted',
    })
    mocks.setAndroidBackgroundWakeWordEnabled.mockResolvedValue(undefined)
    mocks.setAndroidVoiceCuesEnabled.mockResolvedValue(undefined)
    mocks.setAndroidWakeWordEnabled.mockResolvedValue(undefined)
    mocks.stopAndroidVoiceAssistant.mockResolvedValue(undefined)
    mocks.readiness = {
      canWriteProtectedData: true,
      reason: 'ready',
    }
    mocks.useUpdateUserPreferences.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(() => Promise.resolve()),
    })
    mocks.useUpdateWorkspaceSettings.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(() => Promise.resolve()),
    })
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(createStatus())
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(['owner', 'test'] satisfies AppRole[])(
    'allows %s to access voice settings',
    async (appRole) => {
      renderSettings({ appRole })

      expect(
        screen.getByRole('switch', {
          name: 'Включить голосовой помощник',
        }),
      ).toBeEnabled()
      expect(await screen.findByText('Голосовой помощник')).toBeVisible()
    },
  )

  it('shows a settings skeleton while the session is loading', () => {
    mocks.usePlannerSession.mockReturnValue({
      data: undefined,
      error: null,
      isPending: true,
      refetch: vi.fn(() => Promise.resolve()),
    })

    render(<VoiceAssistantSettingsPanel />)

    expect(screen.getByTestId('page-state-skeleton')).toBeVisible()
    expect(
      screen.getByText('Загружаем настройки голосового помощника'),
    ).toBeInTheDocument()
    expect(mocks.getVoiceAssistantNativeStatus).not.toHaveBeenCalled()
  })

  it('shows a session error with retry instead of an empty screen', () => {
    const refetch = vi.fn(() => Promise.resolve())
    mocks.usePlannerSession.mockReturnValue({
      data: undefined,
      error: new Error('Session failed'),
      isPending: false,
      refetch,
    })

    render(<VoiceAssistantSettingsPanel />)

    expect(
      screen.getByRole('heading', {
        name: 'Не удалось загрузить настройки',
      }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(mocks.getVoiceAssistantNativeStatus).not.toHaveBeenCalled()
  })

  it.each(['admin', 'user', 'guest'] satisfies AppRole[])(
    'explains controlled access and offers %s one next action',
    (appRole) => {
      renderSettings({ appRole })

      expect(
        screen.getByRole('heading', { name: 'Доступ подключается отдельно' }),
      ).toBeVisible()
      expect(
        screen.getByText(
          'Голосовой помощник подключается к аккаунту отдельно и сейчас проходит ограниченное тестирование. Запросите доступ — команда уточнит возможность подключения для вашего аккаунта.',
        ),
      ).toBeVisible()
      expect(
        screen.queryByText(/владельцам пространства/i),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Запросить доступ' }),
      ).toHaveAttribute(
        'href',
        expect.stringMatching(/^mailto:support@chaotika\.ru\?subject=/),
      )
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(mocks.getVoiceAssistantNativeStatus).not.toHaveBeenCalled()
    },
  )

  it('renders readonly v1 settings and does not expose unsafe toggles', () => {
    renderSettings()

    expect(screen.getByText('Фраза активации')).toBeVisible()
    expect(screen.getByText('Хаотика')).toBeVisible()
    expect(screen.getByText('Режим подтверждений')).toBeVisible()
    expect(screen.getByText('Всегда подтверждать')).toBeVisible()
    expect(
      screen.getByText(/До фразы активации аудио не отправляется на сервер/),
    ).toBeVisible()
    expect(screen.queryByText('Язык')).not.toBeInTheDocument()
    expect(screen.queryByText('Русский')).not.toBeInTheDocument()
    expect(screen.queryByText(/auto-confirm/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/tts/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/выбор.*фраз/i)).not.toBeInTheDocument()
  })

  it('shows a retryable native-status error and recovers the controls', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus
      .mockRejectedValueOnce(new Error('Bridge unavailable'))
      .mockResolvedValueOnce(createStatus())

    renderSettings()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось прочитать статус голосового помощника.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(
        screen.getByRole('switch', { name: 'Wake word "Хаотика"' }),
      ).toBeEnabled()
    })
  })

  it('keeps permission actions disabled while native status is unknown', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus.mockRejectedValue(
      new Error('Bridge unavailable'),
    )

    renderSettings()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось прочитать статус голосового помощника.',
    )
    expect(
      screen.getByRole('button', { name: 'Разрешить микрофон' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Разрешить уведомления' }),
    ).toBeDisabled()
  })

  it('presents granted permissions as completed disabled actions', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)

    renderSettings()

    expect(await screen.findAllByRole('button', { name: 'Разрешено' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ disabled: true }),
        expect.objectContaining({ disabled: true }),
      ]),
    )
  })

  it('keeps account settings read-only offline while native controls remain available', async () => {
    mocks.browserOffline = true
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)

    renderSettings()

    expect(await screen.findByText('Нет подключения')).toBeVisible()
    expect(
      screen.getByText('Время последней синхронизации неизвестно'),
    ).toBeVisible()
    expect(
      screen.getByRole('switch', {
        name: 'Включить голосовой помощник',
      }),
    ).toBeDisabled()
    expect(
      await screen.findByRole('switch', {
        name: 'Показывать окно оценки срабатывания "Хаотика"',
      }),
    ).toBeDisabled()
    expect(
      screen.getByRole('switch', {
        name: 'Проигрывать короткие сигналы',
      }),
    ).toBeEnabled()
  })

  it('shows a preference error and does not stop the native runtime after rejection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mutateAsync = vi.fn(() => Promise.reject(new Error('Save failed')))
    mocks.useUpdateUserPreferences.mockReturnValue({
      isPending: false,
      mutateAsync,
    })

    renderSettings()
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Включить голосовой помощник',
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось сохранить настройку. Повторите попытку.',
    )
    expect(mutateAsync).toHaveBeenCalledWith({ voiceAssistantEnabled: false })
    expect(mocks.stopAndroidVoiceAssistant).not.toHaveBeenCalled()
  })

  it('stops the native runtime only after disabling is saved', async () => {
    let resolvePreference!: () => void
    const mutateAsync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePreference = resolve
        }),
    )
    mocks.useUpdateUserPreferences.mockReturnValue({
      isPending: false,
      mutateAsync,
    })

    renderSettings()
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Включить голосовой помощник',
      }),
    )

    expect(mocks.stopAndroidVoiceAssistant).not.toHaveBeenCalled()
    resolvePreference()

    await waitFor(() => {
      expect(mocks.stopAndroidVoiceAssistant).toHaveBeenCalledTimes(1)
    })
  })

  it('shows a handled error when system settings cannot be opened', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.openAndroidSystemAppSettings.mockRejectedValue(
      new Error('No settings activity'),
    )

    renderSettings()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Открыть настройки' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось открыть системные настройки.',
    )
  })

  it('blocks background wake word when microphone permission is missing', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(
      createStatus({
        backgroundWakeWordEnabled: false,
        microphonePermission: 'denied',
        notificationPermission: 'granted',
        wakeWordEnabled: true,
        wakeWordModelStatus: 'ready',
      }),
    )

    renderSettings()

    const backgroundSwitch = await screen.findByRole('switch', {
      name: 'Слушать "Хаотика" в фоне',
    })

    fireEvent.click(backgroundSwitch)

    expect(
      await screen.findByText('Для фонового режима нужен доступ к микрофону.'),
    ).toBeVisible()
    expect(mocks.setAndroidBackgroundWakeWordEnabled).not.toHaveBeenCalled()
  })

  it('disables wake word when model is missing while keeping push-to-talk noted', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(
      createStatus({
        wakeWordEnabled: false,
        wakeWordModelStatus: 'missing',
      }),
    )

    renderSettings()

    expect(
      await screen.findByText(
        /Wake word недоступен, кнопка микрофона остается доступной/,
      ),
    ).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'Wake word "Хаотика"' }),
    ).toBeDisabled()
  })

  it('persists audio signals through the Android bridge', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(
      createStatus({
        voiceCuesEnabled: true,
      }),
    )

    renderSettings()

    fireEvent.click(
      await screen.findByRole('switch', {
        name: 'Проигрывать короткие сигналы',
      }),
    )

    await waitFor(() => {
      expect(mocks.setAndroidVoiceCuesEnabled).toHaveBeenCalledWith(false)
    })
  })

  it('shows the wake word threshold as read-only on Android', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(
      createStatus({
        wakeWordSensitivity: 0.99,
      }),
    )

    renderSettings()

    expect(
      await screen.findByRole('heading', {
        name: 'Порог модели "Хаотика"',
      }),
    ).toBeVisible()
    expect(screen.getByText('Порог')).toBeVisible()
    expect(screen.getByText('0.99')).toBeVisible()
    expect(
      screen.queryByRole('slider', {
        name: 'Чувствительность "Хаотика"',
      }),
    ).not.toBeInTheDocument()
  })

  it('updates wake word training mode through workspace settings', async () => {
    const mutateAsync = vi.fn(() => Promise.resolve())

    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.useUpdateWorkspaceSettings.mockReturnValue({
      isPending: false,
      mutateAsync,
    })
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(createStatus())

    renderSettings({
      wakeWordTrainingModeEnabled: false,
    })

    fireEvent.click(
      await screen.findByRole('switch', {
        name: 'Показывать окно оценки срабатывания "Хаотика"',
      }),
    )

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        taskCompletionConfettiEnabled: true,
        wakeWordTrainingModeEnabled: true,
      })
    })
  })

  it('keeps wake word training mode owner-controlled for test role', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(createStatus())

    renderSettings({ appRole: 'test' })

    expect(
      await screen.findByRole('switch', {
        name: 'Показывать окно оценки срабатывания "Хаотика"',
      }),
    ).toBeDisabled()
    expect(
      screen.getByText('Режим дообучения может менять только owner.'),
    ).toBeVisible()
  })

  it('keeps Android-only controls out of the web settings view', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(false)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(
      createStatus({ isAndroid: false, platform: 'web' }),
    )

    renderSettings()

    expect(
      await screen.findByText(/В web-версии доступна только кнопка микрофона/),
    ).toBeVisible()
    expect(
      screen.queryByRole('switch', { name: 'Wake word "Хаотика"' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', {
        name: 'Проигрывать короткие сигналы',
      }),
    ).not.toBeInTheDocument()
  })

  it('shows Android runtime diagnostics for owner and test roles', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(
      createStatus({
        batterySample: {
          isCharging: false,
          isPowerSaveMode: true,
          levelPercent: 61,
        },
        cpuSample: {
          processCpuPercent: 2.4,
        },
        memorySample: {
          maxMb: 512,
          usedMb: 84,
        },
        pushToTalkFallbackStatus: 'available',
        runtimeDurationMs: 5_431_000,
        runtimeLastError: 'missing_wake_model',
        runtimeStatus: 'blocked',
      }),
    )

    renderSettings({ appRole: 'test' })

    expect(await screen.findByText('Android voice runtime')).toBeVisible()
    expect(screen.getByText('Status')).toBeVisible()
    expect(screen.getByText('blocked')).toBeVisible()
    expect(screen.getByText('Last error')).toBeVisible()
    expect(screen.getByText('missing_wake_model')).toBeVisible()
    expect(screen.getByText('01:30:31')).toBeVisible()
    expect(screen.getByText('61%, battery saver')).toBeVisible()
    expect(screen.getByText('2.4% process')).toBeVisible()
    expect(screen.getByText('84 / 512 MB')).toBeVisible()
    expect(screen.getByText('Push-to-talk fallback')).toBeVisible()
    expect(screen.getByText('available')).toBeVisible()
  })
})

function renderSettings({
  appRole = 'owner',
  voiceAssistantEnabled = true,
  wakeWordTrainingModeEnabled = false,
}: {
  appRole?: AppRole
  voiceAssistantEnabled?: boolean
  wakeWordTrainingModeEnabled?: boolean
} = {}) {
  mocks.usePlannerSession.mockReturnValue({
    data: {
      appRole,
      userPreferences: {
        calendarViewMode: 'week',
        energyMode: 'normal',
        voiceAssistantEnabled,
      },
      workspaceSettings: {
        taskCompletionConfettiEnabled: true,
        wakeWordTrainingModeEnabled,
      },
    },
    error: null,
    isPending: false,
    refetch: vi.fn(() => Promise.resolve()),
  })

  return render(<VoiceAssistantSettingsPanel />)
}

function createStatus(
  overrides: Partial<VoiceAssistantNativeStatus> = {},
): VoiceAssistantNativeStatus {
  return {
    ...getBaseStatus(),
    ...overrides,
  }
}

function getBaseStatus(): VoiceAssistantNativeStatus {
  return {
    backgroundWakeWordEnabled: false,
    confirmationMode: 'confirmation_first',
    foregroundServiceStatus: 'stopped',
    isAndroid: true,
    microphonePermission: 'granted',
    notificationPermission: 'granted',
    platform: 'android',
    pushToTalkFallbackStatus: 'available',
    recognitionLanguage: 'ru-RU',
    runtimeDurationMs: 0,
    runtimeLastError: null,
    runtimeMetrics: {},
    runtimeStatus: 'stopped',
    voiceCuesEnabled: true,
    wakePhrase: 'Хаотика',
    wakeWordEnabled: true,
    wakeWordModelVersion: 'haotika-livekit-test',
    wakeWordModelStatus: 'ready',
    wakeWordProvider: 'custom_onnx',
    wakeWordSensitivity: 0.99,
  }
}
