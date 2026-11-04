import { useId, useState } from 'react'

import { cx } from '@/shared/lib/classnames'
import { CalendarIcon } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'

interface TaskComposerScheduleFieldsProps {
  isHabitTaskType: boolean
  plannedDate: string
  plannedEndTime: string
  plannedStartTime: string
  showTimeFields: boolean
  onPlannedDateChange: (plannedDate: string) => void
  onPlannedEndTimeChange: (plannedEndTime: string) => void
  onPlannedStartTimeChange: (plannedStartTime: string) => void
}

export function TaskComposerScheduleFields({
  isHabitTaskType,
  plannedDate,
  plannedEndTime,
  plannedStartTime,
  showTimeFields,
  onPlannedDateChange,
  onPlannedEndTimeChange,
  onPlannedStartTimeChange,
}: TaskComposerScheduleFieldsProps) {
  const scheduleId = useId()
  const [isScheduleExpanded, setIsScheduleExpanded] = useState(false)
  const showSchedule =
    isHabitTaskType || Boolean(plannedDate) || isScheduleExpanded

  return (
    <section className={cx(styles.columnSection, styles.scheduleSection)}>
      {!isHabitTaskType ? (
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
      ) : null}
      <div
        id={scheduleId}
        hidden={!showSchedule}
        className={cx(
          styles.composerMain,
          showTimeFields && !isHabitTaskType
            ? styles.composerMainTimeline
            : styles.composerMainCompact,
          showTimeFields &&
            !isHabitTaskType &&
            !plannedStartTime &&
            styles.composerMainPair,
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

        {showTimeFields && !isHabitTaskType ? (
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
