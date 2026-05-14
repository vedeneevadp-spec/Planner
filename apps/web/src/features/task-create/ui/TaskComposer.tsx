import type { NewHabitInput } from '@planner/contracts'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { SpherePicker } from '@/entities/sphere'
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
  getSphereDisplayTitle,
  getSpherePickerLabel,
  getTemplateProject,
  LEGACY_EMPTY_PROJECT_TITLES,
  resolveClientTimeZone,
  type TaskComposerDraft,
} from '../model/task-composer-model'
import styles from './TaskComposer.module.css'
import {
  BookmarkRibbonIcon,
  QuickPlanActions,
} from './TaskComposerQuickActions'

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
    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return null
    }

    const selectedProject =
      spheres.find((project) => project.id === projectId) ?? null
    const projectInput = {
      project: selectedProject?.name ?? '',
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
      sphereId: projectInput.projectId,
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
      spheres.find((project) => project.id === projectId) ?? null
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
                                spheres,
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
                                templateProject?.name ??
                                getSphereDisplayTitle(template.project)

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
                      <QuickPlanActions
                        as="section"
                        className={cx(
                          styles.columnSection,
                          styles.quickActionsSection,
                        )}
                        todayKey={todayKey}
                        tomorrowKey={tomorrowKey}
                        onChange={handlePlannedDateChange}
                      />
                    ) : null}
                  </div>
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
