import styles from './TodayPage.module.css'

interface TodayClosedTaskPaginationProps {
  errorMessage: string | null
  hasMore: boolean
  isLoading: boolean
  loadedCount: number
  onLoadMore: () => void
  totalCount: number
}

export function TodayClosedTaskPagination({
  errorMessage,
  hasMore,
  isLoading,
  loadedCount,
  onLoadMore,
  totalCount,
}: TodayClosedTaskPaginationProps) {
  if (!hasMore && !errorMessage) {
    return null
  }

  return (
    <div
      aria-live="polite"
      className={styles.closedTaskPagination}
      role={errorMessage ? 'alert' : 'status'}
    >
      <span className={styles.closedTaskPaginationText}>
        {errorMessage ??
          `Показано ${loadedCount} из ${totalCount} закрытых задач`}
      </span>
      <button
        className={styles.closedTaskPaginationButton}
        disabled={isLoading}
        type="button"
        onClick={onLoadMore}
      >
        {isLoading
          ? 'Загружаем…'
          : errorMessage
            ? 'Повторить'
            : 'Загрузить ещё'}
      </button>
    </div>
  )
}
