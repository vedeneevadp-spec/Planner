import {
  type PlannerIntent,
  type VoiceActionConfirmedPayload,
  type VoiceActionPreview,
  type VoiceActionPreviewStatus,
  type VoiceActionResult,
  type VoiceAssistantState,
} from '@planner/contracts'
import { useEffect, useState } from 'react'

import { cx } from '@/shared/lib/classnames'
import { CheckIcon, CloseIcon, EditIcon, MicIcon } from '@/shared/ui/Icon'

import {
  getPlannerIntentTitle,
  getShoppingItemText,
} from '../model/planner-intent-execution'
import {
  getWebVoiceInputLabel,
  type WebVoiceInputState,
} from '../model/web-voice-input'
import styles from './VoiceAssistant.module.css'

export const MAX_CLARIFICATION_ATTEMPTS = 2
export const VOICE_UNDO_TTL_MS = 30_000

export type VoiceConfirmationStatus =
  | VoiceActionPreviewStatus
  | 'error'
  | 'success'

export interface VoiceConfirmationCardProps {
  clarificationAttempts: number
  isUndoing: boolean
  preview: VoiceActionPreview | null
  result: VoiceActionResult | null
  selectedCandidateId: string | null
  spheres: Array<{ id: string; name: string }>
  state: VoiceAssistantState
  webInputState?: WebVoiceInputState | undefined
  webStatusMessage?: string | null | undefined
  onCancelRecording?: (() => void) | undefined
  onClarifyOption: (transcript: string) => void
  onClose: () => void
  onConfirm: (
    preview: VoiceActionPreview,
    confirmedPayload?: VoiceActionConfirmedPayload,
  ) => void
  onCreateFromNotFound: (preview: VoiceActionPreview) => void
  onEditTranscript: (transcript: string) => void
  onManualInput?: (() => void) | undefined
  onRepeat: () => void
  onSaveClarificationToInbox: (preview: VoiceActionPreview) => void
  onSelectCandidate: (taskId: string) => void
  onStopRecording?: (() => void) | undefined
  onUndo: () => void
}

