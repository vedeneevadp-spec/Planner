import { useState } from 'react'

import { cx } from '@/shared/lib/classnames'
import { LightningIcon } from '@/shared/ui/Icon'

import type { ResourceValue, TaskTypeValue } from '../model/task-meta'
import styles from './TaskMetaPickers.module.css'

const IMPORTANT_ICON_SRC =
  '/api/v1/icon-assets/019db853-b277-7b05-a00f-36487fbb5cdb.webp'
const ROUTINE_ICON_SRC =
  '/api/v1/icon-assets/019db853-b277-7e73-8b26-6bc63220c18b.webp'
const RESOURCE_COLORS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '#2f9e44',
  2: '#6da83f',
  3: '#d2a72c',
  4: '#de7b35',
  5: '#c84534',
}
const RESTORE_RESOURCE_COLOR = '#2f9e44'

interface TaskTypeOption {
  imageSrc?: string
  label: string
  value: TaskTypeValue
}

const TASK_TYPE_OPTIONS: TaskTypeOption[] = [
  {
    label: 'Обычная',
    value: '',
  },
  {
    imageSrc: IMPORTANT_ICON_SRC,
    label: 'Важное',
    value: 'important',
  },
  {
    imageSrc: ROUTINE_ICON_SRC,
    label: 'Рутина',
    value: 'routine',
  },
]

interface ResourceOption {
  color: string
  label: string
  level: number
  value: ResourceValue
}

interface TaskResourceMeterProps {
  className?: string | undefined
  color?: string | undefined
  label?: string | undefined
  value: number
}

const RESOURCE_OPTIONS: ResourceOption[] = [
  {
    color: '#879188',
    label: 'Ресурс 0',
    level: 0,
    value: '',
  },
  {
    color: RESOURCE_COLORS[1],
    label: 'Расход 1',
    level: -1,
    value: '-1',
  },
  {
    color: RESOURCE_COLORS[2],
    label: 'Расход 2',
    level: -2,
    value: '-2',
  },
  {
    color: RESOURCE_COLORS[3],
    label: 'Расход 3',
    level: -3,
    value: '-3',
  },
  {
    color: RESOURCE_COLORS[4],
    label: 'Расход 4',
    level: -4,
    value: '-4',
  },
  {
    color: RESOURCE_COLORS[5],
    label: 'Расход 5',
    level: -5,
    value: '-5',
  },
  {
    color: RESOURCE_COLORS[1],
    label: 'Восстановление 1',
    level: 1,
    value: '1',
  },
  {
    color: RESOURCE_COLORS[2],
    label: 'Восстановление 2',
    level: 2,
    value: '2',
  },
  {
    color: RESOURCE_COLORS[3],
    label: 'Восстановление 3',
    level: 3,
    value: '3',
  },
  {
    color: RESOURCE_COLORS[4],
    label: 'Восстановление 4',
    level: 4,
    value: '4',
  },
  {
    color: RESOURCE_COLORS[5],
    label: 'Восстановление 5',
    level: 5,
    value: '5',
  },
]

interface PickerProps<Value extends string> {
  className?: string | undefined
  label: string
  value: Value
  onChange: (value: Value) => void
}

export function TaskTypePicker({
  className,
  label = 'Тип',
  value,
  onChange,
}: Omit<PickerProps<TaskTypeValue>, 'label'> & { label?: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedOption =
    TASK_TYPE_OPTIONS.find((option) => option.value === value) ??
    TASK_TYPE_OPTIONS[0]!

  function selectOption(nextValue: TaskTypeValue) {
    onChange(nextValue)
    setIsOpen(false)
  }

  return (
    <div
      className={cx(styles.picker, className)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget

        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsOpen(false)
        }
      }}
    >
      <span className={styles.label}>{label}</span>
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <TaskTypeOptionContent option={selectedOption} />
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className={styles.menu} role="listbox" tabIndex={-1}>
          {TASK_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value || 'regular'}
              className={cx(
                styles.option,
                option.value === value && styles.active,
              )}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => selectOption(option.value)}
            >
              <TaskTypeOptionContent option={option} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ResourcePicker({
  className,
  label = 'Ресурс',
  value,
  onChange,
}: Omit<PickerProps<ResourceValue>, 'label'> & { label?: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedOption =
    RESOURCE_OPTIONS.find((option) => option.value === value) ??
    RESOURCE_OPTIONS[0]!

  function selectOption(nextValue: ResourceValue) {
    onChange(nextValue)
    setIsOpen(false)
  }

  return (
    <div
      className={cx(styles.picker, className)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget

        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsOpen(false)
        }
      }}
    >
      <span className={styles.label}>{label}</span>
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <ResourceOptionContent option={selectedOption} />
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className={styles.menu} role="listbox" tabIndex={-1}>
          {RESOURCE_OPTIONS.map((option) => (
            <button
              key={option.value || 'unset'}
              className={cx(
                styles.option,
                option.value === value && styles.active,
              )}
              type="button"
              aria-label={option.label}
              role="option"
              aria-selected={option.value === value}
              title={option.label}
              onClick={() => selectOption(option.value)}
            >
              <ResourceOptionContent option={option} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function getResourceMagnitude(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.abs(value))) as 1 | 2 | 3 | 4 | 5
}

export function TaskResourceMeter({
  className,
  color,
  label,
  value,
}: TaskResourceMeterProps) {
  if (value === 0) {
    return null
  }

  const magnitude = getResourceMagnitude(value)
  const isRestore = value > 0
  const normalizedColor = isRestore
    ? RESTORE_RESOURCE_COLOR
    : (color ?? RESOURCE_COLORS[magnitude])
  const normalizedLabel =
    label ?? (isRestore ? `Восстановление ${magnitude}` : `Расход ${magnitude}`)

  return (
    <span
      className={cx(styles.resourceMeter, className)}
      style={{ color: normalizedColor }}
      role="img"
      aria-label={normalizedLabel}
      title={normalizedLabel}
    >
      {[1, 2, 3, 4, 5].map((item) => (
        <span
          key={item}
          className={item > magnitude ? styles.resourceBoltMuted : undefined}
        >
          {isRestore ? (
            <LeafIcon />
          ) : (
            <LightningIcon size={15} strokeWidth={2.4} />
          )}
        </span>
      ))}
    </span>
  )
}

function LeafIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 19C5 11 10.5 5 19 5C19 13.5 13 19 5 19Z" />
      <path d="M5 19L14 10" />
    </svg>
  )
}

function TaskTypeOptionContent({ option }: { option: TaskTypeOption }) {
  return (
    <span className={styles.content}>
      {option.imageSrc ? (
        <span className={styles.typeIcon} aria-hidden="true">
          <img src={option.imageSrc} alt="" />
        </span>
      ) : (
        <span className={styles.emptyTypeIcon} aria-hidden="true" />
      )}
      <span className={styles.text}>
        <span className={styles.title}>{option.label}</span>
      </span>
    </span>
  )
}

function ResourceOptionContent({ option }: { option: ResourceOption }) {
  return (
    <span className={cx(styles.content, styles.resourceContent)}>
      <ResourceIcon color={option.color} level={option.level} />
      <span className={styles.visuallyHidden}>{option.label}</span>
    </span>
  )
}

function ResourceIcon({
  color,
  level,
}: Pick<ResourceOption, 'color' | 'level'>) {
  if (level === 0) {
    return <span className={styles.resourceEmptyIcon} aria-hidden="true" />
  }

  return (
    <TaskResourceMeter
      color={color}
      label={
        level > 0 ? `Восстановление ${level}` : `Расход ${Math.abs(level)}`
      }
      value={level}
    />
  )
}
