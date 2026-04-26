import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { UploadedIconAsset } from '@/shared/ui/Icon'

import { SphereForm, type SphereFormValues } from './SphereForm'
import styles from './SpheresPage.module.css'

interface SphereComposerProps {
  uploadedIcons?: UploadedIconAsset[] | undefined
  onCreate: (values: SphereFormValues) => Promise<boolean>
}

export function SphereComposer({
  uploadedIcons = [],
  onCreate,
}: SphereComposerProps) {
  const titleId = useId()
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const openButton = openButtonRef.current
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      openButton?.focus()
    }
  }, [isOpen])

  return (
    <>
      <div className={styles.createActionRow}>
        <button
          ref={openButtonRef}
          className={styles.primaryButton}
          type="button"
          onClick={() => setIsOpen(true)}
        >
          Создать сферу
        </button>
      </div>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={styles.modalOverlay}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <button
                className={styles.backdropButton}
                type="button"
                tabIndex={-1}
                aria-label="Закрыть окно создания сферы"
                onClick={() => setIsOpen(false)}
              />

              <section className={styles.modalPanel}>
                <div className={styles.modalHeader}>
                  <h2 id={titleId}>Новая сфера</h2>
                  <button
                    className={styles.closeButton}
                    type="button"
                    aria-label="Закрыть"
                    onClick={() => setIsOpen(false)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>

                <SphereForm
                  autoFocusTitle
                  embedded
                  showHeader={false}
                  submitLabel="Создать сферу"
                  uploadedIcons={uploadedIcons}
                  onSubmit={async (values) => {
                    const isCreated = await onCreate(values)

                    if (isCreated) {
                      setIsOpen(false)
                    }

                    return isCreated
                  }}
                />
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
