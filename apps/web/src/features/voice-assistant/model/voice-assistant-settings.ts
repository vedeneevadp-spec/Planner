export const VOICE_ASSISTANT_WAKE_PHRASE = 'Хаотика' as const
export const VOICE_ASSISTANT_RECOGNITION_LANGUAGE = 'ru-RU' as const
export const VOICE_ASSISTANT_CONFIRMATION_MODE = 'confirmation_first' as const

export type VoiceAssistantPermissionStatus = 'denied' | 'granted' | 'unknown'
export type VoiceAssistantForegroundServiceStatus =
  | 'blocked'
  | 'missing_permission'
  | 'running'
  | 'stopped'
export type VoiceAssistantWakeWordModelStatus =
  | 'error'
  | 'loading'
  | 'missing'
  | 'ready'

export interface VoiceAssistantDeviceSettings {
  androidWakeWordEnabled: boolean
  backgroundWakeWordEnabled: boolean
  voiceCuesEnabled: boolean
  wakeWordSensitivity: number
}

export const MIN_WAKE_WORD_SENSITIVITY = 0.3
export const MAX_WAKE_WORD_SENSITIVITY = 0.99
export const WAKE_WORD_SENSITIVITY_STEP = 0.05
export const DEFAULT_WAKE_WORD_SENSITIVITY = 0.99

export const DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS: VoiceAssistantDeviceSettings =
  {
    androidWakeWordEnabled: false,
    backgroundWakeWordEnabled: false,
    voiceCuesEnabled: true,
    wakeWordSensitivity: DEFAULT_WAKE_WORD_SENSITIVITY,
  }

const VOICE_ASSISTANT_DEVICE_SETTINGS_STORAGE_KEY =
  'planner.voiceAssistant.deviceSettings.v1'

export function readVoiceAssistantDeviceSettings(): VoiceAssistantDeviceSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS
  }

  const rawValue = window.localStorage.getItem(
    VOICE_ASSISTANT_DEVICE_SETTINGS_STORAGE_KEY,
  )

  if (!rawValue) {
    return DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS
  }

  try {
    const value = JSON.parse(rawValue) as Partial<VoiceAssistantDeviceSettings>

    return normalizeVoiceAssistantDeviceSettings(value)
  } catch {
    return DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS
  }
}

export function writeVoiceAssistantDeviceSettings(
  settings: VoiceAssistantDeviceSettings,
): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    VOICE_ASSISTANT_DEVICE_SETTINGS_STORAGE_KEY,
    JSON.stringify(normalizeVoiceAssistantDeviceSettings(settings)),
  )
}

export function updateVoiceAssistantDeviceSettings(
  patch: Partial<VoiceAssistantDeviceSettings>,
): VoiceAssistantDeviceSettings {
  const nextSettings = normalizeVoiceAssistantDeviceSettings({
    ...readVoiceAssistantDeviceSettings(),
    ...patch,
  })

  writeVoiceAssistantDeviceSettings(nextSettings)

  return nextSettings
}

export function clampWakeWordSensitivity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_WAKE_WORD_SENSITIVITY
  }

  return Math.min(
    MAX_WAKE_WORD_SENSITIVITY,
    Math.max(MIN_WAKE_WORD_SENSITIVITY, value),
  )
}

function normalizeVoiceAssistantDeviceSettings(
  value: Partial<VoiceAssistantDeviceSettings>,
): VoiceAssistantDeviceSettings {
  return {
    androidWakeWordEnabled:
      value.androidWakeWordEnabled ??
      DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS.androidWakeWordEnabled,
    backgroundWakeWordEnabled:
      value.backgroundWakeWordEnabled ??
      DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS.backgroundWakeWordEnabled,
    voiceCuesEnabled:
      value.voiceCuesEnabled ??
      DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS.voiceCuesEnabled,
    wakeWordSensitivity: clampWakeWordSensitivity(
      value.wakeWordSensitivity ??
        DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS.wakeWordSensitivity,
    ),
  }
}
