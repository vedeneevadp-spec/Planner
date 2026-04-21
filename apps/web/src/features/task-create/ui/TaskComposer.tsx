import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { Project } from '@/entities/project'
import type { NewTaskInput } from '@/entities/task'
import type { TaskTemplate } from '@/entities/task-template'
import { usePlanner } from '@/features/planner'
import { cx } from '@/shared/lib/classnames'
import { addDays, getDateKey } from '@/shared/lib/date'

import styles from './TaskComposer.module.css'

interface TaskComposerProps {
  initialPlannedDate: string | null
  showTimeFields?: boolean
}

interface ProjectFields {
  project: string
  projectId: string | null
}

function resolveProjectFields(
  projects: Project[],
  projectId: string | null,
  fallbackProject: string,
): ProjectFields {
  const project = projectId
    ? projects.find((candidate) => candidate.id === projectId)
    : null

  if (project) {
    return {
      project: project.title,
      projectId: project.id,
    }
  }

  return {
    project: fallbackProject.trim(),
    projectId: null,
  }
}

function getTemplateProjectLabel(
  template: TaskTemplate,
  projects: Project[],
): string {
  const project = template.projectId
    ? projects.find((candidate) => candidate.id === template.projectId)
    : null

  if (project) {
    return `${project.icon} ${project.title}`
  }

  return template.project || 'Без проекта'
}

function buildTaskInputFromTemplate(
  template: TaskTemplate,
  projects: Project[],
  initialPlannedDate: string | null,
): NewTaskInput {
  const project = resolveProjectFields(
    projects,
    template.projectId,
    template.project,
  )
  const plannedDate = initialPlannedDate ?? template.plannedDate

  return {
    dueDate: template.dueDate,
    note: template.note,
    plannedDate,
    plannedEndTime: plannedDate ? template.plannedEndTime : null,
    plannedStartTime: plannedDate ? template.plannedStartTime : null,
    project: project.project,
    projectId: project.projectId,
    title: template.title,
  }
}

