import { useId, useMemo, useRef, useState } from 'react'

import { type Task } from '@/entities/task'
import {
  toPlannerTask,
  usePlanner,
  usePlannerTaskCursor,
} from '@/features/planner'
import { usePlannerTimeZone } from '@/features/session'
import { formatShortDate } from '@/shared/lib/date'
import {
  addDateDays,
  formatDateOnlyForLocale,
  getTodayDate,
} from '@/shared/time/time.service'
import { PlannerDialog } from '@/shared/ui/PlannerDialog/PlannerDialog'

import { buildRescheduleOptions } from '../lib/reschedule-plan'
import {
  analyzeDailyLoad,
  ENERGY_MODE_CONFIGS,
  type EnergyMode,
} from '../lib/resource-plan'
import styles from './TaskRescheduleDialog.module.css'

export function TaskRescheduleDialog({
  task,
  todayTasks,
  todayComplete,
  energyMode,
  onClose,
  onMoved,
}: {
  task: Task
  todayTasks: Task[]
  todayComplete: boolean
  energyMode: EnergyMode
  onClose: () => void
  onMoved: (task: Task, date: string) => void
}) {
  const {
    tasks,
    taskReadModelCoverage,
    isTaskOffline,
    isTaskPending,
    setTaskPlannedDate,
  } = usePlanner()
  const timezone = usePlannerTimeZone()
  const today = getTodayDate(timezone)
  const query = usePlannerTaskCursor({
    dateFrom: today,
    dateTo: addDateDays(today, 8),
    dateMode: 'planned',
    direction: 'asc',
    limit: 500,
    scope: 'all',
  })
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const dateInputId = useId()
  const merged = useMemo(() => {
    const map = new Map(tasks.map((item) => [item.id, item]))
    for (const record of query.data?.items ?? [])
      map.set(record.id, toPlannerTask(record, timezone))
    return [...map.values()]
  }, [tasks, query.data?.items, timezone])
  const complete = Boolean(
    query.data &&
    !query.data.truncated &&
    !query.isFetching &&
    !query.isError &&
    !isTaskOffline &&
    taskReadModelCoverage &&
    !taskReadModelCoverage.sources.active.truncated,
  )
  const { options, recommendedDate } = buildRescheduleOptions(
    merged,
    task,
    energyMode,
    today,
    complete,
  )
  const date =
    chosen ??
    recommendedDate ??
    options.find((option) => option.allowed)?.date ??
    null
  const selected = options.find((option) => option.date === date)
  const limit = ENERGY_MODE_CONFIGS[energyMode].resourceLimit
  const afterToday = analyzeDailyLoad(
    todayTasks.filter((item) => item.id !== task.id),
    energyMode,
    todayComplete,
  )
  async function move() {
    if (!selected?.allowed || locked.current || isTaskPending(task.id)) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      if (await setTaskPlannedDate(task.id, selected.date))
        onMoved(task, selected.date)
      else setError('Не удалось перенести задачу. Попробуй ещё раз.')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <PlannerDialog
      title="Куда перенести?"
      subtitle={task.title}
      onClose={onClose}
      busy={busy}
    >
      <div className={styles.legend}>
        <span>Нагрузка до → после переноса</span>
        <span>
          «{ENERGY_MODE_CONFIGS[energyMode].label}» · лимит {limit}
        </span>
      </div>
      {query.isFetching && !query.data ? (
        <p className={styles.notice} role="status">
          Загружаем ближайшие дни…
        </p>
      ) : null}
      {query.isError ? (
        <p className={styles.notice} role="status">
          Не удалось обновить нагрузку.{' '}
          <button
            type="button"
            onClick={() => {
              void query.refetch()
            }}
          >
            Повторить
          </button>
        </p>
      ) : null}
      <fieldset className={styles.days} disabled={busy}>
        <legend className={styles.visuallyHidden}>День для переноса</legend>
        {options.map((option) => (
          <label
            htmlFor={`${dateInputId}-${option.date}`}
            key={option.date}
            className={styles.day}
            data-selected={date === option.date}
            data-disabled={!option.allowed}
          >
            <span className={styles.visuallyHidden}>Перенести на </span>
            <input
              id={`${dateInputId}-${option.date}`}
              type="radio"
              name="reschedule-date"
              value={option.date}
              checked={date === option.date}
              disabled={!option.allowed}
              onChange={() => setChosen(option.date)}
            />
            <span className={styles.dayInfo}>
              <span className={styles.dayDate}>
                {formatDateOnlyForLocale({
                  localDate: option.date,
                  locale: 'ru-RU',
                  options: { weekday: 'short', day: 'numeric', month: 'short' },
                })}{' '}
                {recommendedDate === option.date ? (
                  <small>Подходит</small>
                ) : null}
              </span>
              <span className={styles.meta}>
                {!option.allowed
                  ? 'Позже срока задачи'
                  : !option.after.isComplete
                    ? 'Оценка неполная'
                    : `Задач: ${option.before.totalTaskCount}`}
              </span>
            </span>
            <span className={styles.dayLoad}>
              <span>
                {option.before.assessedTaskCount || option.before.isComplete
                  ? option.before.totalResource
                  : '—'}{' '}
                →{' '}
                <strong
                  data-overload={option.after.assessedState === 'overload'}
                >
                  {option.after.totalResource} / {limit}
                </strong>
              </span>
              <span className={styles.track} aria-hidden="true">
                <span
                  style={{
                    width: `${Math.min(option.after.overloadScore, 100)}%`,
                  }}
                  data-overload={option.after.assessedState === 'overload'}
                />
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className={styles.selection} role="status">
        {!selected
          ? 'До срока задачи нет доступных дней для переноса.'
          : !selected.after.isComplete
            ? 'Показана только оценённая часть. Полная нагрузка этого дня неизвестна.'
            : selected.after.assessedState === 'overload'
              ? 'После переноса нагрузка этого дня будет выше выбранного лимита.'
              : afterToday.isComplete
                ? `Сегодня станет ${afterToday.totalResource} из ${limit}. В выбранный день — ${selected.after.totalResource} из ${limit}.`
                : `В выбранный день будет ${selected.after.totalResource} из ${limit}. Оценка сегодняшнего дня неполная.`}
      </p>
      {task.recurrence?.isActive ? (
        <p className={styles.notice}>
          Переносится этот повтор. Расписание серии сохраняется.
        </p>
      ) : null}
      {task.plannedStartTime ? (
        <p className={styles.notice}>
          Время {task.plannedStartTime}
          {task.plannedEndTime ? `–${task.plannedEndTime}` : ''} сохранится.
          Совпадения по времени не проверяются.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <footer className={styles.footer}>
        <button type="button" disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={!selected?.allowed || busy || isTaskPending(task.id)}
          onClick={() => {
            void move()
          }}
        >
          {busy
            ? 'Переносим…'
            : selected
              ? `Перенести на ${formatShortDate(selected.date)}`
              : 'Перенести'}
        </button>
      </footer>
    </PlannerDialog>
  )
}
