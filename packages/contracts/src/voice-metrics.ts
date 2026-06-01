import { z } from 'zod'

import { plannerIntentNameSchema } from './planner-intent.js'
import { voiceActionSourceSchema } from './voice-action.js'

export const voiceMetricEventNameSchema = z.enum([
  'voice_started',
  'wake_detected',
  'push_to_talk_started',
  'command_recording_started',
  'command_recording_cancelled',
  'local_validation_failed',
  'stt_upload_started',
  'stt_upload_completed',
  'stt_error',
  'transcript_received',
  'intent_parsed',
  'action_preview_created',
  'confirmation_shown',
  'confirmation_accepted',
  'confirmation_cancelled',
  'confirmation_edited',
  'clarification_requested',
  'action_executed',
  'action_failed',
  'undo_requested',
  'undo_success',
  'undo_failed',
  'audio_signal_start_played',
  'audio_signal_success_played',
  'audio_signal_suppressed',
  'audio_signal_error',
  'voice_cue_listening_played',
  'voice_cue_done_played',
  'voice_cue_suppressed',
  'web_voice_unsupported',
  'web_voice_permission_denied',
  'web_voice_timeout',
  'llm_fallback_requested',
  'llm_fallback_used',
  'llm_fallback_rejected_schema',
  'llm_fallback_rejected_safety',
  'llm_fallback_latency_ms',
  'llm_fallback_provider_error',
  'llm_fallback_cost_estimated',
])

export const voiceMetricPlatformSchema = z.enum(['android', 'web', 'backend'])
export const voiceMetricAppRoleSchema = z.enum(['owner', 'test'])
export const voiceMetricConfidenceBucketSchema = z.enum([
  'low',
  'medium',
  'high',
])
export const voiceMetricDurationBucketSchema = z.enum([
  'short',
  'normal',
  'long',
])
export const voiceMetricWakeWordProviderSchema = z.enum([
  'custom_onnx',
  'custom_tflite',
  'mock',
])
export const voiceMetricSttProviderSchema = z.enum([
  'yandex_speechkit',
  'stub',
  'local_stub',
])

const safeMetricStringSchema = z.string().trim().min(1).max(160)
const safeMetricNumberSchema = z.number().finite().nonnegative()
const safeMetricIntegerSchema = z.number().int().nonnegative()

export const safeVoiceMetricEventSchema = z
  .object({
    appRole: voiceMetricAppRoleSchema,
    audioBytes: safeMetricIntegerSchema.optional(),
    audioDurationMs: safeMetricIntegerSchema.optional(),
    audio_signal_to_recorder_delay_ms: safeMetricNumberSchema.optional(),
    confidenceBucket: voiceMetricConfidenceBucketSchema.optional(),
    createdAt: z.string().trim().min(1),
    durationBucket: voiceMetricDurationBucketSchema.optional(),
    errorCode: safeMetricStringSchema.optional(),
    eventName: voiceMetricEventNameSchema,
    intentType: plannerIntentNameSchema.optional(),
    llm_fallback_cost_estimated: safeMetricNumberSchema.optional(),
    llm_fallback_latency_ms: safeMetricNumberSchema.optional(),
    mic_click_to_confirmation_card_ms: safeMetricNumberSchema.optional(),
    modelVersion: safeMetricStringSchema.optional(),
    parser_duration_ms: safeMetricNumberSchema.optional(),
    platform: voiceMetricPlatformSchema,
    previewStatus: safeMetricStringSchema.optional(),
    resultStatus: safeMetricStringSchema.optional(),
    source: voiceActionSourceSchema,
    sttProvider: voiceMetricSttProviderSchema.optional(),
    stt_upload_duration_ms: safeMetricNumberSchema.optional(),
    start_signal_duration_ms: safeMetricNumberSchema.optional(),
    time_to_confirmation_card_ms: safeMetricNumberSchema.optional(),
    wake_detected_to_confirmation_card_ms: safeMetricNumberSchema.optional(),
    wake_detected_to_recorder_start_ms: safeMetricNumberSchema.optional(),
    wakeWordProvider: voiceMetricWakeWordProviderSchema.optional(),
    action_preview_duration_ms: safeMetricNumberSchema.optional(),
  })
  .strict()

export type VoiceMetricEventName = z.infer<typeof voiceMetricEventNameSchema>
export type VoiceMetricPlatform = z.infer<typeof voiceMetricPlatformSchema>
export type VoiceMetricAppRole = z.infer<typeof voiceMetricAppRoleSchema>
export type VoiceMetricConfidenceBucket = z.infer<
  typeof voiceMetricConfidenceBucketSchema
>
export type VoiceMetricDurationBucket = z.infer<
  typeof voiceMetricDurationBucketSchema
>
export type VoiceMetricWakeWordProvider = z.infer<
  typeof voiceMetricWakeWordProviderSchema
>
export type VoiceMetricSttProvider = z.infer<
  typeof voiceMetricSttProviderSchema
>
export type SafeVoiceMetricEvent = z.infer<typeof safeVoiceMetricEventSchema>

export interface VoiceMetricsSink {
  track(event: SafeVoiceMetricEvent): Promise<void> | void
}

export class NoopVoiceMetricsSink implements VoiceMetricsSink {
  track(_event: SafeVoiceMetricEvent): void {}
}

