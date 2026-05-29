import { z } from 'zod'

import { plannerIntentSchema } from './planner-intent.js'

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
  bitsPerSample: z.literal(16),
  byteOrder: z.literal('little_endian'),
  channelCount: z.literal(1),
  encoding: z.literal('pcm_s16le'),
  sampleRateHertz: z.literal(16_000),
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
