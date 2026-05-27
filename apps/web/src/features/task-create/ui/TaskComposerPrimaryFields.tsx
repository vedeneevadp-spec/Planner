import type { RefObject } from 'react'

import { cx } from '@/shared/lib/classnames'
import { IconChoicePicker, type UploadedIconAsset } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'
import { TaskComposerScheduleFields } from './TaskComposerScheduleFields'

interface TaskComposerPrimaryFieldsProps {
  icon: string
  isHabitTaskType: boolean
  note: string
  plannedDate: string
  plannedEndTime: string
  plannedStartTime: string
  showTimeFields: boolean
  title: string
  titleFieldLabel: string
  titleInputRef: RefObject<HTMLInputElement | null>
  uploadedIcons: UploadedIconAsset[]
  onIconChange: (icon: string) => void
  onNoteChange: (note: string) => void
  onPlannedDateChange: (plannedDate: string) => void
  onPlannedEndTimeChange: (plannedEndTime: string) => void
  onPlannedStartTimeChange: (plannedStartTime: string) => void
  onTitleChange: (title: string) => void
}

export function TaskComposerPrimaryFields({
  icon,
  isHabitTaskType,
  note,
  plannedDate,
  plannedEndTime,
  plannedStartTime,
  showTimeFields,
  title,
  titleFieldLabel,
  titleInputRef,
  uploadedIcons,
  onIconChange,
  onNoteChange,
  onPlannedDateChange,
  onPlannedEndTimeChange,
  onPlannedStartTimeChange,
  onTitleChange,
}: TaskComposerPrimaryFieldsProps) {
  return (
    <div className={styles.columnPanel}>
      <section className={cx(styles.columnSection, styles.titleSection)}>
        <label className={cx(styles.field, styles.titleField)}>
          <span>{titleFieldLabel}</span>
          <input
            ref={titleInputRef}
            required
            value={title}
            placeholder="Например: собрать референсы для недельного плана"
            onChange={(event) => {
              onTitleChange(event.target.value)
            }}
          />
        </label>
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
            placeholder="Контекст, next step, ссылка на материал"
            onChange={(event) => {
              onNoteChange(event.target.value)
            }}
          />
        </label>
      </section>

      <section className={cx(styles.columnSection, styles.visualSection)}>
        <div className={styles.visualPanel}>
          <IconChoicePicker
            allowEmpty={false}
            label="Иконка"
            showEmojiChoices={false}
            value={icon}
            uploadedIcons={uploadedIcons}
            onChange={onIconChange}
          />
        </div>
      </section>
    </div>
  )
}
