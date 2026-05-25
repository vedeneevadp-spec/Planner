import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { UploadedIconAsset } from '@/shared/ui/Icon'

import { SphereForm, type SphereFormValues } from './SphereForm'
import styles from './SpheresPage.module.css'

interface SphereComposerProps {
  hideOpenButton?: boolean | undefined
  openRequestId?: string | null | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  onCreate: (values: SphereFormValues) => Promise<boolean>
}

export function SphereComposer({
  hideOpenButton = false,
  openRequestId,
  uploadedIcons = [],
  onCreate,
}: SphereComposerProps) {
  const titleId = useId()
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const [isManuallyOpen, setIsManuallyOpen] = useState(false)
  const [dismissedOpenRequestId, setDismissedOpenRequestId] = useState<
    string | null
  >(null)
  const isOpenFromRequest = Boolean(
    openRequestId && dismissedOpenRequestId !== openRequestId,
  )
  const isOpen = isManuallyOpen || isOpenFromRequest

  function closeComposer() {
    setIsManuallyOpen(false)

    if (openRequestId) {
      setDismissedOpenRequestId(openRequestId)
    }
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const openButton = openButtonRef.current
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsManuallyOpen(false)

        if (openRequestId) {
          setDismissedOpenRequestId(openRequestId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      openButton?.focus()
    }
  }, [isOpen, openRequestId])

  return (
    <>
      {hideOpenButton ? null : (
        <div className={styles.createActionRow}>
          <button
            ref={openButtonRef}
            className={styles.primaryButton}
            type="button"
            onClick={() => setIsManuallyOpen(true)}
          >
            Создать сферу
          </button>
        </div>
      )}

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
                onClick={closeComposer}
              />

              <section className={styles.modalPanel}>
                <div className={styles.modalHeader}>
                  <h2 id={titleId}>Новая сфера</h2>
                  <button
                    className={styles.closeButton}
                    type="button"
                    aria-label="Закрыть"
                    onClick={closeComposer}
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
                      closeComposer()
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
