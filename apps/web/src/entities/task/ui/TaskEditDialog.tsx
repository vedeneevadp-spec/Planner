import type { WorkspaceUserRecord } from '@planner/contracts'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Sphere } from '@/entities/sphere'
import { SpherePicker } from '@/entities/sphere'
import { cx } from '@/shared/lib/classnames'
import { resolveClientTimeZone } from '@/shared/lib/date'
import { CheckIcon, type UploadedIconAsset } from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  buildRoutineTaskFromForm,
  createRoutineTaskFormFromRoutine,
  type RoutineTaskFormState,
} from '../model/routine-task'
import type {
  Task,
  TaskNecessity,
  TaskReminderOffsetMinutes,
  TaskUpdateInput,
} from '../model/task.types'
import {
  getResourceFromValue,
  getResourceValueFromTaskResource,
} from '../model/task-meta'
import {
  buildTaskRecurrenceFromForm,
  createTaskRecurrenceFormFromRecurrence,
  type TaskRecurrenceFormState,
} from '../model/task-recurrence'
import { RoutineTaskFields } from './RoutineTaskFields'
import styles from './TaskCard.module.css'
import {
  ResourcePicker,
  TaskIconPickerDialog,
  TaskIconSelectButton,
  TaskImportanceToggle,
  TaskNecessityPicker,
  TaskReminderPicker,
} from './TaskMetaPickers'
import { TaskRecurrenceFields } from './TaskRecurrenceFields'

