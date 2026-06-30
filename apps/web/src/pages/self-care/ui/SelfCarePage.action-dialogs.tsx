import type {
  SelfCareCompletionInput,
  SelfCareIntervalUnit,
  SelfCareItemScheduleInput,
  SelfCareTodayItem,
} from '@planner/contracts'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { usePlannerTimeZone } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { CloseIcon } from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import { SelfCareReminderOffsetsField } from './SelfCarePage.form-controls'
import {
  getClientTimeZone,
  getInitialReminderOffsets,
} from './SelfCarePage.form-model'
import {
  buildRestartCourseScheduleRule,
  calculateExerciseTotal,
  CATEGORY_LABELS,
  formatDate,
  formatExercisePlan,
  formatExerciseValue,
  formatMeasurementTarget,
  formatOptionalNumber,
  getCourseUnitLabel,
  getExerciseMetricLabel,
  getExerciseUnitLabel,
  getInitialExerciseValue,
  getInitialMeasurementValue,
  getInitialScheduleTime,
  getTypeLabel,
  INTERVAL_UNIT_SELECT_OPTIONS,
  normalizeOptionalText,
  parseOptionalPrice,
  parsePositiveInteger,
  parseRequiredMeasurementNumber,
  type SelfCareCourseRestartPayload,
} from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'
import { addIntervalDateKey, shiftDateKey } from './SelfCarePage.schedule'

