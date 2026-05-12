import type { HabitFrequency, HabitTargetType } from '@planner/contracts'

import { cx } from '@/shared/lib/classnames'

import {
  ROUTINE_TASK_DEFAULT_DAYS,
  ROUTINE_TASK_WEEKDAYS,
  type RoutineTaskFormState,
  routineTaskWeekdayLabels,
} from '../model/routine-task'
import styles from './RoutineTaskFields.module.css'

interface RoutineTaskFieldsProps {
  className?: string | undefined
  value: RoutineTaskFormState
  onChange: (value: RoutineTaskFormState) => void
}

export function RoutineTaskFields({
  className,
  value,
  onChange,
}: RoutineTaskFieldsProps) {
  function update(patch: Partial<RoutineTaskFormState>) {
    onChange({
      ...value,
      ...patch,
    })
  }

  function handleFrequencyChange(frequency: HabitFrequency) {
    update({
      daysOfWeek:
        frequency === 'daily'
          ? [...ROUTINE_TASK_DEFAULT_DAYS]
          : frequency === 'weekly'
            ? [...ROUTINE_TASK_WEEKDAYS]
            : value.daysOfWeek,
      frequency,
    })
  }

  function handleTargetTypeChange(targetType: HabitTargetType) {
    update({
      targetType,
      targetValue: targetType === 'check' ? '1' : value.targetValue,
      unit: targetType === 'count' ? value.unit : '',
    })
  }

  return (
    <section className={cx(styles.panel, className)}>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Частота</span>
          <select
            value={value.frequency}
            onChange={(event) =>
              handleFrequencyChange(event.target.value as HabitFrequency)
            }
          >
            <option value="daily">Каждый день</option>
            <option value="weekly">Будни</option>
            <option value="custom">Выбрать дни</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Тип цели</span>
          <select
            value={value.targetType}
            onChange={(event) =>
              handleTargetTypeChange(event.target.value as HabitTargetType)
            }
          >
            <option value="check">Отметка</option>
            <option value="count">Количество</option>
            <option value="duration">Минуты</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Цель</span>
          <input
            type="number"
            min={1}
            max={999}
            value={value.targetValue}
            disabled={value.targetType === 'check'}
            onChange={(event) => update({ targetValue: event.target.value })}
          />
        </label>

        <label className={styles.field}>
          <span>Единица</span>
          <input
            maxLength={24}
            value={value.unit}
            disabled={value.targetType !== 'count'}
            placeholder="стаканов"
            onChange={(event) => update({ unit: event.target.value })}
          />
        </label>
      </div>

      <div className={styles.daysGroup}>
        <span>Дни недели</span>
        <div className={styles.daysList}>
          {ROUTINE_TASK_DEFAULT_DAYS.map((day) => (
            <label
              key={day}
              className={cx(
                styles.dayToggle,
                value.daysOfWeek.includes(day) && styles.dayToggleActive,
              )}
            >
              <input
                type="checkbox"
                checked={value.daysOfWeek.includes(day)}
                disabled={value.frequency !== 'custom'}
                onChange={(event) =>
                  update({
                    daysOfWeek: event.target.checked
                      ? [...value.daysOfWeek, day].sort()
                      : value.daysOfWeek.filter((item) => item !== day),
                  })
                }
              />
              <span>{routineTaskWeekdayLabels[day - 1]}</span>
            </label>
          ))}
        </div>
      </div>
    </section>
  )
}
