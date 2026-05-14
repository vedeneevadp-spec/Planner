import type { HabitFrequency, HabitTargetType } from '@planner/contracts'

import { cx } from '@/shared/lib/classnames'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  ROUTINE_TASK_DEFAULT_DAYS,
  ROUTINE_TASK_WEEKDAYS,
  type RoutineTaskFormState,
  routineTaskWeekdayLabels,
} from '../model/routine-task'
import styles from './RoutineTaskFields.module.css'

interface RoutineTaskFieldsProps {
  className?: string | undefined
  showTargetFields?: boolean | undefined
  value: RoutineTaskFormState
  onChange: (value: RoutineTaskFormState) => void
}

export function RoutineTaskFields({
  className,
  showTargetFields = true,
  value,
  onChange,
}: RoutineTaskFieldsProps) {
  const showTargetValueField = showTargetFields && value.targetType !== 'check'
  const showUnitField = showTargetFields && value.targetType === 'count'

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
      <div className={cx(styles.grid, !showTargetFields && styles.gridSingle)}>
        <SelectPicker
          className={styles.field}
          label="Частота"
          value={value.frequency}
          options={[
            { label: 'Каждый день', value: 'daily' },
            { label: 'Будни', value: 'weekly' },
            { label: 'Выбрать дни', value: 'custom' },
          ]}
          onChange={(nextValue) => {
            handleFrequencyChange(nextValue)
          }}
        />

        {showTargetFields ? (
          <>
            <SelectPicker
              className={styles.field}
              label="Тип цели"
              value={value.targetType}
              options={[
                { label: 'Отметка', value: 'check' },
                { label: 'Количество', value: 'count' },
                { label: 'Минуты', value: 'duration' },
              ]}
              onChange={(nextValue) => {
                handleTargetTypeChange(nextValue)
              }}
            />

            {showTargetValueField ? (
              <label className={styles.field}>
                <span>Цель</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={value.targetValue}
                  onChange={(event) =>
                    update({ targetValue: event.target.value })
                  }
                />
              </label>
            ) : null}

            {showUnitField ? (
              <label className={styles.field}>
                <span>Единица</span>
                <input
                  maxLength={24}
                  value={value.unit}
                  placeholder="стаканов"
                  onChange={(event) => update({ unit: event.target.value })}
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>

      {value.frequency === 'custom' ? (
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
      ) : null}
    </section>
  )
}
