import type { Sphere } from '@/entities/sphere'
import { SpherePicker } from '@/entities/sphere'
import {
  ResourcePicker,
  type ResourceValue,
  RoutineTaskFields,
  type RoutineTaskFormState,
  TaskRecurrenceFields,
  type TaskRecurrenceFormState,
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
import { QuickPlanActions } from './TaskComposerQuickActions'

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
  projectId: string
  recurrenceForm: TaskRecurrenceFormState
  remindBeforeStart: boolean
  requiresConfirmation: boolean
  resource: ResourceValue
  routineForm: RoutineTaskFormState
  spheres: Sphere[]
  taskType: TaskTypeValue
  todayKey: string
  tomorrowKey: string
  uploadedIcons: UploadedIconAsset[]
  workspaceUsers: WorkspaceUserOption[]
  onAssigneeUserIdChange: (assigneeUserId: string) => void
  onPlannedDateChange: (plannedDate: string) => void
  onProjectIdChange: (projectId: string) => void
  onRecurrenceChange: (recurrenceForm: TaskRecurrenceFormState) => void
  onRemindBeforeStartChange: (remindBeforeStart: boolean) => void
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
  projectId,
  recurrenceForm,
  remindBeforeStart,
  requiresConfirmation,
  resource,
  routineForm,
  spheres,
  taskType,
  todayKey,
  tomorrowKey,
  uploadedIcons,
  workspaceUsers,
  onAssigneeUserIdChange,
  onPlannedDateChange,
  onProjectIdChange,
  onRecurrenceChange,
  onRemindBeforeStartChange,
  onRequiresConfirmationChange,
  onResourceChange,
  onRoutineFormChange,
  onTaskTypeChange,
}: TaskComposerDetailsFieldsProps) {
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

      {isReminderAvailable && !isHabitTaskType ? (
        <section className={styles.columnSection}>
          <div className={styles.checkboxField}>
            <input
              id={`${confirmationFieldId}-reminder`}
              type="checkbox"
              checked={remindBeforeStart}
              onChange={(event) => {
                onRemindBeforeStartChange(event.target.checked)
              }}
            />
            <span className={styles.checkboxCopy}>
              <label
                className={styles.checkboxLabel}
                htmlFor={`${confirmationFieldId}-reminder`}
              >
                Напомнить за 15 минут
              </label>
            </span>
          </div>
        </section>
      ) : null}

      {isSharedWorkspace && !isHabitTaskType ? (
        <section className={styles.columnSection}>
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
        <section className={styles.columnSection}>
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
        <section className={styles.columnSection}>
          <RoutineTaskFields
            showTargetFields={isHabitTaskType}
            value={routineForm}
            onChange={onRoutineFormChange}
          />
        </section>
      ) : null}

      {canUseRecurrence ? (
        <section className={styles.columnSection}>
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

      {!isHabitTaskType ? (
        <QuickPlanActions
          as="section"
          className={cx(styles.columnSection, styles.quickActionsSection)}
          todayKey={todayKey}
          tomorrowKey={tomorrowKey}
          onChange={onPlannedDateChange}
        />
      ) : null}
    </div>
  )
}
