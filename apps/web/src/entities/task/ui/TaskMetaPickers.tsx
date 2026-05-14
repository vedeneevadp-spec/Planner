import { useId } from 'react'

import { cx } from '@/shared/lib/classnames'
import { LightningIcon } from '@/shared/ui/Icon'

import {
  MAX_TASK_RESOURCE,
  TASK_RESOURCE_STEPS,
  type TaskResourceLevel,
} from '../model/resource'
import type { ResourceValue, TaskTypeValue } from '../model/task-meta'
import styles from './TaskMetaPickers.module.css'

const IMPORTANT_ICON_SRC =
  'https://chaotika.ru/api/v1/icon-assets/019db853-b277-7b05-a00f-36487fbb5cdb.webp'
const ROUTINE_ICON_SRC =
  'https://chaotika.ru/api/v1/icon-assets/019db853-b277-7e73-8b26-6bc63220c18b.webp'
const HABIT_ICON_SRC =
  'https://chaotika.ru/api/v1/icon-assets/019e1f42-061d-78e6-9b6d-4de317e02cff.png'
const RESOURCE_COLORS: Record<TaskResourceLevel, string> = {
  1: '#2f9e44',
  2: '#6da83f',
  3: '#d2a72c',
  4: '#de7b35',
}
const RESTORE_RESOURCE_COLOR = '#2f9e44'

interface TaskTypeOption {
  imageSrc: string
  label: string
  value: TaskTypeValue
}

const TASK_TYPE_OPTIONS: TaskTypeOption[] = [
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
  {
    imageSrc: HABIT_ICON_SRC,
    label: 'Привычка',
    value: 'habit',
  },
]

interface ResourceOption {
  color: string
  kind: 'drain' | 'restore'
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
    color: RESOURCE_COLORS[1],
    kind: 'drain',
    label: 'Расход 1',
    level: -1,
    value: '-1',
  },
  {
    color: RESOURCE_COLORS[2],
    kind: 'drain',
    label: 'Расход 2',
    level: -2,
    value: '-2',
  },
  {
    color: RESOURCE_COLORS[3],
    kind: 'drain',
    label: 'Расход 3',
    level: -3,
    value: '-3',
  },
  {
    color: RESOURCE_COLORS[4],
    kind: 'drain',
    label: 'Расход 4',
    level: -4,
    value: '-4',
  },
  {
    color: RESTORE_RESOURCE_COLOR,
    kind: 'restore',
    label: 'Восстановление 1',
    level: 1,
    value: '1',
  },
  {
    color: RESTORE_RESOURCE_COLOR,
    kind: 'restore',
    label: 'Восстановление 2',
    level: 2,
    value: '2',
  },
  {
    color: RESTORE_RESOURCE_COLOR,
    kind: 'restore',
    label: 'Восстановление 3',
    level: 3,
    value: '3',
  },
  {
    color: RESTORE_RESOURCE_COLOR,
    kind: 'restore',
    label: 'Восстановление 4',
    level: 4,
    value: '4',
  },
]

const DRAIN_RESOURCE_OPTIONS = RESOURCE_OPTIONS.filter(
  (option) => option.kind === 'drain',
)
const RESTORE_RESOURCE_OPTIONS = RESOURCE_OPTIONS.filter(
  (option) => option.kind === 'restore',
)

interface PickerProps<Value extends string> {
  className?: string | undefined
  label: string
  value: Value
  onChange: (value: Value) => void
}

export function TaskTypePicker({
  className,
  includeHabit = true,
  label = 'Тип',
  value,
  onChange,
}: Omit<PickerProps<TaskTypeValue>, 'label'> & {
  includeHabit?: boolean | undefined
  label?: string
}) {
  const labelId = useId()
  const options = includeHabit
    ? TASK_TYPE_OPTIONS
    : TASK_TYPE_OPTIONS.filter((option) => option.value !== 'habit')

  return (
    <div className={cx(styles.picker, className)}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>

      <div
        className={cx(styles.segmentedSurface, styles.typeSurface)}
        role="group"
        aria-labelledby={labelId}
      >
        {options.map((option) => {
          const isActive = option.value === value

          return (
            <button
              key={option.value}
              className={cx(
                styles.segmentButton,
                styles.typeButton,
                isActive && styles.segmentButtonActive,
              )}
              type="button"
              aria-pressed={isActive}
              title={option.label}
              onClick={() => onChange(isActive ? '' : option.value)}
            >
              <TaskTypeOptionContent option={option} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ResourcePicker({
  className,
  label = 'Ресурс',
  value,
  onChange,
}: Omit<PickerProps<ResourceValue>, 'label'> & { label?: string }) {
  const labelId = useId()

  return (
    <div className={cx(styles.picker, className)}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>

      <div
        className={cx(styles.segmentedSurface, styles.resourceSurface)}
        role="group"
        aria-labelledby={labelId}
      >
        <div className={styles.resourceCluster}>
          {DRAIN_RESOURCE_OPTIONS.map((option) => (
            <ResourceOptionButton
              key={option.value}
              option={option}
              isActive={option.value === value}
              onClick={() =>
                onChange(option.value === value ? '' : option.value)
              }
            />
          ))}
        </div>

        <div className={styles.resourceCluster}>
          {RESTORE_RESOURCE_OPTIONS.map((option) => (
            <ResourceOptionButton
              key={option.value}
              option={option}
              isActive={option.value === value}
              onClick={() =>
                onChange(option.value === value ? '' : option.value)
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function getResourceMagnitude(value: number): TaskResourceLevel {
  return Math.max(
    1,
    Math.min(MAX_TASK_RESOURCE, Math.abs(value)),
  ) as TaskResourceLevel
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
      {TASK_RESOURCE_STEPS.map((item) => (
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
    <span className={cx(styles.content, styles.typeContent)}>
      <span className={styles.typeIcon} aria-hidden="true">
        <img src={option.imageSrc} alt="" />
      </span>
      <span className={styles.typeTitle}>{option.label}</span>
    </span>
  )
}

function ResourceOptionButton({
  option,
  isActive,
  onClick,
}: {
  option: ResourceOption
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      className={cx(
        styles.segmentButton,
        styles.resourceButton,
        option.kind === 'drain'
          ? styles.resourceButtonDrain
          : styles.resourceButtonRestore,
        isActive && styles.segmentButtonActive,
      )}
      type="button"
      aria-label={option.label}
      aria-pressed={isActive}
      title={option.label}
      style={{ color: option.color }}
      onClick={onClick}
    >
      <span className={cx(styles.content, styles.resourceContent)}>
        <span className={styles.resourceBadgeIcon} aria-hidden="true">
          {option.kind === 'restore' ? (
            <LeafIcon />
          ) : (
            <LightningIcon size={14} strokeWidth={2.3} />
          )}
        </span>
        <span className={styles.resourceValue}>{Math.abs(option.level)}</span>
        <span className={styles.visuallyHidden}>{option.label}</span>
      </span>
    </button>
  )
}
