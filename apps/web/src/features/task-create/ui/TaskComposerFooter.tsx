import { cx } from '@/shared/lib/classnames'
import { PlusIcon } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'

interface TaskComposerFooterProps {
  isSubmitDisabled: boolean
  isSubmitting: boolean
  submitLabel: string
}

export function TaskComposerFooter({
  isSubmitDisabled,
  isSubmitting,
  submitLabel,
}: TaskComposerFooterProps) {
  return (
    <div className={styles.footer}>
      <button
        className={cx(styles.primaryButton, styles.footerPrimaryButton)}
        type="submit"
        disabled={isSubmitDisabled}
        aria-busy={isSubmitting || undefined}
      >
        <span className={styles.buttonIconStrong} aria-hidden="true">
          {isSubmitting ? (
            <span className={styles.submitSpinner} />
          ) : (
            <PlusIcon size={16} />
          )}
        </span>
        {isSubmitting ? 'Сохраняем…' : submitLabel}
      </button>
    </div>
  )
}
