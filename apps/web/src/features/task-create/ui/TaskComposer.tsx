import type { NewHabitInput } from '@planner/contracts'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  createDefaultRoutineTaskForm,
  createDefaultTaskRecurrenceForm,
  getTaskTypeValue,
  type NewTaskInput,
  type ResourceValue,
  type RoutineTaskFormState,
  type TaskRecurrenceFormState,
  type TaskTypeValue,
} from '@/entities/task'
import type { TaskTemplate } from '@/entities/task-template'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { useCreateHabit } from '@/features/habits'
import { usePlanner } from '@/features/planner'
import { usePlannerSession, useWorkspaceUsers } from '@/features/session'
import { addDays, getDateKey } from '@/shared/lib/date'

import {
  buildTaskComposerHabitInput,
  buildTaskComposerTaskInput,
  buildTaskInputFromTemplate,
  type TaskComposerDraft,
} from '../model/task-composer-model'
import styles from './TaskComposer.module.css'
import { TaskComposerDetailsFields } from './TaskComposerDetailsFields'
import { TaskComposerFooter } from './TaskComposerFooter'
import { TaskComposerModalHeader } from './TaskComposerModalHeader'
import { TaskComposerOpenButton } from './TaskComposerOpenButton'
import { TaskComposerPrimaryFields } from './TaskComposerPrimaryFields'
import { QuickPlanActions } from './TaskComposerQuickActions'

interface TaskComposerProps {
  desktopOpenButtonHidden?: boolean | undefined
  hideOpenButton?: boolean
  initialPlannedDate: string | null
  mobileOpenButtonMode?: 'fab' | 'inline'
  openDraft?: TaskComposerDraft | null | undefined
  openButtonLabel?: string | undefined
  showTimeFields?: boolean
  defaultTaskType?: TaskTypeValue | undefined
  onTaskCreated?: ((input: NewTaskInput) => Promise<void> | void) | undefined
}

