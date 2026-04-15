import { type FormEvent, useState } from 'react'

import { usePlanner } from '@/features/planner'
import { cx } from '@/shared/lib/classnames'
import { addDays, getDateKey } from '@/shared/lib/date'

import styles from './TaskComposer.module.css'

interface TaskComposerProps {
  initialPlannedDate: string | null
}

export function TaskComposer({ initialPlannedDate }: TaskComposerProps) {
  const { addTask } = usePlanner()
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [plannedDate, setPlannedDate] = useState(initialPlannedDate ?? '')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      return
    }

    addTask({
      title: normalizedTitle,
      note,
      project,
      plannedDate: plannedDate || null,
      dueDate: dueDate || null,
    })

    setTitle('')
    setProject('')
    setPlannedDate(initialPlannedDate ?? '')
    setDueDate('')
    setNote('')
  }

  return (
    <form className={styles.panel} onSubmit={handleSubmit}>
      <div className={styles.composerMain}>
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
            onChange={(event) => setPlannedDate(event.target.value)}
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
            onClick={() => setPlannedDate(todayKey)}
          >
            На сегодня
          </button>
          <button
            className={styles.ghostButton}
            type="button"
            onClick={() => setPlannedDate(tomorrowKey)}
          >
            На завтра
          </button>
          <button
            className={styles.ghostButton}
            type="button"
            onClick={() => setPlannedDate('')}
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
