import type { NewHabitInput } from '@planner/contracts'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ProjectPicker } from '@/entities/project'
import {
  buildRoutineTaskFromForm,
  buildTaskRecurrenceFromForm,
  createDefaultRoutineTaskForm,
  createDefaultTaskRecurrenceForm,
  getResourceFromValue,
  getTaskImportanceFromType,
  getTaskTypeValue,
  getTaskUrgencyFromType,
  type NewTaskInput,
  ResourcePicker,
  type ResourceValue,
  RoutineTaskFields,
  type RoutineTaskFormState,
  TaskRecurrenceFields,
  type TaskRecurrenceFormState,
  TaskTypePicker,
  type TaskTypeValue,
} from '@/entities/task'
import type { TaskTemplate } from '@/entities/task-template'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { useCreateHabit } from '@/features/habits'
import { usePlanner } from '@/features/planner'
import { usePlannerSession, useWorkspaceUsers } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { addDays, getDateKey } from '@/shared/lib/date'
import {
  CheckIcon,
  IconChoicePicker,
  IconMark,
  PlusIcon,
  TrashIcon,
} from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  buildTaskInputFromTemplate,
  getEmptyProjectLabel,
  getProjectDisplayTitle,
  getProjectPickerLabel,
  getTemplateProject,
  LEGACY_EMPTY_PROJECT_TITLES,
  resolveClientTimeZone,
  type TaskComposerDraft,
} from '../model/task-composer-model'
import styles from './TaskComposer.module.css'

interface TaskComposerProps {
  hideOpenButton?: boolean
  initialPlannedDate: string | null
  mobileOpenButtonMode?: 'fab' | 'inline'
  openDraft?: TaskComposerDraft | null | undefined
  openButtonLabel?: string | undefined
  showTimeFields?: boolean
  defaultTaskType?: TaskTypeValue | undefined
  onTaskCreated?: ((input: NewTaskInput) => Promise<void> | void) | undefined
}

function BookmarkRibbonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4.75H17C17.69 4.75 18.25 5.31 18.25 6V19.25L12 15.4L5.75 19.25V6C5.75 5.31 6.31 4.75 7 4.75Z" />
    </svg>
  )
}

function TodaySunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3.75V6" />
      <path d="M12 18V20.25" />
      <path d="M3.75 12H6" />
      <path d="M18 12H20.25" />
      <path d="M6.35 6.35L7.95 7.95" />
      <path d="M16.05 16.05L17.65 17.65" />
      <path d="M16.05 7.95L17.65 6.35" />
      <path d="M6.35 17.65L7.95 16.05" />
    </svg>
  )
}

function TomorrowSunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 17.5H20" />
      <path d="M7 17.5C7 14.74 9.24 12.5 12 12.5C14.76 12.5 17 14.74 17 17.5" />
      <path d="M12 7V9.25" />
      <path d="M6.6 10.1L8.2 11.25" />
      <path d="M17.4 10.1L15.8 11.25" />
    </svg>
  )
}

function InboxTrayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.75 12.25L6.9 6.75H17.1L19.25 12.25V18C19.25 18.69 18.69 19.25 18 19.25H6C5.31 19.25 4.75 18.69 4.75 18V12.25Z" />
      <path d="M4.75 12.25H8.4L10.1 14.75H13.9L15.6 12.25H19.25" />
    </svg>
  )
}