export function TaskComposer({
  desktopOpenButtonHidden = false,
  hideOpenButton = false,
  initialPlannedDate,
  mobileOpenButtonMode = 'fab',
  openDraft,
  openButtonLabel = 'Новая задача',
  showTimeFields = true,
  defaultTaskType = '',
  onTaskCreated,
}: TaskComposerProps) {
  const {
    addTask,
    addTaskTemplate,
    removeTaskTemplate,
    spheres,
    taskTemplates,
  } = usePlanner()
  const createHabitMutation = useCreateHabit()
  const [isOpen, setIsOpen] = useState(false)
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const workspaceUsersQuery = useWorkspaceUsers({
    enabled: isOpen && isSharedWorkspace,
  })
  const workspaceUsers = workspaceUsersQuery.data?.users ?? []
  const { uploadedIcons } = useUploadedIconAssets()
  const titleId = useId()
  const confirmationFieldId = useId()
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const openDraftRequestIdRef = useRef<string | null>(null)
  const reminderAvailabilityRef = useRef(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState('')
  const [taskType, setTaskType] = useState<TaskTypeValue>(defaultTaskType)
  const [resource, setResource] = useState<ResourceValue>('')
  const [routineForm, setRoutineForm] = useState<RoutineTaskFormState>(() =>
    createDefaultRoutineTaskForm(),
  )
  const [recurrenceForm, setRecurrenceForm] = useState<TaskRecurrenceFormState>(
    () => createDefaultTaskRecurrenceForm(),
  )
  const [projectId, setProjectId] = useState('')
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [requiresConfirmation, setRequiresConfirmation] = useState(false)
  const [plannedDate, setPlannedDate] = useState(initialPlannedDate ?? '')
  const [plannedStartTime, setPlannedStartTime] = useState('')
  const [plannedEndTime, setPlannedEndTime] = useState('')
  const [remindBeforeStart, setRemindBeforeStart] = useState(false)
  const [note, setNote] = useState('')
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(
    null,
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  )
  const [templateNotice, setTemplateNotice] = useState<string | null>(null)
  const [isTemplatesExpanded, setIsTemplatesExpanded] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const openButton = openButtonRef.current
    document.body.style.overflow = 'hidden'
    titleInputRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      openButton?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!openDraft || openDraftRequestIdRef.current === openDraft.requestId) {
      return
    }

    openDraftRequestIdRef.current = openDraft.requestId
    setTitle(openDraft.title ?? '')
    setIcon(openDraft.icon ?? '')
    setTaskType(openDraft.taskType ?? defaultTaskType)
    setResource(openDraft.resource ?? '')
    setRoutineForm(createDefaultRoutineTaskForm())
    setRecurrenceForm(createDefaultTaskRecurrenceForm())
    setProjectId(openDraft.projectId ?? '')
    setAssigneeUserId('')
    setRequiresConfirmation(false)
    setPlannedDate(openDraft.plannedDate ?? initialPlannedDate ?? '')
    setPlannedStartTime('')
    setPlannedEndTime('')
    setRemindBeforeStart(false)
    reminderAvailabilityRef.current = false
    setNote(openDraft.note ?? '')
    setSelectedTemplateId(null)
    setTemplateNotice(null)
    setIsTemplatesExpanded(false)
    setIsOpen(true)
  }, [defaultTaskType, initialPlannedDate, isSharedWorkspace, openDraft])

  const isReminderAvailable =
    !isSharedWorkspace && Boolean(plannedDate && plannedStartTime)
  const isHabitTaskType = taskType === 'habit'
  const isRoutineLikeTaskType = taskType === 'routine' || isHabitTaskType
  const canUseRecurrence = !isRoutineLikeTaskType
  const composerTitle = isHabitTaskType
    ? 'Новая привычка'
    : taskType === 'routine' || defaultTaskType === 'routine'
      ? 'Новая рутина'
      : 'Новая задача'
  const titleFieldLabel = isHabitTaskType ? 'Привычка' : 'Задача'
  const submitLabel = isHabitTaskType ? 'Добавить привычку' : 'Добавить задачу'

  useEffect(() => {
    const wasAvailable = reminderAvailabilityRef.current

    if (!isReminderAvailable) {
      if (wasAvailable || remindBeforeStart) {
        setRemindBeforeStart(false)
      }
      reminderAvailabilityRef.current = false
      return
    }

    if (!wasAvailable) {
      setRemindBeforeStart(true)
    }

    reminderAvailabilityRef.current = true
  }, [isReminderAvailable, remindBeforeStart])

  function handlePlannedDateChange(nextPlannedDate: string) {
    setPlannedDate(nextPlannedDate)

    if (!nextPlannedDate) {
      setPlannedStartTime('')
      setPlannedEndTime('')
    }
  }

  function handlePlannedStartTimeChange(nextStartTime: string) {
    setPlannedStartTime(nextStartTime)

    if (!nextStartTime) {
      setPlannedEndTime('')
    }
  }

  function handleTaskTypeChange(nextTaskType: TaskTypeValue) {
    setTaskType(nextTaskType)

    if (
      (nextTaskType === 'routine' || nextTaskType === 'habit') &&
      !plannedDate
    ) {
      setPlannedDate(initialPlannedDate ?? todayKey)
    }

    if (nextTaskType === 'routine' || nextTaskType === 'habit') {
      setRecurrenceForm(createDefaultTaskRecurrenceForm())
    }
  }

  function handleRecurrenceChange(nextForm: TaskRecurrenceFormState) {
    setRecurrenceForm(nextForm)

    if (nextForm.isEnabled && !plannedDate) {
      setPlannedDate(initialPlannedDate ?? todayKey)
    }
  }

  function buildCurrentTaskInput(): NewTaskInput | null {
    return buildTaskComposerTaskInput({
      assigneeUserId,
      canUseRecurrence,
      icon,
      initialPlannedDate,
      isSharedWorkspace: Boolean(isSharedWorkspace),
      note,
      plannedDate,
      plannedEndTime,
      plannedStartTime,
      projectId,
      recurrenceForm,
      remindBeforeStart,
      requiresConfirmation,
      resource,
      routineForm,
      spheres,
      taskType,
      title,
      todayKey,
    })
  }

  function buildCurrentHabitInput(): NewHabitInput | null {
    return buildTaskComposerHabitInput({
      icon,
      initialPlannedDate,
      note,
      plannedDate,
      projectId,
      routineForm,
      spheres,
      title,
      todayKey,
    })
  }

  function resetForm() {
    setTitle('')
    setIcon('')
    setTaskType(defaultTaskType)
    setResource('')
    setRoutineForm(createDefaultRoutineTaskForm())
    setRecurrenceForm(createDefaultTaskRecurrenceForm())
    setProjectId('')
    setAssigneeUserId('')
    setRequiresConfirmation(false)
    setPlannedDate(initialPlannedDate ?? '')
    setPlannedStartTime('')
    setPlannedEndTime('')
    setRemindBeforeStart(false)
    reminderAvailabilityRef.current = false
    setNote('')
    setSelectedTemplateId(null)
    setTemplateNotice(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isHabitTaskType) {
      const habitInput = buildCurrentHabitInput()

      if (!habitInput) {
        return
      }

      await createHabitMutation.mutateAsync(habitInput)
      resetForm()
      setIsOpen(false)

      return
    }

    const input = buildCurrentTaskInput()

    if (!input) {
      return
    }

    const isCreated = await addTask(input)

    if (!isCreated) {
      return
    }

    try {
      await onTaskCreated?.(input)
    } finally {
      resetForm()
      setIsOpen(false)
    }
  }

  async function handleSaveTemplate() {
    if (isHabitTaskType) {
      return
    }

    const input = buildCurrentTaskInput()

    if (!input) {
      return
    }

    const isCreated = await addTaskTemplate(input)

    if (isCreated) {
      resetForm()
      setTemplateNotice(
        'Шаблон сохранён. Теперь его можно запускать в один клик.',
      )
    }
  }

  function handleApplyTemplate(template: TaskTemplate) {
    const plannedDateFromTemplate = initialPlannedDate ?? template.plannedDate
    const knownProject = template.projectId
      ? spheres.find((project) => project.id === template.projectId)
      : null

    setTitle(template.title)
    setIcon(template.icon)
    setTaskType(getTaskTypeValue(template))
    setResource('')
    setRoutineForm(createDefaultRoutineTaskForm())
    setRecurrenceForm(createDefaultTaskRecurrenceForm())
    setProjectId(knownProject?.id ?? '')
    setAssigneeUserId('')
    setRequiresConfirmation(false)
    setPlannedDate(plannedDateFromTemplate ?? '')
    setPlannedStartTime(
      plannedDateFromTemplate ? (template.plannedStartTime ?? '') : '',
    )
    setPlannedEndTime(
      plannedDateFromTemplate && template.plannedStartTime
        ? (template.plannedEndTime ?? '')
        : '',
    )
    setRemindBeforeStart(false)
    reminderAvailabilityRef.current = false
    setNote(template.note)
    setSelectedTemplateId(template.id)
    setTemplateNotice(`Шаблон «${template.title}» подставлен в форму.`)
    titleInputRef.current?.focus()
  }

  async function handleCreateFromTemplate(template: TaskTemplate) {
    if (pendingTemplateId) {
      return
    }

    const input = buildTaskInputFromTemplate(
      template,
      spheres,
      initialPlannedDate,
      isSharedWorkspace,
    )

    setPendingTemplateId(template.id)
    resetForm()
    setTemplateNotice(`Задача из шаблона «${template.title}» создаётся.`)
    setIsOpen(false)

    try {
      const isCreated = await addTask(input)

      if (isCreated) {
        setTemplateNotice(`Задача из шаблона «${template.title}» создана.`)
      }
    } finally {
      setPendingTemplateId(null)
    }
  }

  async function handleRemoveTemplate(template: TaskTemplate) {
    const isRemoved = await removeTaskTemplate(template.id)

    if (isRemoved) {
      if (selectedTemplateId === template.id) {
        setSelectedTemplateId(null)
      }

      setTemplateNotice(`Шаблон «${template.title}» удалён.`)
    }
  }

  function openComposer() {
    setTemplateNotice(null)
    setIsTemplatesExpanded(false)
    setIsOpen(true)
  }

  return (
    <>
      {hideOpenButton ? null : (
        <TaskComposerOpenButton
          buttonRef={openButtonRef}
          desktopHidden={desktopOpenButtonHidden}
          label={openButtonLabel}
          mode={mobileOpenButtonMode}
          onOpen={openComposer}
        />
      )}

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={styles.modalOverlay}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <button
                className={styles.backdropButton}
                type="button"
                tabIndex={-1}
                aria-label="Закрыть окно создания задачи"
                onClick={() => setIsOpen(false)}
              />

              <form
                className={styles.panel}
                onSubmit={(event) => {
                  void handleSubmit(event)
                }}
              >
                <TaskComposerModalHeader
                  isSubmitDisabled={
                    !title.trim() || createHabitMutation.isPending
                  }
                  submitLabel={submitLabel}
                  title={composerTitle}
                  titleId={titleId}
                  onClose={() => {
                    setIsOpen(false)
                  }}
                />

                <div className={styles.formColumns}>
                  <TaskComposerPrimaryFields
                    icon={icon}
                    isHabitTaskType={isHabitTaskType}
                    isTemplatesExpanded={isTemplatesExpanded}
                    note={note}
                    pendingTemplateId={pendingTemplateId}
                    plannedDate={plannedDate}
                    plannedEndTime={plannedEndTime}
                    plannedStartTime={plannedStartTime}
                    selectedTemplateId={selectedTemplateId}
                    showTimeFields={showTimeFields}
                    spheres={spheres}
                    taskTemplates={taskTemplates}
                    title={title}
                    titleFieldLabel={titleFieldLabel}
                    titleInputRef={titleInputRef}
                    uploadedIcons={uploadedIcons}
                    onApplyTemplate={handleApplyTemplate}
                    onCreateFromTemplate={(template) => {
                      void handleCreateFromTemplate(template)
                    }}
                    onIconChange={setIcon}
                    onNoteChange={setNote}
                    onPlannedDateChange={handlePlannedDateChange}
                    onPlannedEndTimeChange={setPlannedEndTime}
                    onPlannedStartTimeChange={handlePlannedStartTimeChange}
                    onRemoveTemplate={(template) => {
                      void handleRemoveTemplate(template)
                    }}
                    onTemplatesExpandedChange={setIsTemplatesExpanded}
                    onTitleChange={setTitle}
                  />

                  <TaskComposerDetailsFields
                    assigneeUserId={assigneeUserId}
                    canUseRecurrence={canUseRecurrence}
                    confirmationFieldId={confirmationFieldId}
                    isHabitTaskType={isHabitTaskType}
                    isReminderAvailable={isReminderAvailable}
                    isRoutineLikeTaskType={isRoutineLikeTaskType}
                    isSharedWorkspace={Boolean(isSharedWorkspace)}
                    projectId={projectId}
                    recurrenceForm={recurrenceForm}
                    remindBeforeStart={remindBeforeStart}
                    requiresConfirmation={requiresConfirmation}
                    resource={resource}
                    routineForm={routineForm}
                    spheres={spheres}
                    taskType={taskType}
                    todayKey={todayKey}
                    tomorrowKey={tomorrowKey}
                    uploadedIcons={uploadedIcons}
                    workspaceUsers={workspaceUsers}
                    onAssigneeUserIdChange={setAssigneeUserId}
                    onPlannedDateChange={handlePlannedDateChange}
                    onProjectIdChange={setProjectId}
                    onRecurrenceChange={handleRecurrenceChange}
                    onRemindBeforeStartChange={setRemindBeforeStart}
                    onRequiresConfirmationChange={setRequiresConfirmation}
                    onResourceChange={setResource}
                    onRoutineFormChange={setRoutineForm}
                    onTaskTypeChange={handleTaskTypeChange}
                  />
                </div>

                {templateNotice ? (
                  <p className={styles.notice}>{templateNotice}</p>
                ) : null}

                {!isHabitTaskType ? (
                  <QuickPlanActions
                    className={styles.mobileQuickActions}
                    todayKey={todayKey}
                    tomorrowKey={tomorrowKey}
                    onChange={handlePlannedDateChange}
                  />
                ) : null}

                <TaskComposerFooter
                  isHabitTaskType={isHabitTaskType}
                  isSaveTemplateDisabled={!title.trim()}
                  isSubmitDisabled={createHabitMutation.isPending}
                  submitLabel={submitLabel}
                  onSaveTemplate={() => {
                    void handleSaveTemplate()
                  }}
                />
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
