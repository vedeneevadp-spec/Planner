import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import styles from './TaskCard.module.css'

interface TaskNextStageDialogProps {
  completeCurrent?: boolean | undefined
  defaultPlannedDate?: string | undefined
  defaultTitle: string
  isPending?: boolean | undefined
  onClose: () => void
  onSubmit: (input: { plannedDate: string | null; title: string }) => unknown
  todayKey?: string | undefined
  tomorrowKey?: string | undefined
}

export function TaskNextStageDialog({
  completeCurrent = false,
  defaultPlannedDate = '',
  defaultTitle,
  isPending = false,
  onClose,
  onSubmit,
  todayKey,
  tomorrowKey,
}: TaskNextStageDialogProps) {
  const titleInputId = useId()
  const plannedDateInputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [plannedDate, setPlannedDate] = useState(defaultPlannedDate)
  const [title, setTitle] = useState(defaultTitle)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isPending) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPending, onClose])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      setErrorMessage('Введите название этапа.')

      return
    }

    setErrorMessage(null)

    const result = await onSubmit({
      plannedDate: plannedDate || null,
      title: normalizedTitle,
    })

    if (result !== false && result !== null) {
      onClose()
    }
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.nextStageOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${titleInputId}-heading`}
    >
      <button
        className={styles.nextStageBackdrop}
        type="button"
        aria-label="Закрыть"
        disabled={isPending}
        onClick={onClose}
      />
      <form
        className={styles.nextStagePanel}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className={styles.nextStageHeader}>
          <h3 id={`${titleInputId}-heading`}>
            {completeCurrent
              ? 'Завершить и создать этап'
              : 'Создать следующий этап'}
          </h3>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть"
            disabled={isPending}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <label className={styles.field} htmlFor={titleInputId}>
          <span>Название</span>
          <input
            ref={inputRef}
            id={titleInputId}
            required
            value={title}
            disabled={isPending}
            onChange={(event) => {
              setTitle(event.target.value)
              setErrorMessage(null)
            }}
          />
        </label>

        <label className={styles.field} htmlFor={plannedDateInputId}>
          <span>Дата</span>
          <input
            id={plannedDateInputId}
            type="date"
            value={plannedDate}
            disabled={isPending}
            onChange={(event) => setPlannedDate(event.target.value)}
          />
        </label>
        {todayKey || tomorrowKey ? (
          <div className={styles.nextStageDateShortcuts}>
            {todayKey ? (
              <button
                className={styles.nextStageDateShortcut}
                type="button"
                disabled={isPending}
                aria-pressed={plannedDate === todayKey}
                onClick={() => setPlannedDate(todayKey)}
              >
                Сегодня
              </button>
            ) : null}
            {tomorrowKey ? (
              <button
                className={styles.nextStageDateShortcut}
                type="button"
                disabled={isPending}
                aria-pressed={plannedDate === tomorrowKey}
                onClick={() => setPlannedDate(tomorrowKey)}
              >
                Завтра
              </button>
            ) : null}
          </div>
        ) : null}

        {errorMessage ? (
          <p className={styles.nextStageError} role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className={styles.nextStageActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={isPending}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={isPending || !title.trim()}
          >
            Создать
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