export function TaskComposer({
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
    projects,
    removeTaskTemplate,
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
    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return null
    }

    const selectedProject =
      projects.find((project) => project.id === projectId) ?? null
    const projectInput = {
      project: selectedProject?.title ?? '',
      projectId: selectedProject?.id ?? null,
    }
    const resolvedPlannedDate =
      canUseRecurrence && recurrenceForm.isEnabled && !plannedDate
        ? (initialPlannedDate ?? todayKey)
        : plannedDate
    const hasPlannedDate = Boolean(resolvedPlannedDate)

    return {
      assigneeUserId: isSharedWorkspace ? assigneeUserId || null : null,
      dueDate: null,
      icon,
      importance: getTaskImportanceFromType(taskType),
      note,
      plannedDate: resolvedPlannedDate || null,
      plannedEndTime:
        hasPlannedDate && plannedStartTime ? plannedEndTime || null : null,
      plannedStartTime: hasPlannedDate ? plannedStartTime || null : null,
      project: projectInput.project,
      projectId: projectInput.projectId,
      recurrence: canUseRecurrence
        ? buildTaskRecurrenceFromForm(
            recurrenceForm,
            resolvedPlannedDate || todayKey,
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
        taskType === 'routine' ? buildRoutineTaskFromForm(routineForm) : null,
      sphereId: null,
      title: normalizedTitle,
      urgency: getTaskUrgencyFromType(taskType),
    }
  }

  function buildCurrentHabitInput(): NewHabitInput | null {
    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return null
    }

    const selectedProject =
      projects.find((project) => project.id === projectId) ?? null
    const routine = buildRoutineTaskFromForm(routineForm)

    return {
      color: '#2f6f62',
      daysOfWeek: routine.daysOfWeek,
      description: note.trim(),
      endDate: null,
      frequency: routine.frequency,
      icon: icon.trim() || 'check',
      reminderTime: null,
      sphereId: selectedProject?.id ?? null,
      startDate: plannedDate || initialPlannedDate || todayKey,
      targetType: routine.targetType,
      targetValue: routine.targetValue,
      title: normalizedTitle,
      unit: routine.targetType === 'count' ? routine.unit : '',
    }
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
      ? projects.find((project) => project.id === template.projectId)
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
      projects,
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
        <div
          className={cx(
            styles.actionRow,
            mobileOpenButtonMode === 'inline' && styles.actionRowInlineMobile,
          )}
        >
          <button
            ref={openButtonRef}
            className={cx(
              styles.openButton,
              mobileOpenButtonMode === 'inline' &&
                styles.openButtonInlineMobile,
            )}
            type="button"
            onClick={openComposer}
          >
            <span className={styles.openButtonIcon} aria-hidden="true">
              +
            </span>
            <span className={styles.openButtonLabel}>{openButtonLabel}</span>
          </button>
        </div>
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
                <div className={styles.modalHeader}>
                  <h2 id={titleId}>{composerTitle}</h2>
                  <button
                    className={styles.closeButton}
                    type="button"
                    aria-label="Закрыть"
                    onClick={() => setIsOpen(false)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                  <button
                    className={styles.mobileHeaderSubmit}
                    type="submit"
                    aria-label={submitLabel}
                    disabled={!title.trim() || createHabitMutation.isPending}
                  >
                    <CheckIcon size={16} />
                  </button>
                </div>

                <label className={cx(styles.field, styles.titleField)}>
                  <span>{titleFieldLabel}</span>
                  <input
                    ref={titleInputRef}
                    required
                    value={title}
                    placeholder="Например: собрать референсы для недельного плана"
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>

                <div className={styles.formColumns}>
                  <div className={styles.columnPanel}>
                    <section
                      className={cx(
                        styles.columnSection,
                        styles.scheduleSection,
                      )}
                    >
                      <div
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
                            onChange={(event) =>
                              handlePlannedDateChange(event.target.value)
                            }
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
                                onChange={(event) =>
                                  handlePlannedStartTimeChange(
                                    event.target.value,
                                  )
                                }
                              />
                            </label>

                            {plannedStartTime ? (
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
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </section>

                    <section
                      className={cx(styles.columnSection, styles.noteSection)}
                    >
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

                    <section
                      className={cx(styles.columnSection, styles.visualSection)}
                    >
                      <div className={styles.visualPanel}>
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

                    {!isHabitTaskType && taskTemplates.length > 0 ? (
                      <section
                        className={cx(
                          styles.columnSection,
                          styles.templateSection,
                          styles.templatePanel,
                        )}
                      >
                        <div className={styles.templatePanelHeader}>
                          <p className={styles.eyebrow}>
                            Шаблоны
                            <span className={styles.templateCount}>
                              {taskTemplates.length}
                            </span>
                          </p>
                          <button
                            className={styles.templateToggle}
                            type="button"
                            aria-expanded={isTemplatesExpanded}
                            aria-label={
                              isTemplatesExpanded
                                ? 'Свернуть шаблоны'
                                : 'Показать шаблоны'
                            }
                            onClick={() =>
                              setIsTemplatesExpanded((value) => !value)
                            }
                          >
                            <span
                              className={cx(
                                styles.templateChevron,
                                isTemplatesExpanded &&
                                  styles.templateChevronExpanded,
                              )}
                              aria-hidden="true"
                            />
                          </button>
                        </div>

                        {isTemplatesExpanded ? (
                          <div className={styles.templateList}>
                            {taskTemplates.map((template) => {
                              const templateProject = getTemplateProject(
                                template,
                                projects,
                              )
                              const normalizedTemplateProjectTitle =
                                template.project.trim()
                              const hasTemplateProject =
                                templateProject !== null ||
                                (Boolean(normalizedTemplateProjectTitle) &&
                                  !LEGACY_EMPTY_PROJECT_TITLES.has(
                                    normalizedTemplateProjectTitle,
                                  ))
                              const templateProjectTitle =
                                templateProject?.title ??
                                getProjectDisplayTitle(template.project)

                              return (
                                <article
                                  key={template.id}
                                  className={cx(
                                    styles.templateRow,
                                    selectedTemplateId === template.id &&
                                      styles.templateRowActive,
                                  )}
                                >
                                  <button
                                    className={styles.templateSelectButton}
                                    type="button"
                                    title={`Подставить шаблон «${template.title}»`}
                                    onClick={() =>
                                      handleApplyTemplate(template)
                                    }
                                  >
                                    <span className={styles.templateIconSlot}>
                                      {template.icon ? (
                                        <IconMark
                                          className={styles.templateTaskIcon}
                                          value={template.icon}
                                          uploadedIcons={uploadedIcons}
                                        />
                                      ) : null}
                                    </span>

                                    <span className={styles.templateText}>
                                      <strong>{template.title}</strong>
                                      {template.note ? (
                                        <span>{template.note}</span>
                                      ) : null}
                                    </span>

                                    <span
                                      className={cx(
                                        styles.templateProjectChip,
                                        !hasTemplateProject &&
                                          styles.templateProjectChipMuted,
                                      )}
                                    >
                                      {templateProject ? (
                                        <span
                                          className={styles.templateProjectIcon}
                                          style={{
                                            backgroundColor:
                                              templateProject.color,
                                          }}
                                          aria-hidden="true"
                                        >
                                          <IconMark
                                            value={templateProject.icon}
                                            uploadedIcons={uploadedIcons}
                                          />
                                        </span>
                                      ) : null}
                                      {templateProjectTitle}
                                    </span>
                                  </button>

                                  <div className={styles.templateActions}>
                                    <button
                                      className={cx(
                                        styles.ghostButton,
                                        styles.iconButton,
                                      )}
                                      type="button"
                                      disabled={pendingTemplateId !== null}
                                      aria-label={`Создать задачу из шаблона ${template.title}`}
                                      title="Создать"
                                      onClick={() => {
                                        void handleCreateFromTemplate(template)
                                      }}
                                    >
                                      <CheckIcon size={17} />
                                    </button>
                                    <button
                                      className={cx(
                                        styles.ghostButton,
                                        styles.iconButton,
                                        styles.dangerButton,
                                      )}
                                      type="button"
                                      aria-label={`Удалить шаблон ${template.title}`}
                                      title="Удалить"
                                      onClick={() => {
                                        void handleRemoveTemplate(template)
                                      }}
                                    >
                                      <TrashIcon size={17} />
                                    </button>
                                  </div>
                                </article>
                              )
                            })}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </div>

                  <div className={styles.columnPanel}>
                    <section
                      className={cx(
                        styles.columnSection,
                        styles.projectSection,
                      )}
                    >
                      <ProjectPicker
                        className={styles.fieldProject}
                        emptyLabel={getEmptyProjectLabel()}
                        label={getProjectPickerLabel()}
                        projects={projects}
                        uploadedIcons={uploadedIcons}
                        value={projectId}
                        onChange={setProjectId}
                      />
                    </section>

                    {isReminderAvailable && !isHabitTaskType ? (
                      <section className={styles.columnSection}>
                        <div className={styles.checkboxField}>
                          <input
                            id={`${confirmationFieldId}-reminder`}
                            type="checkbox"
                            checked={remindBeforeStart}
                            onChange={(event) =>
                              setRemindBeforeStart(event.target.checked)
                            }
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
                          onChange={setAssigneeUserId}
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
                      className={cx(styles.columnSection, styles.typeSection)}
                    >
                      <TaskTypePicker
                        className={styles.fieldType}
                        value={taskType}
                        onChange={handleTaskTypeChange}
                      />
                    </section>

                    {isRoutineLikeTaskType ? (
                      <section className={styles.columnSection}>
                        <RoutineTaskFields
                          showTargetFields={isHabitTaskType}
                          value={routineForm}
                          onChange={setRoutineForm}
                        />
                      </section>
                    ) : null}

                    {canUseRecurrence ? (
                      <section className={styles.columnSection}>
                        <TaskRecurrenceFields
                          value={recurrenceForm}
                          onChange={handleRecurrenceChange}
                        />
                      </section>
                    ) : null}

                    {!isHabitTaskType ? (
                      <section
                        className={cx(
                          styles.columnSection,
                          styles.resourceSection,
                        )}
                      >
                        <ResourcePicker
                          className={styles.fieldResource}
                          value={resource}
                          onChange={setResource}
                        />
                      </section>
                    ) : null}

                    {!isHabitTaskType ? (
                      <section
                        className={cx(
                          styles.columnSection,
                          styles.quickActionsSection,
                        )}
                      >
                        <button
                          className={styles.quickActionButton}
                          type="button"
                          onClick={() => {
                            handlePlannedDateChange(todayKey)
                          }}
                        >
                          <span
                            className={styles.quickActionIcon}
                            aria-hidden="true"
                          >
                            <TodaySunIcon />
                          </span>
                          На сегодня
                        </button>
                        <button
                          className={styles.quickActionButton}
                          type="button"
                          onClick={() => {
                            handlePlannedDateChange(tomorrowKey)
                          }}
                        >
                          <span
                            className={styles.quickActionIcon}
                            aria-hidden="true"
                          >
                            <TomorrowSunIcon />
                          </span>
                          На завтра
                        </button>
                        <button
                          className={styles.quickActionButton}
                          type="button"
                          onClick={() => {
                            handlePlannedDateChange('')
                          }}
                        >
                          <span
                            className={styles.quickActionIcon}
                            aria-hidden="true"
                          >
                            <InboxTrayIcon />
                          </span>
                          В inbox
                        </button>
                      </section>
                    ) : null}
                  </div>
                </div>

                {templateNotice ? (
                  <p className={styles.notice}>{templateNotice}</p>
                ) : null}

                {!isHabitTaskType ? (
                  <div className={styles.mobileQuickActions}>
                    <button
                      className={styles.quickActionButton}
                      type="button"
                      onClick={() => {
                        handlePlannedDateChange(todayKey)
                      }}
                    >
                      <span
                        className={styles.quickActionIcon}
                        aria-hidden="true"
                      >
                        <TodaySunIcon />
                      </span>
                      На сегодня
                    </button>
                    <button
                      className={styles.quickActionButton}
                      type="button"
                      onClick={() => {
                        handlePlannedDateChange(tomorrowKey)
                      }}
                    >
                      <span
                        className={styles.quickActionIcon}
                        aria-hidden="true"
                      >
                        <TomorrowSunIcon />
                      </span>
                      На завтра
                    </button>
                    <button
                      className={styles.quickActionButton}
                      type="button"
                      onClick={() => {
                        handlePlannedDateChange('')
                      }}
                    >
                      <span
                        className={styles.quickActionIcon}
                        aria-hidden="true"
                      >
                        <InboxTrayIcon />
                      </span>
                      В inbox
                    </button>
                  </div>
                ) : null}

                <div className={styles.footer}>
                  {!isHabitTaskType ? (
                    <button
                      className={cx(
                        styles.ghostButton,
                        styles.footerGhostButton,
                      )}
                      type="button"
                      disabled={!title.trim()}
                      onClick={() => {
                        void handleSaveTemplate()
                      }}
                    >
                      <span className={styles.buttonIcon} aria-hidden="true">
                        <BookmarkRibbonIcon />
                      </span>
                      Сохранить как шаблон
                    </button>
                  ) : null}

                  <button
                    className={cx(
                      styles.primaryButton,
                      styles.footerPrimaryButton,
                    )}
                    type="submit"
                    disabled={createHabitMutation.isPending}
                  >
                    <span
                      className={styles.buttonIconStrong}
                      aria-hidden="true"
                    >
                      <PlusIcon size={16} />
                    </span>
                    {submitLabel}
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
