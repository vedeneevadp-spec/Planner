import {
  NoopVoiceMetricsSink,
  type SafeVoiceMetricEvent,
  type VoiceActionSource,
  type VoiceAssistantSource,
  type VoiceMetricWakeWordProvider,
} from '@planner/contracts'
import type { MutableRefObject } from 'react'
import { useCallback, useMemo, useRef } from 'react'

import type { SessionFeatureApiConfig } from '@/features/session'

import {
  BackendVoiceMetricsSink,
  createVoiceRuntimeMetricEvent,
  getSafeVoiceMetricAppRole,
  getVoiceMetricPlatform,
  getVoiceMetricSource,
  VOICE_RUNTIME_METRICS_MODEL_VERSION,
} from './voice-metrics'

export type VoiceMetricPayload = Partial<
  Omit<
    SafeVoiceMetricEvent,
    'appRole' | 'createdAt' | 'eventName' | 'platform' | 'source'
  >
>

export type VoiceMetricSource = VoiceAssistantSource | VoiceActionSource

export interface AndroidWakeWordMetricStatus {
  wakeWordModelVersion?: string | null | undefined
  wakeWordProvider?: VoiceMetricWakeWordProvider | null | undefined
}

interface VoiceFlowTimingMarks {
  actionPreviewCreatedAt?: number | undefined
  intentParsedAt?: number | undefined
  micClickAt?: number | undefined
  recordingStartedAt?: number | undefined
  recordingStoppedAt?: number | undefined
  sttUploadCompletedAt?: number | undefined
  sttUploadStartedAt?: number | undefined
  wakeDetectedAt?: number | undefined
}

export type VoiceTimingMark = keyof VoiceFlowTimingMarks
export type TrackVoiceMetric = (
  eventName: SafeVoiceMetricEvent['eventName'],
  source: VoiceMetricSource,
  payload?: VoiceMetricPayload,
) => void
export type ResetVoiceTiming = (
  start: 'android_wake_word' | 'mic_click',
) => void
export type MarkVoiceTiming = (mark: VoiceTimingMark) => void
export type GetVoiceTimingDuration = (
  startedAt: number | undefined,
  endedAtMark: VoiceTimingMark,
) => number | undefined
export type GetVoiceTimingIntervalDuration = (
  startedAtMark: VoiceTimingMark,
  endedAtMark: VoiceTimingMark,
) => number | undefined
export type CreateConfirmationTimingPayload = (
  source: VoiceMetricSource,
) => VoiceMetricPayload

export interface UseVoiceMetricsInput {
  androidVoiceStatus?: AndroidWakeWordMetricStatus | null | undefined
  androidVoiceStatusRef?:
    MutableRefObject<AndroidWakeWordMetricStatus | null> | undefined
  apiConfig: SessionFeatureApiConfig | null | undefined
  appRole: string | null | undefined
}

