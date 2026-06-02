import { z } from 'zod'

import { plannerIntentSchema } from './planner-intent.js'

export const VOICE_COMMAND_AUDIO_BITS_PER_SAMPLE = 16
export const VOICE_COMMAND_AUDIO_BYTE_ORDER = 'little_endian' as const
export const VOICE_COMMAND_AUDIO_CHANNEL_COUNT = 1
export const VOICE_COMMAND_AUDIO_ENCODING = 'pcm_s16le' as const
export const VOICE_COMMAND_AUDIO_SAMPLE_RATE_HERTZ = 16_000
export const VOICE_COMMAND_AUDIO_BYTES_PER_SECOND =
  VOICE_COMMAND_AUDIO_SAMPLE_RATE_HERTZ *
  VOICE_COMMAND_AUDIO_CHANNEL_COUNT *
  (VOICE_COMMAND_AUDIO_BITS_PER_SAMPLE / 8)
export const VOICE_COMMAND_AUDIO_MIN_DURATION_MS = 500
export const VOICE_COMMAND_AUDIO_MAX_DURATION_MS = 15_000
export const VOICE_COMMAND_AUDIO_ROUTE_HARD_LIMIT_BYTES = 512 * 1024
export const VOICE_COMMAND_STT_TIMEOUT_MS = 25_000

export const sttProviderSchema = z.enum([
  'backend_yandex_speechkit',
  'local_stub',
  'stub',
])

export const sttSourceSchema = z.enum([
  'android_push_to_talk',
  'android_short_clip',
  'local_fallback',
  'test_stub',
  'web_push_to_talk',
])

export const sttErrorSchema = z.enum([
  'NO_SPEECH',
  'TOO_SHORT',
  'TOO_LONG',
  'TOO_QUIET',
  'NETWORK_ERROR',
  'SERVER_STT_UNAVAILABLE',
  'LOCAL_STT_UNAVAILABLE',
  'PERMISSION_DENIED',
  'UNSUPPORTED_AUDIO_FORMAT',
  'LOW_CONFIDENCE',
  'RATE_LIMITED',
  'INVALID_SOURCE',
  'PRIVACY_BLOCKED',
  'REPLAY_REJECTED',
])

export const commandAudioFormatSchema = z.object({
  bitsPerSample: z.literal(VOICE_COMMAND_AUDIO_BITS_PER_SAMPLE),
  byteOrder: z.literal(VOICE_COMMAND_AUDIO_BYTE_ORDER),
  channelCount: z.literal(VOICE_COMMAND_AUDIO_CHANNEL_COUNT),
  encoding: z.literal(VOICE_COMMAND_AUDIO_ENCODING),
  sampleRateHertz: z.literal(VOICE_COMMAND_AUDIO_SAMPLE_RATE_HERTZ),
})

export const commandAudioSchema = z.object({
  byteLength: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  format: commandAudioFormatSchema,
  hasVoiceActivity: z.boolean(),
  isTooQuiet: z.boolean(),
})

export const sttRequestSchema = z.object({
  audio: commandAudioSchema,
  source: sttSourceSchema,
})

export const sttResultSchema = z.object({
  billableSecondsEstimated: z.number().int().positive(),
  confidence: z.number().min(0).max(1).nullable(),
  durationMs: z.number().int().nonnegative(),
  provider: sttProviderSchema,
  source: sttSourceSchema,
  transcript: z.string().trim().min(1),
})

export const voiceCommandResponseSchema = z.object({
  intent: plannerIntentSchema,
  stt: sttResultSchema,
  transcript: z.string().trim().min(1),
})

export type SttProvider = z.infer<typeof sttProviderSchema>
export type SttSource = z.infer<typeof sttSourceSchema>
export type SttError = z.infer<typeof sttErrorSchema>
export type CommandAudioFormat = z.infer<typeof commandAudioFormatSchema>
export type CommandAudio = z.infer<typeof commandAudioSchema>
export type SttRequest = z.infer<typeof sttRequestSchema>
export type SttResult = z.infer<typeof sttResultSchema>
export type VoiceCommandResponse = z.infer<typeof voiceCommandResponseSchema>
