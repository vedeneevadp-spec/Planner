import { type FormEvent, useId, useState } from 'react'

import type { Project } from '@/entities/project'
import { cx } from '@/shared/lib/classnames'
import {
  createSvgIconValue,
  IconChoicePicker,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import styles from './ProjectsPage.module.css'

const PROJECT_COLORS = [
  '#f12b2b',
  '#ed5212',
  '#e4aa3f',
  '#39b629',
  '#42a8f1',
  '#1a3bd1',
  '#4010c3',
  '#bf1fd3',
  '#e581f4',
  '#26ba86',
  '#5f6fb3',
] as const

const DEFAULT_PROJECT_ICON = createSvgIconValue('folder')

export interface ProjectFormValues {
  color: string
  description: string
  icon: string
  title: string
}

interface ProjectFormProps {
  project?: Project | undefined
  submitLabel: string
  uploadedIcons?: UploadedIconAsset[] | undefined
  onCancel?: (() => void) | undefined
  onSubmit: (values: ProjectFormValues) => Promise<boolean>
}

export function ProjectForm({
  project,
  submitLabel,
  uploadedIcons = [],
  onCancel,
  onSubmit,
}: ProjectFormProps) {
  const titleId = useId()
  const [title, setTitle] = useState(project?.title ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0])
  const [icon, setIcon] = useState(project?.icon ?? DEFAULT_PROJECT_ICON)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return
    }

    const isSaved = await onSubmit({
      color,
      description,
      icon,
      title: normalizedTitle,
    })

    if (!isSaved || project) {
      return
    }

    setTitle('')
    setDescription('')
    setColor(PROJECT_COLORS[0])
    setIcon(DEFAULT_PROJECT_ICON)
  }

  return (
    <form
      className={styles.projectForm}
      aria-labelledby={titleId}
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
    >
      <div className={styles.formHeader}>
        <h3 id={titleId}>
          {project ? 'Редактировать проект' : 'Новый проект'}
        </h3>
        {onCancel ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onCancel}
          >
            Отмена
          </button>
        ) : null}
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Название</span>
          <input
            required
            value={title}
            placeholder="Planner"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Описание</span>
          <textarea
            rows={3}
            value={description}
            placeholder="Контекст проекта и ожидаемый результат"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.pickerRow}>
        <div className={styles.pickerGroup}>
          <span className={styles.pickerLabel}>Маркер</span>
          <div className={styles.swatchList}>
            {PROJECT_COLORS.map((projectColor) => (
              <button
                key={projectColor}
                className={cx(
                  styles.swatchButton,
                  color === projectColor && styles.swatchButtonActive,
                )}
                type="button"
                style={{ backgroundColor: projectColor }}
                aria-label={`Цвет ${projectColor}`}
                onClick={() => setColor(projectColor)}
              />
            ))}
          </div>
        </div>

        <IconChoicePicker
          allowEmpty={false}
          className={styles.iconPicker}
          label="Иконка"
          showEmojiChoices={false}
          uploadedIcons={uploadedIcons}
          value={icon}
          onChange={setIcon}
        />
      </div>

      <button className={styles.primaryButton} type="submit">
        {submitLabel}
      </button>
    </form>
  )
}
