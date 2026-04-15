import { NavLink } from 'react-router-dom'

import { getPlannerSummary } from '@/entities/task'
import { usePlanner } from '@/features/planner'
import { cx } from '@/shared/lib/classnames'
import { formatLongDate, getDateKey } from '@/shared/lib/date'

import styles from './Sidebar.module.css'

const navigation = [
  { to: '/today', label: 'Today' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/projects', label: 'Projects' },
] as const

export function Sidebar() {
  const { tasks } = usePlanner()
  const todayKey = getDateKey(new Date())
  const summary = getPlannerSummary(tasks, todayKey)

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandBlock}>
        <p className={styles.eyebrow}>Personal Planner</p>
        <h1>Мой рабочий ритм</h1>
        <p className={styles.copy}>
          Первый MVP без синка и лишней инфраструктуры. Здесь можно быстро
          захватить задачу, выбрать фокус на день, собрать таймлайн и разложить
          всё по проектам.
        </p>
      </div>

      <nav aria-label="Main navigation" className={styles.navList}>
        {navigation.map((item) => {
          const count =
            item.to === '/today'
              ? summary.focusCount + summary.overdueCount
              : item.to === '/timeline'
                ? summary.timelineCount
                : item.to === '/inbox'
                  ? summary.inboxCount
                  : summary.projectCount

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cx(styles.navItem, isActive && styles.navItemActive)
              }
            >
              <span>{item.label}</span>
              <strong>{count}</strong>
            </NavLink>
          )
        })}
      </nav>

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
            <span>Inbox</span>
            <strong>{summary.inboxCount}</strong>
          </div>
          <div>
            <span>Done</span>
            <strong>{summary.doneTodayCount}</strong>
          </div>
        </div>
      </section>
    </aside>
  )
}
