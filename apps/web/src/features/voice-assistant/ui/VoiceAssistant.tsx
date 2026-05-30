import {
  canUseVoiceAssistant,
  initialVoiceAssistantState,
  type PlannerIntent,
  PlannerIntentParser,
  type PlannerIntentParserContext,
  reduceVoiceAssistantState,
  type VoiceActionConfirmedPayload,
  type VoiceActionContext,
  type VoiceActionPreview,
  type VoiceActionResult,
  type VoiceActionSource,
  type VoiceAssistantSource,
  type VoiceAssistantState,
} from '@planner/contracts'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import { usePlanner, usePlannerApiClient } from '@/features/planner'
import { useSessionFeatureReadiness } from '@/features/session'
import {
  useCreateShoppingListItem,
  useRemoveShoppingListItem,
} from '@/features/shopping-list'
import { cx } from '@/shared/lib/classnames'
import { recordClientEvent } from '@/shared/lib/observability'
import { MicIcon } from '@/shared/ui/Icon'

import {
  addAndroidVoiceAssistantResumeListener,
  addVoiceAssistantSettingsChangedListener,
  captureAndroidVoiceCommand,
  consumePendingAndroidVoiceCommand,
  getVoiceAssistantNativeStatus,
  isAndroidVoiceAssistantRuntime,
  type NativeVoiceCommand,
  notifyAndroidVoiceActionResult,
  startAndroidVoiceAssistant,
  stopAndroidVoiceAssistant,
  type VoiceAssistantNativeStatus,
} from '../lib/native-voice-assistant'
import {
  uploadWebVoiceCommand,
  WebVoiceCommandApiError,
} from '../lib/web-voice-command-api'
import {
  startWebVoiceRecorder,
  type WebVoiceRecorder,
} from '../lib/web-voice-recorder'
import {
  PlannerActionExecutor,
  type PlannerActionExecutorDependencies,
} from '../model/planner-action-executor'
import {
  getWebVoiceInputLabel,
  getWebVoiceSupport,
  normalizeWebVoicePermissionError,
  validateWebVoiceRecording,
  WEB_VOICE_SOURCE,
  type WebVoiceInputState,
} from '../model/web-voice-input'
import styles from './VoiceAssistant.module.css'
import {
  MAX_CLARIFICATION_ATTEMPTS,
  VoiceConfirmationCard,
} from './VoiceConfirmationCard'

const AUTO_CLOSE_DELAY_MS = 2200
const WEB_RECORDING_MAX_DURATION_MS = 8_000

const WEB_PROCESSING_STATES = new Set<WebVoiceInputState>([
  'requesting_permission',
  'validating_audio',
  'uploading',
  'recognizing',
  'parsing',
])