export function TaskComposer({
  initialPlannedDate,
  showTimeFields = false,
}: TaskComposerProps) {
  const {
    addTask,
    addTaskTemplate,
    projects,
    removeTaskTemplate,
    taskTemplates,
  } = usePlanner()
  const titleId = useId()
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const visibleQuickTemplates = useMemo(
    () => taskTemplates.slice(0, 5),
    [taskTemplates],
  )
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [plannedDate, setPlannedDate] = useState(initialPlannedDate ?? '')
  const [plannedStartTime, setPlannedStartTime] = useState('')
  const [plannedEndTime, setPlannedEndTime] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(
    null,
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  )
  const [templateNotice, setTemplateNotice] = useState<string | null>(null)

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

  function handlePlannedDateChange(nextPlannedDate: string) {
    setPlannedDate(nextPlannedDate)

    if (!nextPlannedDate) {
      setPlannedStartTime('')
      setPlannedEndTime('')
    }
  }

  function buildCurrentTaskInput(): NewTaskInput | null {
    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return null
    }

    const selectedProject =
      projects.find((project) => project.id === projectId) ?? null
    const hasPlannedDate = Boolean(plannedDate)

    return {
      dueDate: dueDate || null,
      note,
      plannedDate: plannedDate || null,
      plannedEndTime:
        hasPlannedDate && plannedStartTime ? plannedEndTime || null : null,
      plannedStartTime: hasPlannedDate ? plannedStartTime || null : null,
      project: selectedProject?.title ?? '',
      projectId: selectedProject?.id ?? null,
      title: normalizedTitle,
    }
  }

  function resetForm() {
    setTitle('')
    setProjectId('')
    setPlannedDate(initialPlannedDate ?? '')
    setPlannedStartTime('')
    setPlannedEndTime('')
    setDueDate('')
    setNote('')
    setSelectedTemplateId(null)
    setTemplateNotice(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const input = buildCurrentTaskInput()

    if (!input) {
      return
    }

    const isCreated = await addTask(input)

    if (!isCreated) {
      return
    }

    resetForm()
    setIsOpen(false)
  }

  async function handleSaveTemplate() {
    const input = buildCurrentTaskInput()

    if (!input) {
      return
    }

    const isCreated = await addTaskTemplate(input)

    if (isCreated) {
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
    setProjectId(knownProject?.id ?? '')
    setPlannedDate(plannedDateFromTemplate ?? '')
    setPlannedStartTime(
      plannedDateFromTemplate ? (template.plannedStartTime ?? '') : '',
    )
    setPlannedEndTime(
      plannedDateFromTemplate && template.plannedStartTime
        ? (template.plannedEndTime ?? '')
        : '',
    )
    setDueDate(template.dueDate ?? '')
    setNote(template.note)
    setSelectedTemplateId(template.id)
    setTemplateNotice(`Шаблон «${template.title}» подставлен в форму.`)
    titleInputRef.current?.focus()
  }

  async function handleCreateFromTemplate(template: TaskTemplate) {
    if (pendingTemplateId) {
      return
    }

    setPendingTemplateId(template.id)

    try {
      const isCreated = await addTask(
        buildTaskInputFromTemplate(template, projects, initialPlannedDate),
      )

      if (isCreated) {
        setTemplateNotice(`Задача из шаблона «${template.title}» создана.`)
        setIsOpen(false)
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
    setIsOpen(true)
  }

  return (
    <>
      <div className={styles.actionRow}>
        {visibleQuickTemplates.length > 0 ? (
          <div className={styles.templateQuickBar} aria-label="Шаблоны задач">
            <span className={styles.templateQuickLabel}>Из шаблона</span>
            {visibleQuickTemplates.map((template) => (
              <button
                key={template.id}
                className={styles.templateQuickButton}
                type="button"
                disabled={pendingTemplateId !== null}
                onClick={() => {
                  void handleCreateFromTemplate(template)
                }}
              >
                <span aria-hidden="true">+</span>
                {template.title}
              </button>
            ))}
          </div>
        ) : null}

        <button
          ref={openButtonRef}
          className={styles.openButton}
          type="button"
          onClick={openComposer}
        >
          <span aria-hidden="true">+</span>
          Новая задача
        </button>
      </div>

      {isOpen ? (
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
              <h2 id={titleId}>Новая задача</h2>
              <button
                className={styles.closeButton}
                type="button"
                aria-label="Закрыть"
                onClick={() => setIsOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            {taskTemplates.length > 0 ? (
              <section className={styles.templatePanel}>
                <div className={styles.templatePanelHeader}>
                  <div>
                    <p className={styles.eyebrow}>Шаблоны</p>
                    <h3>Быстрый старт</h3>
                  </div>
                  <p>
                    Создай задачу сразу или подставь шаблон и поправь детали.
                  </p>
                </div>

                <div className={styles.templateGrid}>
                  {taskTemplates.map((template) => (
                    <article
                      key={template.id}
                      className={cx(
                        styles.templateCard,
                        selectedTemplateId === template.id &&
                          styles.templateCardActive,
                      )}
                    >
                      <div>
                        <h4>{template.title}</h4>
                        <p>{getTemplateProjectLabel(template, projects)}</p>
                        {template.note ? <span>{template.note}</span> : null}
                      </div>

                      <div className={styles.templateActions}>
                        <button
                          className={styles.ghostButton}
                          type="button"
                          onClick={() => handleApplyTemplate(template)}
                        >
                          Подставить
                        </button>
                        <button
                          className={styles.ghostButton}
                          type="button"
                          disabled={pendingTemplateId !== null}
                          onClick={() => {
                            void handleCreateFromTemplate(template)
                          }}
                        >
                          Создать
                        </button>
                        <button
                          className={cx(
                            styles.ghostButton,
                            styles.dangerButton,
                          )}
                          type="button"
                          onClick={() => {
                            void handleRemoveTemplate(template)
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <div
              className={cx(
                styles.composerMain,
                showTimeFields && styles.composerMainTimeline,
              )}
            >
              <label className={cx(styles.field, styles.fieldTitle)}>
                <span>Задача</span>
                <input
                  ref={titleInputRef}
                  required
                  value={title}
                  placeholder="Например: собрать референсы для недельного плана"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span>Проект</span>
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">Без проекта</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.icon} {project.title}
                    </option>
                  ))}
                </select>
              </label>

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

              {showTimeFields ? (
                <>
                  <label className={styles.field}>
                    <span>Старт</span>
                    <input
                      type="time"
                      value={plannedStartTime}
                      disabled={!plannedDate}
                      onChange={(event) =>
                        setPlannedStartTime(event.target.value)
                      }
                    />
                  </label>

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
                </>
              ) : null}

              <label className={styles.field}>
                <span>Дедлайн</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </label>
            </div>

            <label className={styles.field}>
              <span>Заметка</span>
              <textarea
                rows={3}
                value={note}
                placeholder="Контекст, next step, ссылка на материал"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>

            {templateNotice ? (
              <p className={styles.notice}>{templateNotice}</p>
            ) : null}

            <div className={styles.footer}>
              <div className={styles.quickActions}>
                <button
                  className={styles.ghostButton}
                  type="button"
                  onClick={() => {
                    handlePlannedDateChange(todayKey)
                  }}
                >
                  На сегодня
                </button>
                <button
                  className={styles.ghostButton}
                  type="button"
                  onClick={() => {
                    handlePlannedDateChange(tomorrowKey)
                  }}
                >
                  На завтра
                </button>
                <button
                  className={styles.ghostButton}
                  type="button"
                  onClick={() => {
                    handlePlannedDateChange('')
                  }}
                >
                  В inbox
                </button>
              </div>

              <div className={styles.footerActions}>
                <button
                  className={styles.ghostButton}
                  type="button"
                  disabled={!title.trim()}
                  onClick={() => {
                    void handleSaveTemplate()
                  }}
                >
                  Сохранить как шаблон
                </button>

                <button className={styles.primaryButton} type="submit">
                  Добавить задачу
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
