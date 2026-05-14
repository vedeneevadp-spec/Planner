import type { HabitRecord } from '@planner/contracts'

import {
  getHabitEntryProgressValue,
  getHabitFrequencyLabel,
  getHabitTargetLabel,
  type HabitTodayListItem,
  isHabitEntryComplete,
} from '@/entities/habit'
import { cx } from '@/shared/lib/classnames'
import {
  CheckIcon,
  CloseIcon,
  IconMark,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import styles from './HabitRoutineTaskCard.module.css'

interface HabitRoutineTaskCardProps {
  isPending?: boolean | undefined
  item: HabitTodayListItem
  tone?: 'default' | 'success' | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  onComplete: (item: HabitTodayListItem) => void
  onUndo: (item: HabitTodayListItem) => void
}

export function HabitRoutineTaskCard({
  isPending = false,
  item,
  tone = 'default',
  uploadedIcons = [],
  onComplete,
  onUndo,
}: HabitRoutineTaskCardProps) {
  const { entry, habit } = item
  const isComplete = isHabitEntryComplete(habit, entry)
  const isSkipped = entry?.status === 'skipped'
  const canUndo = isComplete || isSkipped
  const progressValue = getHabitEntryProgressValue(habit, entry)
  const progressPercent = isComplete ? 100 : item.progressPercent
  const progressLabel = getHabitRoutineProgressLabel(habit, progressValue)
  const actionLabel = canUndo
    ? `Отменить отметку привычки ${habit.title}`
    : `Завершить привычку ${habit.title}`

  return (
    <article
      className={cx(
        styles.card,
        (tone === 'success' || isComplete) && styles.success,
        isSkipped && styles.skipped,
      )}
    >
      <div className={styles.main}>
        <div className={styles.cardHeader}>
          <div className={styles.titleRow}>
            <span
              className={styles.iconWrap}
              style={{ backgroundColor: habit.color }}
              aria-hidden="true"
            >
              <IconMark value={habit.icon} uploadedIcons={uploadedIcons} />
            </span>
            <h4>{habit.title}</h4>
          </div>

          <div className={styles.quickActions}>
            <button
              className={cx(styles.button, styles.iconButton)}
              type="button"
              disabled={isPending}
              aria-label={actionLabel}
              title={canUndo ? 'Отменить' : 'Завершить'}
              onClick={() => {
                if (canUndo) {
                  onUndo(item)
                  return
                }

                onComplete(item)
              }}
            >
              {canUndo ? <CloseIcon size={18} /> : <CheckIcon size={18} />}
            </button>
          </div>
        </div>

        {habit.description ? (
          <p className={styles.note}>{habit.description}</p>
        ) : null}

        <div className={styles.meta}>
          <span className={styles.metaChip}>Привычка</span>
          <span className={styles.metaChip}>
            {getHabitFrequencyLabel(habit)}
          </span>
          <span className={styles.metaChip}>{progressLabel}</span>
        </div>

        {habit.targetType !== 'check' || progressPercent > 0 ? (
          <div
            className={styles.progressTrack}
            aria-label={`Прогресс ${progressLabel}`}
          >
            <span
              className={styles.progressFill}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : null}
      </div>
    </article>
  )
}

function getHabitRoutineProgressLabel(
  habit: Pick<HabitRecord, 'targetType' | 'targetValue' | 'unit'>,
  progressValue: number,
): string {
  if (habit.targetType === 'check') {
    return getHabitTargetLabel(habit.targetType, habit.targetValue, habit.unit)
  }

  if (habit.targetType === 'duration') {
    return `${progressValue}/${habit.targetValue} мин`
  }

  return `${progressValue}/${habit.targetValue}${habit.unit ? ` ${habit.unit}` : ''}`
}
