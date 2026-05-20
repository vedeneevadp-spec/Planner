import type { RefObject } from 'react'

import { cx } from '@/shared/lib/classnames'

import styles from './TaskComposer.module.css'

interface TaskComposerOpenButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>
  label: string
  mode: 'fab' | 'inline'
  onOpen: () => void
}

export function TaskComposerOpenButton({
  buttonRef,
  label,
  mode,
  onOpen,
}: TaskComposerOpenButtonProps) {
  return (
    <div
      className={cx(
        styles.actionRow,
        mode === 'inline' && styles.actionRowInlineMobile,
      )}
    >
      <button
        ref={buttonRef}
        className={cx(
          styles.openButton,
          mode === 'inline' && styles.openButtonInlineMobile,
        )}
        type="button"
        onClick={onOpen}
      >
        <span className={styles.openButtonIcon} aria-hidden="true">
          +
        </span>
        <span className={styles.openButtonLabel}>{label}</span>
      </button>
    </div>
  )
}
