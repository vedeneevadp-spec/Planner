import {
  canUseVoiceAssistant,
  initialVoiceAssistantState,
  type PlannerIntent,
  PlannerIntentParser,
  reduceVoiceAssistantState,
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

import { usePlanner } from '@/features/planner'
import { useSessionFeatureReadiness } from '@/features/session'
import { useCreateShoppingListItem } from '@/features/shopping-list'
import { cx } from '@/shared/lib/classnames'
import { CheckIcon, CloseIcon, MicIcon } from '@/shared/ui/Icon'

import {
  addAndroidVoiceAssistantResumeListener,
  captureAndroidVoiceCommand,
  consumePendingAndroidVoiceCommand,
  getAndroidWakeWordTrainingCollectionStatus,
  isAndroidVoiceAssistantRuntime,
  type NativeVoiceCommand,
  openAndroidWakeWordFalseRejectRecorder,
  reportAndroidWakeWordFalseAccept,
  reportAndroidWakeWordTrueAccept,
  setAndroidWakeWordTrainingCollectionEnabled,
  skipAndroidWakeWordFeedback,
  startAndroidVoiceAssistant,
  stopAndroidVoiceAssistant,
} from '../lib/native-voice-assistant'
import {
  captureWebSpeechTranscript,
  isWebSpeechRecognitionSupported,
} from '../lib/web-speech-recognition'
import {
  buildTaskInputFromPlannerIntent,
  getPlannerIntentActionLabel,
  getPlannerIntentTitle,
  isExecutablePlannerIntent,
  shouldAutoConfirmPlannerIntent,
} from '../model/planner-intent-execution'
import styles from './VoiceAssistant.module.css'

const AUTO_CLOSE_DELAY_MS = 2200

type WakeWordFeedbackState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { message: string; status: 'saved' }
  | { message: string; status: 'error' }

type WakeWordFeedbackDecision = 'false_accept' | 'skip' | 'true_accept'

interface WakeWordSampleCollectionState {
  isEnabled: boolean
  isLoading: boolean
  message?: string
}

export function VoiceAssistant() {
  const planner = usePlanner()
  const { apiConfig, session } = useSessionFeatureReadiness()
  const createShoppingItemMutation = useCreateShoppingListItem()
  const parser = useMemo(() => new PlannerIntentParser(), [])
  const [state, dispatch] = useReducer(
    reduceVoiceAssistantState,
    initialVoiceAssistantState,
  )
  const [isCardVisible, setIsCardVisible] = useState(false)
  const [wakeWordFeedback, setWakeWordFeedback] =
    useState<WakeWordFeedbackState>({ status: 'idle' })
  const [wakeWordSampleCollection, setWakeWordSampleCollection] =
    useState<WakeWordSampleCollectionState>({
      isEnabled: false,
      isLoading: false,
    })
  const handledNativeCommandIdsRef = useRef<Set<string>>(new Set())
  const pendingAndroidButtonCaptureRef = useRef(false)
  const autoCloseTimerRef = useRef<number | null>(null)
  const isVoiceEnabled = canUseVoiceAssistant(session?.appRole)
  const isBusy = state.status === 'recording' || state.status === 'executing'

  const executeIntent = useCallback(
    async (intent: PlannerIntent) => {
      if (intent.intent === 'add_shopping_item') {
        await createShoppingItemMutation.mutateAsync({
          isFavorite: false,
          priority: null,
          shoppingCategory: 'other',
          text: getPlannerIntentTitle(intent),
        })
        return
      }

      if (
        intent.intent === 'create_task' ||
        intent.intent === 'create_event' ||
        intent.intent === 'create_reminder'
      ) {
        await planner.addTask(buildTaskInputFromPlannerIntent(intent))
        return
      }

      throw new Error('Это действие требует ручного выбора объекта в планере.')
    },
    [createShoppingItemMutation, planner],
  )

  const runIntent = useCallback(
    async (intent: PlannerIntent, source?: VoiceAssistantSource) => {
      if (!isExecutablePlannerIntent(intent)) {
        dispatch({
          error:
            intent.clarificationQuestion ??
            'Для этой команды нужно уточнение в планере.',
          transcript: intent.rawText,
          type: 'failed',
          ...(source ? { source } : {}),
        })
        return
      }

      dispatch({ type: 'confirmed' })

      try {
        await executeIntent(intent)
        dispatch({ type: 'executed' })
      } catch (error) {
        dispatch({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось выполнить голосовую команду.',
          transcript: intent.rawText,
          type: 'failed',
          ...(source ? { source } : {}),
        })
      }
    },
    [executeIntent],
  )

  const handleTranscript = useCallback(
    (
      transcript: string,
      source: VoiceAssistantSource,
      backendIntent?: PlannerIntent,
    ) => {
      const normalizedTranscript = transcript.trim()

      setIsCardVisible(true)
      setWakeWordFeedback({ status: 'idle' })
      setWakeWordSampleCollection((current) => ({
        isEnabled: current.isEnabled,
        isLoading: source === 'android_wake_word',
      }))

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

      const intent = backendIntent ?? parser.parse(normalizedTranscript)

      dispatch({
        intent,
        type: 'intent_parsed',
      })

      if (shouldAutoConfirmPlannerIntent(intent)) {
        void runIntent(intent, source)
      }
    },
    [parser, runIntent],
  )

  const submitWakeWordFeedback = useCallback(
    async (decision: WakeWordFeedbackDecision) => {
      setWakeWordFeedback({ status: 'saving' })

      try {
        const result =
          decision === 'true_accept'
            ? await reportAndroidWakeWordTrueAccept()
            : decision === 'false_accept'
              ? await reportAndroidWakeWordFalseAccept()
              : await skipAndroidWakeWordFeedback()

        setWakeWordFeedback({
          message:
            decision === 'skip'
              ? 'Пропущено, пример не сохранен.'
              : getWakeWordFeedbackMessage(result?.sampleSaved ?? false),
          status: 'saved',
        })
        if (result) {
          setWakeWordSampleCollection((current) => ({
            ...current,
            isEnabled: result.collectionEnabled,
            isLoading: false,
          }))
        }
      } catch (error) {
        setWakeWordFeedback({
          message:
            error instanceof Error
              ? error.message
              : 'Не удалось сохранить оценку срабатывания.',
          status: 'error',
        })
      }
    },
    [],
  )

  const openWakeWordSampleRecorder = useCallback(async () => {
    try {
      const status = await openAndroidWakeWordFalseRejectRecorder()

      setWakeWordSampleCollection((current) => ({
        ...current,
        isEnabled: status?.isEnabled ?? current.isEnabled,
        isLoading: false,
        message: 'Открыла запись примера.',
      }))
    } catch (error) {
      setWakeWordSampleCollection((current) => ({
        ...current,
        isLoading: false,
        message:
          error instanceof Error
            ? error.message
            : 'Не удалось открыть запись примера.',
      }))
    }
  }, [])

  const updateWakeWordSampleCollection = useCallback(
    async (isEnabled: boolean) => {
      setWakeWordSampleCollection({
        isEnabled,
        isLoading: true,
      })

      try {
        const status =
          await setAndroidWakeWordTrainingCollectionEnabled(isEnabled)

        setWakeWordSampleCollection({
          isEnabled: status?.isEnabled ?? isEnabled,
          isLoading: false,
          message: status?.isEnabled
            ? 'Сохранение аудио включено.'
            : 'Сохранение аудио выключено.',
        })
      } catch (error) {
        setWakeWordSampleCollection((current) => ({
          ...current,
          isLoading: false,
          message:
            error instanceof Error
              ? error.message
              : 'Не удалось изменить согласие на сохранение аудио.',
        }))
      }
    },
    [],
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

      handleTranscript(command.transcript, source, command.intent ?? undefined)
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

    void startAndroidVoiceAssistant(apiConfig).catch((error) => {
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
  }, [apiConfig, consumePendingAndroidCommand, isVoiceEnabled])

  useEffect(() => {
    if (!isCardVisible || getStateSource(state) !== 'android_wake_word') {
      return undefined
    }

    let isDisposed = false

    setWakeWordSampleCollection((current) => ({
      isEnabled: current.isEnabled,
      isLoading: true,
    }))

    void getAndroidWakeWordTrainingCollectionStatus()
      .then((status) => {
        if (isDisposed || !status) {
          return
        }

        setWakeWordSampleCollection({
          isEnabled: status.isEnabled,
          isLoading: false,
        })
      })
      .catch((error) => {
        if (isDisposed) {
          return
        }

        setWakeWordSampleCollection((current) => ({
          ...current,
          isLoading: false,
          message:
            error instanceof Error
              ? error.message
              : 'Не удалось получить статус сохранения аудио.',
        }))
      })

    return () => {
      isDisposed = true
    }
  }, [isCardVisible, state])

  useEffect(() => {
    if (state.status !== 'completed') {
      return undefined
    }

    if (
      getStateSource(state) === 'android_wake_word' &&
      wakeWordFeedback.status !== 'saved'
    ) {
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
  }, [state, wakeWordFeedback.status])

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
      handleTranscript(transcript, 'web_microphone')
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
    setWakeWordFeedback({ status: 'idle' })
    setWakeWordSampleCollection({
      isEnabled: wakeWordSampleCollection.isEnabled,
      isLoading: false,
    })
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
          state={state}
          wakeWordFeedback={
            getStateSource(state) === 'android_wake_word'
              ? wakeWordFeedback
              : null
          }
          wakeWordSampleCollection={
            getStateSource(state) === 'android_wake_word'
              ? wakeWordSampleCollection
              : null
          }
          onClose={closeCard}
          onConfirm={(intent) => {
            void runIntent(intent, getStateSource(state))
          }}
          onEditTranscript={(transcript) => {
            handleTranscript(
              transcript,
              getStateSource(state) ?? 'web_microphone',
            )
          }}
          onSampleCollectionChange={(isEnabled) => {
            void updateWakeWordSampleCollection(isEnabled)
          }}
          onWakeWordSampleRecord={() => {
            void openWakeWordSampleRecorder()
          }}
          onWakeWordFeedback={(decision) => {
            void submitWakeWordFeedback(decision)
          }}
        />
      ) : null}
    </>
  )
}

