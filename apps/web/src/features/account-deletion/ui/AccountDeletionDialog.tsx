import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { TrashIcon } from '@/shared/ui/Icon'

import styles from './AccountDeletionDialog.module.css'

interface AccountDeletionDialogProps {
  displayName: string
  email: string
  errorMessage?: string | null | undefined
  isOpen: boolean
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function AccountDeletionDialog({
  displayName,
  email,
  errorMessage,
  isOpen,
  isPending,
  onCancel,
  onConfirm,
}: AccountDeletionDialogProps) {
  const descriptionId = useId()
  const headingId = useId()
  const [confirmation, setConfirmation] = useState('')
  const isConfirmed = confirmation.trim().toLowerCase() === email.toLowerCase()

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isPending) {
        setConfirmation('')
        onCancel()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isPending, onCancel])

  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          setConfirmation('')
          onCancel()
        }
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={headingId}
        aria-modal="true"
        className={styles.dialog}
        role="alertdialog"
      >
        <div className={styles.iconMark} aria-hidden="true">
          <TrashIcon size={22} strokeWidth={2.1} />
        </div>

        <div className={styles.copy}>
          <p className={styles.kicker}>Опасное действие</p>
          <h2 id={headingId}>Удалить аккаунт {displayName}?</h2>
          <p id={descriptionId}>
            Аккаунт и все связанные с ним данные будут безвозвратно удалены из
            действующей системы.
          </p>
        </div>

        <ul className={styles.consequences}>
          <li>
            Личные workspace’ы, задачи, привычки и настройки будут удалены.
          </li>
          <li>
            Созданные пользователем общие workspace’ы станут недоступны всем
            участникам.
          </li>
          <li>
            Все активные сессии и подключённые устройства будут отключены.
          </li>
        </ul>

        <p className={styles.backupNote}>
          Исторические зашифрованные резервные копии удаляются по установленному
          сроку хранения. Восстановить аккаунт через интерфейс будет нельзя.
        </p>

        <label className={styles.confirmationField}>
          <span>
            Для подтверждения введите <strong>{email}</strong>
          </span>
          <input
            autoFocus
            autoComplete="off"
            disabled={isPending}
            value={confirmation}
            aria-label="Email для подтверждения удаления"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>

        {errorMessage ? (
          <p className={styles.errorText} role="alert">
            {errorMessage}
          </p>
        ) : null}

        <footer className={styles.actions}>
          <button
            className={styles.cancelButton}
            type="button"
            disabled={isPending}
            onClick={() => {
              setConfirmation('')
              onCancel()
            }}
          >
            Отмена
          </button>
          <button
            className={styles.deleteButton}
            type="button"
            disabled={!isConfirmed || isPending}
            onClick={onConfirm}
          >
            <TrashIcon size={17} strokeWidth={2.1} />
            <span>{isPending ? 'Удаляем...' : 'Удалить навсегда'}</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
