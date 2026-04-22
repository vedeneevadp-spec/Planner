import { type FormEvent, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Project } from '@/entities/project'
import { ProjectPicker } from '@/entities/project'
import type { Task, TaskStatus, TaskUpdateInput } from '@/entities/task'
import { cx } from '@/shared/lib/classnames'
import {
  addDays,
  formatShortDate,
  formatTimeRange,
  getDateKey,
} from '@/shared/lib/date'
import {
  CheckIcon,
  EditIcon,
  IconChoicePicker,
  IconMark,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import styles from './TaskCard.module.css'

interface TaskCardProps {
  task: Task
  project?: Project | undefined
  projects?: Project[] | undefined
  tone?: 'default' | 'warning' | 'success'
  isPending?: boolean | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onSetPlannedDate: (taskId: string, plannedDate: string | null) => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
  onRemove: (taskId: string) => void
}

export function TaskCard({
  task,
  project,
  projects = [],
  tone = 'default',
  isPending = false,
  uploadedIcons = [],
  onSetStatus,
  onSetPlannedDate,
  onUpdate,
  onRemove,
}: TaskCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const projectTitle = project?.title ?? task.project.trim()
  const toneClass =
    tone === 'warning'
      ? styles.warning
      : tone === 'success'
        ? styles.success
        : undefined

  return (
    <article
      className={cx(
        styles.card,
        toneClass,
        task.importance === 'important' && styles.important,
      )}
    >
      <div className={styles.main}>
        <div className={styles.copy}>
          {projectTitle ? (
            <span className={styles.projectBadge}>
              {project ? (
                <span
                  className={styles.projectIcon}
                  style={{ backgroundColor: project.color }}
                  aria-hidden="true"
                >
                  <IconMark
                    value={project.icon}
                    uploadedIcons={uploadedIcons}
                  />
                </span>
              ) : null}
              <span>Проект: {projectTitle}</span>
            </span>
          ) : (
            <span className={styles.projectBadgeMuted}>Без проекта</span>
          )}

          <div className={styles.titleRow}>
            {task.icon ? (
              <IconMark
                className={styles.taskIcon}
                value={task.icon}
                uploadedIcons={uploadedIcons}
              />
            ) : null}
            <h4>{task.title}</h4>
          </div>
          {task.note ? <p>{task.note}</p> : null}
        </div>

        <div className={styles.meta}>
          {task.plannedStartTime ? (
            <span className={styles.metaChip}>
              Time {formatTimeRange(task.plannedStartTime, task.plannedEndTime)}
            </span>
          ) : null}
          {task.plannedDate ? (
            <span className={styles.metaChip}>
              Plan {formatShortDate(task.plannedDate)}
            </span>
          ) : null}
          {task.dueDate ? (
            <span className={styles.metaChip}>
              Due {formatShortDate(task.dueDate)}
            </span>
          ) : null}
          {task.importance === 'important' ? (
            <span className={cx(styles.metaChip, styles.markerChipStrong)}>
              Важно
            </span>
          ) : null}
        </div>
      </div>

      <div className={styles.actions}>
        {task.status === 'todo' ? (
          <>
            <button
              className={cx(styles.button, styles.iconButton)}
              type="button"
              disabled={isPending}
              aria-label="Завершить задачу"
              title="Завершить"
              onClick={() => onSetStatus(task.id, 'done')}
            >
              <CheckIcon size={18} />
            </button>
            {task.plannedDate !== todayKey ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
                onClick={() => onSetPlannedDate(task.id, todayKey)}
              >
                Today
              </button>
            ) : null}
            {task.plannedDate !== tomorrowKey ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
                onClick={() => onSetPlannedDate(task.id, tomorrowKey)}
              >
                Tomorrow
              </button>
            ) : null}
            {task.plannedDate ? (
              <button
                className={styles.button}
                type="button"
                disabled={isPending}
                onClick={() => onSetPlannedDate(task.id, null)}
              >
                Inbox
              </button>
            ) : null}
          </>
        ) : (
          <button
            className={styles.button}
            type="button"
            disabled={isPending}
            onClick={() => onSetStatus(task.id, 'todo')}
          >
            Reopen
          </button>
        )}

        <button
          className={cx(styles.button, styles.iconButton)}
          type="button"
          disabled={isPending}
          aria-label="Редактировать задачу"
          title="Редактировать"
          onClick={() => setIsEditing(true)}
        >
          <EditIcon size={18} />
        </button>

        <button
          className={cx(styles.button, styles.iconButton, styles.dangerButton)}
          type="button"
          disabled={isPending}
          aria-label="Удалить задачу"
          title="Удалить"
          onClick={() => onRemove(task.id)}
        >
          <TrashIcon size={18} />
        </button>
      </div>

      {isEditing ? (
        <TaskEditDialog
          task={task}
          projects={projects}
          uploadedIcons={uploadedIcons}
          isPending={isPending}
          onClose={() => setIsEditing(false)}
          onUpdate={onUpdate}
        />
      ) : null}
    </article>
  )
}

