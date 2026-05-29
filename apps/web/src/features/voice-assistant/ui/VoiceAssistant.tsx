import {
  canUseVoiceAssistant,
  initialVoiceAssistantState,
  type PlannerIntent,
  PlannerIntentParser,
  type PlannerIntentParserContext,
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
  buildTaskInputFromPlannerIntent,
  getPlannerIntentActionLabel,
  isExecutablePlannerIntent,
  shouldAutoConfirmPlannerIntent,
} from '../model/planner-intent-execution'
import styles from './VoiceAssistant.module.css'

const AUTO_CLOSE_DELAY_MS = 2200

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
  const handledNativeCommandIdsRef = useRef<Set<string>>(new Set())
  const pendingAndroidButtonCaptureRef = useRef(false)
  const autoCloseTimerRef = useRef<number | null>(null)
  const isVoiceEnabled = canUseVoiceAssistant(session?.appRole)
  const isBusy = state.status === 'recording' || state.status === 'executing'

  const executeIntent = useCallback(
    async (intent: PlannerIntent) => {
      if (intent.intent === 'add_shopping_item') {
        for (const item of intent.items ?? []) {
          await createShoppingItemMutation.mutateAsync({
            isFavorite: false,
            priority: null,
            shoppingCategory: 'other',
            text: getShoppingItemText(item),
          })
        }

        return
      }

      if (intent.intent === 'create_task') {
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

      dispatch({
        intent,
        type: 'intent_parsed',
      })

      if (shouldAutoConfirmPlannerIntent(intent)) {
        void runIntent(intent, source)
      }
    },
    [parser, planner.spheres, runIntent, session],
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
        />
      ) : null}
    </>
  )
}

interface VoiceAssistantCardProps {
  state: VoiceAssistantState
  onClose: () => void
  onConfirm: (intent: PlannerIntent) => void
  onEditTranscript: (transcript: string) => void
}

function VoiceAssistantCard({
  state,
  onClose,
  onConfirm,
  onEditTranscript,
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

function getShoppingItemText(
  item: NonNullable<PlannerIntent['items']>[number],
): string {
  return item.quantity ? `${item.quantity} ${item.title}` : item.title
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
