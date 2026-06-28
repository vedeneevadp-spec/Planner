import { useState } from 'react'

import type { Sphere } from '@/entities/sphere'
import { SpherePicker } from '@/entities/sphere'
import {
  ResourcePicker,
  type ResourceValue,
  RoutineTaskFields,
  type RoutineTaskFormState,
  TaskIconPickerDialog,
  TaskIconSelectButton,
  type TaskNecessity,
  TaskNecessityPicker,
  TaskRecurrenceFields,
  type TaskRecurrenceFormState,
  type TaskReminderOffsetMinutes,
  TaskReminderPicker,
} from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import type { UploadedIconAsset } from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  getEmptyProjectLabel,
  getSpherePickerLabel,
} from '../model/task-composer-model'
import styles from './TaskComposer.module.css'

interface WorkspaceUserOption {
  displayName: string
  id: string
}

interface TaskComposerDetailsFieldsProps {
  assigneeUserId: string
  canUseRecurrence: boolean
  confirmationFieldId: string
  icon: string
  isHabitTaskType: boolean
  isReminderAvailable: boolean
  isRoutineLikeTaskType: boolean
  isSharedWorkspace: boolean
  plannedDate: string
  plannedEndTime: string
  plannedStartTime: string
  projectId: string
  necessity: TaskNecessity
  recurrenceForm: TaskRecurrenceFormState
  reminderOffsets: TaskReminderOffsetMinutes[]
  requiresConfirmation: boolean
  resource: ResourceValue
  routineForm: RoutineTaskFormState
  showTimeFields: boolean
  spheres: Sphere[]
  uploadedIcons: UploadedIconAsset[]
  workspaceUsers: WorkspaceUserOption[]
  onAssigneeUserIdChange: (assigneeUserId: string) => void
  onIconChange: (icon: string) => void
  onPlannedEndTimeChange: (plannedEndTime: string) => void
  onProjectIdChange: (projectId: string) => void
  onNecessityChange: (necessity: TaskNecessity) => void
  onRecurrenceChange: (recurrenceForm: TaskRecurrenceFormState) => void
  onReminderOffsetsChange: (
    reminderOffsets: TaskReminderOffsetMinutes[],
  ) => void
  onRequiresConfirmationChange: (requiresConfirmation: boolean) => void
  onResourceChange: (resource: ResourceValue) => void
  onRoutineFormChange: (routineForm: RoutineTaskFormState) => void
}

export function TaskComposerDetailsFields({
  assigneeUserId,
  canUseRecurrence,
  confirmationFieldId,
  icon,
  isHabitTaskType,
  isReminderAvailable,
  isRoutineLikeTaskType,
  isSharedWorkspace,
  plannedDate,
  plannedEndTime,
  plannedStartTime,
  projectId,
  necessity,
  recurrenceForm,
  reminderOffsets,
  requiresConfirmation,
  resource,
  routineForm,
  showTimeFields,
  spheres,
  uploadedIcons,
  workspaceUsers,
  onAssigneeUserIdChange,
  onIconChange,
  onPlannedEndTimeChange,
  onProjectIdChange,
  onNecessityChange,
  onRecurrenceChange,
  onReminderOffsetsChange,
  onRequiresConfirmationChange,
  onResourceChange,
  onRoutineFormChange,
}: TaskComposerDetailsFieldsProps) {
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const showMobileFinish =
    showTimeFields && !isHabitTaskType && Boolean(plannedStartTime)

  return (
    <div className={styles.columnPanel}>
      <section className={cx(styles.columnSection, styles.projectSection)}>
        <div className={styles.projectIconRow}>
          <SpherePicker
            className={styles.fieldProject}
            emptyLabel={getEmptyProjectLabel()}
            label={getSpherePickerLabel()}
            spheres={spheres}
            uploadedIcons={uploadedIcons}
            value={projectId}
            onChange={onProjectIdChange}
          />

          <TaskIconSelectButton
            className={styles.projectIconButton}
            uploadedIcons={uploadedIcons}
            value={icon}
            onClick={() => setIsIconPickerOpen(true)}
          />
        </div>
      </section>

      {showMobileFinish ? (
        <section
          className={cx(styles.columnSection, styles.mobileFinishSection)}
        >
          <label className={styles.field}>
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
        </section>
      ) : null}

      {isReminderAvailable && !isHabitTaskType ? (
        <section
          className={cx(
            styles.columnSection,
            styles.reminderSection,
            showMobileFinish && styles.reminderWithFinish,
          )}
        >
          <TaskReminderPicker
            className={styles.field}
            value={reminderOffsets}
            onChange={onReminderOffsetsChange}
          />
        </section>
      ) : null}

      {isSharedWorkspace && !isHabitTaskType ? (
        <section className={cx(styles.columnSection, styles.assigneeSection)}>
          <SelectPicker
            className={styles.field}
            label="Исполнитель"
            value={assigneeUserId}
            options={[
              { label: 'Без исполнителя', value: '' },
              ...workspaceUsers.map((user) => ({
                label: user.displayName,
                value: user.id,
              })),
            ]}
            onChange={onAssigneeUserIdChange}
          />
        </section>
      ) : null}

      {isSharedWorkspace && !isHabitTaskType ? (
        <section
          className={cx(styles.columnSection, styles.confirmationSection)}
        >
          <div className={styles.checkboxField}>
            <input
              id={confirmationFieldId}
              type="checkbox"
              checked={requiresConfirmation}
              onChange={(event) => {
                onRequiresConfirmationChange(event.target.checked)
              }}
            />
            <span className={styles.checkboxCopy}>
              <label
                className={styles.checkboxLabel}
                htmlFor={confirmationFieldId}
              >
                Требуется подтверждение
              </label>
              <small id={`${confirmationFieldId}-hint`}>
                Завершить такую задачу сможет только её автор.
              </small>
            </span>
          </div>
        </section>
      ) : null}

      {!isHabitTaskType ? (
        <section className={cx(styles.columnSection, styles.necessitySection)}>
          <TaskNecessityPicker
            className={styles.fieldNecessity}
            value={necessity}
            onChange={onNecessityChange}
          />
        </section>
      ) : null}

      {isRoutineLikeTaskType ? (
        <section className={cx(styles.columnSection, styles.routineSection)}>
          <RoutineTaskFields
            showTargetFields={isHabitTaskType}
            value={routineForm}
            onChange={onRoutineFormChange}
          />
        </section>
      ) : null}

      {canUseRecurrence ? (
        <section className={cx(styles.columnSection, styles.recurrenceSection)}>
          <TaskRecurrenceFields
            value={recurrenceForm}
            onChange={onRecurrenceChange}
          />
        </section>
      ) : null}

      {!isHabitTaskType ? (
        <section className={cx(styles.columnSection, styles.resourceSection)}>
          <ResourcePicker
            className={styles.fieldResource}
            value={resource}
            onChange={onResourceChange}
          />
        </section>
      ) : null}

      {isIconPickerOpen ? (
        <TaskIconPickerDialog
          uploadedIcons={uploadedIcons}
          value={icon}
          onChange={onIconChange}
          onClose={() => setIsIconPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}