interface TaskEditDialogProps {
  task: Task
  projects: Project[]
  uploadedIcons: UploadedIconAsset[]
  isPending: boolean
  onClose: () => void
  onUpdate: (taskId: string, input: TaskUpdateInput) => Promise<boolean>
}

export function TaskEditDialog({
  task,
  projects,
  uploadedIcons,
  isPending,
  onClose,
  onUpdate,
}: TaskEditDialogProps) {
  const [title, setTitle] = useState(task.title)
  const [projectId, setProjectId] = useState(task.projectId ?? '')
  const [plannedDate, setPlannedDate] = useState(task.plannedDate ?? '')
  const [plannedStartTime, setPlannedStartTime] = useState(
    task.plannedStartTime ?? '',
  )
  const [plannedEndTime, setPlannedEndTime] = useState(
    task.plannedEndTime ?? '',
  )
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [icon, setIcon] = useState(task.icon)
  const [isImportant, setIsImportant] = useState(
    task.importance === 'important',
  )
  const [note, setNote] = useState(task.note)

  function handlePlannedDateChange(nextPlannedDate: string) {
    setPlannedDate(nextPlannedDate)

    if (!nextPlannedDate) {
      setPlannedStartTime('')
      setPlannedEndTime('')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return
    }

    const selectedProject =
      projects.find((project) => project.id === projectId) ?? null
    const hasPlannedDate = Boolean(plannedDate)
    const isUpdated = await onUpdate(task.id, {
      dueDate: dueDate || null,
      icon,
      importance: isImportant ? 'important' : 'not_important',
      note,
      plannedDate: plannedDate || null,
      plannedEndTime:
        hasPlannedDate && plannedStartTime ? plannedEndTime || null : null,
      plannedStartTime: hasPlannedDate ? plannedStartTime || null : null,
      project: selectedProject?.title ?? '',
      projectId: selectedProject?.id ?? null,
      title: normalizedTitle,
      urgency: 'not_urgent',
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

        <div className={styles.editorGrid}>
          <label className={cx(styles.field, styles.fieldTitle)}>
            <span>Задача</span>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <ProjectPicker
            className={styles.fieldProject}
            projects={projects}
            uploadedIcons={uploadedIcons}
            value={projectId}
            onChange={setProjectId}
          />

          <label className={cx(styles.field, styles.fieldImportant)}>
            <span>Маркер</span>
            <span className={styles.checkboxControl}>
              <input
                type="checkbox"
                checked={isImportant}
                onChange={(event) => setIsImportant(event.target.checked)}
              />
              <span>Важно</span>
            </span>
          </label>

          <label className={styles.field}>
            <span>План</span>
            <input
              type="date"
              value={plannedDate}
              onChange={(event) => handlePlannedDateChange(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Старт</span>
            <input
              type="time"
              value={plannedStartTime}
              disabled={!plannedDate}
              onChange={(event) => setPlannedStartTime(event.target.value)}
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

          <label className={styles.field}>
            <span>Дедлайн</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
        </div>

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

        <label className={styles.field}>
          <span>Заметка</span>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

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
