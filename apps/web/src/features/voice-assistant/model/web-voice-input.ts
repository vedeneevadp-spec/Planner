import { type VoicePrivacyBlockReason } from './voice-audio-upload-guard'
import {
  decideVoiceAudioUpload,
  VOICE_AUDIO_UPLOAD_MAX_DURATION_MS,
  VOICE_AUDIO_UPLOAD_MIN_DURATION_MS,
} from './voice-audio-upload-guard'

export type WebVoiceInputState =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'validating_audio'
  | 'uploading'
  | 'recognizing'
  | 'parsing'
  | 'ready_for_confirmation'
  | 'needs_repeat'
  | 'permission_denied'
  | 'unsupported'
  | 'error'

export type WebVoiceUnsupportedReason =
  | 'audio_context_unavailable'
  | 'get_user_media_unavailable'
  | 'insecure_context'
  | 'media_devices_unavailable'
  | 'media_recorder_unavailable'

export interface WebVoiceSupportResult {
  message?: string | undefined
  reason?: WebVoiceUnsupportedReason | undefined
  supported: boolean
}

export interface WebVoicePermissionError {
  message: string
  name: string
  state: Extract<
    WebVoiceInputState,
    'error' | 'permission_denied' | 'unsupported'
  >
}

export interface WebVoiceAudioAnalysis {
  hasVoiceActivity: boolean
  isSilent: boolean
  isTooQuiet: boolean
  peak: number
  rms: number
  voicedRatio: number
}

export interface WebVoiceRecording {
  analysis: WebVoiceAudioAnalysis
  audio: ArrayBuffer
  byteLength: number
  durationMs: number
  mediaRecorderMimeType?: string | undefined
}

export type WebVoiceValidationFailureReason =
  | VoicePrivacyBlockReason
  | 'empty_audio'

export type WebVoiceValidationResult =
  | { ok: true }
  | {
      message: string
      ok: false
      reason: WebVoiceValidationFailureReason
    }

const SILENCE_ABSOLUTE_PEAK = 12
const QUIET_ABSOLUTE_PEAK = 420
const VOICE_ABSOLUTE_PEAK = 700
const QUIET_RMS = 0.0035
const VOICE_RMS = 0.006
const VOICED_SAMPLE_RATIO = 0.006

export const WEB_VOICE_SAMPLE_RATE_HERTZ = 16_000
export const WEB_VOICE_BACKEND_TIMEOUT_MS = 12_000
export const WEB_VOICE_SOURCE = 'web_push_to_talk' as const
const WEB_VOICE_UNSUPPORTED_MESSAGE =
  'Голосовой ввод недоступен в этом браузере. Можно ввести задачу вручную.'

type AudioContextWindow = Window & {
  AudioContext?: typeof AudioContext | undefined
  webkitAudioContext?: typeof AudioContext | undefined
}

export function getWebVoiceInputLabel(state: WebVoiceInputState): string {
  switch (state) {
    case 'idle':
      return 'Нажми микрофон'
    case 'requesting_permission':
      return 'Запрашиваю доступ к микрофону'
    case 'listening':
      return 'Слушаю'
    case 'validating_audio':
      return 'Проверяю запись'
    case 'uploading':
    case 'recognizing':
    case 'parsing':
      return 'Распознаю'
    case 'ready_for_confirmation':
      return 'Проверка'
    case 'needs_repeat':
      return 'Нужно повторить'
    case 'permission_denied':
      return 'Нет доступа к микрофону'
    case 'unsupported':
      return 'Голосовой ввод недоступен в этом браузере'
    case 'error':
      return 'Не удалось распознать'
  }
}

export function getWebVoiceSupport(): WebVoiceSupportResult {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      message: WEB_VOICE_UNSUPPORTED_MESSAGE,
      reason: 'media_devices_unavailable',
      supported: false,
    }
  }

  if (!window.isSecureContext) {
    return {
      message: 'Открой приложение через HTTPS или localhost.',
      reason: 'insecure_context',
      supported: false,
    }
  }

  if (!navigator.mediaDevices) {
    return {
      message: WEB_VOICE_UNSUPPORTED_MESSAGE,
      reason: 'media_devices_unavailable',
      supported: false,
    }
  }

  if (typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return {
      message: WEB_VOICE_UNSUPPORTED_MESSAGE,
      reason: 'get_user_media_unavailable',
      supported: false,
    }
  }

  if (typeof MediaRecorder === 'undefined') {
    return {
      message: WEB_VOICE_UNSUPPORTED_MESSAGE,
      reason: 'media_recorder_unavailable',
      supported: false,
    }
  }

  if (!getAudioContextConstructor()) {
    return {
      message: WEB_VOICE_UNSUPPORTED_MESSAGE,
      reason: 'audio_context_unavailable',
      supported: false,
    }
  }

  return { supported: true }
}