export function useVoiceMetrics({
  androidVoiceStatus,
  androidVoiceStatusRef,
  apiConfig,
  appRole,
}: UseVoiceMetricsInput) {
  const voiceMetricsSink = useMemo(
    () =>
      import.meta.env.MODE === 'test' || !apiConfig
        ? new NoopVoiceMetricsSink()
        : new BackendVoiceMetricsSink(apiConfig),
    [apiConfig],
  )
  const voiceTimingRef = useRef<VoiceFlowTimingMarks>({})

  const trackVoiceMetric = useCallback(
    (
      eventName: SafeVoiceMetricEvent['eventName'],
      source: VoiceMetricSource,
      payload: VoiceMetricPayload = {},
    ) => {
      const safeAppRole = getSafeVoiceMetricAppRole(appRole)

      if (!safeAppRole) {
        return
      }

      const metricSource = getVoiceMetricSource(source)
      const wakeWordStatus =
        androidVoiceStatusRef?.current ?? androidVoiceStatus
      const wakeWordContext =
        metricSource === 'android_wake_word'
          ? readAndroidWakeWordMetricContext(wakeWordStatus)
          : {}
      const wakeWordMetricPayload =
        metricSource === 'android_wake_word'
          ? createDefinedMetricPayload({
              wakeWordProvider:
                payload.wakeWordProvider ?? wakeWordContext.wakeWordProvider,
            })
          : {}

      try {
        const event = createVoiceRuntimeMetricEvent({
          ...payload,
          appRole: safeAppRole,
          eventName,
          modelVersion:
            payload.modelVersion ??
            wakeWordContext.modelVersion ??
            VOICE_RUNTIME_METRICS_MODEL_VERSION,
          platform: getVoiceMetricPlatform(metricSource),
          source: metricSource,
          ...wakeWordMetricPayload,
        })

        void Promise.resolve(voiceMetricsSink.track(event)).catch((error) => {
          console.warn('Failed to record voice metric.', error)
        })
      } catch (error) {
        console.warn('Failed to record voice metric.', error)
      }
    },
    [androidVoiceStatus, androidVoiceStatusRef, appRole, voiceMetricsSink],
  )

  const resetVoiceTiming = useCallback(
    (start: 'android_wake_word' | 'mic_click'): void => {
      const now = readVoiceMetricNow()

      voiceTimingRef.current =
        start === 'android_wake_word'
          ? { wakeDetectedAt: now }
          : { micClickAt: now }
    },
    [],
  )

  const markVoiceTiming = useCallback((mark: VoiceTimingMark): void => {
    voiceTimingRef.current = {
      ...voiceTimingRef.current,
      [mark]: readVoiceMetricNow(),
    }
  }, [])

  const getVoiceTimingDuration = useCallback(
    (startedAt: number | undefined, endedAtMark: VoiceTimingMark) =>
      durationBetween(startedAt, voiceTimingRef.current[endedAtMark]),
    [],
  )

  const getVoiceTimingIntervalDuration = useCallback(
    (startedAtMark: VoiceTimingMark, endedAtMark: VoiceTimingMark) =>
      durationBetween(
        voiceTimingRef.current[startedAtMark],
        voiceTimingRef.current[endedAtMark],
      ),
    [],
  )

  const createConfirmationTimingPayload = useCallback(
    (source: VoiceMetricSource): VoiceMetricPayload => {
      const marks = voiceTimingRef.current
      const confirmationShownAt = readVoiceMetricNow()
      const metricSource = getVoiceMetricSource(source)

      return createDefinedMetricPayload({
        mic_click_to_confirmation_card_ms:
          metricSource === 'web_push_to_talk'
            ? durationBetween(marks.micClickAt, confirmationShownAt)
            : undefined,
        time_to_confirmation_card_ms: durationBetween(
          marks.micClickAt ?? marks.wakeDetectedAt,
          confirmationShownAt,
        ),
        wake_detected_to_confirmation_card_ms:
          metricSource === 'android_wake_word'
            ? durationBetween(marks.wakeDetectedAt, confirmationShownAt)
            : undefined,
        wake_detected_to_recorder_start_ms:
          metricSource === 'android_wake_word'
            ? durationBetween(marks.wakeDetectedAt, marks.recordingStartedAt)
            : undefined,
      })
    },
    [],
  )

  return {
    createConfirmationTimingPayload,
    getVoiceTimingDuration,
    getVoiceTimingIntervalDuration,
    markVoiceTiming,
    resetVoiceTiming,
    trackVoiceMetric,
  }
}

export function readAndroidWakeWordMetricContext(
  status: AndroidWakeWordMetricStatus | null | undefined,
): {
  modelVersion?: string
  wakeWordProvider?: VoiceMetricWakeWordProvider
} {
  return {
    ...(status?.wakeWordModelVersion
      ? { modelVersion: status.wakeWordModelVersion }
      : {}),
    ...(status?.wakeWordProvider
      ? { wakeWordProvider: status.wakeWordProvider }
      : {}),
  }
}

export function readVoiceMetricNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export function mapMetricSttProvider(
  provider: string,
): SafeVoiceMetricEvent['sttProvider'] {
  switch (provider) {
    case 'backend_yandex_speechkit':
      return 'yandex_speechkit'
    case 'local_stub':
    case 'stub':
      return provider
    default:
      return 'stub'
  }
}

function durationBetween(
  startedAt: number | undefined,
  endedAt: number | undefined,
): number | undefined {
  if (startedAt === undefined || endedAt === undefined) {
    return undefined
  }

  return Math.max(0, Math.round(endedAt - startedAt))
}

function createDefinedMetricPayload(
  payload: VoiceMetricPayload,
): VoiceMetricPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  )
}
