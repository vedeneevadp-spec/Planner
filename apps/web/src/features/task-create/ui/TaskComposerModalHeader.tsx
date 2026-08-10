import { CheckIcon } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'

interface TaskComposerModalHeaderProps {
  isCloseDisabled: boolean
  isSubmitDisabled: boolean
  isSubmitting: boolean
  submitLabel: string
  title: string
  titleId: string
  onClose: () => void
}

export function TaskComposerModalHeader({
  isCloseDisabled,
  isSubmitDisabled,
  isSubmitting,
  submitLabel,
  title,
  titleId,
  onClose,
}: TaskComposerModalHeaderProps) {
  return (
    <div className={styles.modalHeader}>
      <h2 id={titleId}>{title}</h2>
      <button
        className={styles.closeButton}
        type="button"
        aria-label="Закрыть"
        disabled={isCloseDisabled}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <button
        className={styles.mobileHeaderSubmit}
        type="submit"
        aria-label={isSubmitting ? 'Сохраняем…' : submitLabel}
        aria-busy={isSubmitting || undefined}
        disabled={isSubmitDisabled}
      >
        {isSubmitting ? (
          <span className={styles.submitSpinner} aria-hidden="true" />
        ) : (
          <CheckIcon size={16} />
        )}
      </button>
    </div>
  )
}
