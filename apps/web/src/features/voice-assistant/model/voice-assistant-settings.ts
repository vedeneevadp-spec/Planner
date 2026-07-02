export const VOICE_ASSISTANT_WAKE_PHRASE = 'Хаотика' as const
export const VOICE_ASSISTANT_RECOGNITION_LANGUAGE = 'ru-RU' as const
export const VOICE_ASSISTANT_CONFIRMATION_MODE = 'confirmation_first' as const

export type VoiceAssistantPermissionStatus = 'denied' | 'granted' | 'unknown'
export type VoiceAssistantForegroundServiceStatus =
  'blocked' | 'missing_permission' | 'running' | 'stopped'
export type VoiceAssistantWakeWordModelStatus =
  'error' | 'loading' | 'missing' | 'ready'
export type AndroidVoiceRuntimeStatus =
  | 'disabled'
  | 'starting'
  | 'running_foreground'
  | 'listening_wake_word'
  | 'paused_for_command'
  | 'playing_start_signal'
  | 'recording_command'
  | 'stopping'
  | 'stopped'
  | 'blocked'
export type AndroidVoiceRuntimeError =
  | 'missing_microphone_permission'
  | 'missing_notification_permission'
  | 'missing_wake_model'
  | 'unsupported_wake_model_input'
  | 'foreground_service_not_allowed'
  | 'battery_restricted'
  | 'security_exception'
  | 'wake_engine_error'
  | 'audio_signal_error'
  | 'recorder_error'
export type AndroidVoiceRuntimeMetric =
  | 'wake_service_started'
  | 'wake_service_stopped'
  | 'wake_service_start_failed'
  | 'wake_service_runtime_minutes'
  | 'wake_engine_started'
  | 'wake_engine_stopped'
  | 'wake_engine_error'
  | 'wake_detection_latency_ms'
  | 'wake_detected_to_recorder_start_ms'
  | 'wake_to_start_cue_ms'
  | 'wake_to_recording_started_ms'
  | 'command_recorder_start_latency_ms'
  | 'recording_duration_ms'
  | 'prebuffer_ms'
  | 'start_signal_duration_ms'
  | 'audio_signal_to_recorder_delay_ms'
  | 'audio_signal_start_played'
  | 'audio_signal_success_played'
  | 'audio_signal_suppressed'
  | 'audio_signal_error'
  | 'append_used'
  | 'append_count'
  | 'stt_first_partial_ms'
  | 'voice_session_result'
  | 'battery_sample'
  | 'cpu_sample'
  | 'memory_sample'
  | 'service_killed_or_restarted'
  | 'graceful_degradation_used'
export type AndroidVoicePushToTalkFallbackStatus =
  'available' | 'blocked_missing_microphone_permission'

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