export function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const audioWindow = window as AudioContextWindow

  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext
}

export function normalizeWebVoicePermissionError(
  error: unknown,
): WebVoicePermissionError {
  const name = getErrorName(error)

  switch (name) {
    case 'NotAllowedError':
      return {
        message: 'Нет доступа к микрофону.',
        name,
        state: 'permission_denied',
      }
    case 'NotFoundError':
      return {
        message: 'Микрофон не найден.',
        name,
        state: 'error',
      }
    case 'NotReadableError':
      return {
        message: 'Микрофон занят другим приложением.',
        name,
        state: 'error',
      }
    case 'SecurityError':
      return {
        message: 'Открой приложение через HTTPS.',
        name,
        state: 'unsupported',
      }
    case 'AbortError':
      return {
        message: 'Запись прервана.',
        name,
        state: 'error',
      }
    default:
      return {
        message:
          error instanceof Error
            ? error.message
            : 'Не удалось включить микрофон.',
        name,
        state: 'error',
      }
  }
}

export function validateWebVoiceRecording(
  recording: WebVoiceRecording,
  options: { explicitUserAction: boolean },
): WebVoiceValidationResult {
  if (recording.byteLength === 0 || recording.audio.byteLength === 0) {
    return {
      message: 'Нужно повторить.',
      ok: false,
      reason: 'empty_audio',
    }
  }

  const decision = decideVoiceAudioUpload({
    durationMs: recording.durationMs,
    explicitUserAction: options.explicitUserAction,
    hasVoiceActivity: recording.analysis.hasVoiceActivity,
    isSilent: recording.analysis.isSilent,
    isTooQuiet: recording.analysis.isTooQuiet,
    localValidationPassed: true,
    source: WEB_VOICE_SOURCE,
  })

  if (!decision.allowed) {
    return {
      message: getWebVoiceValidationMessage(decision.reason),
      ok: false,
      reason: decision.reason,
    }
  }

  return { ok: true }
}

export function analyzePcm16Audio(audio: ArrayBuffer): WebVoiceAudioAnalysis {
  if (audio.byteLength < 2) {
    return {
      hasVoiceActivity: false,
      isSilent: true,
      isTooQuiet: true,
      peak: 0,
      rms: 0,
      voicedRatio: 0,
    }
  }

  const view = new DataView(audio)
  const sampleCount = Math.floor(audio.byteLength / 2)
  let peak = 0
  let sumSquares = 0
  let voicedSamples = 0

  for (let offset = 0; offset + 1 < audio.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true)
    const absolute = Math.abs(sample)

    peak = Math.max(peak, absolute)
    sumSquares += sample * sample

    if (absolute >= VOICE_ABSOLUTE_PEAK) {
      voicedSamples += 1
    }
  }

  const rms = Math.sqrt(sumSquares / sampleCount) / 32768
  const voicedRatio = voicedSamples / sampleCount
  const isSilent = peak <= SILENCE_ABSOLUTE_PEAK || voicedRatio === 0
  const isTooQuiet = peak < QUIET_ABSOLUTE_PEAK || rms < QUIET_RMS
  const hasVoiceActivity =
    peak >= VOICE_ABSOLUTE_PEAK &&
    rms >= VOICE_RMS &&
    voicedRatio >= VOICED_SAMPLE_RATIO

  return {
    hasVoiceActivity,
    isSilent,
    isTooQuiet,
    peak,
    rms,
    voicedRatio,
  }
}

function getWebVoiceValidationMessage(reason: VoicePrivacyBlockReason): string {
  switch (reason) {
    case 'explicit_user_action_required':
      return 'Нажми микрофон, чтобы начать голосовой ввод.'
    case 'too_long':
      return `Запись длиннее ${VOICE_AUDIO_UPLOAD_MAX_DURATION_MS / 1000} секунд. Нужно повторить.`
    case 'too_short':
      return `Запись короче ${VOICE_AUDIO_UPLOAD_MIN_DURATION_MS / 1000} секунды. Нужно повторить.`
    case 'no_voice_activity':
    case 'silent_audio':
      return 'Речь не распознана. Нужно повторить.'
    case 'too_quiet':
      return 'Запись слишком тихая. Нужно повторить.'
    case 'local_validation_failed':
      return 'Нужно повторить.'
    case 'wake_word_required':
      return 'Нужно повторить.'
  }
}

function getErrorName(error: unknown): string {
  if (error instanceof DOMException) {
    return error.name
  }

  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    typeof error.name === 'string'
  ) {
    return error.name
  }

  return 'Error'
}
