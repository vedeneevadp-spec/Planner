import type { WorkspaceUserRecord } from '@planner/contracts'
import { type FormEvent, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Sphere } from '@/entities/sphere'
import { SpherePicker } from '@/entities/sphere'
import { cx } from '@/shared/lib/classnames'
import { getDateKey } from '@/shared/lib/date'
import { IconChoicePicker, type UploadedIconAsset } from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  buildRoutineTaskFromForm,
  createRoutineTaskFormFromRoutine,
  type RoutineTaskFormState,
} from '../model/routine-task'
import type { Task, TaskUpdateInput } from '../model/task.types'
import {
  getResourceFromValue,
  getResourceValueFromTaskResource,
  getTaskImportanceFromType,
  getTaskTypeValue,
  getTaskUrgencyFromType,
  type TaskTypeValue,
} from '../model/task-meta'
import {
  buildTaskRecurrenceFromForm,
  createTaskRecurrenceFormFromRecurrence,
  type TaskRecurrenceFormState,
} from '../model/task-recurrence'
import { RoutineTaskFields } from './RoutineTaskFields'
import styles from './TaskCard.module.css'
import { ResourcePicker, TaskTypePicker } from './TaskMetaPickers'
import { TaskRecurrenceFields } from './TaskRecurrenceFields'

interface TaskEditDialogProps {
  currentActorUserId?: string | undefined
  isSharedWorkspace?: boolean | undefined
  task: Task
  spheres: Sphere[]
  uploadedIcons: UploadedIconAsset[]
  workspaceUsers?: WorkspaceUserRecord[] | undefined
  isPending?: boolean | undefined
  onClose: () => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
}

