import { useId, useState } from 'react'

import { cx } from '@/shared/lib/classnames'
import { addDateDays } from '@/shared/time/time.service'
import { CalendarIcon } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'

const dateShortcuts = [
  { label: 'Сегодня', daysFromToday: 0 },
  { label: 'Завтра', daysFromToday: 1 },
]

interface TaskComposerScheduleFieldsProps {
  plannedDate: string
  plannedEndTime: string
  plannedStartTime: string
  showTimeFields: boolean
  todayKey: string
  onDateShortcut: (daysFromToday: number) => void
  onPlannedDateChange: (plannedDate: string) => void
  onPlannedEndTimeChange: (plannedEndTime: string) => void
  onPlannedStartTimeChange: (plannedStartTime: string) => void
}

export function TaskComposerScheduleFields({
  plannedDate,
  plannedEndTime,
  plannedStartTime,
  showTimeFields,
  todayKey,
  onDateShortcut,
  onPlannedDateChange,
  onPlannedEndTimeChange,
  onPlannedStartTimeChange,
}: TaskComposerScheduleFieldsProps) {
  const scheduleId = useId()
  const [isScheduleExpanded, setIsScheduleExpanded] = useState(false)
  const showSchedule = Boolean(plannedDate) || isScheduleExpanded

  return (
    <section className={cx(styles.columnSection, styles.scheduleSection)}>
      <div className={styles.scheduleActions}>
        <button
          className={styles.scheduleToggle}
          type="button"
          aria-expanded={showSchedule}
          aria-controls={scheduleId}
          onClick={() => {
            if (showSchedule) {
              onPlannedDateChange('')
            }
            setIsScheduleExpanded(!showSchedule)
          }}
        >
          <CalendarIcon size={16} />
          <span>{showSchedule ? 'Оставить без даты' : 'Указать дату'}</span>
        </button>
        {dateShortcuts.map(({ label, daysFromToday }) => (
          <button
            key={daysFromToday}
            className={styles.dateShortcut}
            type="button"
            aria-pressed={plannedDate === addDateDays(todayKey, daysFromToday)}
            onClick={() => onDateShortcut(daysFromToday)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id={scheduleId}
        hidden={!showSchedule}
        className={cx(
          styles.composerMain,
          showTimeFields
            ? styles.composerMainTimeline
            : styles.composerMainCompact,
          showTimeFields && !plannedStartTime && styles.composerMainPair,
        )}
      >
        <label className={styles.field}>
          <span>План</span>
          <input
            type="date"
            value={plannedDate}
            onChange={(event) => {
              onPlannedDateChange(event.target.value)
            }}
          />
        </label>

        {showTimeFields ? (
          <>
            <label className={styles.field}>
              <span>Старт</span>
              <input
                type="time"
                value={plannedStartTime}
                disabled={!plannedDate}
                onChange={(event) => {
                  onPlannedStartTimeChange(event.target.value)
                }}
              />
            </label>

            {plannedStartTime ? (
              <label className={cx(styles.field, styles.finishField)}>
                <span>Финиш</span>
                <input
                  type="time"
                  value={plannedEndTime}
                  disabled={!plannedDate || !plannedStartTime}
                  onChange={(event) => {
                    onPlannedEndTimeChange(event.target.value)
                  }}
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}