export function SelfCareCourseRestartDialog({
  entry,
  errorMessage,
  isBusy,
  onClose,
  onSubmit,
  todayKey,
}: {
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onClose: () => void
  onSubmit: (payload: SelfCareCourseRestartPayload) => void
  todayKey: string
}) {
  const [restartMode, setRestartMode] = useState<'now' | 'delay'>('now')
  const [intervalValue, setIntervalValue] = useState('1')
  const [intervalUnit, setIntervalUnit] =
    useState<SelfCareIntervalUnit>('month')
  const intervalNumber = parsePositiveInteger(intervalValue)
  const restartDate =
    restartMode === 'now'
      ? todayKey
      : intervalNumber
        ? addIntervalDateKey(todayKey, intervalNumber, intervalUnit)
        : ''
  const course = entry.courseDetails
  const canSubmit = Boolean(course && restartDate)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined' || !course) {
    return null
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-course-restart-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть повтор курса"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-course-restart-title">Повторить курс</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть повтор курса"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <form
          className={styles.scheduleForm}
          onSubmit={(event) => {
            event.preventDefault()

            if (!canSubmit) {
              return
            }

            onSubmit({
              input: {
                courseDetails: {
                  breakDays: course.breakDays,
                  completedCount: 0,
                  courseType: course.courseType,
                  endDate: null,
                  isCompleted: false,
                  isPaused: false,
                  repeatAfterCompletion: course.repeatAfterCompletion,
                  startDate: restartDate,
                  totalCount: course.totalCount,
                },
                expectedVersion: entry.item.version,
                scheduleRule: buildRestartCourseScheduleRule(
                  entry,
                  restartDate,
                ),
              },
              restartDate,
            })
          }}
        >
          <div className={styles.scheduleTarget}>
            <strong>{entry.item.title}</strong>
            <span>
              {course.totalCount}{' '}
              {getCourseUnitLabel(course.courseType, course.totalCount)}
            </span>
          </div>

          <div
            className={styles.quickDateGrid}
            role="group"
            aria-label="Когда повторить курс"
          >
            <button
              className={cx(
                styles.quickDateButton,
                restartMode === 'now' && styles.quickDateButtonActive,
              )}
              type="button"
              disabled={isBusy}
              aria-pressed={restartMode === 'now'}
              onClick={() => setRestartMode('now')}
            >
              Активировать сейчас
            </button>
            <button
              className={cx(
                styles.quickDateButton,
                restartMode === 'delay' && styles.quickDateButtonActive,
              )}
              type="button"
              disabled={isBusy}
              aria-pressed={restartMode === 'delay'}
              onClick={() => setRestartMode('delay')}
            >
              Повторить через период
            </button>
          </div>

          {restartMode === 'delay' ? (
            <div className={styles.createFormGrid}>
              <label className={styles.dateField}>
                <span>Повторить через</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  required
                  value={intervalValue}
                  onChange={(event) => setIntervalValue(event.target.value)}
                />
              </label>

              <SelectPicker<SelfCareIntervalUnit>
                className={styles.selectField}
                label="Период"
                value={intervalUnit}
                options={INTERVAL_UNIT_SELECT_OPTIONS}
                onChange={setIntervalUnit}
              />
            </div>
          ) : null}

          <p className={styles.mutedText}>
            Новый старт: {restartDate ? formatDate(restartDate) : 'выбери срок'}
          </p>

          {errorMessage ? (
            <p className={styles.errorText}>{errorMessage}</p>
          ) : null}

          <div className={styles.modalActions}>
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              className={styles.doneButton}
              type="submit"
              disabled={isBusy || !canSubmit}
            >
              Повторить
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

export function SelfCareScheduleDialog({
  date,
  defaultCurrency,
  entry,
  errorMessage,
  isBusy,
  onChangeDate,
  onClose,
  onSubmit,
  todayKey,
}: {
  date: string
  defaultCurrency: string
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onChangeDate: (date: string) => void
  onClose: () => void
  onSubmit: (input: SelfCareItemScheduleInput) => void
  todayKey: string
}) {
  const plannerTimeZone = usePlannerTimeZone()
  const [scheduledTime, setScheduledTime] = useState(
    getInitialScheduleTime(entry, plannerTimeZone),
  )
  const [reminderOffsetsMinutes, setReminderOffsetsMinutes] = useState<
    number[]
  >(() => getInitialReminderOffsets(entry))
  const [place, setPlace] = useState(
    entry.appointment?.place ?? entry.procedure?.place ?? '',
  )
  const [specialistName, setSpecialistName] = useState(
    entry.appointment?.specialistName ?? entry.procedure?.specialistName ?? '',
  )
  const [specialistContact, setSpecialistContact] = useState(
    entry.appointment?.specialistContact ?? entry.procedure?.contact ?? '',
  )
  const [price, setPrice] = useState(
    formatOptionalNumber(
      entry.appointment?.price ?? entry.procedure?.defaultPrice,
    ),
  )
  const [note, setNote] = useState(entry.appointment?.preparationNote ?? '')

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  const quickOptions = [
    { label: 'Сегодня', value: todayKey },
    { label: 'Завтра', value: shiftDateKey(todayKey, 1) },
    { label: 'Через неделю', value: shiftDateKey(todayKey, 7) },
    { label: 'Через месяц', value: shiftDateKey(todayKey, 30) },
  ]

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-schedule-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть планирование заботы"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-schedule-title">Запланировать</h2>
            <p>Выбери дату, время и детали записи.</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть планирование заботы"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <form
          className={styles.scheduleForm}
          onSubmit={(event) => {
            event.preventDefault()
            const priceValue = parseOptionalPrice(price)
            onSubmit({
              currency:
                priceValue === null
                  ? null
                  : (entry.appointment?.currency ??
                    entry.procedure?.currency ??
                    defaultCurrency),
              note,
              place: normalizeOptionalText(place),
              price: priceValue,
              reminderOffsetsMinutes,
              scheduledFor: date,
              scheduledTime: normalizeOptionalText(scheduledTime),
              specialistContact: normalizeOptionalText(specialistContact),
              specialistName: normalizeOptionalText(specialistName),
              timezone: getClientTimeZone(plannerTimeZone),
            })
          }}
        >
          <div className={styles.scheduleTarget}>
            <strong>{entry.item.title}</strong>
            <span>
              {CATEGORY_LABELS[entry.item.category]} ·{' '}
              {getTypeLabel(entry.item)}
            </span>
          </div>

          <div className={styles.scheduleDetailsGrid}>
            <label className={styles.dateField}>
              <span>Дата</span>
              <input
                type="date"
                min={todayKey}
                required
                value={date}
                onChange={(event) => onChangeDate(event.target.value)}
              />
            </label>

            <label className={styles.dateField}>
              <span>Время</span>
              <input
                type="time"
                value={scheduledTime}
                onChange={(event) => setScheduledTime(event.target.value)}
              />
            </label>
          </div>

          <SelfCareReminderOffsetsField
            value={reminderOffsetsMinutes}
            onChange={setReminderOffsetsMinutes}
          />

          <div
            className={styles.quickDateGrid}
            role="group"
            aria-label="Быстрый выбор даты"
          >
            {quickOptions.map((option) => (
              <button
                key={option.value}
                className={cx(
                  styles.quickDateButton,
                  option.value === date && styles.quickDateButtonActive,
                )}
                type="button"
                disabled={isBusy}
                onClick={() => onChangeDate(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className={styles.scheduleDetailsGrid}>
            <label className={styles.dateField}>
              <span>Место</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Салон, клиника, адрес"
                value={place}
                onChange={(event) => setPlace(event.target.value)}
              />
            </label>

            <label className={styles.dateField}>
              <span>Мастер / специалист</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Имя мастера или врача"
                value={specialistName}
                onChange={(event) => setSpecialistName(event.target.value)}
              />
            </label>

            <label className={styles.dateField}>
              <span>Контакт</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Телефон, ссылка, мессенджер"
                value={specialistContact}
                onChange={(event) => setSpecialistContact(event.target.value)}
              />
            </label>

            <label className={styles.dateField}>
              <span>Стоимость</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                placeholder="0 ₽"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
          </div>

          <label className={styles.dateField}>
            <span>Комментарий</span>
            <textarea
              rows={3}
              maxLength={600}
              placeholder="Что важно помнить перед записью"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {errorMessage ? (
            <p className={styles.errorText}>{errorMessage}</p>
          ) : null}

          <div className={styles.modalActions}>
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              className={styles.doneButton}
              type="submit"
              disabled={
                isBusy ||
                !date ||
                (reminderOffsetsMinutes.length > 0 && !scheduledTime)
              }
            >
              Запланировать
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

export function SelfCareMeasurementDialog({
  entry,
  errorMessage,
  isBusy,
  onClose,
  onSubmit,
}: {
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onClose: () => void
  onSubmit: (input: SelfCareCompletionInput) => void
}) {
  const [value, setValue] = useState(() => getInitialMeasurementValue(entry))
  const [note, setNote] = useState('')
  const numericValue = parseRequiredMeasurementNumber(value)
  const targetLabel = formatMeasurementTarget(entry)
  const unit = entry.measurement?.unit ?? ''
  const label = entry.measurement?.valueLabel ?? 'Значение'

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-measurement-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть ввод измерения"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-measurement-title">Записать измерение</h2>
            <p>{entry.item.title}</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть ввод измерения"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <form
          className={styles.scheduleForm}
          onSubmit={(event) => {
            event.preventDefault()

            if (numericValue === null) {
              return
            }

            onSubmit({
              alternativeTitle: null,
              completedVariant: 'full',
              durationMinutes: null,
              energyAfter: null,
              energyBefore: null,
              exerciseSets: [],
              measurementUnit: unit || null,
              measurementValue: numericValue,
              moodAfter: null,
              moodBefore: null,
              note,
              status: 'done',
            })
          }}
        >
          <div className={styles.scheduleTarget}>
            <strong>{label}</strong>
            <span>{targetLabel ?? 'Без заданной нормы'}</span>
          </div>

          <label className={styles.dateField}>
            <span>{unit ? `${label}, ${unit}` : label}</span>
            <input
              type="number"
              step="any"
              inputMode="decimal"
              autoFocus
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Комментарий</span>
            <textarea
              rows={3}
              maxLength={1200}
              placeholder="Можно оставить пустым"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {errorMessage ? (
            <p className={styles.errorText}>{errorMessage}</p>
          ) : null}

          <div className={styles.modalActions}>
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              className={styles.doneButton}
              type="submit"
              disabled={isBusy || numericValue === null}
            >
              Сохранить
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

type ExerciseSetDraft = {
  index: number
  value: string
}

export function SelfCareExerciseDialog({
  entry,
  errorMessage,
  isBusy,
  onClose,
  onSubmit,
}: {
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onClose: () => void
  onSubmit: (input: SelfCareCompletionInput) => void
}) {
  const exercise = entry.exercise
  const unit = exercise?.unit ?? 'reps'
  const metricType = exercise?.metricType ?? 'count'
  const useSets = exercise?.useSets ?? false
  const [value, setValue] = useState(() => getInitialExerciseValue(entry))
  const [sets, setSets] = useState<ExerciseSetDraft[]>(() =>
    getInitialExerciseSetDrafts(entry),
  )
  const [note, setNote] = useState('')
  const numericValue = parseRequiredMeasurementNumber(value)
  const parsedSets = sets
    .map((set) => ({
      index: set.index,
      value: parseRequiredMeasurementNumber(set.value),
    }))
    .filter(
      (set): set is { index: number; value: number } => set.value !== null,
    )
  const totalValue = useSets
    ? calculateExerciseTotal(metricType, parsedSets)
    : numericValue
  const canSaveProgress = useSets && parsedSets.length > 0
  const canFinish = totalValue !== null

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function updateSetValue(index: number, nextValue: string): void {
    setSets((current) =>
      current.map((set) =>
        set.index === index ? { ...set, value: nextValue } : set,
      ),
    )
  }

  function addSet(): void {
    setSets((current) => [
      ...current,
      { index: (current.at(-1)?.index ?? 0) + 1, value: '' },
    ])
  }

  function removeSet(index: number): void {
    setSets((current) =>
      current.length <= 1
        ? current
        : current.filter((set) => set.index !== index),
    )
  }

  function submitExercise(status: 'done' | 'partial'): void {
    if (totalValue === null) {
      return
    }

    onSubmit({
      alternativeTitle: null,
      completedVariant: status === 'done' ? 'full' : null,
      durationMinutes: null,
      energyAfter: null,
      energyBefore: null,
      exerciseSets: useSets ? parsedSets : [],
      measurementUnit: unit,
      measurementValue: totalValue,
      moodAfter: null,
      moodBefore: null,
      note,
      status,
    })
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-exercise-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть ввод упражнения"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-exercise-title">Записать упражнение</h2>
            <p>{entry.item.title}</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть ввод упражнения"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <form
          className={styles.scheduleForm}
          onSubmit={(event) => {
            event.preventDefault()

            if (!canFinish) {
              return
            }

            submitExercise('done')
          }}
        >
          <div className={styles.scheduleTarget}>
            <strong>{getExerciseMetricLabel(metricType)}</strong>
            <span>{formatExercisePlan(entry) ?? 'Без заданного плана'}</span>
          </div>

          {useSets ? (
            <div className={styles.exerciseSetList}>
              {sets.map((set, index) => (
                <div key={set.index} className={styles.exerciseSetRow}>
                  <label className={styles.dateField}>
                    <span>Подход {index + 1}</span>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      autoFocus={index === 0}
                      value={set.value}
                      onChange={(event) =>
                        updateSetValue(set.index, event.target.value)
                      }
                    />
                  </label>
                  <button
                    className={styles.softButton}
                    type="button"
                    disabled={isBusy || sets.length <= 1}
                    onClick={() => removeSet(set.index)}
                  >
                    Убрать
                  </button>
                </div>
              ))}
              <button
                className={styles.softButton}
                type="button"
                disabled={isBusy}
                onClick={addSet}
              >
                Добавить подход
              </button>
            </div>
          ) : (
            <label className={styles.dateField}>
              <span>
                {`${getExerciseMetricLabel(metricType)}, ${getExerciseUnitLabel(
                  unit,
                )}`}
              </span>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                autoFocus
                required
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
          )}

          {totalValue !== null ? (
            <div className={styles.scheduleTarget}>
              <strong>Итог</strong>
              <span>{formatExerciseValue(totalValue, unit)}</span>
            </div>
          ) : null}

          <label className={styles.dateField}>
            <span>Комментарий</span>
            <textarea
              rows={3}
              maxLength={1200}
              placeholder="Можно оставить пустым"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {errorMessage ? (
            <p className={styles.errorText}>{errorMessage}</p>
          ) : null}

          <div className={styles.modalActions}>
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={onClose}
            >
              Отмена
            </button>
            {useSets ? (
              <button
                className={styles.softButton}
                type="button"
                disabled={isBusy || !canSaveProgress}
                onClick={() => submitExercise('partial')}
              >
                Сохранить прогресс
              </button>
            ) : null}
            <button
              className={styles.doneButton}
              type="submit"
              disabled={isBusy || !canFinish}
            >
              {useSets ? 'Завершить' : 'Сохранить'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

function getInitialExerciseSetDrafts(
  entry: SelfCareTodayItem,
): ExerciseSetDraft[] {
  const completion = entry.lastExercise ?? entry.completion
  if (completion?.exerciseSets.length) {
    return completion.exerciseSets.map((set) => ({
      index: set.index,
      value: formatOptionalNumber(set.value),
    }))
  }

  const count = entry.exercise?.plannedSets ?? 3
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    index: index + 1,
    value: '',
  }))
}