export function TaskEditDialog({
  currentActorUserId,
  isSharedWorkspace = false,
  task,
  spheres,
  uploadedIcons,
  workspaceUsers = [],
  isPending = false,
  onClose,
  onUpdate,
}: TaskEditDialogProps) {
  const confirmationFieldId = useId()
  const reminderFieldId = useId()
  const reminderAvailabilityRef = useRef(
    !isSharedWorkspace && Boolean(task.plannedDate && task.plannedStartTime),
  )
  const todayKey = getDateKey(new Date())
  const [assigneeUserId, setAssigneeUserId] = useState(
    task.assigneeUserId ?? '',
  )
  const [requiresConfirmation, setRequiresConfirmation] = useState(
    task.requiresConfirmation,
  )
  const [title, setTitle] = useState(task.title)
  const [projectId, setProjectId] = useState(task.projectId ?? '')
  const [plannedDate, setPlannedDate] = useState(task.plannedDate ?? '')
  const [plannedStartTime, setPlannedStartTime] = useState(
    task.plannedStartTime ?? '',
  )
  const [plannedEndTime, setPlannedEndTime] = useState(
    task.plannedEndTime ?? '',
  )
  const [remindBeforeStart, setRemindBeforeStart] = useState(
    task.remindBeforeStart === true,
  )
  const [icon, setIcon] = useState(task.icon)
  const [resource, setResource] = useState(
    getResourceValueFromTaskResource(task.resource),
  )
  const [taskType, setTaskType] = useState<TaskTypeValue>(
    getTaskTypeValue(task),
  )
  const [routineForm, setRoutineForm] = useState<RoutineTaskFormState>(() =>
    createRoutineTaskFormFromRoutine(task.routine),
  )
  const [recurrenceForm, setRecurrenceForm] = useState<TaskRecurrenceFormState>(
    () => createTaskRecurrenceFormFromRecurrence(task.recurrence),
  )
  const [note, setNote] = useState(task.note)
  const canManageConfirmation =
    task.authorUserId !== null && task.authorUserId === currentActorUserId
  const isReminderAvailable =
    !isSharedWorkspace && Boolean(plannedDate && plannedStartTime)
  const canEditRecurrence = taskType !== 'routine' && taskType !== 'habit'

  function handlePlannedDateChange(nextPlannedDate: string) {
    setPlannedDate(nextPlannedDate)

    if (!nextPlannedDate) {
      setPlannedStartTime('')
      setPlannedEndTime('')
      setRemindBeforeStart(false)
      reminderAvailabilityRef.current = false
    }
  }

  function handlePlannedStartTimeChange(nextStartTime: string) {
    const wasAvailable = reminderAvailabilityRef.current
    const nextAvailable =
      !isSharedWorkspace && Boolean(plannedDate && nextStartTime)

    setPlannedStartTime(nextStartTime)

    if (!nextAvailable) {
      setRemindBeforeStart(false)
      reminderAvailabilityRef.current = false
    } else if (!wasAvailable) {
      setRemindBeforeStart(true)
      reminderAvailabilityRef.current = true
    }
  }

  function handleTaskTypeChange(nextTaskType: TaskTypeValue) {
    setTaskType(nextTaskType)

    if (nextTaskType === 'routine' && !plannedDate) {
      setPlannedDate(todayKey)
    }

    if (nextTaskType === 'routine' || nextTaskType === 'habit') {
      setRecurrenceForm(createTaskRecurrenceFormFromRecurrence(null))
    }
  }

  function handleRecurrenceChange(nextForm: TaskRecurrenceFormState) {
    setRecurrenceForm(nextForm)

    if (nextForm.isEnabled && !plannedDate) {
      setPlannedDate(todayKey)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return
    }

    const selectedSphere =
      spheres.find((sphere) => sphere.id === projectId) ?? null
    const projectInput = {
      project: selectedSphere?.name ?? '',
      projectId: selectedSphere?.id ?? null,
    }
    const resolvedPlannedDate =
      canEditRecurrence && recurrenceForm.isEnabled && !plannedDate
        ? todayKey
        : plannedDate
    const hasPlannedDate = Boolean(resolvedPlannedDate)
    const isUpdated = await onUpdate(task.id, {
      assigneeUserId: isSharedWorkspace ? assigneeUserId || null : null,
      dueDate: task.dueDate ?? null,
      icon,
      importance: getTaskImportanceFromType(taskType),
      note,
      plannedDate: resolvedPlannedDate || null,
      plannedEndTime:
        hasPlannedDate && plannedStartTime ? plannedEndTime || null : null,
      plannedStartTime: hasPlannedDate ? plannedStartTime || null : null,
      project: projectInput.project,
      projectId: projectInput.projectId,
      recurrence: canEditRecurrence
        ? buildTaskRecurrenceFromForm(
            recurrenceForm,
            resolvedPlannedDate || todayKey,
            task.recurrence?.seriesId,
          )
        : null,
      remindBeforeStart: isSharedWorkspace ? false : remindBeforeStart,
      reminderTimeZone:
        !isSharedWorkspace && remindBeforeStart
          ? resolveClientTimeZone()
          : undefined,
      resource: getResourceFromValue(resource),
      requiresConfirmation: isSharedWorkspace ? requiresConfirmation : false,
      routine:
        taskType === 'routine'
          ? buildRoutineTaskFromForm(routineForm, task.routine?.seriesId)
          : null,
      sphereId: task.sphereId,
      title: normalizedTitle,
      urgency: getTaskUrgencyFromType(taskType),
    })

    if (isUpdated) {
      onClose()
    }
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className={styles.editorOverlay} role="dialog" aria-modal="true">
      <button
        className={styles.editorBackdrop}
        type="button"
        aria-label="Закрыть редактирование"
        onClick={onClose}
      />

      <form
        className={styles.editorPanel}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className={styles.editorHeader}>
          <h3>Редактировать задачу</h3>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <label className={cx(styles.field, styles.titleField)}>
          <span>Задача</span>
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div className={styles.editorColumns}>
          <div className={styles.editorColumnPanel}>
            <section className={styles.editorSection}>
              <div className={styles.editorGrid}>
                <label className={styles.field}>
                  <span>План</span>
                  <input
                    type="date"
                    value={plannedDate}
                    onChange={(event) =>
                      handlePlannedDateChange(event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Старт</span>
                  <input
                    type="time"
                    value={plannedStartTime}
                    disabled={!plannedDate}
                    onChange={(event) =>
                      handlePlannedStartTimeChange(event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Финиш</span>
                  <input
                    type="time"
                    value={plannedEndTime}
                    disabled={!plannedDate || !plannedStartTime}
                    onChange={(event) => setPlannedEndTime(event.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className={styles.editorSection}>
              <label className={cx(styles.field, styles.notePanel)}>
                <span>Заметка</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
            </section>

            <section className={styles.editorSection}>
              <div className={styles.editorVisual}>
                <IconChoicePicker
                  allowEmpty={false}
                  label="Иконка"
                  showEmojiChoices={false}
                  value={icon}
                  uploadedIcons={uploadedIcons}
                  onChange={setIcon}
                />
              </div>
            </section>
          </div>

          <div className={styles.editorColumnPanel}>
            <section className={styles.editorSection}>
              <SpherePicker
                className={styles.fieldProject}
                emptyLabel={getEmptyProjectLabel()}
                label={getSpherePickerLabel()}
                spheres={spheres}
                uploadedIcons={uploadedIcons}
                value={projectId}
                onChange={setProjectId}
              />
            </section>

            {isReminderAvailable ? (
              <section className={styles.editorSection}>
                <div className={styles.checkboxField}>
                  <input
                    id={reminderFieldId}
                    type="checkbox"
                    checked={remindBeforeStart}
                    onChange={(event) =>
                      setRemindBeforeStart(event.target.checked)
                    }
                  />
                  <span className={styles.checkboxCopy}>
                    <label
                      className={styles.checkboxLabel}
                      htmlFor={reminderFieldId}
                    >
                      Напомнить за 15 минут
                    </label>
                  </span>
                </div>
              </section>
            ) : null}

            {isSharedWorkspace ? (
              <section className={styles.editorSection}>
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
                  onChange={setAssigneeUserId}
                />
              </section>
            ) : null}

            {isSharedWorkspace ? (
              <section className={styles.editorSection}>
                <div className={styles.checkboxField}>
                  <input
                    id={confirmationFieldId}
                    type="checkbox"
                    checked={requiresConfirmation}
                    disabled={!canManageConfirmation}
                    onChange={(event) =>
                      setRequiresConfirmation(event.target.checked)
                    }
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

            <section className={styles.editorSection}>
              <TaskTypePicker
                className={styles.fieldType}
                includeHabit={false}
                value={taskType}
                onChange={handleTaskTypeChange}
              />
            </section>

            {taskType === 'routine' ? (
              <section className={styles.editorSection}>
                <RoutineTaskFields
                  showTargetFields={false}
                  value={routineForm}
                  onChange={setRoutineForm}
                />
              </section>
            ) : null}

            {canEditRecurrence ? (
              <section className={styles.editorSection}>
                <TaskRecurrenceFields
                  value={recurrenceForm}
                  onChange={handleRecurrenceChange}
                />
              </section>
            ) : null}

            <section className={styles.editorSection}>
              <ResourcePicker
                className={styles.fieldResource}
                value={resource}
                onChange={setResource}
              />
            </section>
          </div>
        </div>

        <div className={styles.editorActions}>
          <button className={styles.button} type="button" onClick={onClose}>
            Отмена
          </button>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={isPending || !title.trim()}
          >
            Сохранить
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function getEmptyProjectLabel(): string {
  return 'Без сферы'
}

function getSpherePickerLabel(): string {
  return 'Сфера'
}

function resolveClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}
