import { useMemo } from 'react'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { TaskComposer } from '@/features/task-create'
import { formatShortDate, getDateKey } from '@/shared/lib/date'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import { buildRoutineHabitStats } from '../lib/routine-habit-stats'
import styles from './HabitsPage.module.css'

export function HabitsPage() {
  const todayKey = getDateKey(new Date())
  const { errorMessage, tasks } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const stats = useMemo(
    () => buildRoutineHabitStats(tasks, todayKey),
    [tasks, todayKey],
  )

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Habits"
        description="Статистика по регулярным задачам из блока рутины."
        actions={
          <TaskComposer
            defaultTaskType="routine"
            initialPlannedDate={todayKey}
            openButtonLabel="Новая рутина"
          />
        }
      />

      <section className={styles.summaryBand}>
        <div>
          <span>Активных</span>
          <strong>{stats.activeCount}</strong>
        </div>
        <div>
          <span>Сегодня</span>
          <strong>
            {stats.completedToday}/{stats.scheduledToday}
          </strong>
        </div>
        <div>
          <span>Лучший streak</span>
          <strong>{stats.bestStreak}</strong>
        </div>
      </section>

      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

      {stats.items.length === 0 ? (
        <div className={pageStyles.emptyPanel}>
          <p>Привычки появятся из задач типа «Рутина».</p>
        </div>
      ) : (
        <div className={styles.habitGrid}>
          {stats.items.map((item) => (
            <article key={item.seriesId} className={styles.habitCard}>
              <div className={styles.cardHeader}>
                <span className={styles.habitIcon}>
                  {item.icon ? (
                    <IconMark value={item.icon} uploadedIcons={uploadedIcons} />
                  ) : (
                    <span aria-hidden="true">✓</span>
                  )}
                </span>

                <span className={styles.statusBadge}>
                  {item.completedToday ? 'сегодня готово' : 'в рутине'}
                </span>
              </div>

              <div className={styles.cardBody}>
                <p className={styles.eyebrow}>{item.frequencyLabel}</p>
                <h3>{item.title}</h3>
                <p>{item.targetLabel}</p>
              </div>

              <div className={styles.cardStats}>
                <div>
                  <span>Streak</span>
                  <strong>{item.currentStreak}</strong>
                </div>
                <div>
                  <span>Месяц</span>
                  <strong>
                    {item.monthCompleted}/{item.monthScheduled}
                  </strong>
                </div>
                <div>
                  <span>Процент</span>
                  <strong>{item.completionRate}%</strong>
                </div>
                <div>
                  <span>Следующая</span>
                  <strong>
                    {item.nextPlannedDate
                      ? formatShortDate(item.nextPlannedDate)
                      : 'нет'}
                  </strong>
                </div>
              </div>

              <div className={styles.cardFooter}>
                <span>Лучший streak: {item.bestStreak}</span>
                <span>
                  Последняя:{' '}
                  {item.lastCompletedDate
                    ? formatShortDate(item.lastCompletedDate)
                    : 'нет'}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
