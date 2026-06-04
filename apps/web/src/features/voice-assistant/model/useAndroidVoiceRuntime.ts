import {
  type PlannerIntent,
  VOICE_COMMAND_AUDIO_MAX_DURATION_MS,
  type VoiceActionPreview,
  type VoiceActionResult,
  type VoiceAssistantEvent,
  type VoiceAssistantSource,
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

import {
  addAndroidVoiceAssistantResumeListener,
  addVoiceAssistantSettingsChangedListener,
  captureAndroidVoiceCommand,
  consumePendingAndroidVoiceCommand,
  getVoiceAssistantNativeStatus,
  isAndroidVoiceAssistantRuntime,
  type NativeVoiceCommand,
  startAndroidVoiceAssistant,
  stopAndroidVoiceAssistant,
  type VoiceAssistantNativeStatus,
} from '../lib/native-voice-assistant'
import {
  type AndroidWakeWordMetricStatus,
  type MarkVoiceTiming,
  readAndroidWakeWordMetricContext,
  type ResetVoiceTiming,
  type TrackVoiceMetric,
} from './useVoiceMetrics'
import {
  shouldResetAppendOnVoiceStart,
  type VoiceAppendSession,
} from './voice-append-session'

const ANDROID_COMMAND_INITIAL_POLL_DELAY_MS = 650
const ANDROID_COMMAND_POLL_INTERVAL_MS = 750
const ANDROID_COMMAND_RECORDING_UI_TRANSITION_MS =
  VOICE_COMMAND_AUDIO_MAX_DURATION_MS + 1_000
const ANDROID_COMMAND_RESULT_TIMEOUT_MS = 45_000

type VoiceTranscriptHandler = (
  transcript: string,
  source: VoiceAssistantSource,
  backendIntent?: PlannerIntent,
  options?: {
    appendSession?: VoiceAppendSession | null | undefined
    resetClarificationAttempts?: boolean
  },
) => Promise<void>

export interface UseAndroidVoiceRuntimeInput {
  androidVoiceStatusRef:
    | MutableRefObject<AndroidWakeWordMetricStatus | null>
    | undefined
  apiConfig: SessionFeatureApiConfig | null | undefined
  dispatch: Dispatch<VoiceAssistantEvent>
  handleTranscript: VoiceTranscriptHandler
  isVoiceEnabled: boolean
  markVoiceTiming: MarkVoiceTiming
  pendingAppendSessionRef: MutableRefObject<VoiceAppendSession | null>
  resetVoiceTiming: ResetVoiceTiming
  setActionPreview: Dispatch<SetStateAction<VoiceActionPreview | null>>
  setActionResult: Dispatch<SetStateAction<VoiceActionResult | null>>
  setAppendSession: Dispatch<SetStateAction<VoiceAppendSession | null>>
  setIsCardVisible: Dispatch<SetStateAction<boolean>>
  setIsUndoing: Dispatch<SetStateAction<boolean>>
  setSelectedCandidateId: Dispatch<SetStateAction<string | null>>
  setWebVoiceIdle: () => void
  trackVoiceMetric: TrackVoiceMetric
  wakeWordTrainingModeEnabled: boolean | undefined
}

export function useAndroidVoiceRuntime({
  androidVoiceStatusRef,
  apiConfig,
  dispatch,
  handleTranscript,
  isVoiceEnabled,
  markVoiceTiming,
  pendingAppendSessionRef,
  resetVoiceTiming,
  setActionPreview,
  setActionResult,
  setAppendSession,
  setIsCardVisible,
  setIsUndoing,
  setSelectedCandidateId,
  setWebVoiceIdle,
  trackVoiceMetric,
  wakeWordTrainingModeEnabled,
}: UseAndroidVoiceRuntimeInput) {
  const handledNativeCommandIdsRef = useRef<Set<string>>(new Set())
  const pendingAndroidButtonCaptureRef = useRef(false)
  const androidCaptureOperationIdRef = useRef(0)
  const androidCommandPollTimerRef = useRef<number | null>(null)
  const androidCommandTranscribingTimerRef = useRef<number | null>(null)
  const androidCommandTimeoutTimerRef = useRef<number | null>(null)
  const [androidSettingsRevision, setAndroidSettingsRevision] = useState(0)
  const [androidVoiceStatus, setAndroidVoiceStatus] =
    useState<VoiceAssistantNativeStatus | null>(null)
  const isAndroidRuntime = isAndroidVoiceAssistantRuntime()

  const updateAndroidVoiceStatus = useCallback(
    (status: VoiceAssistantNativeStatus | null) => {
      if (androidVoiceStatusRef) {
        androidVoiceStatusRef.current = status
      }

      setAndroidVoiceStatus(status)
    },
    [androidVoiceStatusRef],
  )

  const clearAndroidCommandPolling = useCallback(() => {
    if (androidCommandPollTimerRef.current !== null) {
      window.clearTimeout(androidCommandPollTimerRef.current)
      androidCommandPollTimerRef.current = null
    }

    if (androidCommandTranscribingTimerRef.current !== null) {
      window.clearTimeout(androidCommandTranscribingTimerRef.current)
      androidCommandTranscribingTimerRef.current = null
    }

    if (androidCommandTimeoutTimerRef.current !== null) {
      window.clearTimeout(androidCommandTimeoutTimerRef.current)
      androidCommandTimeoutTimerRef.current = null
    }
  }, [])

  const isCurrentAndroidCaptureOperation = useCallback(
    (operationId: number): boolean =>
      androidCaptureOperationIdRef.current === operationId,
    [],
  )

  const cancelAndroidCommandPolling = useCallback(() => {
    androidCaptureOperationIdRef.current += 1
    clearAndroidCommandPolling()
    pendingAndroidButtonCaptureRef.current = false
  }, [clearAndroidCommandPolling])

  const consumePendingAndroidCommand =
    useCallback(async (): Promise<boolean> => {
      try {
        const command = await consumePendingAndroidVoiceCommand()

        if (!command || handledNativeCommandIdsRef.current.has(command.id)) {
          return Boolean(command)
        }

        const source = getAndroidVoiceCommandSource(
          command,
          pendingAndroidButtonCaptureRef.current,
        )
        const pendingAppendSession = pendingAppendSessionRef.current

        if (
          shouldResetAppendOnVoiceStart({
            appendRequested: Boolean(pendingAppendSession),
            source,
          })
        ) {
          setAppendSession(null)
        }

        if (source === 'android_wake_word') {
          const wakeWordContext =
            readAndroidWakeWordMetricContext(androidVoiceStatus)

          resetVoiceTiming('android_wake_word')
          markVoiceTiming('recordingStartedAt')
          trackVoiceMetric('voice_started', source, wakeWordContext)
          trackVoiceMetric('wake_detected', source, wakeWordContext)
        }

        trackVoiceMetric(
          androidVoiceStatus?.voiceCuesEnabled
            ? 'audio_signal_start_played'
            : 'audio_signal_suppressed',
          source,
          androidVoiceStatus?.voiceCuesEnabled
            ? {}
            : { errorCode: 'audio_feedback_disabled' },
        )
        pendingAndroidButtonCaptureRef.current = false
        handledNativeCommandIdsRef.current.add(command.id)

        if (command.errorMessage) {
          pendingAppendSessionRef.current = null
          trackVoiceMetric('stt_error', source, {
            errorCode: command.errorCode ?? 'android_voice_command_error',
          })
          trackVoiceMetric('voice_session_result', source, {
            voice_session_result: 'error',
          })
          setIsCardVisible(true)
          dispatch({
            error: command.errorMessage,
            source,
            type: 'failed',
          })
          return true
        }

        if (!command.transcript) {
          pendingAppendSessionRef.current = null
          trackVoiceMetric('stt_error', source, {
            errorCode: 'failed_recognition',
          })
          trackVoiceMetric('voice_session_result', source, {
            voice_session_result: 'error',
          })
          setIsCardVisible(true)
          dispatch({
            error: 'Команда не распознана.',
            source,
            type: 'failed',
          })
          return true
        }

        await handleTranscript(
          command.transcript,
          source,
          command.intent ?? undefined,
          {
            appendSession: pendingAppendSession,
          },
        )
        return true
      } catch (error) {
        console.warn('Failed to consume Android voice command.', error)
        return false
      }
    }, [
      androidVoiceStatus,
      dispatch,
      handleTranscript,
      markVoiceTiming,
      pendingAppendSessionRef,
      resetVoiceTiming,
      setAppendSession,
      setIsCardVisible,
      trackVoiceMetric,
    ])

  const pollPendingAndroidCommand = useCallback(
    async (operationId: number) => {
      if (!isCurrentAndroidCaptureOperation(operationId)) {
        return
      }

      const handled = await consumePendingAndroidCommand()

      if (!isCurrentAndroidCaptureOperation(operationId)) {
        return
      }

      if (handled) {
        clearAndroidCommandPolling()
        return
      }

      if (!pendingAndroidButtonCaptureRef.current) {
        clearAndroidCommandPolling()
        return
      }

      androidCommandPollTimerRef.current = window.setTimeout(() => {
        void pollPendingAndroidCommand(operationId)
      }, ANDROID_COMMAND_POLL_INTERVAL_MS)
    },
    [
      clearAndroidCommandPolling,
      consumePendingAndroidCommand,
      isCurrentAndroidCaptureOperation,
    ],
  )

  const scheduleAndroidCommandPolling = useCallback(
    (operationId: number) => {
      clearAndroidCommandPolling()
      androidCommandPollTimerRef.current = window.setTimeout(() => {
        void pollPendingAndroidCommand(operationId)
      }, ANDROID_COMMAND_INITIAL_POLL_DELAY_MS)
      androidCommandTranscribingTimerRef.current = window.setTimeout(() => {
        if (!isCurrentAndroidCaptureOperation(operationId)) {
          return
        }

        dispatch({
          source: 'android_microphone',
          type: 'transcribing_started',
        })
      }, ANDROID_COMMAND_RECORDING_UI_TRANSITION_MS)
      androidCommandTimeoutTimerRef.current = window.setTimeout(() => {
        void (async () => {
          if (!isCurrentAndroidCaptureOperation(operationId)) {
            return
          }

          const handled = await consumePendingAndroidCommand()

          if (!isCurrentAndroidCaptureOperation(operationId)) {
            return
          }

          if (handled) {
            clearAndroidCommandPolling()
            return
          }

          androidCaptureOperationIdRef.current += 1
          clearAndroidCommandPolling()
          pendingAndroidButtonCaptureRef.current = false
          pendingAppendSessionRef.current = null
          trackVoiceMetric('stt_error', 'android_microphone', {
            errorCode: 'android_command_result_timeout',
          })
          trackVoiceMetric('voice_session_result', 'android_microphone', {
            voice_session_result: 'error',
          })
          setIsCardVisible(true)
          setActionPreview(null)
          setActionResult(null)
          dispatch({
            error:
              'Не удалось получить результат голосовой команды. Попробуй ещё раз.',
            source: 'android_microphone',
            type: 'failed',
          })
        })()
      }, ANDROID_COMMAND_RESULT_TIMEOUT_MS)
    },
    [
      clearAndroidCommandPolling,
      consumePendingAndroidCommand,
      dispatch,
      isCurrentAndroidCaptureOperation,
      pendingAppendSessionRef,
      pollPendingAndroidCommand,
      setActionPreview,
      setActionResult,
      setIsCardVisible,
      trackVoiceMetric,
    ],
  )

  const startAndroidVoiceInput = useCallback(async () => {
    resetVoiceTiming('mic_click')
    setActionPreview(null)
    setActionResult(null)
    setSelectedCandidateId(null)
    setIsUndoing(false)
    setWebVoiceIdle()
    setIsCardVisible(true)
    clearAndroidCommandPolling()
    pendingAndroidButtonCaptureRef.current = true
    const operationId = androidCaptureOperationIdRef.current + 1

    androidCaptureOperationIdRef.current = operationId
    trackVoiceMetric('voice_started', 'android_microphone')
    trackVoiceMetric('push_to_talk_started', 'android_microphone')
    trackVoiceMetric(
      androidVoiceStatus?.voiceCuesEnabled
        ? 'audio_signal_start_played'
        : 'audio_signal_suppressed',
      'android_microphone',
      androidVoiceStatus?.voiceCuesEnabled
        ? {}
        : { errorCode: 'audio_feedback_disabled' },
    )
    markVoiceTiming('recordingStartedAt')
    trackVoiceMetric('command_recording_started', 'android_microphone')

    dispatch({
      source: 'android_microphone',
      type: 'recording_started',
    })

    try {
      if (!apiConfig) {
        throw new Error('Backend STT недоступен без активной сессии.')
      }

      scheduleAndroidCommandPolling(operationId)
      await captureAndroidVoiceCommand(apiConfig)
    } catch (error) {
      if (!isCurrentAndroidCaptureOperation(operationId)) {
        return
      }

      clearAndroidCommandPolling()
      pendingAndroidButtonCaptureRef.current = false
      pendingAppendSessionRef.current = null
      trackVoiceMetric('command_recording_cancelled', 'android_microphone', {
        errorCode: 'android_capture_failed',
      })
      dispatch({
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось запустить голосовой ввод.',
        source: 'android_microphone',
        type: 'failed',
      })
    }
  }, [
    androidVoiceStatus?.voiceCuesEnabled,
    apiConfig,
    clearAndroidCommandPolling,
    dispatch,
    isCurrentAndroidCaptureOperation,
    markVoiceTiming,
    pendingAppendSessionRef,
    resetVoiceTiming,
    scheduleAndroidCommandPolling,
    setActionPreview,
    setActionResult,
    setIsCardVisible,
    setIsUndoing,
    setSelectedCandidateId,
    setWebVoiceIdle,
    trackVoiceMetric,
  ])

  useEffect(() => {
    if (!isAndroidRuntime) {
      updateAndroidVoiceStatus(null)
      return undefined
    }

    let isDisposed = false

    void getVoiceAssistantNativeStatus()
      .then((status) => {
        if (!isDisposed) {
          updateAndroidVoiceStatus(status)
        }
      })
      .catch((error) => {
        console.warn('Failed to read Android voice assistant status.', error)
      })

    return () => {
      isDisposed = true
    }
  }, [androidSettingsRevision, isAndroidRuntime, updateAndroidVoiceStatus])

  useEffect(() => {
    return addVoiceAssistantSettingsChangedListener(() => {
      setAndroidSettingsRevision((revision) => revision + 1)
    })
  }, [])

  useEffect(() => {
    if (!isAndroidRuntime) {
      return undefined
    }

    if (!isVoiceEnabled) {
      void stopAndroidVoiceAssistant().catch((error) => {
        console.warn('Failed to stop Android voice assistant.', error)
      })

      return undefined
    }

    let isDisposed = false
    let resumeHandle: { remove: () => Promise<void> } | null = null

    async function consumePendingCommandIfMounted() {
      if (!isDisposed) {
        await consumePendingAndroidCommand()
      }
    }

    if (!apiConfig) {
      return undefined
    }

    if (
      !androidVoiceStatus?.wakeWordEnabled ||
      !androidVoiceStatus.backgroundWakeWordEnabled ||
      androidVoiceStatus.wakeWordModelStatus !== 'ready'
    ) {
      void stopAndroidVoiceAssistant().catch((error) => {
        console.warn('Failed to stop Android voice assistant.', error)
      })

      return undefined
    }

    void startAndroidVoiceAssistant({
      ...apiConfig,
      wakeWordTrainingModeEnabled: wakeWordTrainingModeEnabled ?? false,
    }).catch((error) => {
      console.warn('Failed to start Android voice assistant.', error)
    })
    void consumePendingCommandIfMounted()

    const intervalId = window.setInterval(() => {
      void consumePendingCommandIfMounted()
    }, 1500)

    void addAndroidVoiceAssistantResumeListener(() => {
      void consumePendingCommandIfMounted()
    }).then((handle) => {
      if (isDisposed) {
        void handle.remove()
        return
      }

      resumeHandle = handle
    })

    return () => {
      isDisposed = true
      window.clearInterval(intervalId)

      if (resumeHandle) {
        void resumeHandle.remove()
      }
    }
  }, [
    androidVoiceStatus?.backgroundWakeWordEnabled,
    androidVoiceStatus?.wakeWordEnabled,
    androidVoiceStatus?.wakeWordModelStatus,
    apiConfig,
    consumePendingAndroidCommand,
    isAndroidRuntime,
    isVoiceEnabled,
    wakeWordTrainingModeEnabled,
  ])

  useEffect(() => {
    return () => {
      androidCaptureOperationIdRef.current += 1
      clearAndroidCommandPolling()
      pendingAndroidButtonCaptureRef.current = false
    }
  }, [clearAndroidCommandPolling])

  return {
    androidVoiceStatus,
    cancelAndroidCommandPolling,
    isAndroidRuntime,
    startAndroidVoiceInput,
  }
}

function getAndroidVoiceCommandSource(
  command: NativeVoiceCommand,
  wasStartedByButton: boolean,
): VoiceAssistantSource {
  if (command.source === 'ANDROID_PUSH_TO_TALK') {
    return 'android_microphone'
  }

  if (command.source === 'ANDROID_SHORT_CLIP') {
    return 'android_wake_word'
  }

  return wasStartedByButton ? 'android_microphone' : 'android_wake_word'
}
