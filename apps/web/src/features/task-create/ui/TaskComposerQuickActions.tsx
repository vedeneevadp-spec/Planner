import styles from './TaskComposer.module.css'

interface QuickPlanActionsProps {
  as?: 'div' | 'section'
  className?: string | undefined
  todayKey: string
  tomorrowKey: string
  onChange: (plannedDate: string) => void
}

export function BookmarkRibbonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4.75H17C17.69 4.75 18.25 5.31 18.25 6V19.25L12 15.4L5.75 19.25V6C5.75 5.31 6.31 4.75 7 4.75Z" />
    </svg>
  )
}

export function QuickPlanActions({
  as: Container = 'div',
  className,
  todayKey,
  tomorrowKey,
  onChange,
}: QuickPlanActionsProps) {
  return (
    <Container className={className}>
      <button
        className={styles.quickActionButton}
        type="button"
        onClick={() => {
          onChange(todayKey)
        }}
      >
        <span className={styles.quickActionIcon} aria-hidden="true">
          <TodaySunIcon />
        </span>
        На сегодня
      </button>
      <button
        className={styles.quickActionButton}
        type="button"
        onClick={() => {
          onChange(tomorrowKey)
        }}
      >
        <span className={styles.quickActionIcon} aria-hidden="true">
          <TomorrowSunIcon />
        </span>
        На завтра
      </button>
      <button
        className={styles.quickActionButton}
        type="button"
        onClick={() => {
          onChange('')
        }}
      >
        <span className={styles.quickActionIcon} aria-hidden="true">
          <InboxTrayIcon />
        </span>
        В inbox
      </button>
    </Container>
  )
}

function TodaySunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3.75V6" />
      <path d="M12 18V20.25" />
      <path d="M3.75 12H6" />
      <path d="M18 12H20.25" />
      <path d="M6.35 6.35L7.95 7.95" />
      <path d="M16.05 16.05L17.65 17.65" />
      <path d="M16.05 7.95L17.65 6.35" />
      <path d="M6.35 17.65L7.95 16.05" />
    </svg>
  )
}

function TomorrowSunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 17.5H20" />
      <path d="M7 17.5C7 14.74 9.24 12.5 12 12.5C14.76 12.5 17 14.74 17 17.5" />
      <path d="M12 7V9.25" />
      <path d="M6.6 10.1L8.2 11.25" />
      <path d="M17.4 10.1L15.8 11.25" />
    </svg>
  )
}

function InboxTrayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.75 12.25L6.9 6.75H17.1L19.25 12.25V18C19.25 18.69 18.69 19.25 18 19.25H6C5.31 19.25 4.75 18.69 4.75 18V12.25Z" />
      <path d="M4.75 12.25H8.4L10.1 14.75H13.9L15.6 12.25H19.25" />
    </svg>
  )
}
