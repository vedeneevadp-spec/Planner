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
import { MicIcon } from '@/shared/ui/Icon'

import {
  addAndroidVoiceAssistantResumeListener,
  captureAndroidVoiceCommand,
  consumePendingAndroidVoiceCommand,
  isAndroidVoiceAssistantRuntime,
  type NativeVoiceCommand,
  notifyAndroidVoiceActionResult,
  startAndroidVoiceAssistant,
  stopAndroidVoiceAssistant,
} from '../lib/native-voice-assistant'
import {
  captureWebSpeechTranscript,
  isWebSpeechRecognitionSupported,
} from '../lib/web-speech-recognition'
import {
  PlannerActionExecutor,
  type PlannerActionExecutorDependencies,
} from '../model/planner-action-executor'
import styles from './VoiceAssistant.module.css'
import {
  MAX_CLARIFICATION_ATTEMPTS,
  VoiceConfirmationCard,
} from './VoiceConfirmationCard'

const AUTO_CLOSE_DELAY_MS = 2200

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
  const isVoiceEnabled = canUseVoiceAssistant(session?.appRole)
  const isBusy = state.status === 'recording' || state.status === 'executing'

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

      setActionResult(undoResult)
    } catch (error) {
      setActionResult({
        errorCode: 'voice_action_undo_failed',
        status: 'failed',
        visualStatus:
          error instanceof Error
            ? error.message
            : 'Не удалось отменить действие.',
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

  async function startVoiceInput() {
    if (!isVoiceEnabled) {
      return
    }

    if (isAndroidVoiceAssistantRuntime()) {
      await startAndroidVoiceInput()
      return
    }

    await startWebVoiceInput()
  }

  async function startAndroidVoiceInput() {
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

    if (!isWebSpeechRecognitionSupported()) {
      dispatch({
        error: 'Браузер не поддерживает голосовой ввод.',
        source: 'web_microphone',
        type: 'failed',
      })
      return
    }

    dispatch({
      source: 'web_microphone',
      type: 'recording_started',
    })

    try {
      const transcript = await captureWebSpeechTranscript()
      void handleTranscript(transcript, 'web_microphone')
    } catch (error) {
      dispatch({
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось распознать команду.',
        source: 'web_microphone',
        type: 'failed',
      })
    }
  }

  function closeCard() {
    setIsCardVisible(false)
    setActionPreview(null)
    setActionResult(null)
    setSelectedCandidateId(null)
    setClarificationAttempts(0)
    setIsUndoing(false)
    dispatch({ type: 'cancelled' })
  }

  if (!isVoiceEnabled) {
    return null
  }

  return (
    <>
      <button
        className={cx(styles.micButton, isBusy && styles.micButtonBusy)}
        type="button"
        aria-label={isBusy ? 'Идет распознавание' : 'Голосовой ввод'}
        title={isBusy ? 'Идет распознавание' : 'Голосовой ввод'}
        disabled={isBusy}
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
          onRepeat={() => {
            void startVoiceInput()
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

function getStateSource(
  state: VoiceAssistantState,
): VoiceAssistantSource | undefined {
  return 'source' in state ? state.source : undefined
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