export function VoiceConfirmationCard({
  clarificationAttempts,
  isUndoing,
  preview,
  result,
  selectedCandidateId,
  spheres,
  state,
  webInputState,
  webStatusMessage,
  onCancelRecording,
  onClarifyOption,
  onClose,
  onConfirm,
  onCreateFromNotFound,
  onEditTranscript,
  onManualInput,
  onRepeat,
  onSaveClarificationToInbox,
  onSelectCandidate,
  onStopRecording,
  onUndo,
}: VoiceConfirmationCardProps) {
  const transcript = 'transcript' in state ? state.transcript : ''
  const [editState, setEditState] = useState<{
    transcript: string
    value: string
  } | null>(null)
  const isEditingTranscript = editState !== null
  const editedTranscript = editState?.value ?? ''
  const selectedCandidate = preview?.candidates?.find(
    (candidate) => candidate.taskId === selectedCandidateId,
  )
  const undoKey =
    result?.status === 'success' && result.undo
      ? getUndoPayloadKey(result.undo)
      : null
  const [expiredUndoKey, setExpiredUndoKey] = useState<string | null>(null)
  const isUndoResult = isSuccessfulUndoResult(result)
  const hidesPrivateDetails = Boolean(
    preview?.requiresUnlock || preview?.status === 'requires_unlock',
  )
  const canEdit =
    Boolean(transcript) &&
    !result &&
    !hidesPrivateDetails &&
    (state.status === 'awaiting_confirmation' || state.status === 'error')
  const canConfirm =
    !result &&
    state.status === 'awaiting_confirmation' &&
    preview !== null &&
    preview.needsConfirmation &&
    ((preview.status === 'ready_for_confirmation' && preview.canExecute) ||
      (preview.status === 'multiple_candidates' &&
        selectedCandidate !== undefined))
  const canUndo =
    result?.status === 'success' &&
    Boolean(result.undo) &&
    undoKey !== null &&
    expiredUndoKey !== undoKey
  const closeLabel =
    result?.status === 'success' ||
    preview?.type === 'get_agenda' ||
    preview?.type === 'get_shopping_list'
      ? 'Закрыть'
      : 'Отмена'
  const confirmationStatus = getVoiceConfirmationStatus(preview, result, state)
  const webStatusLabel = webInputState
    ? getWebVoiceInputLabel(webInputState)
    : null
  const webStatusBody = getWebStatusBody(webInputState, webStatusMessage)
  const canRetryWebInput = isRetryableWebInputState(webInputState)

  useEffect(() => {
    if (!undoKey) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setExpiredUndoKey(undoKey)
    }, VOICE_UNDO_TTL_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [undoKey])

  return (
    <section
      className={styles.card}
      role="dialog"
      aria-live="polite"
      aria-label="Голосовая команда"
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleBlock}>
          <span className={styles.statusPill}>
            {getStatusLabel(state.status, confirmationStatus, {
              isUndoResult,
              webStatusLabel,
            })}
          </span>
          <h2>
            {result ? 'Результат' : (preview?.title ?? 'Голосовая команда')}
          </h2>
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

      {webStatusBody && state.status !== 'error' ? (
        <p className={styles.previewSummary}>{webStatusBody}</p>
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
            aria-label="Изменить распознанный текст"
            onChange={(event) => {
              const { value } = event.currentTarget

              setEditState((current) => ({
                transcript: current?.transcript ?? transcript ?? '',
                value,
              }))
            }}
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
      ) : transcript && !hidesPrivateDetails ? (
        <div className={styles.transcriptBlock}>
          <span className={styles.eyebrow}>Распознано</span>
          <p className={styles.transcript}>{transcript}</p>
        </div>
      ) : null}

      {preview && !result ? (
        <VoicePreviewBody
          clarificationAttempts={clarificationAttempts}
          preview={preview}
          selectedCandidateId={selectedCandidateId}
          spheres={spheres}
          transcript={transcript}
          onClarifyOption={onClarifyOption}
          onRepeat={onRepeat}
          onSelectCandidate={onSelectCandidate}
        />
      ) : null}

      {result ? (
        <div className={styles.resultBlock}>
          <p
            className={cx(
              styles.resultMessage,
              result.status !== 'success' && styles.errorMessage,
            )}
          >
            {result.visualStatus}
          </p>
          {canUndo ? (
            <p className={styles.previewReason}>
              Действие можно отменить из этой карточки в течение 30 секунд.
            </p>
          ) : result?.status === 'success' && result.undo ? (
            <p className={styles.previewReason}>Время отмены истекло.</p>
          ) : null}
          {result?.status !== 'success' ? (
            <p className={styles.previewReason}>
              Обнови экран, если данные выглядят неактуально.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        {webInputState === 'listening' && onStopRecording ? (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={onStopRecording}
          >
            <CheckIcon size={17} strokeWidth={2.15} />
            <span>Завершить</span>
          </button>
        ) : null}
        {webInputState === 'listening' && onCancelRecording ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onCancelRecording}
          >
            Отменить запись
          </button>
        ) : null}
        {canRetryWebInput ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onRepeat}
          >
            <MicIcon size={16} strokeWidth={2.05} />
            <span>Повторить</span>
          </button>
        ) : null}
        {canRetryWebInput && onManualInput ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onManualInput}
          >
            Ввести вручную
          </button>
        ) : null}
        {canConfirm ? (
          <button
            className={cx(
              styles.primaryButton,
              preview?.isDangerous && styles.dangerButton,
            )}
            type="button"
            onClick={() => {
              if (!preview) {
                return
              }

              onConfirm(preview, {
                ...(preview.isDangerous ? { confirmed: true as const } : {}),
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
            <span>{getConfirmLabel(preview)}</span>
          </button>
        ) : null}
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
            <EditIcon size={16} strokeWidth={2.05} />
            <span>Изменить</span>
          </button>
        ) : null}
        {preview?.status === 'not_found' && !result ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => onCreateFromNotFound(preview)}
          >
            Создать новую
          </button>
        ) : null}
        {preview?.status === 'requires_clarification' &&
        clarificationAttempts >= MAX_CLARIFICATION_ATTEMPTS &&
        !preview.isDangerous &&
        !result ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => onSaveClarificationToInbox(preview)}
          >
            Сохранить во входящие
          </button>
        ) : null}
        {canUndo ? (
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={isUndoing}
            onClick={onUndo}
          >
            {isUndoing ? 'Отменяю...' : 'Отменить'}
          </button>
        ) : null}
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onClose}
        >
          {closeLabel}
        </button>
      </div>
    </section>
  )
}

