import { type FormEvent, useState } from 'react'

import { usePlanner } from '@/features/planner'
import { cx } from '@/shared/lib/classnames'
import { addDays, getDateKey } from '@/shared/lib/date'

import styles from './TaskComposer.module.css'

interface TaskComposerProps {
  initialPlannedDate: string | null
  showTimeFields?: boolean
}

export function TaskComposer({
  initialPlannedDate,
  showTimeFields = false,
}: TaskComposerProps) {
  const { addTask } = usePlanner()
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [plannedDate, setPlannedDate] = useState(initialPlannedDate ?? '')
  const [plannedStartTime, setPlannedStartTime] = useState('')
  const [plannedEndTime, setPlannedEndTime] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')

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

    const isCreated = await addTask({
      title: normalizedTitle,
      note,
      project,
      plannedDate: plannedDate || null,
      plannedStartTime: plannedStartTime || null,
      plannedEndTime: plannedEndTime || null,
      dueDate: dueDate || null,
    })

    if (!isCreated) {
      return
    }

    setTitle('')
    setProject('')
    setPlannedDate(initialPlannedDate ?? '')
    setPlannedStartTime('')
    setPlannedEndTime('')
    setDueDate('')
    setNote('')
  }

  return (
    <form
      className={styles.panel}
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
    >
      <div
        className={cx(
          styles.composerMain,
          showTimeFields && styles.composerMainTimeline,
        )}
      >
        <label className={cx(styles.field, styles.fieldTitle)}>
          <span>Новая задача</span>
          <input
            required
            value={title}
            placeholder="Например: собрать референсы для недельного плана"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Проект</span>
          <input
            value={project}
            placeholder="Planner, Work, Study"
            onChange={(event) => setProject(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>План</span>
          <input
            type="date"
            value={plannedDate}
            onChange={(event) => handlePlannedDateChange(event.target.value)}
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

        <button className={styles.primaryButton} type="submit">
          Добавить задачу
        </button>
      </div>
    </form>
  )
}
