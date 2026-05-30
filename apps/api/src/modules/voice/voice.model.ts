import type {
  AppRole,
  CommandAudio,
  CommandAudioFormat,
  SttError,
  SttProvider,
  SttSource,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'

export const COMMAND_AUDIO_FORMAT: CommandAudioFormat = {
  bitsPerSample: 16,
  byteOrder: 'little_endian',
  channelCount: 1,
  encoding: 'pcm_s16le',
  sampleRateHertz: 16_000,
}

export const COMMAND_AUDIO_BYTES_PER_SECOND =
  COMMAND_AUDIO_FORMAT.sampleRateHertz *
  COMMAND_AUDIO_FORMAT.channelCount *
  (COMMAND_AUDIO_FORMAT.bitsPerSample / 8)

export const COMMAND_AUDIO_MIN_DURATION_MS = 500
export const COMMAND_AUDIO_MAX_DURATION_MS = 8_000
export const COMMAND_AUDIO_MAX_BYTES = Math.ceil(
  (COMMAND_AUDIO_BYTES_PER_SECOND * COMMAND_AUDIO_MAX_DURATION_MS) / 1000,
)
export const COMMAND_AUDIO_HARD_LIMIT_BYTES = 400 * 1024

export interface VoiceCommandRouteContext {
  actorUserId: string | undefined
  appRole?: AppRole | undefined
  clientNow?: string | undefined
  deviceId?: string | undefined
  ipAddress?: string | undefined
  isDeviceLocked?: boolean | undefined
  timezone?: string | undefined
  workspaceId: string
}

export interface VoiceRequestSecurity {
  issuedAt: string
  requestId: string
  sessionId: string
}

export interface VoiceCommandAudioFormatMetadata {
  bitsPerSample: number
  byteOrder: string
  channelCount: number
  encoding: string
  sampleRateHertz: number
}

export interface VoiceCommandAudioMetadata {
  durationMs?: number
  format: VoiceCommandAudioFormatMetadata
}

export interface CommandAudioClip extends CommandAudio {
  data: Buffer
}

export interface BackendSttProviderInput {
  audio: CommandAudioClip
}

export interface BackendSttProviderResult {
  confidence: number | null
  provider: SttProvider
  transcript: string
}

export interface BackendSttProvider {
  isAvailable(): boolean
  transcribe(input: BackendSttProviderInput): Promise<BackendSttProviderResult>
}

export class VoiceCommandError extends HttpError {
  constructor(
    statusCode: number,
    public readonly sttError: SttError,
    message: string,
    details?: unknown,
  ) {
    super(statusCode, sttError.toLowerCase(), message, details)
  }
}

export function createVoiceCommandError(
  sttError: SttError,
  details?: unknown,
): VoiceCommandError {
  switch (sttError) {
    case 'NO_SPEECH':
      return new VoiceCommandError(
        422,
        sttError,
        'No speech was detected in the audio clip.',
        details,
      )
    case 'TOO_SHORT':
      return new VoiceCommandError(
        400,
        sttError,
        'Audio clip is too short for STT.',
        details,
      )
    case 'TOO_LONG':
      return new VoiceCommandError(
        413,
        sttError,
        'Audio clip exceeds the maximum duration.',
        details,
      )
    case 'TOO_QUIET':
      return new VoiceCommandError(
        422,
        sttError,
        'Audio clip is too quiet for reliable STT.',
        details,
      )
    case 'UNSUPPORTED_AUDIO_FORMAT':
      return new VoiceCommandError(
        415,
        sttError,
        'Audio clip must be PCM 16 kHz mono 16-bit little-endian.',
        details,
      )
    case 'RATE_LIMITED':
      return new VoiceCommandError(
        429,
        sttError,
        'Voice command rate limit exceeded.',
        details,
      )
    case 'INVALID_SOURCE':
      return new VoiceCommandError(
        400,
        sttError,
        'Voice command source is missing or unsupported.',
        details,
      )
    case 'PRIVACY_BLOCKED':
      return new VoiceCommandError(
        400,
        sttError,
        'Voice command upload was blocked by privacy policy.',
        details,
      )
    case 'REPLAY_REJECTED':
      return new VoiceCommandError(
        409,
        sttError,
        'Voice command request was rejected as a replay.',
        details,
      )
    case 'NETWORK_ERROR':
      return new VoiceCommandError(
        503,
        sttError,
        'Speech-to-text provider network request failed.',
        details,
      )
    case 'SERVER_STT_UNAVAILABLE':
      return new VoiceCommandError(
        503,
        sttError,
        'Server-side speech-to-text provider is unavailable.',
        details,
      )
    case 'LOCAL_STT_UNAVAILABLE':
    case 'PERMISSION_DENIED':
    case 'LOW_CONFIDENCE':
      return new VoiceCommandError(
        400,
        sttError,
        'Speech-to-text request failed.',
        details,
      )
  }
}

export function createUnavailableBackendSttProvider(): BackendSttProvider {
  return {
    isAvailable: () => false,
    transcribe() {
      return Promise.reject(createVoiceCommandError('SERVER_STT_UNAVAILABLE'))
    },
  }
}

export function parseVoiceCommandSource(value: unknown): SttSource {
  if (value === 'android_push_to_talk') {
    return 'android_push_to_talk'
  }

  if (value === 'android_short_clip') {
    return 'android_short_clip'
  }

  if (value === 'local_fallback') {
    return 'local_fallback'
  }

  if (value === 'test_stub') {
    return 'test_stub'
  }

  if (value === 'web_push_to_talk') {
    return 'web_push_to_talk'
  }

  throw createVoiceCommandError('INVALID_SOURCE', {
    source: typeof value === 'string' ? value : null,
  })
}
