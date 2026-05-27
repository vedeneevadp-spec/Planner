import type { Sphere } from '@/entities/sphere'
import { SpherePicker } from '@/entities/sphere'
import {
  ResourcePicker,
  type ResourceValue,
  RoutineTaskFields,
  type RoutineTaskFormState,
  TaskRecurrenceFields,
  type TaskRecurrenceFormState,
  type TaskReminderOffsetMinutes,
  TaskReminderPicker,
  TaskTypePicker,
  type TaskTypeValue,
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
  isHabitTaskType: boolean
  isReminderAvailable: boolean
  isRoutineLikeTaskType: boolean
  isSharedWorkspace: boolean
  plannedDate: string
  plannedEndTime: string
  plannedStartTime: string
  projectId: string
  recurrenceForm: TaskRecurrenceFormState
  reminderOffsets: TaskReminderOffsetMinutes[]
  requiresConfirmation: boolean
  resource: ResourceValue
  routineForm: RoutineTaskFormState
  showTimeFields: boolean
  spheres: Sphere[]
  taskType: TaskTypeValue
  uploadedIcons: UploadedIconAsset[]
  workspaceUsers: WorkspaceUserOption[]
  onAssigneeUserIdChange: (assigneeUserId: string) => void
  onPlannedEndTimeChange: (plannedEndTime: string) => void
  onProjectIdChange: (projectId: string) => void
  onRecurrenceChange: (recurrenceForm: TaskRecurrenceFormState) => void
  onReminderOffsetsChange: (
    reminderOffsets: TaskReminderOffsetMinutes[],
  ) => void
  onRequiresConfirmationChange: (requiresConfirmation: boolean) => void
  onResourceChange: (resource: ResourceValue) => void
  onRoutineFormChange: (routineForm: RoutineTaskFormState) => void
  onTaskTypeChange: (taskType: TaskTypeValue) => void
}

export function TaskComposerDetailsFields({
  assigneeUserId,
  canUseRecurrence,
  confirmationFieldId,
  isHabitTaskType,
  isReminderAvailable,
  isRoutineLikeTaskType,
  isSharedWorkspace,
  plannedDate,
  plannedEndTime,
  plannedStartTime,
  projectId,
  recurrenceForm,
  reminderOffsets,
  requiresConfirmation,
  resource,
  routineForm,
  showTimeFields,
  spheres,
  taskType,
  uploadedIcons,
  workspaceUsers,
  onAssigneeUserIdChange,
  onPlannedEndTimeChange,
  onProjectIdChange,
  onRecurrenceChange,
  onReminderOffsetsChange,
  onRequiresConfirmationChange,
  onResourceChange,
  onRoutineFormChange,
  onTaskTypeChange,
}: TaskComposerDetailsFieldsProps) {
  const showMobileFinish =
    showTimeFields && !isHabitTaskType && Boolean(plannedStartTime)

  return (
    <div className={styles.columnPanel}>
      <section className={cx(styles.columnSection, styles.projectSection)}>
        <SpherePicker
          className={styles.fieldProject}
          emptyLabel={getEmptyProjectLabel()}
          label={getSpherePickerLabel()}
          spheres={spheres}
          uploadedIcons={uploadedIcons}
          value={projectId}
          onChange={onProjectIdChange}
        />
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

      <section className={cx(styles.columnSection, styles.typeSection)}>
        <TaskTypePicker
          className={styles.fieldType}
          value={taskType}
          onChange={onTaskTypeChange}
        />
      </section>

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
    </div>
  )
}