interface VoiceAssistantCardProps {
  state: VoiceAssistantState
  wakeWordFeedback: WakeWordFeedbackState | null
  wakeWordSampleCollection: WakeWordSampleCollectionState | null
  onClose: () => void
  onConfirm: (intent: PlannerIntent) => void
  onEditTranscript: (transcript: string) => void
  onSampleCollectionChange: (isEnabled: boolean) => void
  onWakeWordSampleRecord: () => void
  onWakeWordFeedback: (decision: WakeWordFeedbackDecision) => void
}

function VoiceAssistantCard({
  state,
  wakeWordFeedback,
  wakeWordSampleCollection,
  onClose,
  onConfirm,
  onEditTranscript,
  onSampleCollectionChange,
  onWakeWordSampleRecord,
  onWakeWordFeedback,
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
  const canConfirm =
    state.status === 'awaiting_confirmation' &&
    intent !== null &&
    intent.needsConfirmation &&
    isExecutablePlannerIntent(intent)
  const statusLabel = getStatusLabel(state.status)
  const isWakeWordFeedbackDisabled =
    wakeWordFeedback?.status === 'saving' ||
    wakeWordFeedback?.status === 'saved'

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
          {(intent.datetime ?? intent.reminderAt) ? (
            <div>
              <dt>Время</dt>
              <dd>{intent.reminderAt ?? intent.datetime}</dd>
            </div>
          ) : null}
          <div>
            <dt>Уверенность</dt>
            <dd>{Math.round(intent.confidence * 100)}%</dd>
          </div>
        </dl>
      ) : null}

      {intent?.clarificationQuestion ? (
        <p className={styles.clarification}>{intent.clarificationQuestion}</p>
      ) : null}

      {wakeWordFeedback ? (
        <div className={styles.wakeFeedback}>
          {wakeWordSampleCollection ? (
            <label className={styles.sampleConsent}>
              <input
                type="checkbox"
                checked={wakeWordSampleCollection.isEnabled}
                disabled={
                  wakeWordSampleCollection.isLoading ||
                  wakeWordFeedback.status === 'saving'
                }
                onChange={(event) =>
                  onSampleCollectionChange(event.currentTarget.checked)
                }
              />
              <span>Разрешаю сохранять короткие аудио-примеры wake-фразы</span>
            </label>
          ) : null}
          <p className={styles.wakeFeedbackQuestion}>
            Это было правильное срабатывание?
          </p>
          <div className={styles.wakeFeedbackActions}>
            <button
              className={styles.feedbackButton}
              type="button"
              disabled={isWakeWordFeedbackDisabled}
              onClick={() => onWakeWordFeedback('true_accept')}
            >
              <CheckIcon size={16} strokeWidth={2.15} />
              <span>Верно</span>
            </button>
            <button
              className={styles.feedbackButton}
              type="button"
              disabled={isWakeWordFeedbackDisabled}
              onClick={() => onWakeWordFeedback('false_accept')}
            >
              <CloseIcon size={16} strokeWidth={2.15} />
              <span>Ложно</span>
            </button>
            <button
              className={styles.feedbackButton}
              type="button"
              disabled={isWakeWordFeedbackDisabled}
              onClick={() => onWakeWordFeedback('skip')}
            >
              <span>Пропустить</span>
            </button>
            <button
              className={styles.feedbackButton}
              type="button"
              onClick={onWakeWordSampleRecord}
            >
              <span>Записать</span>
            </button>
          </div>
          {wakeWordFeedback.status === 'saving' ? (
            <p className={styles.wakeFeedbackMessage}>Сохраняю оценку...</p>
          ) : null}
          {wakeWordSampleCollection?.message ? (
            <p className={styles.wakeFeedbackMessage}>
              {wakeWordSampleCollection.message}
            </p>
          ) : null}
          {wakeWordFeedback.status === 'saved' ||
          wakeWordFeedback.status === 'error' ? (
            <p
              className={cx(
                styles.wakeFeedbackMessage,
                wakeWordFeedback.status === 'error' && styles.wakeFeedbackError,
              )}
            >
              {wakeWordFeedback.message}
            </p>
          ) : null}
        </div>
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
            onClick={() => onConfirm(intent)}
          >
            <CheckIcon size={17} strokeWidth={2.15} />
            <span>{getConfirmLabel(intent)}</span>
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
    case 'reschedule':
      return 'Перенести'
    case 'create_event':
    case 'create_reminder':
    case 'create_task':
      return 'Сохранить'
    case 'clarify':
    case 'delete':
      return 'Подтвердить'
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

function getWakeWordFeedbackMessage(sampleSaved: boolean): string {
  if (sampleSaved) {
    return 'Спасибо, пример сохранен для обучения.'
  }

  return 'Спасибо, оценка срабатывания учтена.'
}
