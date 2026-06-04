import type {
  PlannerIntent,
  VoiceActionPreview,
  VoiceActionResult,
  VoiceAssistantEvent,
  VoiceAssistantSource,
} from '@planner/contracts'
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import type { SessionFeatureApiConfig } from '@/features/session'
import { recordClientEvent } from '@/shared/lib/observability'

import { isAndroidVoiceAssistantRuntime } from '../lib/native-voice-assistant'
import {
  uploadWebVoiceCommand,
  WebVoiceCommandApiError,
} from '../lib/web-voice-command-api'
import {
  startWebVoiceRecorder,
  type WebVoiceRecorder,
} from '../lib/web-voice-recorder'
import {
  type GetVoiceTimingIntervalDuration,
  mapMetricSttProvider,
  type MarkVoiceTiming,
  type ResetVoiceTiming,
  type TrackVoiceMetric,
} from './useVoiceMetrics'
import { type VoiceAppendSession } from './voice-append-session'
import { VOICE_AUDIO_UPLOAD_MAX_DURATION_MS } from './voice-audio-upload-guard'
import { bucketVoiceMetricDuration } from './voice-metrics'
import {
  getWebVoiceInputLabel,
  getWebVoiceSupport,
  normalizeWebVoicePermissionError,
  queryWebVoiceMicrophonePermissionState,
  queryWebVoiceMicrophonePermissionStatus,
  validateWebVoiceRecording,
  WEB_VOICE_PERMISSION_READY_MESSAGE,
  WEB_VOICE_SOURCE,
  type WebVoiceInputState,
} from './web-voice-input'

const WEB_RECORDING_MAX_DURATION_MS = VOICE_AUDIO_UPLOAD_MAX_DURATION_MS

const WEB_PROCESSING_STATES = new Set<WebVoiceInputState>([
  'requesting_permission',
  'validating_audio',
  'uploading',
  'recognizing',
  'parsing',
])

type VoiceTranscriptHandler = (
  transcript: string,
  source: VoiceAssistantSource,
  backendIntent?: PlannerIntent,
  options?: {
    appendSession?: VoiceAppendSession | null | undefined
    resetClarificationAttempts?: boolean
  },
) => Promise<void>

export interface UseWebVoiceInputInput {
  apiConfig: SessionFeatureApiConfig | null | undefined
  dispatch: Dispatch<VoiceAssistantEvent>
  getVoiceTimingIntervalDuration: GetVoiceTimingIntervalDuration
  handleTranscript: VoiceTranscriptHandler
  markVoiceTiming: MarkVoiceTiming
  pendingAppendSessionRef: MutableRefObject<VoiceAppendSession | null>
  resetVoiceTiming: ResetVoiceTiming
  setActionPreview: Dispatch<SetStateAction<VoiceActionPreview | null>>
  setActionResult: Dispatch<SetStateAction<VoiceActionResult | null>>
  setIsCardVisible: Dispatch<SetStateAction<boolean>>
  setIsUndoing: Dispatch<SetStateAction<boolean>>
  setSelectedCandidateId: Dispatch<SetStateAction<string | null>>
  trackVoiceMetric: TrackVoiceMetric
}

