import { type FormEvent, useId, useState } from 'react'

import type { Project } from '@/entities/project'
import { cx } from '@/shared/lib/classnames'
import {
  createSvgIconValue,
  IconChoicePicker,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import styles from './SpheresPage.module.css'

const SPHERE_COLORS = [
  '#1a3bd1',
  '#4010c3',
  '#bf1fd3',
  '#e581f4',
  '#26ba86',
  '#5f6fb3',
  '#ff0000',
  '#c72c2c',
  '#b10000',
  '#ff5656',
  '#ff9a9a',
  '#ff8100',
  '#c77a2c',
  '#b15900',
  '#ffab56',
  '#ffcd9a',
  '#047fa1',
  '#1e697e',
  '#025870',
  '#4fc0e0',
  '#8acde0',
  '#00cd00',
  '#23a023',
  '#008e00',
  '#50ef50',
  '#90ef90',
] as const

const DEFAULT_SPHERE_ICON = createSvgIconValue('folder')

export interface SphereFormValues {
  color: string
  description: string
  icon: string
  title: string
}

interface SphereFormProps {
  autoFocusTitle?: boolean | undefined
  embedded?: boolean | undefined
  sphere?: Project | undefined
  showHeader?: boolean | undefined
  submitLabel: string
  uploadedIcons?: UploadedIconAsset[] | undefined
  onCancel?: (() => void) | undefined
  onSubmit: (values: SphereFormValues) => Promise<boolean>
}

export function SphereForm({
  autoFocusTitle = false,
  embedded = false,
  sphere,
  showHeader = true,
  submitLabel,
  uploadedIcons = [],
  onCancel,
  onSubmit,
}: SphereFormProps) {
  const titleId = useId()
  const [title, setTitle] = useState(sphere?.title ?? '')
  const [description, setDescription] = useState(sphere?.description ?? '')
  const [color, setColor] = useState(sphere?.color ?? SPHERE_COLORS[0])
  const [icon, setIcon] = useState(sphere?.icon ?? DEFAULT_SPHERE_ICON)

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

    if (!isSaved || sphere) {
      return
    }

    setTitle('')
    setDescription('')
    setColor(SPHERE_COLORS[0])
    setIcon(DEFAULT_SPHERE_ICON)
  }

  return (
    <form
      className={cx(styles.sphereForm, embedded && styles.sphereFormEmbedded)}
      aria-labelledby={showHeader ? titleId : undefined}
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
    >
      {showHeader ? (
        <div className={styles.formHeader}>
          <h3 id={titleId}>{sphere ? 'Редактировать сферу' : 'Новая сфера'}</h3>
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
      ) : null}

      <div className={styles.formGridDetailed}>
        <label className={styles.field}>
          <span>Название</span>
          <input
            autoFocus={autoFocusTitle}
            required
            value={title}
            placeholder="Например: здоровье"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Описание</span>
          <textarea
            rows={3}
            value={description}
            placeholder="Что входит в эту сферу и какой результат важен"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.pickerRow}>
        <div className={styles.pickerGroup}>
          <span className={styles.pickerLabel}>Цвет</span>
          <div className={styles.swatchList}>
            {SPHERE_COLORS.map((sphereColor) => (
              <button
                key={sphereColor}
                className={cx(
                  styles.swatchButton,
                  color === sphereColor && styles.swatchButtonActive,
                )}
                type="button"
                style={{ backgroundColor: sphereColor }}
                aria-label={`Цвет ${sphereColor}`}
                onClick={() => setColor(sphereColor)}
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
