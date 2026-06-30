import type { RefObject } from 'react'

import { TaskImportanceToggle } from '@/entities/task/ui'
import { cx } from '@/shared/lib/classnames'

import styles from './TaskComposer.module.css'
import { TaskComposerScheduleFields } from './TaskComposerScheduleFields'

interface TaskComposerPrimaryFieldsProps {
  isImportant: boolean
  isHabitTaskType: boolean
  note: string
  plannedDate: string
  plannedEndTime: string
  plannedStartTime: string
  showTimeFields: boolean
  title: string
  titleFieldLabel: string
  titleInputRef: RefObject<HTMLInputElement | null>
  onImportantChange: (isImportant: boolean) => void
  onNoteChange: (note: string) => void
  onPlannedDateChange: (plannedDate: string) => void
  onPlannedEndTimeChange: (plannedEndTime: string) => void
  onPlannedStartTimeChange: (plannedStartTime: string) => void
  onTitleChange: (title: string) => void
}

export function TaskComposerPrimaryFields({
  isImportant,
  isHabitTaskType,
  note,
  plannedDate,
  plannedEndTime,
  plannedStartTime,
  showTimeFields,
  title,
  titleFieldLabel,
  titleInputRef,
  onImportantChange,
  onNoteChange,
  onPlannedDateChange,
  onPlannedEndTimeChange,
  onPlannedStartTimeChange,
  onTitleChange,
}: TaskComposerPrimaryFieldsProps) {
  return (
    <div className={styles.columnPanel}>
      <section className={cx(styles.columnSection, styles.titleSection)}>
        <div className={styles.titleInputRow}>
          <label className={cx(styles.field, styles.titleField)}>
            <span>{titleFieldLabel}</span>
            <input
              ref={titleInputRef}
              required
              value={title}
              placeholder="Например: собрать референсы"
              onChange={(event) => {
                onTitleChange(event.target.value)
              }}
            />
          </label>

          {!isHabitTaskType ? (
            <TaskImportanceToggle
              className={styles.titleImportanceToggle}
              isImportant={isImportant}
              onChange={onImportantChange}
            />
          ) : null}
        </div>
      </section>

      <TaskComposerScheduleFields
        isHabitTaskType={isHabitTaskType}
        plannedDate={plannedDate}
        plannedEndTime={plannedEndTime}
        plannedStartTime={plannedStartTime}
        showTimeFields={showTimeFields}
        onPlannedDateChange={onPlannedDateChange}
        onPlannedEndTimeChange={onPlannedEndTimeChange}
        onPlannedStartTimeChange={onPlannedStartTimeChange}
      />

      <section className={cx(styles.columnSection, styles.noteSection)}>
        <label className={cx(styles.field, styles.notePanel)}>
          <span>Заметка</span>
          <textarea
            rows={3}
            value={note}
            placeholder="Контекст"
            onChange={(event) => {
              onNoteChange(event.target.value)
            }}
          />
        </label>
      </section>
    </div>
  )
}
