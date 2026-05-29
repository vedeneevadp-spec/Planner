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
  data: {
    appRole: AppRole
    userPreferences: {
      calendarViewMode: 'week'
      energyMode: 'normal'
      voiceAssistantEnabled: boolean
    }
  }
}

interface UpdateUserPreferencesHookResult {
  isPending: boolean
  mutate: (input: { voiceAssistantEnabled: boolean }) => void
}

const mocks = vi.hoisted(() => ({
  getVoiceAssistantNativeStatus:
    vi.fn<() => Promise<VoiceAssistantNativeStatus>>(),
  isAndroidVoiceAssistantRuntime: vi.fn(() => false),
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
  setAndroidWakeWordReviewModeEnabled: vi.fn<
    (enabled: boolean) => Promise<void>
  >(() => Promise.resolve()),
  setAndroidWakeWordSensitivity: vi.fn<(sensitivity: number) => Promise<void>>(
    () => Promise.resolve(),
  ),
  stopAndroidVoiceAssistant: vi.fn(() => Promise.resolve()),
  usePlannerSession: vi.fn<() => PlannerSessionHookResult>(),
  useUpdateUserPreferences: vi.fn<() => UpdateUserPreferencesHookResult>(),
}))

vi.mock('@/features/session', () => ({
  usePlannerSession: () => mocks.usePlannerSession(),
  useUpdateUserPreferences: () => mocks.useUpdateUserPreferences(),
}))

vi.mock('../lib/native-voice-assistant', () => ({
  addVoiceAssistantSettingsChangedListener: () => () => {},
  getVoiceAssistantNativeStatus: () => mocks.getVoiceAssistantNativeStatus(),
  isAndroidVoiceAssistantRuntime: () => mocks.isAndroidVoiceAssistantRuntime(),
  openAndroidBatteryOptimizationSettings: vi.fn(() => Promise.resolve()),
  openAndroidSystemAppSettings: vi.fn(() => Promise.resolve()),
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
  setAndroidWakeWordReviewModeEnabled: (enabled: boolean) =>
    mocks.setAndroidWakeWordReviewModeEnabled(enabled),
  setAndroidWakeWordSensitivity: (sensitivity: number) =>
    mocks.setAndroidWakeWordSensitivity(sensitivity),
  stopAndroidVoiceAssistant: () => mocks.stopAndroidVoiceAssistant(),
}))

describe('VoiceAssistantSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useUpdateUserPreferences.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    })
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(createStatus())
  })

  afterEach(() => {
    cleanup()
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

  it.each(['admin', 'user', 'guest'] satisfies AppRole[])(
    'blocks %s without active toggles',
    (appRole) => {
      renderSettings({ appRole })

      expect(
        screen.getByText('Голосовой помощник пока недоступен для вашей роли.'),
      ).toBeVisible()
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    },
  )

  it('renders readonly v1 settings and does not expose unsafe toggles', () => {
    renderSettings()

    expect(screen.getByText('Фраза активации')).toBeVisible()
    expect(screen.getByText('Хаотика')).toBeVisible()
    expect(screen.getByText('Язык')).toBeVisible()
    expect(screen.getByText('Русский')).toBeVisible()
    expect(screen.getByText('Режим подтверждений')).toBeVisible()
    expect(screen.getByText('Всегда подтверждать')).toBeVisible()
    expect(screen.queryByText(/auto-confirm/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/tts/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/выбор.*фраз/i)).not.toBeInTheDocument()
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

  it('persists voice cues through the Android bridge', async () => {
    mocks.isAndroidVoiceAssistantRuntime.mockReturnValue(true)
    mocks.getVoiceAssistantNativeStatus.mockResolvedValue(
      createStatus({
        voiceCuesEnabled: true,
      }),
    )

    renderSettings()

    fireEvent.click(
      await screen.findByRole('switch', {
        name: 'Проигрывать "Слушаю" и "Готово"',
      }),
    )

    await waitFor(() => {
      expect(mocks.setAndroidVoiceCuesEnabled).toHaveBeenCalledWith(false)
    })
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
        name: 'Проигрывать "Слушаю" и "Готово"',
      }),
    ).not.toBeInTheDocument()
  })
})

function renderSettings({
  appRole = 'owner',
  voiceAssistantEnabled = true,
}: {
  appRole?: AppRole
  voiceAssistantEnabled?: boolean
} = {}) {
  mocks.usePlannerSession.mockReturnValue({
    data: {
      appRole,
      userPreferences: {
        calendarViewMode: 'week',
        energyMode: 'normal',
        voiceAssistantEnabled,
      },
    },
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
    recognitionLanguage: 'ru-RU',
    voiceCuesEnabled: true,
    wakePhrase: 'Хаотика',
    wakeWordEnabled: true,
    wakeWordModelStatus: 'ready',
    wakeWordReviewModeEnabled: false,
    wakeWordSensitivity: 0.99,
  }
}
