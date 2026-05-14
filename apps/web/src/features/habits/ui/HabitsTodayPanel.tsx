import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  getHabitEntryProgressValue,
  getHabitEntryValueLabel,
  getHabitFrequencyLabel,
  type HabitTodayListItem,
  isHabitEntryComplete,
} from '@/entities/habit'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { cx } from '@/shared/lib/classnames'
import {
  CheckIcon,
  CloseIcon,
  IconMark,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import {
  getHabitErrorMessage,
  useHabitsToday,
  useHabitSyncStatus,
  useRemoveHabitEntry,
  useUpsertHabitEntry,
} from '../lib/useHabits'
import styles from './HabitsTodayPanel.module.css'

interface HabitsTodayPanelProps {
  className?: string | undefined
  date: string
  defaultExpanded?: boolean | undefined
  showEmptyAction?: boolean | undefined
}

export function HabitsTodayPanel({
  className,
  date,
  defaultExpanded = false,
  showEmptyAction = true,
}: HabitsTodayPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const habitsTodayQuery = useHabitsToday(date)
  const syncStatus = useHabitSyncStatus()
  const upsertEntryMutation = useUpsertHabitEntry()
  const removeEntryMutation = useRemoveHabitEntry()
  const { uploadedIcons } = useUploadedIconAssets()
  const items = habitsTodayQuery.data?.items ?? []
  const error =
    habitsTodayQuery.error ??
    upsertEntryMutation.error ??
    removeEntryMutation.error
  const doneCount = items.filter((item) =>
    isHabitEntryComplete(item.habit, item.entry),
  ).length
  const skippedCount = items.filter(
    (item) => item.entry?.status === 'skipped',
  ).length
  const totalCount = items.length
  const progressPercent =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const progressLabel = getProgressLabel({
    doneCount,
    isPending: habitsTodayQuery.isPending,
    skippedCount,
    totalCount,
  })
  const summaryLabel =
    syncStatus.queuedMutationCount > 0 && !isExpanded
      ? `${progressLabel} · ${syncStatus.queuedMutationCount} ждут`
      : progressLabel

  function markHabitDone(item: HabitTodayListItem, value: number) {
    upsertEntryMutation.mutate({
      date,
      habitId: item.habit.id,
      input: {
        date,
        expectedVersion: item.entry?.version,
        note: item.entry?.note ?? '',
        status: 'done',
        value,
      },
    })
  }

  function skipHabit(item: HabitTodayListItem) {
    upsertEntryMutation.mutate({
      date,
      habitId: item.habit.id,
      input: {
        date,
        expectedVersion: item.entry?.version,
        note: item.entry?.note ?? '',
        status: 'skipped',
        value: 0,
      },
    })
  }

  function undoHabit(item: HabitTodayListItem) {
    removeEntryMutation.mutate({
      date,
      habitId: item.habit.id,
      input: item.entry ? { expectedVersion: item.entry.version } : {},
    })
  }

  return (
    <section
      className={cx(
        styles.panel,
        !isExpanded && styles.panelCollapsed,
        className,
      )}
      aria-labelledby="habits-today-title"
    >
      <div className={styles.header}>
        <div>
          <Link
            id="habits-today-title"
            className={styles.eyebrowLink}
            to="/habits"
          >
            Привычки
          </Link>
          {isExpanded ? <h3>Ритм дня</h3> : null}
        </div>
        <div className={styles.headerControls}>
          <span className={styles.counter}>{summaryLabel}</span>
          <button
            className={cx(
              styles.collapseToggle,
              isExpanded && styles.collapseToggleActive,
            )}
            type="button"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Свернуть привычки' : 'Открыть привычки'}
            onClick={() => setIsExpanded((value) => !value)}
          >
            <span
              className={cx(
                styles.collapseChevron,
                isExpanded && styles.collapseChevronExpanded,
              )}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {!isExpanded ? (
        <div className={styles.compactMeter} aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      ) : habitsTodayQuery.isPending ? (
        <p className={styles.emptyText}>Загружаем привычки...</p>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>Привычек нет. Создайте первую.</p>
          {showEmptyAction ? (
            <Link className={styles.emptyAction} to="/habits">
              Создать привычку
            </Link>
          ) : null}
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <HabitTodayRow
              key={`${item.habit.id}-${item.entry?.updatedAt ?? 'empty'}`}
              item={item}
              isPending={
                upsertEntryMutation.isPending || removeEntryMutation.isPending
              }
              onDone={(value) => markHabitDone(item, value)}
              onSkip={() => skipHabit(item)}
              onUndo={() => undoHabit(item)}
              uploadedIcons={uploadedIcons}
            />
          ))}
        </div>
      )}

      {isExpanded && error ? (
        <p className={styles.errorText}>{getHabitErrorMessage(error)}</p>
      ) : null}

      {isExpanded && syncStatus.queuedMutationCount > 0 ? (
        <div className={styles.syncLine} aria-live="polite">
          <span>{syncStatus.queuedMutationCount} ждут синхронизации</span>
          <button
            type="button"
            disabled={syncStatus.isSyncing}
            onClick={() => {
              void syncStatus.retry()
            }}
          >
            {syncStatus.isSyncing ? 'Синхронизируем...' : 'Повторить'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function getProgressLabel(input: {
  doneCount: number
  isPending: boolean
  skippedCount: number
  totalCount: number
}): string {
  if (input.isPending && input.totalCount === 0) {
    return 'загрузка'
  }

  if (input.totalCount === 0) {
    return 'нет на сегодня'
  }

  if (input.skippedCount > 0) {
    return `${input.doneCount}/${input.totalCount}, ${input.skippedCount} пропуск`
  }

  return `${input.doneCount}/${input.totalCount}`
}

interface HabitTodayRowProps {
  isPending: boolean
  item: HabitTodayListItem
  uploadedIcons: UploadedIconAsset[]
  onDone: (value: number) => void
  onSkip: () => void
  onUndo: () => void
}

function HabitTodayRow({
  isPending,
  item,
  uploadedIcons,
  onDone,
  onSkip,
  onUndo,
}: HabitTodayRowProps) {
  const initialValue =
    item.habit.targetType === 'check'
      ? item.habit.targetValue
      : getHabitEntryProgressValue(item.habit, item.entry)
  const [value, setValue] = useState(initialValue)
  const isDone = isHabitEntryComplete(item.habit, item.entry)
  const isSkipped = item.entry?.status === 'skipped'

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  return (
    <article
      className={cx(
        styles.row,
        isDone && styles.rowDone,
        isSkipped && styles.rowSkipped,
      )}
    >
      <div
        className={styles.iconWrap}
        style={{ backgroundColor: item.habit.color }}
      >
        <IconMark value={item.habit.icon} uploadedIcons={uploadedIcons} />
      </div>

      <div className={styles.rowBody}>
        <div className={styles.rowTitleLine}>
          <h4>{item.habit.title}</h4>
          <span>{getHabitEntryValueLabel(item.habit, item.entry)}</span>
        </div>

        <div className={styles.metaLine}>
          <span>{getHabitFrequencyLabel(item.habit)}</span>
          <span>{item.stats.currentStreak} подряд</span>
          <span>
            {item.stats.weekCompleted}/{item.stats.weekScheduled} неделя
          </span>
        </div>

        <div className={styles.progressTrack} aria-hidden="true">
          <span
            className={styles.progressFill}
            style={{ width: `${item.progressPercent}%` }}
          />
        </div>
      </div>

      <div className={styles.actions}>
        {item.habit.targetType !== 'check' && !isDone && !isSkipped ? (
          <input
            className={styles.valueInput}
            type="number"
            min={0}
            max={999}
            value={value}
            aria-label={`Прогресс привычки ${item.habit.title}`}
            onChange={(event) => setValue(Number(event.target.value))}
          />
        ) : null}

        {isDone || isSkipped ? (
          <button
            className={styles.iconButton}
            type="button"
            disabled={isPending}
            aria-label={`Отменить отметку привычки ${item.habit.title}`}
            onClick={onUndo}
          >
            <CloseIcon size={16} strokeWidth={2.1} />
          </button>
        ) : (
          <>
            <button
              className={styles.iconButton}
              type="button"
              disabled={isPending}
              aria-label={`Выполнить привычку ${item.habit.title}`}
              onClick={() => onDone(value)}
            >
              <CheckIcon size={16} strokeWidth={2.1} />
            </button>
            <button
              className={styles.skipButton}
              type="button"
              disabled={isPending}
              onClick={onSkip}
            >
              Пропуск
            </button>
          </>
        )}
      </div>
    </article>
  )
}