function VoicePreviewBody({
  clarificationAttempts,
  preview,
  selectedCandidateId,
  spheres,
  transcript,
  onClarifyOption,
  onRepeat,
  onSelectCandidate,
}: {
  clarificationAttempts: number
  preview: VoiceActionPreview
  selectedCandidateId: string | null
  spheres: Array<{ id: string; name: string }>
  transcript: string
  onClarifyOption: (transcript: string) => void
  onRepeat: () => void
  onSelectCandidate: (taskId: string) => void
}) {
  if (preview.status === 'requires_unlock') {
    return (
      <div className={styles.previewBlock}>
        <p className={styles.previewSummary}>
          Разблокируй телефон, чтобы продолжить.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.previewBlock}>
      {renderActionLayout({
        clarificationAttempts,
        preview,
        selectedCandidateId,
        spheres,
        transcript,
        onClarifyOption,
        onRepeat,
        onSelectCandidate,
      })}
      <ConfirmationReason preview={preview} />
    </div>
  )
}

function renderActionLayout(input: {
  clarificationAttempts: number
  preview: VoiceActionPreview
  selectedCandidateId: string | null
  spheres: Array<{ id: string; name: string }>
  transcript: string
  onClarifyOption: (transcript: string) => void
  onRepeat: () => void
  onSelectCandidate: (taskId: string) => void
}) {
  const { preview } = input

  switch (preview.status) {
    case 'blocked':
      return <BlockedLayout preview={preview} />
    case 'multiple_candidates':
      return (
        <MultipleCandidatesLayout
          preview={preview}
          selectedCandidateId={input.selectedCandidateId}
          onSelectCandidate={input.onSelectCandidate}
        />
      )
    case 'not_found':
      return <NotFoundLayout preview={preview} />
    case 'requires_clarification':
      return (
        <ClarificationLayout
          clarificationAttempts={input.clarificationAttempts}
          preview={preview}
          transcript={input.transcript}
          onClarifyOption={input.onClarifyOption}
          onRepeat={input.onRepeat}
        />
      )
    case 'unsupported':
      return <UnsupportedLayout preview={preview} />
    case 'ready_for_confirmation':
      return (
        <ReadyLayout
          preview={preview}
          selectedCandidateId={input.selectedCandidateId}
          spheres={input.spheres}
        />
      )
    case 'requires_unlock':
      return null
  }
}

function ReadyLayout({
  preview,
  selectedCandidateId,
  spheres,
}: {
  preview: VoiceActionPreview
  selectedCandidateId: string | null
  spheres: Array<{ id: string; name: string }>
}) {
  switch (preview.type) {
    case 'create_task':
      return <CreateTaskLayout preview={preview} spheres={spheres} />
    case 'add_shopping_item':
      return <ShoppingLayout preview={preview} />
    case 'get_shopping_list':
      return <ShoppingListLayout preview={preview} />
    case 'reschedule_task':
      return (
        <RescheduleLayout
          preview={preview}
          selectedCandidateId={selectedCandidateId}
        />
      )
    case 'get_agenda':
      return <AgendaLayout preview={preview} />
    case 'clarify':
      return null
    case 'unsupported':
      return <UnsupportedLayout preview={preview} />
  }
}

function CreateTaskLayout({
  preview,
  spheres,
}: {
  preview: VoiceActionPreview
  spheres: Array<{ id: string; name: string }>
}) {
  const intent = preview.intent

  return (
    <section className={styles.actionPanel} aria-label="Новая задача">
      <h3>{intent.reminderAt ? 'Напоминание-задача' : 'Новая задача'}</h3>
      <dl className={styles.detailList}>
        <DetailRow label="Название" value={getPlannerIntentTitle(intent)} />
        <DetailRow label="Дата" value={formatDateValue(intent)} />
        <DetailRow label="Время" value={intent.time ?? 'не указано'} />
        <DetailRow
          label="Напоминание"
          value={intent.reminderAt ? formatDateTime(intent.reminderAt) : 'нет'}
        />
        <DetailRow label="Сфера" value={formatSphere(intent, spheres)} />
        <DetailRow label="Приоритет" value={formatPriority(intent.priority)} />
      </dl>
    </section>
  )
}

