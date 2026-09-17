import styles from './TodayPage.module.css'

export function TodayStatusNotice({
  action,
  message,
}: {
  action?:
    { disabled?: boolean; label: string; onClick: () => void } | undefined
  message: string
}) {
  return (
    <div className={styles.statusNotice} role="status" aria-live="polite">
      <span>{message}</span>
      {action ? (
        <button
          className={styles.statusNoticeAction}
          disabled={action.disabled}
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
