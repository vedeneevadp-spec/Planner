import type { HabitRecord } from '@planner/contracts'
import { useMemo } from 'react'

import {
  getHabitEntryValueLabel,
  getHabitFrequencyLabel,
  getHabitTargetLabel,
  isHabitEntryComplete,
  sortHabits,
} from '@/entities/habit'
import { useUploadedIconAssets } from '@/features/emoji-library'
import {
  getHabitErrorMessage,
  HabitsTodayPanel,
  useHabits,
  useHabitStats,
  useHabitsToday,
  useHabitSyncStatus,
  useRemoveHabit,
  useUpdateHabit,
} from '@/features/habits'
import { TaskComposer } from '@/features/task-create'
import { cx } from '@/shared/lib/classnames'
import { formatShortDate, getDateKey } from '@/shared/lib/date'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './HabitsPage.module.css'

export function HabitsPage() {
  const todayKey = getDateKey(new Date())
  const monthStart = `${todayKey.slice(0, 7)}-01`
  const habitsQuery = useHabits()
  const todayQuery = useHabitsToday(todayKey)
  const statsQuery = useHabitStats(monthStart, todayKey)
  const syncStatus = useHabitSyncStatus()
  const updateHabitMutation = useUpdateHabit()
  const removeHabitMutation = useRemoveHabit()
  const { uploadedIcons } = useUploadedIconAssets()
  const habits = useMemo(
    () => sortHabits(habitsQuery.data ?? []),
    [habitsQuery.data],
  )
  const todayItems = todayQuery.data?.items ?? []
  const statsByHabitId = useMemo(
    () =>
      new Map(
        (statsQuery.data?.stats ?? []).map((stats) => [stats.habitId, stats]),
      ),
    [statsQuery.data?.stats],
  )
  const error =
    habitsQuery.error ??
    todayQuery.error ??
    statsQuery.error ??
    updateHabitMutation.error ??
    removeHabitMutation.error ??
    syncStatus.error
  const activeCount = habits.filter((habit) => habit.isActive).length
  const doneTodayCount = todayItems.filter((item) =>
    isHabitEntryComplete(item.habit, item.entry),
  ).length
  const bestStreak = Math.max(
    0,
    ...(statsQuery.data?.stats ?? []).map((stats) => stats.bestStreak),
  )

  function toggleHabitActive(habit: HabitRecord) {
    updateHabitMutation.mutate({
      habitId: habit.id,
      input: {
        expectedVersion: habit.version,
        isActive: !habit.isActive,
      },
    })
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        actions={
          <TaskComposer
            defaultTaskType="habit"
            initialPlannedDate={todayKey}
            mobileOpenButtonMode="inline"
            openButtonLabel="Новая привычка"
            showTimeFields={false}
          />
        }
        kicker="Habits"
        description="Привычки со статистикой, streak и отметками по дням."
      />

      <section className={styles.summaryBand}>
        <div>
          <span>Активных</span>
          <strong>{activeCount}</strong>
        </div>
        <div>
          <span>Сегодня</span>
          <strong>
            {doneTodayCount}/{todayItems.length}
          </strong>
        </div>
        <div>
          <span>Лучший streak</span>
          <strong>{bestStreak}</strong>
        </div>
      </section>

      <HabitsTodayPanel
        date={todayKey}
        defaultExpanded
        showEmptyAction={false}
      />

      {syncStatus.queuedMutationCount > 0 ||
      syncStatus.conflictedMutationCount > 0 ? (
        <section
          className={cx(
            styles.syncBanner,
            syncStatus.conflictedMutationCount > 0 && styles.syncBannerWarning,
          )}
        >
          <div>
            <strong>
              {syncStatus.conflictedMutationCount > 0
                ? 'Есть конфликтующие изменения'
                : 'Есть изменения offline'}
            </strong>
            <span>{syncStatus.queuedMutationCount} ждут синхронизации</span>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={syncStatus.isSyncing}
            onClick={() => {
              void syncStatus.retry()
            }}
          >
            {syncStatus.isSyncing ? 'Синхронизируем...' : 'Повторить'}
          </button>
        </section>
      ) : null}

      {error ? (
        <p className={styles.errorText}>{getHabitErrorMessage(error)}</p>
      ) : null}

      {habitsQuery.isPending && habits.length === 0 ? (
        <div className={pageStyles.emptyPanel}>
          <p>Загружаем привычки...</p>
        </div>
      ) : habits.length === 0 ? (
        <div className={pageStyles.emptyPanel}>
          <p>Привычек пока нет. Создайте первую через кнопку вверху.</p>
        </div>
      ) : (
        <div className={styles.habitGrid}>
          {habits.map((habit) => {
            const stats = statsByHabitId.get(habit.id)
            const todayItem = todayItems.find(
              (item) => item.habit.id === habit.id,
            )

            return (
              <article key={habit.id} className={styles.habitCard}>
                <div className={styles.cardHeader}>
                  <span
                    className={styles.habitIcon}
                    style={{ backgroundColor: habit.color }}
                  >
                    <IconMark
                      value={habit.icon}
                      uploadedIcons={uploadedIcons}
                    />
                  </span>

                  <span
                    className={cx(
                      styles.statusBadge,
                      habit.isActive
                        ? styles.statusBadgeActive
                        : styles.statusBadgePaused,
                    )}
                  >
                    {habit.isActive ? 'активна' : 'пауза'}
                  </span>
                </div>

                <div className={styles.cardBody}>
                  <p className={styles.eyebrow}>
                    {getHabitFrequencyLabel(habit)}
                  </p>
                  <h3>{habit.title}</h3>
                  <p>
                    {getHabitTargetLabel(
                      habit.targetType,
                      habit.targetValue,
                      habit.unit,
                    )}
                  </p>
                  {habit.description ? <p>{habit.description}</p> : null}
                </div>

                <div className={styles.cardStats}>
                  <div>
                    <span>Сегодня</span>
                    <strong>
                      {todayItem &&
                      isHabitEntryComplete(todayItem.habit, todayItem.entry)
                        ? 'готово'
                        : todayItem?.entry?.status === 'skipped'
                          ? 'пропуск'
                          : todayItem?.entry
                            ? getHabitEntryValueLabel(
                                todayItem.habit,
                                todayItem.entry,
                              )
                            : todayItem
                              ? 'ожидает'
                              : 'не запланировано'}
                    </strong>
                  </div>
                  <div>
                    <span>Streak</span>
                    <strong>{stats?.currentStreak ?? 0}</strong>
                  </div>
                  <div>
                    <span>Месяц</span>
                    <strong>
                      {stats?.monthCompleted ?? 0}/{stats?.monthScheduled ?? 0}
                    </strong>
                  </div>
                  <div>
                    <span>Процент</span>
                    <strong>{stats?.completionRate ?? 0}%</strong>
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  <span>
                    Последняя:{' '}
                    {stats?.lastCompletedDate
                      ? formatShortDate(stats.lastCompletedDate)
                      : 'нет'}
                  </span>
                  <span>
                    Старт {formatShortDate(habit.startDate)}
                    {habit.endDate
                      ? ` - ${formatShortDate(habit.endDate)}`
                      : ''}
                  </span>
                </div>

                <div className={styles.cardActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={updateHabitMutation.isPending}
                    onClick={() => toggleHabitActive(habit)}
                  >
                    {habit.isActive ? 'Пауза' : 'Возобновить'}
                  </button>
                  <button
                    className={styles.dangerButton}
                    type="button"
                    disabled={removeHabitMutation.isPending}
                    onClick={() => removeHabitMutation.mutate(habit.id)}
                  >
                    Удалить
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
