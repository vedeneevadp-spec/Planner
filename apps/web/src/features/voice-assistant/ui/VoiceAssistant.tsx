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
import { useCreateShoppingListItem } from '@/features/shopping-list'
import { cx } from '@/shared/lib/classnames'
import { CheckIcon, CloseIcon, MicIcon } from '@/shared/ui/Icon'

import {
  addAndroidVoiceAssistantResumeListener,
  captureAndroidVoiceCommand,
  consumePendingAndroidVoiceCommand,
  isAndroidVoiceAssistantRuntime,
  type NativeVoiceCommand,
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
import {
  getPlannerIntentActionLabel,
  getShoppingItemText,
} from '../model/planner-intent-execution'
import styles from './VoiceAssistant.module.css'

const AUTO_CLOSE_DELAY_MS = 2200

export function VoiceAssistant() {
  const planner = usePlanner()
  const plannerApi = usePlannerApiClient()
  const { apiConfig, session } = useSessionFeatureReadiness()
  const createShoppingItemMutation = useCreateShoppingListItem()
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
            planner,
            plannerApi,
          }),
        )

        setActionResult(result)

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
    [createShoppingItemMutation.mutateAsync, planner, plannerApi, session],
  )

  const handleTranscript = useCallback(
    async (
      transcript: string,
      source: VoiceAssistantSource,
      backendIntent?: PlannerIntent,
    ) => {
      const normalizedTranscript = transcript.trim()

      setIsCardVisible(true)
      setActionPreview(null)
      setActionResult(null)
      setSelectedCandidateId(null)

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
        const preview = await actionExecutorRef.current.prepareAction(
          intent,
          createVoiceActionContext(source, session),
          createActionDependencies({
            createShoppingItem: createShoppingItemMutation.mutateAsync,
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
      createShoppingItemMutation.mutateAsync,
      parser,
      planner,
      plannerApi,
      session,
    ],
  )

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
  }, [state])

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
        <VoiceAssistantCard
          preview={actionPreview}
          result={actionResult}
          selectedCandidateId={selectedCandidateId}
          state={state}
          onClose={closeCard}
          onConfirm={(preview, confirmedPayload) => {
            void runActionPreview(
              preview,
              getStateSource(state),
              confirmedPayload,
            )
          }}
          onEditTranscript={(transcript) => {
            void handleTranscript(
              transcript,
              getStateSource(state) ?? 'web_microphone',
            )
          }}
          onSelectCandidate={setSelectedCandidateId}
        />
      ) : null}
    </>
  )
}

interface VoiceAssistantCardProps {
  preview: VoiceActionPreview | null
  result: VoiceActionResult | null
  selectedCandidateId: string | null
  state: VoiceAssistantState
  onClose: () => void
  onConfirm: (
    preview: VoiceActionPreview,
    confirmedPayload?: VoiceActionConfirmedPayload,
  ) => void
  onEditTranscript: (transcript: string) => void
  onSelectCandidate: (taskId: string) => void
}

