import { formatLongDate } from '@/shared/lib/date'

import styles from './Sidebar.module.css'

interface SidebarTodaySummaryProps {
  summary: {
    doneTodayCount: number
    focusCount: number
    timelineCount: number
    tomorrowCount: number
  }
  todayKey: string
}

export function SidebarTodaySummary({
  summary,
  todayKey,
}: SidebarTodaySummaryProps) {
  return (
    <section className={styles.summaryCard}>
      <p className={styles.summaryLabel}>Сегодня</p>
      <strong>{formatLongDate(todayKey)}</strong>
      <div className={styles.summaryGrid}>
        <div>
          <span>Focus</span>
          <strong>{summary.focusCount}</strong>
        </div>
        <div>
          <span>Timeline</span>
          <strong>{summary.timelineCount}</strong>
        </div>
        <div>
          <span>Tomorrow</span>
          <strong>{summary.tomorrowCount}</strong>
        </div>
        <div>
          <span>Done</span>
          <strong>{summary.doneTodayCount}</strong>
        </div>
      </div>
    </section>
  )
}
