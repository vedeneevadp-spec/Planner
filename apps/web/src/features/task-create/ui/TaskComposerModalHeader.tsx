import { CheckIcon } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'

interface TaskComposerModalHeaderProps {
  isSubmitDisabled: boolean
  submitLabel: string
  title: string
  titleId: string
  onClose: () => void
}

export function TaskComposerModalHeader({
  isSubmitDisabled,
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
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <button
        className={styles.mobileHeaderSubmit}
        type="submit"
        aria-label={submitLabel}
        disabled={isSubmitDisabled}
      >
        <CheckIcon size={16} />
      </button>
    </div>
  )
}
