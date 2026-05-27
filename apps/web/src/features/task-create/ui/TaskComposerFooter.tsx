import { cx } from '@/shared/lib/classnames'
import { PlusIcon } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'

interface TaskComposerFooterProps {
  isSubmitDisabled: boolean
  submitLabel: string
}

export function TaskComposerFooter({
  isSubmitDisabled,
  submitLabel,
}: TaskComposerFooterProps) {
  return (
    <div className={styles.footer}>
      <button
        className={cx(styles.primaryButton, styles.footerPrimaryButton)}
        type="submit"
        disabled={isSubmitDisabled}
      >
        <span className={styles.buttonIconStrong} aria-hidden="true">
          <PlusIcon size={16} />
        </span>
        {submitLabel}
      </button>
    </div>
  )
}