interface TaskEditDialogProps {
  currentActorUserId?: string | undefined
  isSharedWorkspace?: boolean | undefined
  task: Task
  todayKey: string
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
  todayKey,
  spheres,
  uploadedIcons,
  workspaceUsers = [],
  isPending = false,
  onClose,
  onUpdate,
}: TaskEditDialogProps) {
  const titleId = useId()
  const confirmationFieldId = useId()
  const titleInputRef = useRef<HTMLInputElement>(null)
  const reminderAvailabilityRef = useRef(
    !isSharedWorkspace && Boolean(task.plannedDate && task.plannedStartTime),
  )
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
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    getIsTaskEditorMobileLayout(),
  )
  const [reminderOffsets, setReminderOffsets] = useState<
    TaskReminderOffsetMinutes[]
  >(
    task.reminderOffsets && task.reminderOffsets.length > 0
      ? task.reminderOffsets
      : task.remindBeforeStart
        ? [15]
        : [],
  )
  const [icon, setIcon] = useState(task.icon)
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const [resource, setResource] = useState(
    getResourceValueFromTaskResource(task.resource),
  )
  const [isImportant, setIsImportant] = useState(
    task.importance === 'important',
  )
  const [necessity, setNecessity] = useState<TaskNecessity>(task.necessity)
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
  const isRoutineTask = Boolean(task.routine)
  const canEditRecurrence = !isRoutineTask
  const showDesktopFinish = Boolean(plannedStartTime) && !isMobileLayout
  const showMobileFinish = Boolean(plannedStartTime) && isMobileLayout

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 560px)')

    function syncMobileLayout() {
      setIsMobileLayout(mediaQuery.matches)
    }

    syncMobileLayout()
    mediaQuery.addEventListener('change', syncMobileLayout)

    return () => {
      mediaQuery.removeEventListener('change', syncMobileLayout)
    }
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const rootStyle = document.documentElement.style
    const previousViewportHeight = rootStyle.getPropertyValue(
      '--task-editor-viewport-height',
    )
    const previousViewportOffsetTop = rootStyle.getPropertyValue(
      '--task-editor-viewport-offset-top',
    )
    document.body.style.overflow = 'hidden'

    function syncVisualViewport() {
      const visualViewport = window.visualViewport
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportOffsetTop = visualViewport?.offsetTop ?? 0

      rootStyle.setProperty(
        '--task-editor-viewport-height',
        `${viewportHeight}px`,
      )
      rootStyle.setProperty(
        '--task-editor-viewport-offset-top',
        `${viewportOffsetTop}px`,
      )
    }

    syncVisualViewport()

    const visualViewport = window.visualViewport
    visualViewport?.addEventListener('resize', syncVisualViewport)
    visualViewport?.addEventListener('scroll', syncVisualViewport)
    window.addEventListener('resize', syncVisualViewport)

    const focusFrame = window.requestAnimationFrame(() => {
      if (!getIsTaskEditorMobileLayout()) {
        titleInputRef.current?.focus({ preventScroll: true })
      }
    })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.cancelAnimationFrame(focusFrame)
      visualViewport?.removeEventListener('resize', syncVisualViewport)
      visualViewport?.removeEventListener('scroll', syncVisualViewport)
      window.removeEventListener('resize', syncVisualViewport)
      restoreCssVariable(
        rootStyle,
        '--task-editor-viewport-height',
        previousViewportHeight,
      )
      restoreCssVariable(
        rootStyle,
        '--task-editor-viewport-offset-top',
        previousViewportOffsetTop,
      )
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  function handlePlannedDateChange(nextPlannedDate: string) {
    setPlannedDate(nextPlannedDate)

    if (!nextPlannedDate) {
      setPlannedStartTime('')
      setPlannedEndTime('')
      setReminderOffsets([])
      reminderAvailabilityRef.current = false
    }
  }

  function handlePlannedStartTimeChange(nextStartTime: string) {
    const wasAvailable = reminderAvailabilityRef.current
    const nextAvailable =
      !isSharedWorkspace && Boolean(plannedDate && nextStartTime)

    setPlannedStartTime(nextStartTime)

    if (!nextAvailable) {
      setPlannedEndTime('')
      setReminderOffsets([])
      reminderAvailabilityRef.current = false
    } else if (!wasAvailable) {
      setReminderOffsets([15])
      reminderAvailabilityRef.current = true
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
    const resolvedReminderOffsets =
      !isSharedWorkspace && hasPlannedDate && plannedStartTime
        ? reminderOffsets
        : []
    const isUpdated = await onUpdate(task.id, {
      assigneeUserId: isSharedWorkspace ? assigneeUserId || null : null,
      dueDate: task.dueDate ?? null,
      icon,
      importance: isImportant ? 'important' : 'not_important',
      necessity,
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
      remindBeforeStart: resolvedReminderOffsets.length > 0,
      reminderOffsets: resolvedReminderOffsets,
      reminderTimeZone:
        resolvedReminderOffsets.length > 0
          ? resolveClientTimeZone()
          : undefined,
      resource: getResourceFromValue(resource),
      requiresConfirmation: isSharedWorkspace ? requiresConfirmation : false,
      routine: isRoutineTask
        ? buildRoutineTaskFromForm(routineForm, task.routine?.seriesId)
        : null,
      sphereId: task.sphereId,
      title: normalizedTitle,
      urgency: isRoutineTask ? 'urgent' : 'not_urgent',
    })

    if (isUpdated) {
      onClose()
    }
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.editorOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
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
          <h3 id={titleId}>Редактировать задачу</h3>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
          {isMobileLayout ? (
            <button
              className={styles.mobileHeaderSubmit}
              type="submit"
              aria-label="Сохранить"
              disabled={isPending || !title.trim()}
            >
              <CheckIcon size={16} />
            </button>
          ) : null}
        </div>

        <div className={styles.editorFormScroller}>
          <div className={styles.editorColumns}>
            <div className={styles.editorColumnPanel}>
              <section
                className={cx(styles.editorSection, styles.titleSection)}
              >
                <div className={styles.titleInputRow}>
                  <label className={cx(styles.field, styles.titleField)}>
                    <span>Задача</span>
                    <input
                      ref={titleInputRef}
                      required
                      value={title}
                      placeholder="Например: собрать референсы для недельного плана"
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>

                  <TaskImportanceToggle
                    className={styles.titleImportanceToggle}
                    isImportant={isImportant}
                    onChange={setIsImportant}
                  />
                </div>
              </section>

              <section
                className={cx(styles.editorSection, styles.scheduleSection)}
              >
                <div
                  className={cx(
                    styles.editorGrid,
                    plannedStartTime && styles.editorGridTimeline,
                    !plannedStartTime && styles.editorGridPair,
                  )}
                >
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

                  {showDesktopFinish ? (
                    <label className={cx(styles.field, styles.finishField)}>
                      <span>Финиш</span>
                      <input
                        type="time"
                        value={plannedEndTime}
                        disabled={!plannedDate || !plannedStartTime}
                        onChange={(event) =>
                          setPlannedEndTime(event.target.value)
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </section>

              <section className={cx(styles.editorSection, styles.noteSection)}>
                <label className={cx(styles.field, styles.notePanel)}>
                  <span>Заметка</span>
                  <textarea
                    rows={3}
                    value={note}
                    placeholder="Контекст, next step, ссылка на материал"
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              </section>
            </div>

            <div className={styles.editorColumnPanel}>
              <section
                className={cx(styles.editorSection, styles.projectSection)}
              >
                <div className={styles.projectIconRow}>
                  <SpherePicker
                    className={styles.fieldProject}
                    emptyLabel={getEmptyProjectLabel()}
                    label={getSpherePickerLabel()}
                    spheres={spheres}
                    uploadedIcons={uploadedIcons}
                    value={projectId}
                    onChange={setProjectId}
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
                  className={cx(
                    styles.editorSection,
                    styles.mobileFinishSection,
                  )}
                >
                  <label className={styles.field}>
                    <span>Финиш</span>
                    <input
                      type="time"
                      value={plannedEndTime}
                      disabled={!plannedDate || !plannedStartTime}
                      onChange={(event) =>
                        setPlannedEndTime(event.target.value)
                      }
                    />
                  </label>
                </section>
              ) : null}

              {isReminderAvailable ? (
                <section
                  className={cx(
                    styles.editorSection,
                    styles.reminderSection,
                    showMobileFinish && styles.reminderWithFinish,
                  )}
                >
                  <TaskReminderPicker
                    className={styles.field}
                    value={reminderOffsets}
                    onChange={setReminderOffsets}
                  />
                </section>
              ) : null}

              {isSharedWorkspace ? (
                <section
                  className={cx(styles.editorSection, styles.assigneeSection)}
                >
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
                <section
                  className={cx(
                    styles.editorSection,
                    styles.confirmationSection,
                  )}
                >
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

              <section
                className={cx(styles.editorSection, styles.necessitySection)}
              >
                <TaskNecessityPicker
                  className={styles.fieldNecessity}
                  value={necessity}
                  onChange={setNecessity}
                />
              </section>

              {isRoutineTask ? (
                <section
                  className={cx(styles.editorSection, styles.routineSection)}
                >
                  <RoutineTaskFields
                    showTargetFields={false}
                    value={routineForm}
                    onChange={setRoutineForm}
                  />
                </section>
              ) : null}

              {canEditRecurrence ? (
                <section
                  className={cx(styles.editorSection, styles.recurrenceSection)}
                >
                  <TaskRecurrenceFields
                    value={recurrenceForm}
                    onChange={handleRecurrenceChange}
                  />
                </section>
              ) : null}

              <section
                className={cx(styles.editorSection, styles.resourceSection)}
              >
                <ResourcePicker
                  className={styles.fieldResource}
                  value={resource}
                  onChange={setResource}
                />
              </section>
            </div>
          </div>

          {isIconPickerOpen ? (
            <TaskIconPickerDialog
              uploadedIcons={uploadedIcons}
              value={icon}
              onChange={setIcon}
              onClose={() => setIsIconPickerOpen(false)}
            />
          ) : null}

          <div className={styles.editorActions}>
            <button
              className={cx(styles.primaryButton, styles.footerPrimaryButton)}
              type="submit"
              disabled={isPending || !title.trim()}
            >
              <span className={styles.buttonIconStrong} aria-hidden="true">
                <CheckIcon size={16} />
              </span>
              Сохранить
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function restoreCssVariable(
  style: CSSStyleDeclaration,
  propertyName: string,
  previousValue: string,
): void {
  if (previousValue) {
    style.setProperty(propertyName, previousValue)
    return
  }

  style.removeProperty(propertyName)
}

function getIsTaskEditorMobileLayout(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 560px)').matches
  )
}

function getEmptyProjectLabel(): string {
  return 'Без сферы'
}

function getSpherePickerLabel(): string {
  return 'Сфера'
}
