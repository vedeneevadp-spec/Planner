import {
  type HabitRecord,
  type HabitTargetType,
  habitUpdateInputSchema,
  newHabitInputSchema,
} from '@planner/contracts'
import { type FormEvent, useMemo, useState } from 'react'

import {
  getHabitEntryValueLabel,
  getHabitFrequencyLabel,
  getHabitTargetLabel,
  isoWeekdayLabels,
  sortHabits,
} from '@/entities/habit'
import { useUploadedIconAssets } from '@/features/emoji-library'
import {
  getHabitErrorMessage,
  useCreateHabit,
  useHabits,
  useHabitStats,
  useHabitsToday,
  useHabitSyncStatus,
  useRemoveHabit,
  useUpdateHabit,
} from '@/features/habits'
import { usePlanner } from '@/features/planner'
import { cx } from '@/shared/lib/classnames'
import { getDateKey } from '@/shared/lib/date'
import {
  createSvgIconValue,
  IconChoicePicker,
  IconMark,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './HabitsPage.module.css'

const HABIT_COLORS = [
  '#214e42',
  '#2f6f62',
  '#365f8c',
  '#7b5ea7',
  '#b85c38',
  '#8b6f2f',
  '#047fa1',
  '#c72c2c',
] as const
const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEKDAYS = [1, 2, 3, 4, 5]
const DEFAULT_ICON = createSvgIconValue('check')

interface HabitFormState {
  color: string
  daysOfWeek: number[]
  description: string
  endDate: string
  frequency: HabitRecord['frequency']
  icon: string
  isActive: boolean
  reminderTime: string
  sphereId: string
  startDate: string
  targetType: HabitTargetType
  targetValue: string
  title: string
  unit: string
}

export function HabitsPage() {
  const todayKey = getDateKey(new Date())
  const monthStart = `${todayKey.slice(0, 7)}-01`
  const { projects } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const habitsQuery = useHabits()
  const todayQuery = useHabitsToday(todayKey)
  const statsQuery = useHabitStats(monthStart, todayKey)
  const syncStatus = useHabitSyncStatus()
  const createHabitMutation = useCreateHabit()
  const updateHabitMutation = useUpdateHabit()
  const removeHabitMutation = useRemoveHabit()
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const [form, setForm] = useState<HabitFormState>(() =>
    createInitialHabitForm(todayKey),
  )
  const habits = useMemo(
    () => sortHabits(habitsQuery.data ?? []),
    [habitsQuery.data],
  )
  const editingHabit = habits.find((habit) => habit.id === editingHabitId)
  const todayByHabitId = useMemo(
    () =>
      new Map(
        (todayQuery.data?.items ?? []).map((item) => [item.habit.id, item]),
      ),
    [todayQuery.data?.items],
  )
  const statsByHabitId = useMemo(
    () =>
      new Map(
        (statsQuery.data?.stats ?? []).map((stat) => [stat.habitId, stat]),
      ),
    [statsQuery.data?.stats],
  )
  const error =
    habitsQuery.error ??
    todayQuery.error ??
    statsQuery.error ??
    syncStatus.error ??
    createHabitMutation.error ??
    updateHabitMutation.error ??
    removeHabitMutation.error
  const completedToday =
    todayQuery.data?.items.filter((item) => item.entry?.status === 'done')
      .length ?? 0
  const scheduledToday = todayQuery.data?.items.length ?? 0
  const activeHabits = habits.filter((habit) => habit.isActive).length

  function resetForm() {
    setEditingHabitId(null)
    setForm(createInitialHabitForm(todayKey))
    createHabitMutation.reset()
    updateHabitMutation.reset()
  }

  function startEditing(habit: HabitRecord) {
    setEditingHabitId(habit.id)
    setForm(createHabitFormFromRecord(habit))
    createHabitMutation.reset()
    updateHabitMutation.reset()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (editingHabit) {
      const input = habitUpdateInputSchema.parse({
        color: form.color,
        daysOfWeek: resolveDaysOfWeek(form),
        description: form.description,
        endDate: form.endDate || null,
        expectedVersion: editingHabit.version,
        frequency: form.frequency,
        icon: form.icon,
        isActive: form.isActive,
        reminderTime: form.reminderTime || null,
        sphereId: form.sphereId || null,
        startDate: form.startDate,
        targetType: form.targetType,
        targetValue: Number(form.targetValue),
        title: form.title,
        unit: form.unit,
      })

      await updateHabitMutation.mutateAsync({
        habitId: editingHabit.id,
        input,
      })
      resetForm()
      return
    }

    const input = newHabitInputSchema.parse({
      color: form.color,
      daysOfWeek: resolveDaysOfWeek(form),
      description: form.description,
      endDate: form.endDate || null,
      frequency: form.frequency,
      icon: form.icon,
      reminderTime: form.reminderTime || null,
      sphereId: form.sphereId || null,
      startDate: form.startDate,
      targetType: form.targetType,
      targetValue: Number(form.targetValue),
      title: form.title,
      unit: form.unit,
    })

    await createHabitMutation.mutateAsync(input)
    resetForm()
  }

  async function handleRemoveHabit(habit: HabitRecord) {
    if (!window.confirm(`Удалить привычку «${habit.title}»?`)) {
      return
    }

    await removeHabitMutation.mutateAsync(habit.id)

    if (editingHabitId === habit.id) {
      resetForm()
    }
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Habits"
        description="Привычки держат регулярный ритм отдельно от задач: можно отмечать выполнение, пропускать без потери streak и видеть статистику по неделе."
      />

      {syncStatus.queuedMutationCount > 0 ||
      syncStatus.conflictedMutationCount > 0 ? (
        <section
          className={cx(
            styles.syncBanner,
            syncStatus.conflictedMutationCount > 0 && styles.syncBannerWarning,
          )}
          aria-live="polite"
        >
          <div>
            <strong>
              {syncStatus.conflictedMutationCount > 0
                ? 'Есть конфликтующие изменения'
                : 'Изменения сохранены локально'}
            </strong>
            <span>
              {syncStatus.conflictedMutationCount > 0
                ? 'Серверная версия изменилась. Данные обновятся, повтори действие для спорных привычек.'
                : `${syncStatus.queuedMutationCount} в очереди на синхронизацию.`}
            </span>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={
              syncStatus.isSyncing || syncStatus.queuedMutationCount === 0
            }
            onClick={() => {
              void syncStatus.retry()
            }}
          >
            {syncStatus.isSyncing ? 'Синхронизация...' : 'Повторить'}
          </button>
        </section>
      ) : null}

      <section className={styles.summaryBand}>
        <div>
          <span>Активных</span>
          <strong>{activeHabits}</strong>
        </div>
        <div>
          <span>Сегодня</span>
          <strong>
            {completedToday}/{scheduledToday}
          </strong>
        </div>
        <div>
          <span>Лучший streak</span>
          <strong>
            {Math.max(
              0,
              ...[...statsByHabitId.values()].map((stat) => stat.bestStreak),
            )}
          </strong>
        </div>
      </section>

      <form
        className={styles.form}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className={styles.formHeader}>
          <div>
            <p className={styles.eyebrow}>
              {editingHabit ? 'Редактирование' : 'Новая привычка'}
            </p>
            <h3>
              {editingHabit
                ? `Настроить «${editingHabit.title}»`
                : 'Добавить регулярное действие'}
            </h3>
          </div>

          {editingHabit ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={resetForm}
            >
              Отмена
            </button>
          ) : null}
        </div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Название</span>
            <input
              required
              maxLength={120}
              value={form.title}
              placeholder="Например: прогулка"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>

          <label className={styles.field}>
            <span>Сфера</span>
            <select
              value={form.sphereId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sphereId: event.target.value,
                }))
              }
            >
              <option value="">Без сферы</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Описание</span>
            <textarea
              rows={3}
              maxLength={600}
              value={form.description}
              placeholder="Зачем нужна эта привычка"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>

          <div className={styles.inlineGrid}>
            <label className={styles.field}>
              <span>Частота</span>
              <select
                value={form.frequency}
                onChange={(event) => {
                  const frequency = event.target
                    .value as HabitRecord['frequency']
                  setForm((current) => ({
                    ...current,
                    daysOfWeek:
                      frequency === 'daily'
                        ? DEFAULT_DAYS
                        : frequency === 'weekly'
                          ? WEEKDAYS
                          : current.daysOfWeek,
                    frequency,
                  }))
                }}
              >
                <option value="daily">Каждый день</option>
                <option value="weekly">Будни</option>
                <option value="custom">Выбрать дни</option>
              </select>
            </label>

            <label className={styles.field}>
              <span>Напоминание</span>
              <input
                type="time"
                value={form.reminderTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reminderTime: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className={styles.daysGroup}>
            <span>Дни недели</span>
            <div className={styles.daysList}>
              {DEFAULT_DAYS.map((day) => (
                <label
                  key={day}
                  className={cx(
                    styles.dayToggle,
                    form.daysOfWeek.includes(day) && styles.dayToggleActive,
                  )}
                >
                  <input
                    type="checkbox"
                    checked={form.daysOfWeek.includes(day)}
                    disabled={form.frequency !== 'custom'}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        daysOfWeek: event.target.checked
                          ? [...current.daysOfWeek, day].sort()
                          : current.daysOfWeek.filter((item) => item !== day),
                      }))
                    }}
                  />
                  <span>{isoWeekdayLabels[day - 1]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.inlineGrid}>
            <label className={styles.field}>
              <span>Тип цели</span>
              <select
                value={form.targetType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    targetType: event.target.value as HabitTargetType,
                    targetValue:
                      event.target.value === 'check'
                        ? '1'
                        : current.targetValue,
                  }))
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
                value={form.targetValue}
                disabled={form.targetType === 'check'}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    targetValue: event.target.value,
                  }))
                }
              />
            </label>

            <label className={styles.field}>
              <span>Единица</span>
              <input
                maxLength={24}
                value={form.unit}
                disabled={form.targetType !== 'count'}
                placeholder="стаканов"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    unit: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className={styles.inlineGrid}>
            <label className={styles.field}>
              <span>Старт</span>
              <input
                required
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
              />
            </label>

            <label className={styles.field}>
              <span>Завершить</span>
              <input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </label>

            <label className={styles.activeToggle}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
              />
              <span>Активна</span>
            </label>
          </div>

          <div className={styles.visualRow}>
            <div className={styles.colorGroup}>
              <span>Цвет</span>
              <div className={styles.swatches}>
                {HABIT_COLORS.map((color) => (
                  <button
                    key={color}
                    className={cx(
                      styles.swatch,
                      form.color === color && styles.swatchActive,
                    )}
                    type="button"
                    aria-label={`Цвет ${color}`}
                    style={{ backgroundColor: color }}
                    onClick={() =>
                      setForm((current) => ({ ...current, color }))
                    }
                  />
                ))}
              </div>
            </div>

            <IconChoicePicker
              allowEmpty={false}
              className={styles.iconPicker}
              label="Иконка"
              showEmojiChoices={false}
              uploadedIcons={uploadedIcons}
              value={form.icon}
              onChange={(icon) => setForm((current) => ({ ...current, icon }))}
            />
          </div>
        </div>

        <button
          className={styles.primaryButton}
          type="submit"
          disabled={
            createHabitMutation.isPending || updateHabitMutation.isPending
          }
        >
          {editingHabit ? 'Сохранить привычку' : 'Создать привычку'}
        </button>
      </form>

      {error ? (
        <p className={styles.errorText}>{getHabitErrorMessage(error)}</p>
      ) : null}

      {habits.length === 0 && habitsQuery.isSuccess ? (
        <div className={pageStyles.emptyPanel}>
          <p>Привычек пока нет. Создай первую регулярную практику выше.</p>
        </div>
      ) : (
        <div className={styles.habitGrid}>
          {habits.map((habit) => {
            const todayItem = todayByHabitId.get(habit.id)
            const stats = statsByHabitId.get(habit.id)

            return (
              <article key={habit.id} className={styles.habitCard}>
                <div className={styles.cardHeader}>
                  <span
                    className={styles.habitIcon}
                    style={{ backgroundColor: habit.color }}
                  >
                    <IconMark
                      value={habit.icon}
                      uploadedIcons={uploadedIcons}
                    />
                  </span>

                  <span
                    className={cx(
                      styles.statusBadge,
                      habit.isActive
                        ? styles.statusBadgeActive
                        : styles.statusBadgePaused,
                    )}
                  >
                    {habit.isActive ? 'активна' : 'пауза'}
                  </span>
                </div>

                <div className={styles.cardBody}>
                  <p className={styles.eyebrow}>
                    {getHabitFrequencyLabel(habit)}
                  </p>
                  <h3>{habit.title}</h3>
                  {habit.description ? <p>{habit.description}</p> : null}
                </div>

                <div className={styles.cardStats}>
                  <div>
                    <span>Цель</span>
                    <strong>
                      {getHabitTargetLabel(
                        habit.targetType,
                        habit.targetValue,
                        habit.unit,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Сегодня</span>
                    <strong>
                      {todayItem
                        ? getHabitEntryValueLabel(habit, todayItem.entry)
                        : 'не по плану'}
                    </strong>
                  </div>
                  <div>
                    <span>Streak</span>
                    <strong>{stats?.currentStreak ?? 0}</strong>
                  </div>
                  <div>
                    <span>Месяц</span>
                    <strong>{stats?.completionRate ?? 0}%</strong>
                  </div>
                </div>

                <div className={styles.cardActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => startEditing(habit)}
                  >
                    Редактировать
                  </button>
                  <button
                    className={styles.dangerButton}
                    type="button"
                    disabled={removeHabitMutation.isPending}
                    onClick={() => {
                      void handleRemoveHabit(habit)
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function createInitialHabitForm(todayKey: string): HabitFormState {
  return {
    color: HABIT_COLORS[0],
    daysOfWeek: [...DEFAULT_DAYS],
    description: '',
    endDate: '',
    frequency: 'daily',
    icon: DEFAULT_ICON,
    isActive: true,
    reminderTime: '',
    sphereId: '',
    startDate: todayKey,
    targetType: 'check',
    targetValue: '1',
    title: '',
    unit: '',
  }
}

function createHabitFormFromRecord(habit: HabitRecord): HabitFormState {
  return {
    color: habit.color,
    daysOfWeek: habit.daysOfWeek,
    description: habit.description,
    endDate: habit.endDate ?? '',
    frequency: habit.frequency,
    icon: habit.icon,
    isActive: habit.isActive,
    reminderTime: habit.reminderTime ?? '',
    sphereId: habit.sphereId ?? '',
    startDate: habit.startDate,
    targetType: habit.targetType,
    targetValue: String(habit.targetValue),
    title: habit.title,
    unit: habit.unit,
  }
}

function resolveDaysOfWeek(form: HabitFormState): number[] {
  if (form.frequency === 'daily') {
    return [...DEFAULT_DAYS]
  }

  if (form.frequency === 'weekly') {
    return [...WEEKDAYS]
  }

  return form.daysOfWeek.length > 0 ? form.daysOfWeek : [...DEFAULT_DAYS]
}
