import {
  type CleaningFrequencyType,
  type CleaningPriority,
  type CleaningTaskRecord,
  type CleaningTaskStateRecord,
  type CleaningTaskWithState,
  type CleaningZoneRecord,
  type CleaningZoneUpdateInput,
} from '@planner/contracts'
import { useState } from 'react'

import { cx } from '@/shared/lib/classnames'
import { formatShortDate } from '@/shared/lib/date'
import { CheckIcon, CloseIcon, EditIcon, TrashIcon } from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  ASSIGNEE_LABELS,
  DEPTH_LABELS,
  ENERGY_LABELS,
  formatFrequency,
  formatPostponeCount,
  getHistoryActionLabel,
  getWeekdayLabel,
  getWeekdayShortLabel,
  PRIORITY_LABELS,
  type WeekdayOption,
} from './CleaningPage.model'
import styles from './CleaningPage.module.css'

export function TaskSection(props: {
  emptyMessage?: string
  isBusy: boolean
  items: CleaningTaskWithState[]
  postponeTargets: Record<string, string>
  title: string
  onComplete: (taskId: string) => void
  onPostpone: (taskId: string) => void
  onSkip: (taskId: string) => void
  onTargetChange: (taskId: string, value: string) => void
}) {
  return (
    <section className={styles.taskSection} id="cleaning-tasks">
      <div className={styles.panelHeader}>
        <h3>{props.title}</h3>
        <span className={styles.badge}>{props.items.length}</span>
      </div>

      {props.items.length === 0 ? (
        <p className={styles.emptyCopy}>
          {props.emptyMessage ?? 'Здесь пока нет задач.'}
        </p>
      ) : (
        <div className={styles.taskGrid}>
          {props.items.map((item) => (
            <article key={item.task.id} className={styles.taskCard}>
              <div className={styles.taskCardHeader}>
                <div>
                  <p className={styles.kicker}>{item.zone.title}</p>
                  <h4>{item.task.title}</h4>
                </div>
                <span
                  className={cx(
                    styles.priorityBadge,
                    item.task.priority === 'high' && styles.priorityHigh,
                  )}
                >
                  {PRIORITY_LABELS[item.task.priority]}
                </span>
              </div>

              <div className={styles.metaLine}>
                {item.task.estimatedMinutes ? (
                  <span>{item.task.estimatedMinutes} мин</span>
                ) : null}
                <span>{DEPTH_LABELS[item.task.depth]}</span>
                <span>{ENERGY_LABELS[item.task.energy]}</span>
                <span>{ASSIGNEE_LABELS[item.task.assignee]}</span>
              </div>

              {item.reasons.length ? (
                <div className={styles.reasonList}>
                  {item.reasons.slice(0, 3).map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </div>
              ) : null}

              <div className={styles.taskStateLine}>
                <span>
                  Отложено: {formatPostponeCount(item.state.postponeCount)}
                </span>
                <span>
                  Последнее:{' '}
                  {item.state.lastCompletedAt
                    ? formatShortDate(item.state.lastCompletedAt.slice(0, 10))
                    : 'нет'}
                </span>
                <span>
                  Следующее:{' '}
                  {item.state.nextDueAt
                    ? formatShortDate(item.state.nextDueAt)
                    : 'сейчас'}
                </span>
              </div>

              <div className={styles.actionRow}>
                <button
                  className={styles.doneButton}
                  type="button"
                  disabled={props.isBusy}
                  aria-label={`Отметить «${item.task.title}» выполненной`}
                  onClick={() => {
                    props.onComplete(item.task.id)
                  }}
                >
                  <CheckIcon size={16} strokeWidth={2.15} />
                  <span className={styles.doneButtonLabel}>Сделано</span>
                </button>
                <button
                  className={styles.softButton}
                  type="button"
                  disabled={props.isBusy}
                  onClick={() => {
                    props.onPostpone(item.task.id)
                  }}
                >
                  <EditIcon size={16} strokeWidth={2.1} />
                  <span>Отложить</span>
                </button>
                <button
                  className={styles.softButton}
                  type="button"
                  disabled={props.isBusy}
                  onClick={() => {
                    props.onSkip(item.task.id)
                  }}
                >
                  <CloseIcon size={16} strokeWidth={2.1} />
                  <span>Пропустить</span>
                </button>
              </div>

              <label className={styles.dateField}>
                <span>Дата переноса</span>
                <input
                  type="date"
                  value={props.postponeTargets[item.task.id] ?? ''}
                  disabled={props.isBusy}
                  onChange={(event) => {
                    props.onTargetChange(item.task.id, event.target.value)
                  }}
                />
              </label>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function CompactList(props: {
  emptyMessage: string
  items: CleaningTaskWithState[]
  title: string
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h3>{props.title}</h3>
        <span className={styles.badge}>{props.items.length}</span>
      </div>
      {props.items.length === 0 ? (
        <p className={styles.emptyCopy}>{props.emptyMessage}</p>
      ) : (
        <div className={styles.compactList}>
          {props.items.slice(0, 6).map((item) => (
            <div key={item.task.id} className={styles.compactItem}>
              <strong>{item.task.title}</strong>
              <span>
                {item.zone.title} · отложено{' '}
                {formatPostponeCount(item.state.postponeCount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function ZonePicker(props: {
  disabled: boolean
  selectedZone: CleaningZoneRecord | null
  zones: CleaningZoneRecord[]
  onSelect: (zoneId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedZone = props.selectedZone ?? props.zones[0] ?? null

  return (
    <div
      className={styles.zonePicker}
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
      <button
        className={styles.zoneSelectButton}
        type="button"
        disabled={props.disabled || props.zones.length === 0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => {
          setIsOpen((current) => !current)
        }}
      >
        {selectedZone ? (
          <>
            <span className={styles.zoneSelectDay}>
              {getWeekdayShortLabel(selectedZone.dayOfWeek)}
            </span>
            <span className={styles.zoneSelectText}>
              <strong>{selectedZone.title}</strong>
              <small>
                {getWeekdayLabel(selectedZone.dayOfWeek)} ·{' '}
                {selectedZone.isActive ? 'активна' : 'выключена'}
              </small>
            </span>
          </>
        ) : (
          <span className={styles.zoneSelectText}>
            <strong>Выберите зону</strong>
          </span>
        )}
        <span className={styles.zoneSelectChevron} aria-hidden="true">
          ⌄
        </span>
      </button>

      {isOpen ? (
        <div className={styles.zoneSelectMenu} role="listbox" tabIndex={-1}>
          {props.zones.map((zone) => (
            <button
              key={zone.id}
              className={cx(
                styles.zoneSelectOption,
                selectedZone?.id === zone.id && styles.zoneSelectOptionActive,
              )}
              type="button"
              role="option"
              aria-selected={selectedZone?.id === zone.id}
              onClick={() => {
                setIsOpen(false)
                props.onSelect(zone.id)
              }}
            >
              <span>{getWeekdayShortLabel(zone.dayOfWeek)}</span>
              <strong>{zone.title}</strong>
              <small>{zone.isActive ? 'активна' : 'выключена'}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ZoneSettings(props: {
  availableWeekdays: WeekdayOption[]
  disabled: boolean
  zone: CleaningZoneRecord
  onRemove: () => void
  onSave: (input: CleaningZoneUpdateInput) => void
  onUpdate: (input: CleaningZoneUpdateInput) => void
}) {
  const [title, setTitle] = useState(props.zone.title)
  const [description, setDescription] = useState(props.zone.description)
  const [dayOfWeek, setDayOfWeek] = useState(props.zone.dayOfWeek)

  return (
    <form
      className={styles.zoneSettings}
      onSubmit={(event) => {
        event.preventDefault()
        props.onSave({
          dayOfWeek,
          description: description.trim(),
          title: title.trim(),
        })
      }}
    >
      <input
        type="text"
        value={title}
        maxLength={80}
        disabled={props.disabled}
        onChange={(event) => {
          setTitle(event.target.value)
        }}
      />
      <SelectPicker
        value={String(dayOfWeek)}
        disabled={props.disabled}
        ariaLabel="День зоны"
        options={props.availableWeekdays.map((day) => ({
          label: day.label,
          value: String(day.value),
        }))}
        onChange={(nextValue) => {
          setDayOfWeek(Number(nextValue))
        }}
      />
      <input
        type="text"
        value={description}
        maxLength={600}
        disabled={props.disabled}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      <div className={styles.zoneSettingsActions}>
        <button
          className={styles.iconButton}
          type="submit"
          disabled={props.disabled}
          aria-label="Сохранить зону"
        >
          <CheckIcon size={17} strokeWidth={2.15} />
        </button>
        <ActiveSwitch
          checked={props.zone.isActive}
          disabled={props.disabled}
          label={props.zone.isActive ? 'Выключить зону' : 'Включить зону'}
          onClick={() => {
            props.onUpdate({ isActive: !props.zone.isActive })
          }}
        />
        <button
          className={styles.iconButtonDanger}
          type="button"
          disabled={props.disabled}
          aria-label="Удалить зону"
          onClick={props.onRemove}
        >
          <TrashIcon size={17} strokeWidth={2.1} />
        </button>
      </div>
    </form>
  )
}

export function ZoneTaskRow(props: {
  disabled: boolean
  state: CleaningTaskStateRecord | undefined
  task: CleaningTaskRecord
  onRemove: () => void
  onUpdate: (input: {
    estimatedMinutes?: number | null
    frequencyInterval?: number
    frequencyType?: CleaningFrequencyType
    isActive?: boolean
    priority?: CleaningPriority
  }) => void
}) {
  return (
    <div className={styles.zoneTaskRow}>
      <div className={styles.zoneTaskMain}>
        <strong>{props.task.title}</strong>
        <span>
          {props.state?.postponeCount
            ? `Отложено ${formatPostponeCount(props.state.postponeCount)}`
            : 'в цикле'}{' '}
          · {formatFrequency(props.task)}
        </span>
      </div>
      <div className={cx(styles.zoneTaskField, styles.zoneTaskPriorityField)}>
        <span className={styles.fieldLabel}>Приоритет</span>
        <SelectPicker
          className={styles.zoneTaskPriority}
          value={props.task.priority}
          disabled={props.disabled}
          ariaLabel="Приоритет задачи"
          options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({
            label,
            value,
          }))}
          onChange={(nextValue) => {
            props.onUpdate({ priority: nextValue as CleaningPriority })
          }}
        />
      </div>
      <label className={cx(styles.zoneTaskField, styles.zoneTaskMinutesField)}>
        <span className={styles.fieldLabel}>Мин</span>
        <input
          className={styles.zoneTaskMinutes}
          type="number"
          min={1}
          value={props.task.estimatedMinutes ?? ''}
          placeholder="мин"
          disabled={props.disabled}
          aria-label="Длительность задачи"
          onChange={(event) => {
            props.onUpdate({
              estimatedMinutes: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }}
        />
      </label>
      <div className={styles.zoneTaskActions}>
        <ActiveSwitch
          className={styles.zoneTaskSwitch}
          checked={props.task.isActive}
          disabled={props.disabled}
          label={props.task.isActive ? 'Выключить задачу' : 'Включить задачу'}
          onClick={() => {
            props.onUpdate({ isActive: !props.task.isActive })
          }}
        />
        <button
          className={cx(styles.iconButtonDanger, styles.zoneTaskDelete)}
          type="button"
          disabled={props.disabled}
          aria-label={`Удалить ${props.task.title}`}
          onClick={props.onRemove}
        >
          <TrashIcon size={17} strokeWidth={2.1} />
        </button>
      </div>
    </div>
  )
}

export function ZoneStats(props: {
  history: Array<{
    action: string
    date: string
    taskId: string
    zoneId: string
  }>
  statesByTaskId: Map<string, CleaningTaskStateRecord>
  tasks: CleaningTaskRecord[]
  zone: CleaningZoneRecord
}) {
  const zoneHistory = props.history.filter(
    (item) => item.zoneId === props.zone.id,
  )
  const completed = zoneHistory.filter((item) => item.action === 'completed')
  const postponed = zoneHistory.filter((item) => item.action === 'postponed')
  const lastCompleted = completed[0]?.date ?? null
  const totalActions = zoneHistory.filter((item) =>
    ['completed', 'postponed', 'skipped'].includes(item.action),
  ).length
  const completionRate =
    totalActions === 0 ? 0 : Math.round((completed.length / totalActions) * 100)
  const mostPostponedTask = props.tasks
    .map((task) => ({
      count: props.statesByTaskId.get(task.id)?.postponeCount ?? 0,
      title: task.title,
    }))
    .sort((left, right) => right.count - left.count)[0]

  return (
    <div className={styles.zoneStats}>
      <StatPill
        label="последняя"
        value={lastCompleted ? formatShortDate(lastCompleted) : 'нет'}
      />
      <StatPill label="выполнение" value={`${completionRate}%`} />
      <StatPill
        label="чаще ждёт"
        value={
          mostPostponedTask && mostPostponedTask.count > 0
            ? mostPostponedTask.title
            : 'нет'
        }
      />
      <StatPill label="переносы" value={String(postponed.length)} />
    </div>
  )
}

export function HistoryList(props: {
  history: Array<{
    action: string
    date: string
    id: string
    taskId: string
  }>
  tasks: CleaningTaskRecord[]
}) {
  const taskById = new Map(props.tasks.map((task) => [task.id, task]))

  return (
    <section className={styles.historyBlock}>
      <div className={styles.panelHeader}>
        <h3>История зоны</h3>
      </div>
      {props.history.length === 0 ? (
        <p className={styles.emptyCopy}>
          История появится после первых действий.
        </p>
      ) : (
        <div className={styles.historyList}>
          {props.history.slice(0, 8).map((item) => (
            <div key={item.id} className={styles.historyItem}>
              <time>{formatShortDate(item.date)}</time>
              <span>{getHistoryActionLabel(item.action)}</span>
              <strong>{taskById.get(item.taskId)?.title ?? 'Задача'}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function StatPill(props: { label: string; value: string }) {
  return (
    <div className={styles.statPill}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function ActiveSwitch(props: {
  checked: boolean
  className?: string | undefined
  disabled: boolean
  label: string
  text?: string | undefined
  onClick: () => void
}) {
  return (
    <button
      className={cx(
        styles.switchToggle,
        props.checked && styles.switchToggleChecked,
        props.className,
      )}
      type="button"
      disabled={props.disabled}
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      {props.text ? (
        <span className={styles.switchText}>{props.text}</span>
      ) : null}
    </button>
  )
}
