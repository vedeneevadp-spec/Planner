import {
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
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import { usePlanner, usePlannerApiClient } from '@/features/planner'
import {
  useCreateShoppingListItem,
  useRemoveShoppingListItem,
  useShoppingListSummary,
  useUpdateShoppingListItem,
} from '@/features/shopping-list'

import { notifyAndroidVoiceActionResult } from '../lib/native-voice-assistant'
import {
  PlannerActionExecutor,
  type PlannerActionExecutorDependencies,
} from './planner-action-executor'
import {
  type CreateConfirmationTimingPayload,
  type GetVoiceTimingDuration,
  type MarkVoiceTiming,
  readVoiceMetricNow,
  type TrackVoiceMetric,
} from './useVoiceMetrics'
import {
  appendVoiceTranscript,
  canAppendToVoiceSession,
  createVoiceAppendSession,
  type VoiceAppendSession,
} from './voice-append-session'
import { bucketVoiceMetricConfidence } from './voice-metrics'

const AUTO_CLOSE_DELAY_MS = 2200

type VoiceActionFlowSession =
  | {
      actorUserId?: string | undefined
      appRole?:
        | PlannerIntentParserContext['appRole']
        | VoiceActionContext['appRole']
        | undefined
      workspaceId?: string | undefined
    }
  | null
  | undefined

interface UseVoiceActionFlowInput {
  createConfirmationTimingPayload: CreateConfirmationTimingPayload
  getVoiceTimingDuration: GetVoiceTimingDuration
  isVoiceEnabled: boolean
  markVoiceTiming: MarkVoiceTiming
  maxClarificationAttempts: number
  pendingAppendSessionRef: MutableRefObject<VoiceAppendSession | null>
  session: VoiceActionFlowSession
  trackVoiceMetric: TrackVoiceMetric
}

export function useVoiceActionFlow({
  createConfirmationTimingPayload,
  getVoiceTimingDuration,
  isVoiceEnabled,
  markVoiceTiming,
  maxClarificationAttempts,
  pendingAppendSessionRef,
  session,
  trackVoiceMetric,
}: UseVoiceActionFlowInput) {
  const planner = usePlanner()
  const plannerApi = usePlannerApiClient()
  const createShoppingItemMutation = useCreateShoppingListItem()
  const removeShoppingItemMutation = useRemoveShoppingListItem()
  const updateShoppingItemMutation = useUpdateShoppingListItem()
  const parser = useMemo(() => new PlannerIntentParser(), [])
  const actionExecutorRef = useRef(new PlannerActionExecutor())
  const autoCloseTimerRef = useRef<number | null>(null)
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
  const [appendSession, setAppendSession] = useState<VoiceAppendSession | null>(
    null,
  )
  const shoppingListQuery = useShoppingListSummary({ enabled: isVoiceEnabled })
  const canAppendVoice =
    state.status === 'awaiting_confirmation' &&
    !actionResult &&
    appendSession !== null

  const createCurrentActionDependencies = useCallback(
    () =>
      createActionDependencies({
        createShoppingItem: createShoppingItemMutation.mutateAsync,
        removeShoppingItem: removeShoppingItemMutation.mutateAsync,
        shoppingListQuery,
        updateShoppingItem: (itemId, patch) =>
          updateShoppingItemMutation.mutateAsync({ itemId, patch }),
        planner,
        plannerApi,
      }),
    [
      createShoppingItemMutation.mutateAsync,
      planner,
      plannerApi,
      removeShoppingItemMutation.mutateAsync,
      shoppingListQuery,
      updateShoppingItemMutation,
    ],
  )

  const runActionPreview = useCallback(
    async (
      preview: VoiceActionPreview,
      source?: VoiceAssistantSource,
      confirmedPayload?: VoiceActionConfirmedPayload,
    ) => {
      const metricSource = source ?? 'web_microphone'

      trackVoiceMetric('confirmation_accepted', metricSource, {
        intentType: preview.intent.intent,
        previewStatus: preview.status,
      })
      dispatch({ type: 'confirmed' })

      try {
        const context = createVoiceActionContext(metricSource, session)
        const result = await actionExecutorRef.current.executeAction(
          preview.id,
          confirmedPayload,
          context,
          createCurrentActionDependencies(),
        )

        setActionResult(result)
        void notifyAndroidVoiceActionResult({
          changedData: hasVoiceActionMutatedData(result),
          intent: preview.intent.intent,
          requiresUnlock:
            preview.requiresUnlock || Boolean(preview.intent.requiresUnlock),
          source: metricSource,
          status: result.status,
        })
          .then((successSignalPlayed) => {
            trackVoiceMetric(
              successSignalPlayed
                ? 'audio_signal_success_played'
                : 'audio_signal_suppressed',
              metricSource,
              {
                errorCode: successSignalPlayed
                  ? undefined
                  : 'success_signal_not_played_by_policy',
                intentType: preview.intent.intent,
                resultStatus: result.status,
              },
            )
          })
          .catch((error) => {
            console.warn('Failed to notify Android voice action result.', error)
            trackVoiceMetric('audio_signal_error', metricSource, {
              errorCode: 'android_signal_notification_failed',
              intentType: preview.intent.intent,
              resultStatus: result.status,
            })
          })

        trackVoiceMetric(
          result.status === 'success' ? 'action_executed' : 'action_failed',
          metricSource,
          {
            errorCode: result.errorCode,
            intentType: preview.intent.intent,
            previewStatus: preview.status,
            resultStatus: result.status,
          },
        )

        if (result.status === 'success') {
          dispatch({ type: 'executed' })
          return
        }

        dispatch({
          error: result.visualStatus,
          transcript: preview.intent.rawText,
          type: 'failed',
          source: metricSource,
        })
      } catch (error) {
        trackVoiceMetric('action_failed', metricSource, {
          errorCode: 'voice_action_execution_error',
          intentType: preview.intent.intent,
          previewStatus: preview.status,
        })
        dispatch({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось выполнить голосовую команду.',
          transcript: preview.intent.rawText,
          type: 'failed',
          source: metricSource,
        })
      }
    },
    [createCurrentActionDependencies, session, trackVoiceMetric],
  )

  const prepareIntentPreview = useCallback(
    async (intent: PlannerIntent, source: VoiceAssistantSource) => {
      const actionPreviewStartedAt = readVoiceMetricNow()
      const preview = await actionExecutorRef.current.prepareAction(
        intent,
        createVoiceActionContext(source, session),
        createCurrentActionDependencies(),
      )
      markVoiceTiming('actionPreviewCreatedAt')

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
      trackVoiceMetric('action_preview_created', source, {
        action_preview_duration_ms: getVoiceTimingDuration(
          actionPreviewStartedAt,
          'actionPreviewCreatedAt',
        ),
        intentType: intent.intent,
        previewStatus: preview.status,
      })
      trackVoiceMetric('confirmation_shown', source, {
        ...createConfirmationTimingPayload(source),
        intentType: intent.intent,
        previewStatus: preview.status,
      })

      if (preview.status === 'requires_clarification') {
        trackVoiceMetric('clarification_requested', source, {
          intentType: intent.intent,
          previewStatus: preview.status,
        })
      }

      return preview
    },
    [
      createConfirmationTimingPayload,
      createCurrentActionDependencies,
      getVoiceTimingDuration,
      markVoiceTiming,
      session,
      trackVoiceMetric,
    ],
  )

  const handleTranscript = useCallback(
    async (
      transcript: string,
      source: VoiceAssistantSource,
      backendIntent?: PlannerIntent,
      options: {
        appendSession?: VoiceAppendSession | null | undefined
        resetClarificationAttempts?: boolean
      } = {},
    ) => {
      const appendResult = appendVoiceTranscript({
        addition: transcript,
        nowMs: readVoiceMetricNow(),
        session: options.appendSession ?? null,
      })
      const normalizedTranscript = appendResult.transcript.trim()

      setIsCardVisible(true)
      setActionPreview(null)
      setActionResult(null)
      setSelectedCandidateId(null)
      setIsUndoing(false)

      if (options.resetClarificationAttempts !== false) {
        setClarificationAttempts(0)
      }

      if (!normalizedTranscript) {
        pendingAppendSessionRef.current = null
        dispatch({
          error: 'Команда не распознана.',
          source,
          type: 'failed',
        })
        return
      }

      if (appendResult.appended) {
        setAppendSession(appendResult.session)
        trackVoiceMetric('append_used', source, {
          append_count: appendResult.appendCount,
          append_used: true,
        })
      } else {
        setAppendSession(
          createVoiceAppendSession({
            nowMs: readVoiceMetricNow(),
            source,
            transcript: normalizedTranscript,
          }),
        )
      }
      pendingAppendSessionRef.current = null

      dispatch({
        source,
        transcript: normalizedTranscript,
        type: 'transcript_received',
      })
      trackVoiceMetric('transcript_received', source)
      trackVoiceMetric('voice_session_result', source, {
        voice_session_result: 'success',
      })

      const parserStartedAt = readVoiceMetricNow()
      const intent = appendResult.appended
        ? parser.parse(
            normalizedTranscript,
            createPlannerIntentParserContext(source, planner.spheres, session),
          )
        : (backendIntent ??
          parser.parse(
            normalizedTranscript,
            createPlannerIntentParserContext(source, planner.spheres, session),
          ))
      markVoiceTiming('intentParsedAt')
      trackVoiceMetric('intent_parsed', source, {
        confidenceBucket: bucketVoiceMetricConfidence(intent.confidence),
        intentType: intent.intent,
        parser_duration_ms: getVoiceTimingDuration(
          parserStartedAt,
          'intentParsedAt',
        ),
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
          transcript: normalizedTranscript,
          type: 'failed',
        })
      }
    },
    [
      getVoiceTimingDuration,
      markVoiceTiming,
      parser,
      pendingAppendSessionRef,
      planner.spheres,
      prepareIntentPreview,
      session,
      trackVoiceMetric,
    ],
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
      trackVoiceMetric('transcript_received', source)
      markVoiceTiming('intentParsedAt')
      trackVoiceMetric('intent_parsed', source, {
        confidenceBucket: bucketVoiceMetricConfidence(intent.confidence),
        intentType: intent.intent,
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
    [markVoiceTiming, prepareIntentPreview, trackVoiceMetric],
  )

  const handleClarifyOption = useCallback(
    (transcript: string) => {
      trackVoiceMetric(
        'clarification_requested',
        getStateSource(state) ?? 'web_microphone',
      )
      setClarificationAttempts((current) =>
        Math.min(current + 1, maxClarificationAttempts),
      )
      void handleTranscript(
        transcript,
        getStateSource(state) ?? 'web_microphone',
        undefined,
        { resetClarificationAttempts: false },
      )
    },
    [handleTranscript, maxClarificationAttempts, state, trackVoiceMetric],
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

    const source = getStateSource(state) ?? 'web_microphone'

    trackVoiceMetric('undo_requested', source, {
      resultStatus: actionResult.status,
    })
    setIsUndoing(true)

    try {
      const undoResult = await actionExecutorRef.current.undoAction(
        actionResult,
        createCurrentActionDependencies(),
      )

      setActionResult(normalizeUndoResult(undoResult))
      trackVoiceMetric(
        undoResult.status === 'success' ? 'undo_success' : 'undo_failed',
        source,
        {
          errorCode: undoResult.errorCode,
          resultStatus: undoResult.status,
        },
      )
    } catch {
      setActionResult({
        errorCode: 'voice_action_undo_failed',
        status: 'failed',
        visualStatus: 'Не удалось отменить. Обнови экран.',
      })
      trackVoiceMetric('undo_failed', source, {
        errorCode: 'voice_action_undo_failed',
        resultStatus: 'failed',
      })
    } finally {
      setIsUndoing(false)
    }
  }, [actionResult, createCurrentActionDependencies, state, trackVoiceMetric])

  const handleConfirm = useCallback(
    (
      preview: VoiceActionPreview,
      confirmedPayload?: VoiceActionConfirmedPayload,
    ) => {
      void runActionPreview(preview, getStateSource(state), confirmedPayload)
    },
    [runActionPreview, state],
  )

  const handleEditTranscript = useCallback(
    (transcript: string) => {
      if (actionPreview) {
        trackVoiceMetric(
          'confirmation_edited',
          getStateSource(state) ?? 'web_microphone',
          {
            intentType: actionPreview.intent.intent,
            previewStatus: actionPreview.status,
          },
        )
      }

      void handleTranscript(
        transcript,
        getStateSource(state) ?? 'web_microphone',
      )
    },
    [actionPreview, handleTranscript, state, trackVoiceMetric],
  )

  const prepareVoiceInputSession = useCallback(
    (options: { appendRequested?: boolean } = {}) => {
      const appendSessionForCapture =
        options.appendRequested &&
        canAppendToVoiceSession(appendSession, readVoiceMetricNow())
          ? appendSession
          : null

      pendingAppendSessionRef.current = appendSessionForCapture
      if (!appendSessionForCapture) {
        setAppendSession(null)
      }
    },
    [appendSession, pendingAppendSessionRef],
  )

  const closeActionFlow = useCallback(() => {
    if (actionPreview && !actionResult) {
      trackVoiceMetric(
        'confirmation_cancelled',
        getStateSource(state) ?? 'web_microphone',
        {
          intentType: actionPreview.intent.intent,
          previewStatus: actionPreview.status,
        },
      )
    }

    setIsCardVisible(false)
    setActionPreview(null)
    setActionResult(null)
    setSelectedCandidateId(null)
    setClarificationAttempts(0)
    setIsUndoing(false)
    setAppendSession(null)
    pendingAppendSessionRef.current = null
    dispatch({ type: 'cancelled' })
  }, [
    actionPreview,
    actionResult,
    pendingAppendSessionRef,
    state,
    trackVoiceMetric,
  ])

  useEffect(() => {
    if (!appendSession) {
      return undefined
    }

    const timeoutId = window.setTimeout(
      () => {
        setAppendSession(null)
      },
      Math.max(0, appendSession.expiresAtMs - readVoiceMetricNow()),
    )

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [appendSession])

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

  return {
    actionPreview,
    actionResult,
    appendSession,
    canAppendVoice,
    clarificationAttempts,
    closeActionFlow,
    dispatch,
    handleClarifyOption,
    handleConfirm,
    handleCreateFromNotFound,
    handleEditTranscript,
    handleSaveClarificationToInbox,
    handleTranscript,
    handleUndo,
    isCardVisible,
    isUndoing,
    plannerSpheres: planner.spheres,
    prepareVoiceInputSession,
    selectedCandidateId,
    setActionPreview,
    setActionResult,
    setAppendSession,
    setIsCardVisible,
    setIsUndoing,
    setSelectedCandidateId,
    state,
  }
}

function createPlannerIntentParserContext(
  source: VoiceAssistantSource,
  spheres: Array<{ id: string; name: string }>,
  session: VoiceActionFlowSession,
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
  shoppingListQuery: ReturnType<typeof useShoppingListSummary>
  updateShoppingItem: NonNullable<
    PlannerActionExecutorDependencies['updateShoppingItem']
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
    listShoppingItems: async () => {
      const currentItems = input.shoppingListQuery.data ?? []
      const result = await input.shoppingListQuery.refetch()

      if (result.error && !result.data && currentItems.length === 0) {
        throw result.error
      }

      return result.data ?? currentItems
    },
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
    updateShoppingItem: input.updateShoppingItem,
  }
}

function createVoiceActionContext(
  source: VoiceAssistantSource,
  session: VoiceActionFlowSession,
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