export function VoiceAssistant() {
  const planner = usePlanner()
  const plannerApi = usePlannerApiClient()
  const { apiConfig, session } = useSessionFeatureReadiness()
  const createShoppingItemMutation = useCreateShoppingListItem()
  const removeShoppingItemMutation = useRemoveShoppingListItem()
  const parser = useMemo(() => new PlannerIntentParser(), [])
  const actionExecutorRef = useRef(new PlannerActionExecutor())
  const [state, dispatch] = useReducer(
    reduceVoiceAssistantState,
    initialVoiceAssistantState,
  )
  const [isCardVisible, setIsCardVisible] = useState(false)
  const [actionPreview, setActionPreview] = useState<VoiceActionPreview | null>(
    null,
  )
  const [actionResult, setActionResult] = useState<VoiceActionResult | null>(
    null,
  )
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  )
  const [clarificationAttempts, setClarificationAttempts] = useState(0)
  const [isUndoing, setIsUndoing] = useState(false)
  const handledNativeCommandIdsRef = useRef<Set<string>>(new Set())
  const pendingAndroidButtonCaptureRef = useRef(false)
  const autoCloseTimerRef = useRef<number | null>(null)
  const webRecorderRef = useRef<WebVoiceRecorder | null>(null)
  const webRecordingTimerRef = useRef<number | null>(null)
  const webUploadAbortControllerRef = useRef<AbortController | null>(null)
  const webExplicitUserActionRef = useRef(false)
  const webOperationIdRef = useRef(0)
  const [androidSettingsRevision, setAndroidSettingsRevision] = useState(0)
  const [androidVoiceStatus, setAndroidVoiceStatus] =
    useState<VoiceAssistantNativeStatus | null>(null)
  const [webVoiceState, setWebVoiceState] = useState<WebVoiceInputState>('idle')
  const [webVoiceMessage, setWebVoiceMessage] = useState<string | null>(null)
  const isVoiceEnabled =
    canUseVoiceAssistant(session?.appRole) &&
    (session?.userPreferences.voiceAssistantEnabled ?? true)
  const isAndroidRuntime = isAndroidVoiceAssistantRuntime()
  const isWebListening = !isAndroidRuntime && webVoiceState === 'listening'
  const isWebProcessing = WEB_PROCESSING_STATES.has(webVoiceState)
  const isBusy =
    state.status === 'executing' ||
    isWebProcessing ||
    (isAndroidRuntime && state.status === 'recording')

  const runActionPreview = useCallback(
    async (
      preview: VoiceActionPreview,
      source?: VoiceAssistantSource,
      confirmedPayload?: VoiceActionConfirmedPayload,
    ) => {
      dispatch({ type: 'confirmed' })

      try {
        const context = createVoiceActionContext(
          source ?? 'web_microphone',
          session,
        )
        const result = await actionExecutorRef.current.executeAction(
          preview.id,
          confirmedPayload,
          context,
          createActionDependencies({
            createShoppingItem: createShoppingItemMutation.mutateAsync,
            removeShoppingItem: removeShoppingItemMutation.mutateAsync,
            planner,
            plannerApi,
          }),
        )

        setActionResult(result)
        void notifyAndroidVoiceActionResult({
          changedData: hasVoiceActionMutatedData(result),
          intent: preview.intent.intent,
          requiresUnlock:
            preview.requiresUnlock || Boolean(preview.intent.requiresUnlock),
          source: source ?? 'web_microphone',
          status: result.status,
        }).catch((error) => {
          console.warn('Failed to notify Android voice action result.', error)
        })

        if (result.status === 'success') {
          dispatch({ type: 'executed' })
          return
        }

        dispatch({
          error: result.visualStatus,
          transcript: preview.intent.rawText,
          type: 'failed',
          ...(source ? { source } : {}),
        })
      } catch (error) {
        dispatch({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось выполнить голосовую команду.',
          transcript: preview.intent.rawText,
          type: 'failed',
          ...(source ? { source } : {}),
        })
      }
    },
    [
      createShoppingItemMutation.mutateAsync,
      planner,
      plannerApi,
      removeShoppingItemMutation.mutateAsync,
      session,
    ],
  )

  const prepareIntentPreview = useCallback(
    async (intent: PlannerIntent, source: VoiceAssistantSource) => {
      const preview = await actionExecutorRef.current.prepareAction(
        intent,
        createVoiceActionContext(source, session),
        createActionDependencies({
          createShoppingItem: createShoppingItemMutation.mutateAsync,
          removeShoppingItem: removeShoppingItemMutation.mutateAsync,
          planner,
          plannerApi,
        }),
      )

      setActionPreview(preview)
      setSelectedCandidateId(
        preview.status === 'multiple_candidates'
          ? null
          : (preview.candidates?.[0]?.taskId ?? null),
      )
      dispatch({
        intent,
        type: 'intent_parsed',
      })

      return preview
    },
    [
      createShoppingItemMutation.mutateAsync,
      planner,
      plannerApi,
      removeShoppingItemMutation.mutateAsync,
      session,
    ],
  )

  const handleTranscript = useCallback(
    async (
      transcript: string,
      source: VoiceAssistantSource,
      backendIntent?: PlannerIntent,
      options: { resetClarificationAttempts?: boolean } = {},
    ) => {
      const normalizedTranscript = transcript.trim()

      setIsCardVisible(true)
      setActionPreview(null)
      setActionResult(null)
      setSelectedCandidateId(null)
      setIsUndoing(false)

      if (options.resetClarificationAttempts !== false) {
        setClarificationAttempts(0)
      }

      if (!normalizedTranscript) {
        dispatch({
          error: 'Команда не распознана.',
          source,
          type: 'failed',
        })
        return
      }

      dispatch({
        source,
        transcript: normalizedTranscript,
        type: 'transcript_received',
      })

      const intent =
        backendIntent ??
        parser.parse(
          normalizedTranscript,
          createPlannerIntentParserContext(source, planner.spheres, session),
        )

      try {
        await prepareIntentPreview(intent, source)
      } catch (error) {
        dispatch({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось подготовить голосовое действие.',
          source,
          transcript: normalizedTranscript,
          type: 'failed',
        })
      }
    },
    [parser, planner, prepareIntentPreview, session],
  )

  const prepareFollowUpIntent = useCallback(
    async (
      intent: PlannerIntent,
      transcript: string,
      source: VoiceAssistantSource,
    ) => {
      setIsCardVisible(true)
      setActionPreview(null)
      setActionResult(null)
      setSelectedCandidateId(null)
      setIsUndoing(false)
      dispatch({
        source,
        transcript,
        type: 'transcript_received',
      })

      try {
        await prepareIntentPreview(intent, source)
      } catch (error) {
        dispatch({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось подготовить голосовое действие.',
          source,
          transcript,
          type: 'failed',
        })
      }
    },
    [prepareIntentPreview],
  )

  const handleClarifyOption = useCallback(
    (transcript: string) => {
      setClarificationAttempts((current) =>
        Math.min(current + 1, MAX_CLARIFICATION_ATTEMPTS),
      )
      void handleTranscript(
        transcript,
        getStateSource(state) ?? 'web_microphone',
        undefined,
        { resetClarificationAttempts: false },
      )
    },
    [handleTranscript, state],
  )

  const handleCreateFromNotFound = useCallback(
    (preview: VoiceActionPreview) => {
      const intent = createTaskIntentFromNotFoundPreview(preview)

      void prepareFollowUpIntent(
        intent,
        intent.rawText,
        getStateSource(state) ?? 'web_microphone',
      )
    },
    [prepareFollowUpIntent, state],
  )

  const handleSaveClarificationToInbox = useCallback(
    (preview: VoiceActionPreview) => {
      const intent = createInboxTaskIntentFromPreview(preview)

      void prepareFollowUpIntent(
        intent,
        intent.rawText,
        getStateSource(state) ?? 'web_microphone',
      )
    },
    [prepareFollowUpIntent, state],
  )

  const handleUndo = useCallback(async () => {
    if (!actionResult) {
      return
    }

    setIsUndoing(true)

    try {
      const undoResult = await actionExecutorRef.current.undoAction(
        actionResult,
        createActionDependencies({
          createShoppingItem: createShoppingItemMutation.mutateAsync,
          removeShoppingItem: removeShoppingItemMutation.mutateAsync,
          planner,
          plannerApi,
        }),
      )

      setActionResult(normalizeUndoResult(undoResult))
    } catch {
      setActionResult({
        errorCode: 'voice_action_undo_failed',
        status: 'failed',
        visualStatus: 'Не удалось отменить. Обнови экран.',
      })
    } finally {
      setIsUndoing(false)
    }
  }, [
    actionResult,
    createShoppingItemMutation.mutateAsync,
    planner,
    plannerApi,
    removeShoppingItemMutation.mutateAsync,
  ])

  const consumePendingAndroidCommand = useCallback(async () => {
    try {
      const command = await consumePendingAndroidVoiceCommand()

      if (!command || handledNativeCommandIdsRef.current.has(command.id)) {
        return
      }

      const source = getAndroidVoiceCommandSource(
        command,
        pendingAndroidButtonCaptureRef.current,
      )

      pendingAndroidButtonCaptureRef.current = false
      handledNativeCommandIdsRef.current.add(command.id)

      if (command.errorMessage) {
        setIsCardVisible(true)
        dispatch({
          error: command.errorMessage,
          source,
          type: 'failed',
        })
        return
      }

      if (!command.transcript) {
        return
      }

      void handleTranscript(
        command.transcript,
        source,
        command.intent ?? undefined,
      )
    } catch (error) {
      console.warn('Failed to consume Android voice command.', error)
    }
  }, [handleTranscript])

  useEffect(() => {
    if (!isAndroidVoiceAssistantRuntime()) {
      setAndroidVoiceStatus(null)
      return undefined
    }

    let isDisposed = false

    void getVoiceAssistantNativeStatus()
      .then((status) => {
        if (!isDisposed) {
          setAndroidVoiceStatus(status)
        }
      })
      .catch((error) => {
        console.warn('Failed to read Android voice assistant status.', error)
      })

    return () => {
      isDisposed = true
    }
  }, [androidSettingsRevision])

  useEffect(() => {
    return addVoiceAssistantSettingsChangedListener(() => {
      setAndroidSettingsRevision((revision) => revision + 1)
    })
  }, [])

  useEffect(() => {
    if (!isAndroidVoiceAssistantRuntime()) {
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
      wakeWordTrainingModeEnabled:
        session?.workspaceSettings.wakeWordTrainingModeEnabled ?? false,
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
    apiConfig,
    androidVoiceStatus?.backgroundWakeWordEnabled,
    androidVoiceStatus?.wakeWordEnabled,
    androidVoiceStatus?.wakeWordModelStatus,
    consumePendingAndroidCommand,
    isVoiceEnabled,
    session?.workspaceSettings.wakeWordTrainingModeEnabled,
  ])

  useEffect(() => {
    if (state.status !== 'completed') {
      return undefined
    }

    if (actionResult?.status === 'success' && actionResult.undo) {
      return undefined
    }

    autoCloseTimerRef.current = window.setTimeout(() => {
      setIsCardVisible(false)
      dispatch({ type: 'cancelled' })
    }, AUTO_CLOSE_DELAY_MS)

    return () => {
      if (autoCloseTimerRef.current !== null) {
        window.clearTimeout(autoCloseTimerRef.current)
        autoCloseTimerRef.current = null
      }
    }
  }, [actionResult, state])

  useEffect(() => {
    return () => {
      webOperationIdRef.current += 1

      if (webRecordingTimerRef.current !== null) {
        window.clearTimeout(webRecordingTimerRef.current)
        webRecordingTimerRef.current = null
      }

      webRecorderRef.current?.cancel()
      webRecorderRef.current = null
      webUploadAbortControllerRef.current?.abort()
      webUploadAbortControllerRef.current = null
    }
  }, [])

  async function startVoiceInput() {
    if (!isVoiceEnabled) {
      return
    }

    if (isWebListening) {
      await stopWebVoiceRecording()
      return
    }

    if (isAndroidVoiceAssistantRuntime()) {
      await startAndroidVoiceInput()
      return
    }

    await startWebVoiceInput()
  }

  async function startAndroidVoiceInput() {
    setWebVoiceState('idle')
    setWebVoiceMessage(null)
    setIsCardVisible(true)
    pendingAndroidButtonCaptureRef.current = true

    dispatch({
      source: 'android_microphone',
      type: 'recording_started',
    })

    try {
      if (!apiConfig) {
        throw new Error('Backend STT недоступен без активной сессии.')
      }

      await captureAndroidVoiceCommand(apiConfig)
      window.setTimeout(() => {
        void consumePendingAndroidCommand()
      }, 650)
    } catch (error) {
      pendingAndroidButtonCaptureRef.current = false
      dispatch({
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось запустить голосовой ввод.',
        source: 'android_microphone',
        type: 'failed',
      })
    }
  }

  async function startWebVoiceInput() {
    setIsCardVisible(true)
    setActionPreview(null)
    setActionResult(null)
    setSelectedCandidateId(null)
    setIsUndoing(false)
    setWebVoiceMessage(null)
    webExplicitUserActionRef.current = true
    const operationId = webOperationIdRef.current + 1

    webOperationIdRef.current = operationId
    recordClientEvent('web_voice_started', {
      source: WEB_VOICE_SOURCE,
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
        void stopWebVoiceRecording(operationId)
      }, WEB_RECORDING_MAX_DURATION_MS)
    } catch (error) {
      const voiceError = normalizeWebVoicePermissionError(error)

      setWebVoiceState(voiceError.state)
      setWebVoiceMessage(voiceError.message)

      if (voiceError.state === 'permission_denied') {
        recordClientEvent(
          'web_voice_permission_denied',
          {
            errorName: voiceError.name,
          },
          { level: 'warn' },
        )
      }

      dispatch({
        error: voiceError.message,
        source: 'web_microphone',
        type: 'failed',
      })
    }
  }

  async function stopWebVoiceRecording(
    operationId = webOperationIdRef.current,
  ) {
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
      recordClientEvent('web_voice_upload_started', {
        byteLength: recording.byteLength,
        durationMs: recording.durationMs,
        source: WEB_VOICE_SOURCE,
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
      setWebVoiceState('parsing')
      setWebVoiceMessage(getWebVoiceInputLabel('parsing'))
      await handleTranscript(
        response.transcript,
        'web_microphone',
        response.intent,
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
      }
      recordClientEvent(
        'web_voice_upload_error',
        {
          code:
            error instanceof WebVoiceCommandApiError ? error.code : errorName,
          source: WEB_VOICE_SOURCE,
          status:
            error instanceof WebVoiceCommandApiError ? error.status : undefined,
        },
        { level: 'error' },
      )
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
  }

  function closeCard() {
    cancelWebVoiceOperation()
    setIsCardVisible(false)
    setActionPreview(null)
    setActionResult(null)
    setSelectedCandidateId(null)
    setClarificationAttempts(0)
    setIsUndoing(false)
    dispatch({ type: 'cancelled' })
  }

  function cancelWebVoiceOperation() {
    if (isCancellableWebVoiceState(webVoiceState)) {
      recordClientEvent('web_voice_recording_cancelled', {
        source: WEB_VOICE_SOURCE,
        state: webVoiceState,
      })
    }

    webOperationIdRef.current += 1
    clearWebRecordingTimer()
    webRecorderRef.current?.cancel()
    webRecorderRef.current = null
    webUploadAbortControllerRef.current?.abort()
    webUploadAbortControllerRef.current = null
    webExplicitUserActionRef.current = false
    setWebVoiceState('idle')
    setWebVoiceMessage(null)
  }

  function clearWebRecordingTimer() {
    if (webRecordingTimerRef.current !== null) {
      window.clearTimeout(webRecordingTimerRef.current)
      webRecordingTimerRef.current = null
    }
  }

  function isCurrentWebOperation(operationId: number): boolean {
    return webOperationIdRef.current === operationId
  }

  if (!isVoiceEnabled) {
    return null
  }

  return (
    <>
      <button
        className={cx(styles.micButton, isBusy && styles.micButtonBusy)}
        type="button"
        aria-label={getMicButtonLabel(isWebListening, isBusy)}
        title={getMicButtonLabel(isWebListening, isBusy)}
        disabled={isBusy && !isWebListening}
        onClick={() => {
          void startVoiceInput()
        }}
      >
        <MicIcon size={19} strokeWidth={2.1} />
      </button>

      {isCardVisible ? (
        <VoiceConfirmationCard
          clarificationAttempts={clarificationAttempts}
          isUndoing={isUndoing}
          preview={actionPreview}
          result={actionResult}
          selectedCandidateId={selectedCandidateId}
          spheres={planner.spheres}
          state={state}
          webInputState={webVoiceState}
          webStatusMessage={webVoiceMessage}
          onCancelRecording={closeCard}
          onClarifyOption={handleClarifyOption}
          onClose={closeCard}
          onConfirm={(preview, confirmedPayload) => {
            void runActionPreview(
              preview,
              getStateSource(state),
              confirmedPayload,
            )
          }}
          onCreateFromNotFound={handleCreateFromNotFound}
          onEditTranscript={(transcript) => {
            void handleTranscript(
              transcript,
              getStateSource(state) ?? 'web_microphone',
            )
          }}
          onManualInput={closeCard}
          onRepeat={() => {
            void startVoiceInput()
          }}
          onStopRecording={() => {
            void stopWebVoiceRecording()
          }}
          onSaveClarificationToInbox={handleSaveClarificationToInbox}
          onSelectCandidate={setSelectedCandidateId}
          onUndo={() => {
            void handleUndo()
          }}
        />
      ) : null}
    </>
  )
}

function createPlannerIntentParserContext(
  source: VoiceAssistantSource,
  spheres: Array<{ id: string; name: string }>,
  session:
    | { appRole?: PlannerIntentParserContext['appRole'] | undefined }
    | null
    | undefined,
): PlannerIntentParserContext {
  return {
    appRole: session?.appRole,
    locale: 'ru-RU',
    now: new Date(),
    source: getPlannerIntentParserSource(source),
    spheres: spheres.map((sphere) => ({
      id: sphere.id,
      name: sphere.name,
    })),
    timezone: resolveVoiceClientTimeZone(),
  }
}

function createTaskIntentFromNotFoundPreview(
  preview: VoiceActionPreview,
): PlannerIntent {
  const sourceIntent = preview.intent
  const title = normalizeFollowUpTaskTitle(
    sourceIntent.targetQuery ?? sourceIntent.transcript ?? sourceIntent.rawText,
  )

  return {
    confidence: Math.min(sourceIntent.confidence, 0.82),
    intent: 'create_task',
    needsConfirmation: true,
    rawText: `создать задачу ${title}`,
    title,
    ...(sourceIntent.date ? { date: sourceIntent.date } : {}),
    ...(sourceIntent.datePrecision
      ? { datePrecision: sourceIntent.datePrecision }
      : {}),
    ...(sourceIntent.dateText ? { dateText: sourceIntent.dateText } : {}),
    ...(sourceIntent.priority ? { priority: sourceIntent.priority } : {}),
    ...(sourceIntent.sphereId ? { sphereId: sourceIntent.sphereId } : {}),
    ...(sourceIntent.time ? { time: sourceIntent.time } : {}),
  }
}

function createInboxTaskIntentFromPreview(
  preview: VoiceActionPreview,
): PlannerIntent {
  const sourceIntent = preview.intent
  const title = normalizeFollowUpTaskTitle(
    sourceIntent.transcript ?? sourceIntent.rawText,
  )

  return {
    confidence: Math.min(sourceIntent.confidence, 0.7),
    intent: 'create_task',
    needsConfirmation: true,
    rawText: `создать задачу ${title}`,
    title,
  }
}

function normalizeFollowUpTaskTitle(value: string): string {
  const title = value.trim()

  return title || 'Новая задача'
}

function createActionDependencies(input: {
  createShoppingItem: PlannerActionExecutorDependencies['createShoppingItem']
  planner: ReturnType<typeof usePlanner>
  plannerApi: ReturnType<typeof usePlannerApiClient>
  removeShoppingItem: NonNullable<
    PlannerActionExecutorDependencies['removeShoppingItem']
  >
}): PlannerActionExecutorDependencies {
  const plannerApi = input.plannerApi

  return {
    createShoppingItem: input.createShoppingItem,
    createTask: (taskInput) => input.planner.addTask(taskInput),
    getCachedTasks: () =>
      input.planner.tasks.map((task) => ({
        id: task.id,
        plannedEndTime: task.plannedEndTime,
        plannedDate: task.plannedDate,
        plannedStartTime: task.plannedStartTime,
        status: task.status,
        title: task.title,
      })),
    isOnline: () =>
      typeof navigator === 'undefined' ? true : navigator.onLine,
    refreshPlanner: input.planner.refresh,
    removeShoppingItem: input.removeShoppingItem,
    removeTask: (taskId) => input.planner.removeTask(taskId),
    taskClient: plannerApi
      ? {
          listTasks: (filters) => plannerApi.listTasks(filters),
          setTaskSchedule: (taskId, scheduleInput) =>
            plannerApi.setTaskSchedule(taskId, scheduleInput),
        }
      : null,
  }
}

function createVoiceActionContext(
  source: VoiceAssistantSource,
  session:
    | {
        actorUserId?: string | undefined
        appRole?: VoiceActionContext['appRole'] | undefined
        workspaceId?: string | undefined
      }
    | null
    | undefined,
): VoiceActionContext {
  if (!session?.actorUserId || !session.workspaceId) {
    throw new Error('Planner session is required for voice actions.')
  }

  return {
    appRole: session.appRole ?? 'guest',
    isDeviceLocked: false,
    now: new Date().toISOString(),
    source: getVoiceActionSource(source),
    timezone: resolveVoiceClientTimeZone() ?? 'Europe/Moscow',
    userId: session.actorUserId,
    workspaceId: session.workspaceId,
  }
}

function getVoiceActionSource(source: VoiceAssistantSource): VoiceActionSource {
  switch (source) {
    case 'android_wake_word':
      return 'android_wake_word'
    case 'android_microphone':
      return 'android_push_to_talk'
    case 'web_microphone':
      return 'web_push_to_talk'
  }
}

function getPlannerIntentParserSource(
  source: VoiceAssistantSource,
): PlannerIntentParserContext['source'] {
  switch (source) {
    case 'android_wake_word':
      return 'android_wake_word'
    case 'android_microphone':
      return 'android_push_to_talk'
    case 'web_microphone':
      return 'web_push_to_talk'
  }
}

function resolveVoiceClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

function hasVoiceActionMutatedData(result: VoiceActionResult): boolean {
  return Boolean(
    result.changedData ||
    result.createdTaskId ||
    result.updatedTaskId ||
    result.createdShoppingItemIds?.length,
  )
}

function normalizeUndoResult(result: VoiceActionResult): VoiceActionResult {
  if (result.status === 'success') {
    return result
  }

  return {
    ...result,
    visualStatus: 'Не удалось отменить. Обнови экран.',
  }
}

function getStateSource(
  state: VoiceAssistantState,
): VoiceAssistantSource | undefined {
  return 'source' in state ? state.source : undefined
}

function getMicButtonLabel(isWebListening: boolean, isBusy: boolean): string {
  if (isWebListening) {
    return 'Завершить запись'
  }

  return isBusy ? 'Идет распознавание' : 'Голосовой ввод'
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
