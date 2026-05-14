import type { HabitFrequency } from '@planner/contracts'
import { useId } from 'react'

import { cx } from '@/shared/lib/classnames'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  TASK_RECURRENCE_DEFAULT_DAYS,
  TASK_RECURRENCE_WEEKDAYS,
  type TaskRecurrenceFormState,
  taskRecurrenceWeekdayLabels,
} from '../model/task-recurrence'
import styles from './TaskRecurrenceFields.module.css'

interface TaskRecurrenceFieldsProps {
  className?: string | undefined
  value: TaskRecurrenceFormState
  onChange: (value: TaskRecurrenceFormState) => void
}

export function TaskRecurrenceFields({
  className,
  value,
  onChange,
}: TaskRecurrenceFieldsProps) {
  const toggleId = useId()

  function update(patch: Partial<TaskRecurrenceFormState>) {
    onChange({
      ...value,
      ...patch,
    })
  }

  function handleFrequencyChange(frequency: HabitFrequency) {
    update({
      daysOfWeek:
        frequency === 'daily'
          ? [...TASK_RECURRENCE_DEFAULT_DAYS]
          : frequency === 'weekly'
            ? [...TASK_RECURRENCE_WEEKDAYS]
            : value.daysOfWeek,
      frequency,
    })
  }

  return (
    <section className={cx(styles.panel, className)}>
      <div className={styles.toggle}>
        <input
          id={toggleId}
          type="checkbox"
          checked={value.isEnabled}
          onChange={(event) => update({ isEnabled: event.target.checked })}
        />
        <span className={styles.toggleCopy}>
          <label className={styles.toggleLabel} htmlFor={toggleId}>
            Повторять задачу
          </label>
          <small>После завершения появится следующий экземпляр.</small>
        </span>
      </div>

      {value.isEnabled ? (
        <>
          <div className={styles.grid}>
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
          </div>

          {value.frequency === 'custom' ? (
            <div className={styles.daysGroup}>
              <span>Дни недели</span>
              <div className={styles.daysList}>
                {TASK_RECURRENCE_DEFAULT_DAYS.map((day) => (
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
                    <span>{taskRecurrenceWeekdayLabels[day - 1]}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
