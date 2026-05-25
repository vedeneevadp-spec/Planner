import { type RefObject, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { cx } from '@/shared/lib/classnames'

import styles from './TaskComposer.module.css'

interface TaskComposerOpenButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>
  desktopHidden?: boolean | undefined
  label: string
  mode: 'fab' | 'inline'
  onOpen: () => void
}

export function TaskComposerOpenButton({
  buttonRef,
  desktopHidden = false,
  label,
  mode,
  onOpen,
}: TaskComposerOpenButtonProps) {
  const [isMobileViewport, setIsMobileViewport] = useState(getIsMobileViewport)
  const openButton = (
    <button
      ref={buttonRef}
      aria-label={label}
      data-task-composer-open-button={mode}
      className={cx(
        styles.openButton,
        mode === 'inline' && styles.openButtonInlineMobile,
      )}
      type="button"
      onClick={onOpen}
    >
      <span
        className={styles.openButtonIcon}
        data-task-composer-open-icon=""
        aria-hidden="true"
      >
        +
      </span>
      <span className={styles.openButtonLabel} data-task-composer-open-label="">
        {label}
      </span>
    </button>
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return undefined
    }

    const mobileMedia = window.matchMedia('(max-width: 820px)')

    function syncMobileViewport() {
      setIsMobileViewport(mobileMedia.matches)
    }

    syncMobileViewport()
    mobileMedia.addEventListener('change', syncMobileViewport)

    return () => {
      mobileMedia.removeEventListener('change', syncMobileViewport)
    }
  }, [])

  if (mode === 'fab' && isMobileViewport && typeof document !== 'undefined') {
    return createPortal(openButton, document.body)
  }

  if (desktopHidden && !isMobileViewport) {
    return null
  }

  return (
    <div
      className={cx(
        styles.actionRow,
        mode === 'inline' && styles.actionRowInlineMobile,
      )}
    >
      {openButton}
    </div>
  )
}

function getIsMobileViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false
  }

  return window.matchMedia('(max-width: 820px)').matches
}
