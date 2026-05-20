import { cx } from '@/shared/lib/classnames'
import { PlusIcon } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'
import { BookmarkRibbonIcon } from './TaskComposerQuickActions'

interface TaskComposerFooterProps {
  isHabitTaskType: boolean
  isSaveTemplateDisabled: boolean
  isSubmitDisabled: boolean
  submitLabel: string
  onSaveTemplate: () => void
}

export function TaskComposerFooter({
  isHabitTaskType,
  isSaveTemplateDisabled,
  isSubmitDisabled,
  submitLabel,
  onSaveTemplate,
}: TaskComposerFooterProps) {
  return (
    <div className={styles.footer}>
      {!isHabitTaskType ? (
        <button
          className={cx(styles.ghostButton, styles.footerGhostButton)}
          type="button"
          disabled={isSaveTemplateDisabled}
          onClick={onSaveTemplate}
        >
          <span className={styles.buttonIcon} aria-hidden="true">
            <BookmarkRibbonIcon />
          </span>
          Сохранить как шаблон
        </button>
      ) : null}

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
