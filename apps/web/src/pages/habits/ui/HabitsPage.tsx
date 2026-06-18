import type { HabitRecord, HabitUpdateInput } from '@planner/contracts'
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'

import {
  getHabitEntryValueLabel,
  getHabitFrequencyLabel,
  getHabitTargetLabel,
  isHabitEntryComplete,
  sortHabits,
} from '@/entities/habit'
import { SpherePicker } from '@/entities/sphere'
import {
  buildRoutineTaskFromForm,
  RoutineTaskFields,
  type RoutineTaskFormState,
} from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import {
  getHabitErrorMessage,
  HabitsTodayPanel,
  useHabits,
  useHabitStats,
  useHabitsToday,
  useHabitSyncStatus,
  useRemoveHabit,
  useUpdateHabit,
} from '@/features/habits'
import { usePlanner } from '@/features/planner'
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
import { cx } from '@/shared/lib/classnames'
import { formatShortDate, getDateKey } from '@/shared/lib/date'
import {
  CloseIcon,
  EditIcon,
  IconChoicePicker,
  IconMark,
  PauseIcon,
  PlayIcon,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import styles from './HabitsPage.module.css'

const HABIT_COLOR_SWATCHES = [
  '#2f6f62',
  '#4f7d9f',
  '#a05f3c',
  '#8767a8',
  '#c08a2d',
  '#4d7c45',
]
const HABITS_ACTION_REQUEST_SEARCH_PARAM = 'habitsActionRequest'
const HABITS_ACTION_SEARCH_PARAM = 'habitsAction'

export function HabitsPage() {
  const todayKey = getDateKey(new Date())
  const monthStart = `${todayKey.slice(0, 7)}-01`
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const habitsQuery = useHabits()
  const todayQuery = useHabitsToday(todayKey)
  const statsQuery = useHabitStats(monthStart, todayKey)
  const syncStatus = useHabitSyncStatus()
  const updateHabitMutation = useUpdateHabit()
  const removeHabitMutation = useRemoveHabit()
  const { uploadedIcons } = useUploadedIconAssets()
  const habits = useMemo(
    () => sortHabits(habitsQuery.data ?? []),
    [habitsQuery.data],
  )
  const editingHabit = habits.find((habit) => habit.id === editingHabitId)
  const habitsAction = searchParams.get(HABITS_ACTION_SEARCH_PARAM)
  const habitsActionRequestId = searchParams.get(
    HABITS_ACTION_REQUEST_SEARCH_PARAM,
  )
  const habitComposerOpenRequestId =
    habitsAction === 'habit' ? habitsActionRequestId : null
  const habitComposerDraft = useMemo<TaskComposerDraft | null>(
    () =>
      habitComposerOpenRequestId
        ? {
            plannedDate: todayKey,
            requestId: habitComposerOpenRequestId,
            taskType: 'habit',
          }
        : null,
    [habitComposerOpenRequestId, todayKey],
  )
  const todayItems = todayQuery.data?.items ?? []
  const statsByHabitId = useMemo(
    () =>
      new Map(
        (statsQuery.data?.stats ?? []).map((stats) => [stats.habitId, stats]),
      ),
    [statsQuery.data?.stats],
  )
  const error =
    habitsQuery.error ??
    todayQuery.error ??
    statsQuery.error ??
    updateHabitMutation.error ??
    removeHabitMutation.error ??
    syncStatus.error
  const activeCount = habits.filter((habit) => habit.isActive).length
  const doneTodayCount = todayItems.filter((item) =>
    isHabitEntryComplete(item.habit, item.entry),
  ).length
  const bestStreak = Math.max(
    0,
    ...(statsQuery.data?.stats ?? []).map((stats) => stats.bestStreak),
  )

  function toggleHabitActive(habit: HabitRecord) {
    updateHabitMutation.mutate({
      habitId: habit.id,
      input: {
        expectedVersion: habit.version,
        isActive: !habit.isActive,
      },
    })
  }

  return (
    <section className={pageStyles.page}>
      <TaskComposer
        allowHabitTaskType
        defaultTaskType="habit"
        hideOpenButton
        initialPlannedDate={todayKey}
        openDraft={habitComposerDraft}
        showTimeFields={false}
      />

      <section className={styles.summaryBand}>
        <div>
          <span>Активных</span>
          <strong>{activeCount}</strong>
        </div>
        <div>
          <span>Сегодня</span>
          <strong>
            {doneTodayCount}/{todayItems.length}
          </strong>
        </div>
        <div>
          <span>Лучший streak</span>
          <strong>{bestStreak}</strong>
        </div>
      </section>

      <HabitsTodayPanel
        date={todayKey}
        defaultExpanded
        showEmptyAction={false}
      />

      {syncStatus.queuedMutationCount > 0 ||
      syncStatus.conflictedMutationCount > 0 ? (
        <section
          className={cx(
            styles.syncBanner,
            syncStatus.conflictedMutationCount > 0 && styles.syncBannerWarning,
          )}
        >
          <div>
            <strong>
              {syncStatus.conflictedMutationCount > 0
                ? 'Есть конфликтующие изменения'
                : 'Есть изменения offline'}
            </strong>
            <span>{syncStatus.queuedMutationCount} ждут синхронизации</span>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={syncStatus.isSyncing}
            onClick={() => {
              void syncStatus.retry()
            }}
          >
            {syncStatus.isSyncing ? 'Синхронизируем...' : 'Повторить'}
          </button>
        </section>
      ) : null}

      {error ? (
        <p className={styles.errorText}>{getHabitErrorMessage(error)}</p>
      ) : null}

      {habitsQuery.isPending && habits.length === 0 ? (
        <div className={pageStyles.emptyPanel}>
          <p>Загружаем привычки...</p>
        </div>
      ) : habits.length === 0 ? (
        <div className={pageStyles.emptyPanel}>
          <p>Привычек пока нет. Создайте первую через вкладку + Привычка.</p>
        </div>
      ) : (
        <div className={styles.habitGrid}>
          {habits.map((habit) => {
            const stats = statsByHabitId.get(habit.id)
            const todayItem = todayItems.find(
              (item) => item.habit.id === habit.id,
            )
            const monthCompleted = stats?.monthCompleted ?? 0
            const monthScheduled = stats?.monthScheduled ?? 0
            const monthProgressPercent = stats?.completionRate ?? 0

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

                  <div className={styles.cardHeaderMeta}>
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

                    <div className={styles.cardActions}>
                      <button
                        className={styles.cardIconButton}
                        type="button"
                        aria-label={`Редактировать привычку ${habit.title}`}
                        title="Редактировать"
                        onClick={() => setEditingHabitId(habit.id)}
                      >
                        <EditIcon size={16} strokeWidth={2.1} />
                      </button>
                      <button
                        className={styles.cardIconButton}
                        type="button"
                        disabled={updateHabitMutation.isPending}
                        aria-label={
                          habit.isActive
                            ? `Поставить привычку ${habit.title} на паузу`
                            : `Возобновить привычку ${habit.title}`
                        }
                        title={habit.isActive ? 'Пауза' : 'Возобновить'}
                        onClick={() => toggleHabitActive(habit)}
                      >
                        {habit.isActive ? (
                          <PauseIcon size={16} strokeWidth={2.1} />
                        ) : (
                          <PlayIcon size={16} strokeWidth={2.1} />
                        )}
                      </button>
                      <button
                        className={cx(
                          styles.cardIconButton,
                          styles.cardIconButtonDanger,
                        )}
                        type="button"
                        disabled={removeHabitMutation.isPending}
                        aria-label={`Удалить привычку ${habit.title}`}
                        title="Удалить"
                        onClick={() => removeHabitMutation.mutate(habit.id)}
                      >
                        <TrashIcon size={16} strokeWidth={2.1} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className={styles.cardBody}>
                  <p className={styles.eyebrow}>
                    {getHabitFrequencyLabel(habit)}
                  </p>
                  <h3>{habit.title}</h3>
                  <p>
                    {getHabitTargetLabel(
                      habit.targetType,
                      habit.targetValue,
                      habit.unit,
                    )}
                  </p>
                  {habit.description ? <p>{habit.description}</p> : null}
                </div>

                <div className={styles.cardStats}>
                  <div>
                    <span>Сегодня</span>
                    <strong>
                      {todayItem &&
                      isHabitEntryComplete(todayItem.habit, todayItem.entry)
                        ? 'готово'
                        : todayItem?.entry?.status === 'skipped'
                          ? 'пропуск'
                          : todayItem?.entry
                            ? getHabitEntryValueLabel(
                                todayItem.habit,
                                todayItem.entry,
                              )
                            : todayItem
                              ? 'ожидает'
                              : 'не запланировано'}
                    </strong>
                  </div>
                  <div>
                    <span>Streak</span>
                    <strong>{stats?.currentStreak ?? 0}</strong>
                  </div>
                  <div>
                    <span>Месяц</span>
                    <strong>
                      {monthCompleted}/{monthScheduled}
                    </strong>
                  </div>
                  <div>
                    <span>Процент</span>
                    <strong>{stats?.completionRate ?? 0}%</strong>
                  </div>
                </div>

                <div
                  className={styles.progressTrack}
                  aria-label={`Прогресс месяца ${monthProgressPercent}%`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={monthProgressPercent}
                  role="progressbar"
                >
                  <span style={{ width: `${monthProgressPercent}%` }} />
                </div>

                <div className={styles.cardFooter}>
                  <span>
                    Последняя:{' '}
                    {stats?.lastCompletedDate
                      ? formatShortDate(stats.lastCompletedDate)
                      : 'нет'}
                  </span>
                  <span>
                    Старт {formatShortDate(habit.startDate)}
                    {habit.endDate
                      ? ` - ${formatShortDate(habit.endDate)}`
                      : ''}
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {editingHabit ? (
        <HabitEditDialog
          key={`${editingHabit.id}-${editingHabit.version}`}
          habit={editingHabit}
          uploadedIcons={uploadedIcons}
          onClose={() => setEditingHabitId(null)}
        />
      ) : null}
    </section>
  )
}

interface HabitEditDialogProps {
  habit: HabitRecord
  uploadedIcons: UploadedIconAsset[]
  onClose: () => void
}

function HabitEditDialog({
  habit,
  uploadedIcons,
  onClose,
}: HabitEditDialogProps) {
  const titleId = useId()
  const titleInputRef = useRef<HTMLInputElement>(null)
  const { spheres } = usePlanner()
  const updateHabitMutation = useUpdateHabit()
  const [title, setTitle] = useState(habit.title)
  const [description, setDescription] = useState(habit.description)
  const [icon, setIcon] = useState(habit.icon)
  const [color, setColor] = useState(habit.color)
  const [sphereId, setSphereId] = useState(habit.sphereId ?? '')
  const [startDate, setStartDate] = useState(habit.startDate)
  const [endDate, setEndDate] = useState(habit.endDate ?? '')
  const [reminderTime, setReminderTime] = useState(habit.reminderTime ?? '')
  const [isActive, setIsActive] = useState(habit.isActive)
  const [routineForm, setRoutineForm] = useState<RoutineTaskFormState>(() =>
    createRoutineFormFromHabit(habit),
  )
  const error = updateHabitMutation.error

  useEffect(() => {
    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = 'hidden'
    titleInputRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedTitle = title.trim()

    if (!normalizedTitle) {
      return
    }

    const routine = buildRoutineTaskFromForm(routineForm)
    const input: HabitUpdateInput = {
      color,
      daysOfWeek: routine.daysOfWeek,
      description: description.trim(),
      endDate: endDate || null,
      expectedVersion: habit.version,
      frequency: routine.frequency,
      icon: icon.trim() || 'check',
      isActive,
      reminderTime: reminderTime || null,
      sphereId: sphereId || null,
      startDate,
      targetType: routine.targetType,
      targetValue: routine.targetValue,
      title: normalizedTitle,
      unit: routine.targetType === 'count' ? routine.unit : '',
    }

    await updateHabitMutation.mutateAsync({
      habitId: habit.id,
      input,
    })
    onClose()
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.dialogOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        className={styles.dialogBackdrop}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть окно редактирования привычки"
        onClick={onClose}
      />

      <form
        className={styles.dialog}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>Редактирование</p>
            <h2 id={titleId}>{habit.title}</h2>
          </div>
          <button
            className={styles.dialogCloseButton}
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.1} />
          </button>
        </div>

        <div className={styles.editGrid}>
          <label className={styles.field}>
            <span>Название</span>
            <input
              ref={titleInputRef}
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <SpherePicker
            className={styles.editPicker}
            spheres={spheres}
            uploadedIcons={uploadedIcons}
            value={sphereId}
            onChange={setSphereId}
          />

          <label className={styles.field}>
            <span>Старт</span>
            <input
              required
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Финиш</span>
            <input
              type="date"
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Напоминание</span>
            <input
              type="time"
              value={reminderTime}
              onChange={(event) => setReminderTime(event.target.value)}
            />
          </label>

          <label className={styles.activeToggle}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Активна
          </label>

          <label className={cx(styles.field, styles.editWide)}>
            <span>Описание</span>
            <textarea
              rows={3}
              maxLength={600}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>

        <section className={styles.editSection}>
          <RoutineTaskFields value={routineForm} onChange={setRoutineForm} />
        </section>

        <section className={styles.editSection}>
          <div className={styles.visualRow}>
            <IconChoicePicker
              allowEmpty={false}
              className={styles.iconPicker}
              label="Иконка"
              showEmojiChoices={false}
              uploadedIcons={uploadedIcons}
              value={icon}
              onChange={setIcon}
            />

            <div className={styles.colorGroup}>
              <span>Цвет</span>
              <div className={styles.swatches}>
                {HABIT_COLOR_SWATCHES.map((swatchColor) => (
                  <button
                    key={swatchColor}
                    className={cx(
                      styles.swatch,
                      color === swatchColor && styles.swatchActive,
                    )}
                    type="button"
                    aria-label={`Цвет ${swatchColor}`}
                    aria-pressed={color === swatchColor}
                    style={{ backgroundColor: swatchColor }}
                    onClick={() => setColor(swatchColor)}
                  />
                ))}
              </div>
              <label className={styles.field}>
                <span>Точный цвет</span>
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
            </div>
          </div>
        </section>

        {error ? (
          <p className={styles.errorText}>{getHabitErrorMessage(error)}</p>
        ) : null}

        <div className={styles.dialogActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={!title.trim() || updateHabitMutation.isPending}
          >
            {updateHabitMutation.isPending ? 'Сохраняем...' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function createRoutineFormFromHabit(habit: HabitRecord): RoutineTaskFormState {
  return {
    daysOfWeek: [...habit.daysOfWeek],
    frequency: habit.frequency,
    targetType: habit.targetType,
    targetValue: String(habit.targetValue),
    unit: habit.unit,
  }
}
