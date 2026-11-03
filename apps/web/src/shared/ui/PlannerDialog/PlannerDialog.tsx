import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

import { CloseIcon } from '@/shared/ui/Icon'

import styles from './PlannerDialog.module.css'

export function PlannerDialog({
  title,
  subtitle,
  children,
  onClose,
  busy = false,
  initialFocus,
}: {
  title: string
  subtitle?: string | undefined
  children: ReactNode
  onClose: () => void
  busy?: boolean
  initialFocus?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previous = document.activeElement
    dialog.showModal()
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus()
    }
  }, [initialFocus])
  return createPortal(
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (!busy) onClose()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="Закрыть"
            disabled={busy}
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>,
    document.body,
  )
}
