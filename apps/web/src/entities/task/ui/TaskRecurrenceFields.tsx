import { useId } from 'react'

import { cx } from '@/shared/lib/classnames'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import type { TaskRecurrenceFrequency } from '../model/task.types'
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

  function handleFrequencyChange(frequency: TaskRecurrenceFrequency) {
    update({
      daysOfWeek:
        frequency === 'daily' || frequency === 'monthly'
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
              label="Тип повтора"
              value={value.frequency}
              options={[
                { label: 'Дни', value: 'daily' },
                { label: 'Будни', value: 'weekly' },
                { label: 'Выбрать дни', value: 'custom' },
                { label: 'Месяцы', value: 'monthly' },
              ]}
              onChange={(nextValue) => {
                handleFrequencyChange(nextValue)
              }}
            />

            <label className={styles.field}>
              <span>Каждые</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={String(value.interval)}
                onChange={(event) => {
                  const interval = Number(event.target.value)

                  update({
                    interval: Number.isFinite(interval)
                      ? Math.max(1, Math.floor(interval))
                      : 1,
                  })
                }}
              />
            </label>
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