export class TestVoiceMetricsSink implements VoiceMetricsSink {
  readonly events: SafeVoiceMetricEvent[] = []

  track(event: SafeVoiceMetricEvent): void {
    this.events.push(parseSafeVoiceMetricEvent(event))
  }

  clear(): void {
    this.events.splice(0, this.events.length)
  }
}

export class ConsoleVoiceMetricsSink implements VoiceMetricsSink {
  track(event: SafeVoiceMetricEvent): void {
    const safeEvent = parseSafeVoiceMetricEvent(event)

    ;(
      globalThis as {
        console?: { info: (...args: unknown[]) => void } | undefined
      }
    ).console?.info('[voice:metric]', safeEvent)
  }
}

export class VoiceMetricPayloadError extends Error {
  constructor(
    public readonly code:
      | 'invalid_voice_metric_payload'
      | 'private_voice_metric_payload',
    message: string,
    public readonly details: unknown,
  ) {
    super(message)
    this.name = 'VoiceMetricPayloadError'
  }
}

export function parseSafeVoiceMetricEvent(
  input: unknown,
): SafeVoiceMetricEvent {
  const privatePaths = findPrivateVoiceMetricPayloadPaths(input)

  if (privatePaths.length > 0) {
    throw new VoiceMetricPayloadError(
      'private_voice_metric_payload',
      'Voice metric payload contains private fields.',
      { privatePaths },
    )
  }

  const redacted = redactVoiceMetricPayload(input)
  const parsed = safeVoiceMetricEventSchema.safeParse(redacted)

  if (!parsed.success) {
    throw new VoiceMetricPayloadError(
      'invalid_voice_metric_payload',
      'Voice metric payload does not match the safe schema.',
      {
        issues: parsed.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.join('.'),
        })),
      },
    )
  }

  return parsed.data
}

export function redactVoiceMetricDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const redacted = redactVoiceMetricPayload(details)

  return isRecord(redacted) ? redacted : {}
}

export function redactVoiceMetricPayload(value: unknown): unknown {
  return redactVoiceMetricValue(value, new WeakSet())
}

export function findPrivateVoiceMetricPayloadPaths(value: unknown): string[] {
  return findPrivateVoiceMetricPaths(value, new WeakSet(), [])
}

const BLOCKED_VOICE_METRIC_KEYS = new Set([
  'agenda',
  'agendaitem',
  'agendaitems',
  'audio',
  'audioblob',
  'candidate',
  'candidatetasktitle',
  'candidatetasktitles',
  'candidatetitle',
  'candidatetitles',
  'candidates',
  'fullintent',
  'fullplannerintent',
  'fulltranscript',
  'fullpreview',
  'fullresult',
  'fullvoiceactionpreview',
  'fullvoiceactionresult',
  'intent',
  'item',
  'itemname',
  'itemnames',
  'items',
  'llmprompt',
  'name',
  'preview',
  'prompt',
  'query',
  'rawaudio',
  'rawproviderresponse',
  'rawsttproviderresponse',
  'rawtext',
  'result',
  'shoppingitem',
  'shoppingitemname',
  'shoppingitemnames',
  'shoppingitems',
  'sttproviderrawresponse',
  'targetquery',
  'task',
  'tasktitle',
  'tasktitles',
  'tasks',
  'text',
  'title',
  'transcript',
])

function redactVoiceMetricValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (value === undefined || isBinaryPayload(value)) {
    return undefined
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (seen.has(value)) {
    return undefined
  }

  seen.add(value)

  if (Array.isArray(value)) {
    const redactedItems = value
      .map((item) => redactVoiceMetricValue(item, seen))
      .filter((item) => item !== undefined)

    return redactedItems.length > 0 ? redactedItems : undefined
  }

  const entries = Object.entries(value).flatMap(([key, nestedValue]) => {
    if (isBlockedVoiceMetricKey(key)) {
      return []
    }

    const redacted = redactVoiceMetricValue(nestedValue, seen)

    return redacted === undefined ? [] : ([[key, redacted]] as const)
  })

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function findPrivateVoiceMetricPaths(
  value: unknown,
  seen: WeakSet<object>,
  path: string[],
): string[] {
  if (value === undefined || value === null) {
    return []
  }

  if (isBinaryPayload(value)) {
    return [path.join('.') || '<root>']
  }

  if (typeof value !== 'object' || value instanceof Date) {
    return []
  }

  if (seen.has(value)) {
    return []
  }

  seen.add(value)

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findPrivateVoiceMetricPaths(item, seen, [...path, String(index)]),
    )
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nextPath = [...path, key]

    if (isBlockedVoiceMetricKey(key)) {
      return [nextPath.join('.')]
    }

    return findPrivateVoiceMetricPaths(nestedValue, seen, nextPath)
  })
}

function isBlockedVoiceMetricKey(key: string): boolean {
  return BLOCKED_VOICE_METRIC_KEYS.has(normalizeVoiceMetricKey(key))
}

function normalizeVoiceMetricKey(key: string): string {
  return key.replace(/[_\-\s]+/gu, '').toLowerCase()
}

function isBinaryPayload(value: unknown): boolean {
  const blobConstructor = (
    globalThis as {
      Blob?: (new (...args: never[]) => object) | undefined
    }
  ).Blob

  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (blobConstructor !== undefined && value instanceof blobConstructor)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