export function useWebVoiceInput({
  apiConfig,
  dispatch,
  getVoiceTimingIntervalDuration,
  handleTranscript,
  markVoiceTiming,
  pendingAppendSessionRef,
  resetVoiceTiming,
  setActionPreview,
  setActionResult,
  setIsCardVisible,
  setIsUndoing,
  setSelectedCandidateId,
  trackVoiceMetric,
}: UseWebVoiceInputInput) {
  const webRecorderRef = useRef<WebVoiceRecorder | null>(null)
  const webRecordingTimerRef = useRef<number | null>(null)
  const webUploadAbortControllerRef = useRef<AbortController | null>(null)
  const webExplicitUserActionRef = useRef(false)
  const webOperationIdRef = useRef(0)
  const [webVoiceState, setWebVoiceState] = useState<WebVoiceInputState>('idle')
  const [webVoiceMessage, setWebVoiceMessage] = useState<string | null>(null)
  const isWebListening = webVoiceState === 'listening'
  const isWebProcessing = WEB_PROCESSING_STATES.has(webVoiceState)
  const isAndroidRuntime = isAndroidVoiceAssistantRuntime()

  const isCurrentWebOperation = useCallback(
    (operationId: number): boolean => webOperationIdRef.current === operationId,
    [],
  )

  const clearWebRecordingTimer = useCallback(() => {
    if (webRecordingTimerRef.current !== null) {
      window.clearTimeout(webRecordingTimerRef.current)
      webRecordingTimerRef.current = null
    }
  }, [])

  const resetWebVoiceState = useCallback(() => {
    setWebVoiceState('idle')
    setWebVoiceMessage(null)
  }, [])

  const stopWebVoiceRecording = useCallback(
    async (operationId = webOperationIdRef.current) => {
      const recorder = webRecorderRef.current

      if (!recorder || !isCurrentWebOperation(operationId)) {
        return
      }

      clearWebRecordingTimer()
      webRecorderRef.current = null
      setWebVoiceState('validating_audio')
      setWebVoiceMessage(getWebVoiceInputLabel('validating_audio'))

      try {
        const recording = await recorder.stop()

        if (!isCurrentWebOperation(operationId)) {
          return
        }

        markVoiceTiming('recordingStoppedAt')
        recordClientEvent('web_voice_recording_stopped', {
          byteLength: recording.byteLength,
          durationMs: recording.durationMs,
          source: WEB_VOICE_SOURCE,
        })

        const validation = validateWebVoiceRecording(recording, {
          explicitUserAction: webExplicitUserActionRef.current,
        })

        if (!validation.ok) {
          setWebVoiceState('needs_repeat')
          setWebVoiceMessage(validation.message)
          recordClientEvent(
            'web_voice_local_validation_failed',
            {
              durationMs: recording.durationMs,
              reason: validation.reason,
              source: WEB_VOICE_SOURCE,
            },
            { level: 'warn' },
          )
          trackVoiceMetric('local_validation_failed', 'web_microphone', {
            audioBytes: recording.byteLength,
            audioDurationMs: recording.durationMs,
            durationBucket: bucketVoiceMetricDuration(recording.durationMs),
            errorCode: validation.reason,
            recording_duration_ms: recording.durationMs,
          })
          trackVoiceMetric('voice_session_result', 'web_microphone', {
            voice_session_result: 'error',
          })
          pendingAppendSessionRef.current = null
          dispatch({
            error: validation.message,
            source: 'web_microphone',
            type: 'failed',
          })
          return
        }

        if (!apiConfig) {
          throw new Error('Backend STT недоступен без активной сессии.')
        }

        setWebVoiceState('uploading')
        setWebVoiceMessage(getWebVoiceInputLabel('uploading'))
        markVoiceTiming('sttUploadStartedAt')
        recordClientEvent('web_voice_upload_started', {
          byteLength: recording.byteLength,
          durationMs: recording.durationMs,
          source: WEB_VOICE_SOURCE,
        })
        trackVoiceMetric('stt_upload_started', 'web_microphone', {
          audioBytes: recording.byteLength,
          audioDurationMs: recording.durationMs,
          durationBucket: bucketVoiceMetricDuration(recording.durationMs),
          recording_duration_ms: recording.durationMs,
          sttProvider: 'yandex_speechkit',
        })

        const abortController = new AbortController()

        webUploadAbortControllerRef.current = abortController
        setWebVoiceState('recognizing')
        setWebVoiceMessage(getWebVoiceInputLabel('recognizing'))

        const response = await uploadWebVoiceCommand(recording, apiConfig, {
          signal: abortController.signal,
        })

        if (!isCurrentWebOperation(operationId)) {
          return
        }

        recordClientEvent('web_voice_upload_completed', {
          billableSecondsEstimated: response.stt.billableSecondsEstimated,
          durationMs: response.stt.durationMs,
          provider: response.stt.provider,
          source: response.stt.source,
        })
        markVoiceTiming('sttUploadCompletedAt')
        trackVoiceMetric('stt_upload_completed', 'web_microphone', {
          audioDurationMs: response.stt.durationMs,
          durationBucket: bucketVoiceMetricDuration(response.stt.durationMs),
          recording_duration_ms: recording.durationMs,
          sttProvider: mapMetricSttProvider(response.stt.provider),
          stt_upload_duration_ms: getVoiceTimingIntervalDuration(
            'sttUploadStartedAt',
            'sttUploadCompletedAt',
          ),
        })
        setWebVoiceState('parsing')
        setWebVoiceMessage(getWebVoiceInputLabel('parsing'))
        await handleTranscript(
          response.transcript,
          'web_microphone',
          response.intent,
          {
            appendSession: pendingAppendSessionRef.current,
          },
        )

        if (isCurrentWebOperation(operationId)) {
          setWebVoiceState('ready_for_confirmation')
          setWebVoiceMessage(null)
        }
      } catch (error) {
        if (!isCurrentWebOperation(operationId)) {
          return
        }

        const message = getWebVoiceUploadErrorMessage(error)
        const errorName = getErrorName(error)

        setWebVoiceState('error')
        setWebVoiceMessage(message)
        if (errorName === 'TimeoutError') {
          recordClientEvent(
            'web_voice_timeout',
            {
              source: WEB_VOICE_SOURCE,
              stage: 'upload',
            },
            { level: 'warn' },
          )
          trackVoiceMetric('web_voice_timeout', 'web_microphone', {
            errorCode: 'upload_timeout',
          })
        }
        recordClientEvent(
          'web_voice_upload_error',
          {
            code:
              error instanceof WebVoiceCommandApiError ? error.code : errorName,
            source: WEB_VOICE_SOURCE,
            status:
              error instanceof WebVoiceCommandApiError
                ? error.status
                : undefined,
          },
          { level: 'error' },
        )
        trackVoiceMetric('stt_error', 'web_microphone', {
          errorCode:
            error instanceof WebVoiceCommandApiError ? error.code : errorName,
          sttProvider: 'yandex_speechkit',
        })
        trackVoiceMetric('voice_session_result', 'web_microphone', {
          voice_session_result: 'error',
        })
        pendingAppendSessionRef.current = null
        dispatch({
          error: message,
          source: 'web_microphone',
          type: 'failed',
        })
      } finally {
        if (isCurrentWebOperation(operationId)) {
          webUploadAbortControllerRef.current = null
        }
      }
    },
    [
      apiConfig,
      clearWebRecordingTimer,
      dispatch,
      getVoiceTimingIntervalDuration,
      handleTranscript,
      isCurrentWebOperation,
      markVoiceTiming,
      pendingAppendSessionRef,
      trackVoiceMetric,
    ],
  )

  const startWebVoiceInput = useCallback(async () => {
    resetVoiceTiming('mic_click')
    setIsCardVisible(true)
    setActionPreview(null)
    setActionResult(null)
    setSelectedCandidateId(null)
    setIsUndoing(false)
    setWebVoiceMessage(null)
    dispatch({ type: 'cancelled' })
    webExplicitUserActionRef.current = true
    const operationId = webOperationIdRef.current + 1

    webOperationIdRef.current = operationId
    recordClientEvent('web_voice_started', {
      source: WEB_VOICE_SOURCE,
    })
    trackVoiceMetric('voice_started', 'web_microphone')
    trackVoiceMetric('push_to_talk_started', 'web_microphone')
    trackVoiceMetric('audio_signal_suppressed', 'web_microphone', {
      errorCode: 'web_audio_signals_unsupported',
    })

    const support = getWebVoiceSupport()

    if (!support.supported) {
      const message =
        support.message ??
        'Голосовой ввод недоступен в этом браузере. Можно ввести задачу вручную.'

      setWebVoiceState('unsupported')
      setWebVoiceMessage(message)
      recordClientEvent(
        'web_voice_unsupported',
        {
          reason: support.reason ?? 'unknown',
        },
        { level: 'warn' },
      )
      trackVoiceMetric('web_voice_unsupported', 'web_microphone', {
        errorCode: support.reason ?? 'unknown',
      })
      pendingAppendSessionRef.current = null
      dispatch({
        error: message,
        source: 'web_microphone',
        type: 'failed',
      })
      return
    }

    setWebVoiceState('requesting_permission')
    setWebVoiceMessage(getWebVoiceInputLabel('requesting_permission'))

    try {
      webRecorderRef.current = await startWebVoiceRecorder()

      if (!isCurrentWebOperation(operationId)) {
        webRecorderRef.current?.cancel()
        webRecorderRef.current = null
        return
      }

      setWebVoiceState('listening')
      setWebVoiceMessage(getWebVoiceInputLabel('listening'))
      markVoiceTiming('recordingStartedAt')
      trackVoiceMetric('command_recording_started', 'web_microphone')
      dispatch({
        source: 'web_microphone',
        type: 'recording_started',
      })
      webRecordingTimerRef.current = window.setTimeout(() => {
        recordClientEvent('web_voice_timeout', {
          maxDurationMs: WEB_RECORDING_MAX_DURATION_MS,
          source: WEB_VOICE_SOURCE,
          stage: 'recording',
        })
        trackVoiceMetric('web_voice_timeout', 'web_microphone', {
          errorCode: 'recording_timeout',
        })
        void stopWebVoiceRecording(operationId)
      }, WEB_RECORDING_MAX_DURATION_MS)
    } catch (error) {
      const microphonePermissionState =
        await queryWebVoiceMicrophonePermissionState()

      if (!isCurrentWebOperation(operationId)) {
        return
      }

      const voiceError = normalizeWebVoicePermissionError(error, {
        microphonePermissionState,
      })

      setWebVoiceState(voiceError.state)
      setWebVoiceMessage(voiceError.message)
      pendingAppendSessionRef.current = null

      if (voiceError.state === 'permission_denied') {
        recordClientEvent(
          'web_voice_permission_denied',
          {
            errorName: voiceError.name,
          },
          { level: 'warn' },
        )
        trackVoiceMetric('web_voice_permission_denied', 'web_microphone', {
          errorCode: voiceError.name,
        })
      }

      dispatch({
        error: voiceError.message,
        source: 'web_microphone',
        type: 'failed',
      })
    }
  }, [
    dispatch,
    isCurrentWebOperation,
    markVoiceTiming,
    pendingAppendSessionRef,
    resetVoiceTiming,
    setActionPreview,
    setActionResult,
    setIsCardVisible,
    setIsUndoing,
    setSelectedCandidateId,
    stopWebVoiceRecording,
    trackVoiceMetric,
  ])

  const cancelWebVoiceOperation = useCallback(() => {
    if (isCancellableWebVoiceState(webVoiceState)) {
      recordClientEvent('web_voice_recording_cancelled', {
        source: WEB_VOICE_SOURCE,
        state: webVoiceState,
      })
      trackVoiceMetric('command_recording_cancelled', 'web_microphone', {
        errorCode: webVoiceState,
      })
    }

    webOperationIdRef.current += 1
    clearWebRecordingTimer()
    webRecorderRef.current?.cancel()
    webRecorderRef.current = null
    webUploadAbortControllerRef.current?.abort()
    webUploadAbortControllerRef.current = null
    webExplicitUserActionRef.current = false
    pendingAppendSessionRef.current = null
    setWebVoiceState('idle')
    setWebVoiceMessage(null)
  }, [
    clearWebRecordingTimer,
    pendingAppendSessionRef,
    trackVoiceMetric,
    webVoiceState,
  ])

  useEffect(() => {
    if (isAndroidRuntime || webVoiceState !== 'permission_denied') {
      return undefined
    }

    let isDisposed = false
    let removePermissionListener: (() => void) | null = null

    const handlePermissionState = (permissionState: PermissionState) => {
      if (isDisposed || permissionState !== 'granted') {
        return
      }

      setWebVoiceState('permission_ready')
      setWebVoiceMessage(WEB_VOICE_PERMISSION_READY_MESSAGE)
      dispatch({ type: 'cancelled' })
    }

    void queryWebVoiceMicrophonePermissionStatus().then((permissionStatus) => {
      if (isDisposed || !permissionStatus) {
        return
      }

      const handleChange = () => {
        handlePermissionState(permissionStatus.state)
      }

      handleChange()
      permissionStatus.addEventListener('change', handleChange)
      removePermissionListener = () => {
        permissionStatus.removeEventListener('change', handleChange)
      }
    })

    return () => {
      isDisposed = true
      removePermissionListener?.()
    }
  }, [dispatch, isAndroidRuntime, webVoiceState])

  useEffect(() => {
    return () => {
      webOperationIdRef.current += 1
      clearWebRecordingTimer()
      webRecorderRef.current?.cancel()
      webRecorderRef.current = null
      webUploadAbortControllerRef.current?.abort()
      webUploadAbortControllerRef.current = null
    }
  }, [clearWebRecordingTimer])

  return {
    cancelWebVoiceOperation,
    isWebListening,
    isWebProcessing,
    resetWebVoiceState,
    startWebVoiceInput,
    stopWebVoiceRecording,
    webVoiceMessage,
    webVoiceState,
  }
}

function getWebVoiceUploadErrorMessage(error: unknown): string {
  if (error instanceof WebVoiceCommandApiError) {
    return error.message || 'Не удалось распознать.'
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return 'Запись прервана.'
  }

  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'Не удалось распознать: запрос занял слишком много времени.'
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Не удалось распознать.'
}

function getErrorName(error: unknown): string {
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

function isCancellableWebVoiceState(state: WebVoiceInputState): boolean {
  return (
    state === 'requesting_permission' ||
    state === 'listening' ||
    state === 'validating_audio' ||
    state === 'uploading' ||
    state === 'recognizing' ||
    state === 'parsing'
  )
}