function VoiceAssistantCard({
  preview,
  result,
  selectedCandidateId,
  state,
  onClose,
  onConfirm,
  onEditTranscript,
  onSelectCandidate,
}: VoiceAssistantCardProps) {
  const transcript = 'transcript' in state ? state.transcript : ''
  const [editState, setEditState] = useState<{
    transcript: string
    value: string
  } | null>(null)
  const isEditingTranscript = editState !== null
  const editedTranscript = editState?.value ?? ''
  const intent =
    state.status === 'awaiting_confirmation' ||
    state.status === 'executing' ||
    state.status === 'completed'
      ? state.intent
      : null
  const canEdit =
    Boolean(transcript) &&
    (state.status === 'awaiting_confirmation' || state.status === 'error')
  const selectedCandidate = preview?.candidates?.find(
    (candidate) => candidate.taskId === selectedCandidateId,
  )
  const canConfirm =
    state.status === 'awaiting_confirmation' &&
    preview !== null &&
    preview.needsConfirmation &&
    ((preview.status === 'ready_for_confirmation' && preview.canExecute) ||
      (preview.status === 'multiple_candidates' &&
        selectedCandidate !== undefined))
  const statusLabel = getStatusLabel(state.status)

  return (
    <section
      className={styles.card}
      role="dialog"
      aria-live="polite"
      aria-label="Голосовая команда"
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleBlock}>
          <span className={styles.statusPill}>{statusLabel}</span>
          <h2>Голосовая команда</h2>
        </div>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <CloseIcon size={17} strokeWidth={2.15} />
        </button>
      </div>

      {state.status === 'error' ? (
        <p className={styles.errorMessage}>{state.error}</p>
      ) : null}

      {isEditingTranscript ? (
        <form
          className={styles.editForm}
          onSubmit={(event) => {
            event.preventDefault()
            setEditState(null)
            onEditTranscript(editedTranscript)
          }}
        >
          <textarea
            className={styles.editTextarea}
            value={editedTranscript}
            rows={3}
            autoFocus
            onChange={(event) =>
              setEditState((current) => ({
                transcript: current?.transcript ?? transcript ?? '',
                value: event.currentTarget.value,
              }))
            }
          />
          <div className={styles.inlineActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setEditState(null)}
            >
              Отмена
            </button>
            <button className={styles.primaryButton} type="submit">
              <span>Применить</span>
            </button>
          </div>
        </form>
      ) : transcript ? (
        <p className={styles.transcript}>{transcript}</p>
      ) : null}

      {intent ? (
        <dl className={styles.intentGrid}>
          <div>
            <dt>Действие</dt>
            <dd>{getPlannerIntentActionLabel(intent)}</dd>
          </div>
          {intent.title ? (
            <div>
              <dt>Название</dt>
              <dd>{intent.title}</dd>
            </div>
          ) : null}
          {intent.items?.length ? (
            <div>
              <dt>Покупки</dt>
              <dd>{intent.items.map(getShoppingItemText).join(', ')}</dd>
            </div>
          ) : null}
          {intent.targetQuery ? (
            <div>
              <dt>Что перенести</dt>
              <dd>{intent.targetQuery}</dd>
            </div>
          ) : null}
          {intent.date ? (
            <div>
              <dt>Дата</dt>
              <dd>{intent.date}</dd>
            </div>
          ) : null}
          {intent.time ? (
            <div>
              <dt>Время</dt>
              <dd>{intent.time}</dd>
            </div>
          ) : null}
          {intent.reminderAt ? (
            <div>
              <dt>Напоминание</dt>
              <dd>{intent.reminderAt}</dd>
            </div>
          ) : null}
          {intent.requiresUnlock ? (
            <div>
              <dt>Доступ</dt>
              <dd>Нужна разблокировка</dd>
            </div>
          ) : null}
          <div>
            <dt>Уверенность</dt>
            <dd>{Math.round(intent.confidence * 100)}%</dd>
          </div>
        </dl>
      ) : null}

      {preview ? (
        <div className={styles.previewBlock}>
          <p className={styles.previewSummary}>{preview.summary}</p>
          {preview.reason && preview.reason !== preview.summary ? (
            <p className={styles.previewReason}>{preview.reason}</p>
          ) : null}
          {preview.agendaItems?.length ? (
            <ul className={styles.agendaList}>
              {preview.agendaItems.slice(0, 5).map((item) => (
                <li key={item.taskId}>
                  <span>{formatAgendaItemTime(item)}</span>
                  <strong>{item.title}</strong>
                </li>
              ))}
            </ul>
          ) : null}
          {preview.candidates?.length ? (
            <fieldset className={styles.candidateList}>
              <legend>Задача</legend>
              {preview.candidates.map((candidate) => {
                const candidateInputId = `voice-candidate-${preview.id}-${candidate.taskId}`

                return (
                  <label
                    key={`${candidate.taskId}:${candidate.version}`}
                    aria-label={`Перенести ${candidate.title}`}
                    htmlFor={candidateInputId}
                  >
                    <input
                      id={candidateInputId}
                      type="radio"
                      name={`voice-candidate-${preview.id}`}
                      value={candidate.taskId}
                      checked={selectedCandidateId === candidate.taskId}
                      onChange={() => onSelectCandidate(candidate.taskId)}
                    />
                    <span>
                      <strong>{candidate.title}</strong>
                      <small>{formatCandidateSchedule(candidate)}</small>
                    </span>
                  </label>
                )
              })}
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <p className={styles.resultMessage}>{result.visualStatus}</p>
      ) : null}

      {intent?.clarificationQuestion ? (
        <p className={styles.clarification}>{intent.clarificationQuestion}</p>
      ) : null}

      <div className={styles.actions}>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onClose}
        >
          Отмена
        </button>
        {canEdit ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() =>
              setEditState({
                transcript: transcript ?? '',
                value: transcript ?? '',
              })
            }
          >
            Изменить
          </button>
        ) : null}
        {canConfirm ? (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => {
              if (!preview) {
                return
              }

              onConfirm(preview, {
                ...(selectedCandidate
                  ? {
                      candidateTaskId: selectedCandidate.taskId,
                      expectedVersion: selectedCandidate.version,
                    }
                  : {}),
              })
            }}
          >
            <CheckIcon size={17} strokeWidth={2.15} />
            <span>{getConfirmLabel(preview.intent)}</span>
          </button>
        ) : null}
      </div>
    </section>
  )
}

function getConfirmLabel(intent: PlannerIntent): string {
  switch (intent.intent) {
    case 'add_shopping_item':
      return 'Добавить'
    case 'reschedule_task':
      return 'Перенести'
    case 'create_task':
      return 'Сохранить'
    case 'get_agenda':
      return 'Показать'
    case 'clarify':
    case 'unsupported':
      return 'Подтвердить'
  }
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

function createActionDependencies(input: {
  createShoppingItem: PlannerActionExecutorDependencies['createShoppingItem']
  planner: ReturnType<typeof usePlanner>
  plannerApi: ReturnType<typeof usePlannerApiClient>
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

function formatAgendaItemTime(
  item: NonNullable<VoiceActionPreview['agendaItems']>[number],
): string {
  return item.plannedStartTime ?? 'Без времени'
}

function formatCandidateSchedule(
  candidate: NonNullable<VoiceActionPreview['candidates']>[number],
): string {
  const date = candidate.plannedDate ?? 'без даты'
  const time = candidate.plannedStartTime
    ? `, ${candidate.plannedStartTime}`
    : ''

  return `${date}${time}`
}

function resolveVoiceClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'recording':
      return 'Слушаю'
    case 'parsing':
      return 'Разбираю'
    case 'awaiting_confirmation':
      return 'Проверка'
    case 'executing':
      return 'Выполняю'
    case 'completed':
      return 'Готово'
    case 'error':
      return 'Ошибка'
    default:
      return 'Голос'
  }
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