function ShoppingLayout({ preview }: { preview: VoiceActionPreview }) {
  return (
    <section className={styles.actionPanel} aria-label="Добавить в покупки">
      <h3>Добавить в покупки</h3>
      <p className={styles.previewReason}>Список: покупки</p>
      <ul className={styles.bulletList}>
        {(preview.intent.items ?? []).map((item, index) => (
          <li key={`${item.title}:${item.quantity ?? ''}:${index}`}>
            {getShoppingItemText(item)}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ShoppingListLayout({ preview }: { preview: VoiceActionPreview }) {
  return (
    <section className={styles.actionPanel} aria-label="Список покупок">
      <h3>Нужно купить</h3>
      <p className={styles.previewSummary}>{preview.summary}</p>
      {preview.shoppingItems?.length ? (
        <ul className={styles.bulletList}>
          {preview.shoppingItems.map((item) => (
            <li key={item.shoppingItemId}>{item.title}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function RescheduleLayout({
  preview,
  selectedCandidateId,
}: {
  preview: VoiceActionPreview
  selectedCandidateId: string | null
}) {
  const candidate =
    preview.candidates?.find((item) => item.taskId === selectedCandidateId) ??
    preview.candidates?.[0] ??
    null

  return (
    <section className={styles.actionPanel} aria-label="Перенести задачу">
      <h3>Перенести задачу</h3>
      <p className={styles.warningText}>Это изменит существующую задачу.</p>
      <dl className={styles.detailList}>
        <DetailRow
          label="Задача"
          value={candidate?.title ?? preview.intent.targetQuery ?? 'не выбрана'}
        />
        <DetailRow
          label="Было"
          value={candidate ? formatCandidateSchedule(candidate) : 'неизвестно'}
        />
        <DetailRow label="Стало" value={formatTargetSchedule(preview.intent)} />
      </dl>
    </section>
  )
}

function AgendaLayout({ preview }: { preview: VoiceActionPreview }) {
  return (
    <section className={styles.actionPanel} aria-label="План">
      <h3>{preview.title}</h3>
      <p className={styles.previewSummary}>{preview.summary}</p>
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
    </section>
  )
}

function MultipleCandidatesLayout({
  preview,
  selectedCandidateId,
  onSelectCandidate,
}: {
  preview: VoiceActionPreview
  selectedCandidateId: string | null
  onSelectCandidate: (taskId: string) => void
}) {
  return (
    <section className={styles.actionPanel} aria-label="Выбор задачи">
      <h3>Нашла несколько похожих задач</h3>
      <p className={styles.previewReason}>Какую перенести?</p>
      <fieldset className={styles.candidateList}>
        <legend>Задача</legend>
        {preview.candidates?.map((candidate) => {
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
    </section>
  )
}

function NotFoundLayout({ preview }: { preview: VoiceActionPreview }) {
  return (
    <section className={styles.actionPanel} aria-label="Задача не найдена">
      <h3>Задача не найдена</h3>
      <p className={styles.previewSummary}>{preview.summary}</p>
      <p className={styles.previewReason}>
        Можно изменить запрос или перейти к отдельному preview новой задачи.
      </p>
    </section>
  )
}

function BlockedLayout({ preview }: { preview: VoiceActionPreview }) {
  return (
    <section className={styles.actionPanel} aria-label="Действие недоступно">
      <h3>Это действие сейчас недоступно</h3>
      <p className={styles.previewSummary}>
        {preview.reason ?? preview.summary}
      </p>
    </section>
  )
}

function UnsupportedLayout({ preview }: { preview: VoiceActionPreview }) {
  return (
    <section
      className={cx(
        styles.actionPanel,
        preview.isDangerous && styles.warningPanel,
      )}
      aria-label="Команда не поддерживается"
    >
      <h3>Команда не поддерживается</h3>
      <p className={styles.previewSummary}>{preview.summary}</p>
      {preview.isDangerous ? (
        <p className={styles.warningText}>
          Опасные и массовые действия голосом сейчас не выполняются.
        </p>
      ) : null}
    </section>
  )
}

function ClarificationLayout({
  clarificationAttempts,
  preview,
  transcript,
  onClarifyOption,
  onRepeat,
}: {
  clarificationAttempts: number
  preview: VoiceActionPreview
  transcript: string
  onClarifyOption: (transcript: string) => void
  onRepeat: () => void
}) {
  const options = getClarificationOptions(preview, transcript)

  return (
    <section className={styles.actionPanel} aria-label="Нужно уточнение">
      <h3>Нужно уточнение</h3>
      <p className={styles.previewSummary}>
        {preview.intent.clarificationQuestion ?? preview.summary}
      </p>
      {options.length > 0 ? (
        <div className={styles.quickOptions} aria-label="Быстрые варианты">
          {options.map((option) => (
            <button
              key={option.label}
              className={styles.secondaryButton}
              type="button"
              onClick={() => onClarifyOption(option.transcript)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        className={styles.secondaryButton}
        type="button"
        onClick={onRepeat}
      >
        <MicIcon size={16} strokeWidth={2.05} />
        <span>Повторить</span>
      </button>
      <p className={styles.previewReason}>
        Попытка{' '}
        {Math.min(clarificationAttempts + 1, MAX_CLARIFICATION_ATTEMPTS)} из{' '}
        {MAX_CLARIFICATION_ATTEMPTS}.
      </p>
    </section>
  )
}

function ConfirmationReason({ preview }: { preview: VoiceActionPreview }) {
  return (
    <aside
      className={cx(
        styles.reasonBox,
        preview.isDangerous && styles.warningPanel,
      )}
    >
      <h3>Причина подтверждения</h3>
      <p>{getConfirmationReason(preview)}</p>
      <small>Уверенность {Math.round(preview.intent.confidence * 100)}%</small>
    </aside>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function getClarificationOptions(
  preview: VoiceActionPreview,
  transcript: string,
): Array<{ label: string; transcript: string }> {
  const alternatives = preview.intent.alternatives ?? []

  if (alternatives.length > 0) {
    return alternatives.slice(0, 3).map((alternative) => ({
      label: alternative,
      transcript: alternative,
    }))
  }

  const question = (
    preview.intent.clarificationQuestion ?? preview.summary
  ).toLowerCase()
  const sourceText =
    preview.intent.transcript?.trim() ||
    preview.intent.rawText.trim() ||
    transcript.trim()

  if (question.includes('8 утра') || question.includes('утра или вечера')) {
    return [
      { label: '8:00', transcript: `${sourceText} 8 утра`.trim() },
      { label: '20:00', transcript: `${sourceText} 8 вечера`.trim() },
    ]
  }

  if (sourceText && question.includes('что сделать')) {
    return [
      {
        label: 'Добавить в покупки',
        transcript: `добавь в покупки ${sourceText}`,
      },
      {
        label: 'Создать задачу',
        transcript: `создай задачу ${sourceText}`,
      },
    ]
  }

  return []
}

function getVoiceConfirmationStatus(
  preview: VoiceActionPreview | null,
  result: VoiceActionResult | null,
  state: VoiceAssistantState,
): VoiceConfirmationStatus | null {
  if (result?.status === 'success') {
    return 'success'
  }

  if (result || state.status === 'error') {
    return 'error'
  }

  return preview?.status ?? null
}

function getStatusLabel(
  status: VoiceAssistantState['status'],
  confirmationStatus: VoiceConfirmationStatus | null,
  options: { isUndoResult?: boolean; webStatusLabel?: string | null } = {},
): string {
  if (options.isUndoResult) {
    return 'Отменено'
  }

  if (options.webStatusLabel) {
    return options.webStatusLabel
  }

  if (confirmationStatus === 'requires_unlock') {
    return 'Разблокировка'
  }

  if (confirmationStatus === 'requires_clarification') {
    return 'Уточнение'
  }

  if (
    confirmationStatus === 'blocked' ||
    confirmationStatus === 'unsupported' ||
    confirmationStatus === 'not_found'
  ) {
    return 'Нельзя выполнить'
  }

  if (confirmationStatus === 'multiple_candidates') {
    return 'Выбор'
  }

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

function getWebStatusBody(
  webInputState: WebVoiceInputState | undefined,
  webStatusMessage: string | null | undefined,
): string | null {
  if (!webInputState || webInputState === 'idle') {
    return null
  }

  if (webInputState === 'ready_for_confirmation') {
    return null
  }

  return webStatusMessage ?? getWebVoiceInputLabel(webInputState)
}

function isRetryableWebInputState(
  webInputState: WebVoiceInputState | undefined,
): boolean {
  return (
    webInputState === 'error' ||
    webInputState === 'needs_repeat' ||
    webInputState === 'permission_denied' ||
    webInputState === 'unsupported'
  )
}

function isSuccessfulUndoResult(result: VoiceActionResult | null): boolean {
  return (
    result?.status === 'success' &&
    !result.undo &&
    result.visualStatus.toLowerCase().includes('отмен')
  )
}

function getUndoPayloadKey(
  undo: NonNullable<VoiceActionResult['undo']>,
): string {
  switch (undo.type) {
    case 'create_task':
      return `${undo.type}:${undo.createdTaskId}`
    case 'add_shopping_item':
      return `${undo.type}:${undo.createdShoppingItemIds.join(',')}`
    case 'reschedule_task':
      return `${undo.type}:${undo.updatedTaskId}:${undo.expectedVersion}`
  }
}

function getConfirmLabel(preview: VoiceActionPreview): string {
  if (preview.status === 'multiple_candidates') {
    return 'Продолжить'
  }

  switch (preview.intent.intent) {
    case 'add_shopping_item':
      return 'Добавить'
    case 'get_shopping_list':
      return 'Показать'
    case 'reschedule_task':
      return 'Да, перенести'
    case 'create_task':
      return 'Сохранить'
    case 'get_agenda':
      return 'Показать'
    case 'clarify':
    case 'unsupported':
      return 'Подтвердить'
  }
}

function getConfirmationReason(preview: VoiceActionPreview): string {
  if (preview.status === 'requires_unlock') {
    return 'Разблокируй телефон, чтобы продолжить без раскрытия приватных данных.'
  }

  if (preview.status === 'multiple_candidates') {
    return 'Нашла несколько похожих задач. Нужно выбрать одну перед выполнением.'
  }

  if (preview.status === 'not_found') {
    return 'Задача не найдена. Создание новой задачи требует отдельного preview.'
  }

  if (preview.status === 'blocked') {
    return preview.reason ?? 'Действие сейчас заблокировано.'
  }

  if (preview.status === 'requires_clarification') {
    return 'Я не уверена в команде. Нужно уточнение перед сохранением.'
  }

  if (preview.status === 'unsupported') {
    return preview.isDangerous
      ? 'Опасное действие не поддерживается и не будет выполнено голосом.'
      : 'Эта команда пока не поддерживается.'
  }

  if (preview.isDangerous || preview.type === 'reschedule_task') {
    return 'Нужно подтверждение, потому что действие изменит существующую задачу.'
  }

  if (
    preview.type === 'create_task' &&
    (preview.intent.time || preview.intent.reminderAt)
  ) {
    return 'Нужно подтверждение, потому что задача имеет точное время.'
  }

  if (preview.intent.confidence < 0.85) {
    return 'Я не полностью уверена в распознавании. Проверь перед выполнением.'
  }

  if (preview.type === 'get_agenda' || preview.type === 'get_shopping_list') {
    return 'Это только просмотр. Данные не изменятся.'
  }

  return preview.reason ?? 'Проверь действие перед выполнением.'
}

function formatDateValue(intent: PlannerIntent): string {
  return intent.dateText ?? intent.date ?? 'не указана'
}

function formatDateTime(value: string): string {
  return value.replace('T', ' ')
}

function formatPriority(priority: PlannerIntent['priority']): string {
  switch (priority) {
    case 'high':
      return 'высокий'
    case 'low':
      return 'низкий'
    case 'normal':
    case undefined:
      return 'обычный'
  }
}

function formatSphere(
  intent: PlannerIntent,
  spheres: Array<{ id: string; name: string }>,
): string {
  if (!intent.sphereId) {
    return 'не указана'
  }

  return (
    spheres.find((sphere) => sphere.id === intent.sphereId)?.name ??
    intent.sphereId
  )
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

function formatTargetSchedule(intent: PlannerIntent): string {
  if (intent.timeShiftMinutes !== undefined) {
    return intent.timeShiftText ?? formatTimeShift(intent.timeShiftMinutes)
  }

  const date = intent.dateText ?? intent.date ?? 'дата не указана'
  const time = intent.time ? `, ${intent.time}` : ''

  return `${date}${time}`
}

function formatTimeShift(timeShiftMinutes: number): string {
  const direction = timeShiftMinutes < 0 ? 'раньше' : 'позже'
  const minutes = Math.abs(timeShiftMinutes)

  if (minutes % 60 === 0) {
    const hours = minutes / 60

    return `на ${hours} ${plural(hours, 'час', 'часа', 'часов')} ${direction}`
  }

  return `на ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} ${direction}`
}

function plural(value: number, one: string, few: string, many: string): string {
  const lastTwo = value % 100
  const last = value % 10

  if (lastTwo >= 11 && lastTwo <= 14) {
    return many
  }

  if (last === 1) {
    return one
  }

  if (last >= 2 && last <= 4) {
    return few
  }

  return many
}
