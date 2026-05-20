import type { RefObject } from 'react'

import type { Sphere } from '@/entities/sphere'
import type { TaskTemplate } from '@/entities/task-template'
import { cx } from '@/shared/lib/classnames'
import { IconChoicePicker, type UploadedIconAsset } from '@/shared/ui/Icon'

import styles from './TaskComposer.module.css'
import { TaskComposerScheduleFields } from './TaskComposerScheduleFields'
import { TaskComposerTemplates } from './TaskComposerTemplates'

interface TaskComposerPrimaryFieldsProps {
  icon: string
  isHabitTaskType: boolean
  isTemplatesExpanded: boolean
  note: string
  pendingTemplateId: string | null
  plannedDate: string
  plannedEndTime: string
  plannedStartTime: string
  selectedTemplateId: string | null
  showTimeFields: boolean
  spheres: Sphere[]
  taskTemplates: TaskTemplate[]
  title: string
  titleFieldLabel: string
  titleInputRef: RefObject<HTMLInputElement | null>
  uploadedIcons: UploadedIconAsset[]
  onApplyTemplate: (template: TaskTemplate) => void
  onCreateFromTemplate: (template: TaskTemplate) => void
  onIconChange: (icon: string) => void
  onNoteChange: (note: string) => void
  onPlannedDateChange: (plannedDate: string) => void
  onPlannedEndTimeChange: (plannedEndTime: string) => void
  onPlannedStartTimeChange: (plannedStartTime: string) => void
  onRemoveTemplate: (template: TaskTemplate) => void
  onTemplatesExpandedChange: (isExpanded: boolean) => void
  onTitleChange: (title: string) => void
}

export function TaskComposerPrimaryFields({
  icon,
  isHabitTaskType,
  isTemplatesExpanded,
  note,
  pendingTemplateId,
  plannedDate,
  plannedEndTime,
  plannedStartTime,
  selectedTemplateId,
  showTimeFields,
  spheres,
  taskTemplates,
  title,
  titleFieldLabel,
  titleInputRef,
  uploadedIcons,
  onApplyTemplate,
  onCreateFromTemplate,
  onIconChange,
  onNoteChange,
  onPlannedDateChange,
  onPlannedEndTimeChange,
  onPlannedStartTimeChange,
  onRemoveTemplate,
  onTemplatesExpandedChange,
  onTitleChange,
}: TaskComposerPrimaryFieldsProps) {
  return (
    <div className={styles.columnPanel}>
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

      {!isHabitTaskType ? (
        <TaskComposerTemplates
          isExpanded={isTemplatesExpanded}
          pendingTemplateId={pendingTemplateId}
          selectedTemplateId={selectedTemplateId}
          spheres={spheres}
          templates={taskTemplates}
          uploadedIcons={uploadedIcons}
          onApplyTemplate={onApplyTemplate}
          onCreateFromTemplate={onCreateFromTemplate}
          onExpandedChange={onTemplatesExpandedChange}
          onRemoveTemplate={onRemoveTemplate}
        />
      ) : null}
    </div>
  )
}
