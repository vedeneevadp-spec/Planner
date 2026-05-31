import {
  parseSafeVoiceMetricEvent,
  type SafeVoiceMetricEvent,
  type VoiceActionSource,
  type VoiceAssistantSource,
  type VoiceMetricAppRole,
  type VoiceMetricConfidenceBucket,
  type VoiceMetricDurationBucket,
  type VoiceMetricPlatform,
  type VoiceMetricsSink,
} from '@planner/contracts'

import type { SessionFeatureApiConfig } from '@/features/session'
import { createApiRequester } from '@/shared/lib/api-client'

export const VOICE_RUNTIME_METRICS_MODEL_VERSION = 'voice-runtime-metrics.v1'

type VoiceMetricEventInput = Omit<SafeVoiceMetricEvent, 'createdAt'> & {
  createdAt?: string | undefined
}

export class VoiceMetricsApiError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly status: number

  constructor(
    message: string,
    options: {
      code: string
      details?: unknown
      status: number
    },
  ) {
    super(message)
    this.name = 'VoiceMetricsApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export class BackendVoiceMetricsSink implements VoiceMetricsSink {
  private readonly request: ReturnType<typeof createApiRequester>['request']

  constructor(config: SessionFeatureApiConfig, fetchFn: typeof fetch = fetch) {
    this.request = createApiRequester(
      config,
      (message, options) => new VoiceMetricsApiError(message, options),
      fetchFn,
      {
        fallbackErrorCode: 'voice_metric_failed',
        fallbackErrorMessage: 'Voice metric request failed.',
      },
    ).request
  }

  async track(event: SafeVoiceMetricEvent): Promise<void> {
    const safeEvent = parseSafeVoiceMetricEvent(event)

    await this.request({
      body: safeEvent,
      method: 'POST',
      path: '/api/voice/metrics',
      writeAccess: true,
    })
  }
}

export function createVoiceRuntimeMetricEvent(
  input: VoiceMetricEventInput,
): SafeVoiceMetricEvent {
  return parseSafeVoiceMetricEvent({
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...input,
  })
}

export function getSafeVoiceMetricAppRole(
  appRole: string | null | undefined,
): VoiceMetricAppRole | null {
  return appRole === 'owner' || appRole === 'test' ? appRole : null
}

export function getVoiceMetricSource(
  source: VoiceAssistantSource | VoiceActionSource,
): VoiceActionSource {
  switch (source) {
    case 'android_microphone':
      return 'android_push_to_talk'
    case 'android_push_to_talk':
    case 'android_wake_word':
    case 'backend_text':
    case 'web_push_to_talk':
      return source
    case 'web_microphone':
      return 'web_push_to_talk'
  }
}

export function getVoiceMetricPlatform(
  source: VoiceActionSource,
): VoiceMetricPlatform {
  switch (source) {
    case 'android_push_to_talk':
    case 'android_wake_word':
      return 'android'
    case 'backend_text':
      return 'backend'
    case 'web_push_to_talk':
      return 'web'
  }
}

export function bucketVoiceMetricConfidence(
  confidence: number | null | undefined,
): VoiceMetricConfidenceBucket | undefined {
  if (confidence === null || confidence === undefined) {
    return undefined
  }

  if (confidence < 0.55) {
    return 'low'
  }

  if (confidence < 0.85) {
    return 'medium'
  }

  return 'high'
}

export function bucketVoiceMetricDuration(
  durationMs: number,
): VoiceMetricDurationBucket {
  if (durationMs < 700) {
    return 'short'
  }

  if (durationMs <= 5_000) {
    return 'normal'
  }

  return 'long'
}
