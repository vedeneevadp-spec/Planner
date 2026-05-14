import {
  type CleaningAssignee,
  type CleaningDepth,
  type CleaningEnergy,
  type CleaningFrequencyType,
  type CleaningPriority,
  type CleaningZoneUpdateInput,
} from '@planner/contracts'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  getCleaningErrorMessage,
  useCleaningPlan,
  useCleaningToday,
  useCompleteCleaningTask,
  useCreateCleaningTask,
  useCreateCleaningZone,
  usePostponeCleaningTask,
  useRemoveCleaningTask,
  useRemoveCleaningZone,
  useSkipCleaningTask,
  useUpdateCleaningTask,
  useUpdateCleaningZone,
} from '@/features/cleaning'
import { cx } from '@/shared/lib/classnames'
import { getDateKey } from '@/shared/lib/date'
import {
  CheckIcon,
  EditIcon,
  LightningIcon,
  PlusIcon,
  SettingsIcon,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  ASSIGNEE_LABELS,
  clamp,
  createActionInput,
  DEFAULT_CLEANING_TEMPLATES,
  DEPTH_LABELS,
  EMPTY_TASK_DRAFT,
  ENERGY_LABELS,
  filterItemsByFocusMode,
  type FocusMode,
  FREQUENCY_LABELS,
  getFirstErrorMessage,
  getFocusModeAriaLabel,
  getHeroHint,
  getIsoWeekdayFromDate,
  getWeekdayLabel,
  MONTHS,
  parseTags,
  PRIORITY_LABELS,
  type TaskDraft,
  toggleNumber,
  WEEKDAYS,
} from './CleaningPage.model'
import styles from './CleaningPage.module.css'
import {
  CompactList,
  HistoryList,
  StatPill,
  TaskSection,
  ZonePicker,
  ZoneSettings,
  ZoneStats,
  ZoneTaskRow,
} from './CleaningPage.sections'

export function CleaningPage() {
  const todayKey = getDateKey(new Date())
  const planQuery = useCleaningPlan()
  const todayQuery = useCleaningToday(todayKey)
  const createZoneMutation = useCreateCleaningZone()
  const createTaskMutation = useCreateCleaningTask()
  const completeTaskMutation = useCompleteCleaningTask()
  const postponeTaskMutation = usePostponeCleaningTask()
  const skipTaskMutation = useSkipCleaningTask()
  const [focusMode, setFocusMode] = useState<FocusMode>('all')
  const [postponeTargets, setPostponeTargets] = useState<
    Record<string, string>
  >({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSeeding, setIsSeeding] = useState(false)
  const plan = planQuery.data
  const today = todayQuery.data
  const zones = plan?.zones ?? []
  const todayItems = today?.items ?? []
  const visibleTodayItems = filterItemsByFocusMode(todayItems, focusMode)
  const isBusy =
    createZoneMutation.isPending ||
    createTaskMutation.isPending ||
    completeTaskMutation.isPending ||
    postponeTaskMutation.isPending ||
    skipTaskMutation.isPending ||
    isSeeding
  const errorMessage =
    formError ||
    getFirstErrorMessage([
      planQuery.error,
      todayQuery.error,
      createZoneMutation.error,
      createTaskMutation.error,
      completeTaskMutation.error,
      postponeTaskMutation.error,
      skipTaskMutation.error,
    ])

  async function handleSeedTemplates() {
    setIsSeeding(true)
    setFormError(null)

    try {
      for (const [
        zoneIndex,
        template,
      ] of DEFAULT_CLEANING_TEMPLATES.entries()) {
        const zone = await createZoneMutation.mutateAsync({
          dayOfWeek: template.dayOfWeek,
          description: template.description,
          isActive: true,
          sortOrder: zoneIndex,
          title: template.title,
        })

        for (const [taskIndex, task] of template.tasks.entries()) {
          await createTaskMutation.mutateAsync({
            ...task,
            sortOrder: taskIndex,
            zoneId: zone.id,
          })
        }
      }
    } catch (error) {
      setFormError(getCleaningErrorMessage(error))
    } finally {
      setIsSeeding(false)
    }
  }

  function updatePostponeTarget(taskId: string, value: string) {
    setPostponeTargets((current) => ({
      ...current,
      [taskId]: value,
    }))
  }

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      <PageHeader kicker="Уборка" />

      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

      <section className={styles.todayHero}>
        <div>
          <p className={styles.kicker}>Сегодня</p>
          <h2>
            {getWeekdayLabel(today?.dayOfWeek ?? getIsoWeekdayFromDate())}
            {today?.zones.length ? (
              <span>{today.zones.map((zone) => zone.title).join(', ')}</span>
            ) : null}
          </h2>
          <p>
            {today?.zones.length
              ? getHeroHint(today)
              : zones.length === 0
                ? 'Пока нет зон. Можно начать с базового набора и потом всё переименовать.'
                : 'На этот день зона не назначена.'}
          </p>
        </div>

        <div className={styles.heroStats}>
          <StatPill label="задач" value={String(today?.items.length ?? 0)} />
          <StatPill
            label="важные"
            value={String(today?.summary.urgentCount ?? 0)}
          />
          <StatPill
            label="быстрые"
            value={String(today?.summary.quickCount ?? 0)}
          />
          <StatPill
            label="накопилось"
            value={String(today?.summary.accumulatedCount ?? 0)}
          />
        </div>
      </section>

      <div className={styles.modeBar} aria-label="Режим уборки">
        {[
          ['all', 'Всё'],
          ['quick', '15 мин'],
          ['minimum', 'Минимум'],
          ['regular', 'Обычно'],
          ['deep', 'Максимум'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={cx(
              styles.modeButton,
              focusMode === value && styles.modeButtonActive,
            )}
            type="button"
            onClick={() => {
              setFocusMode(value as FocusMode)
            }}
            aria-label={getFocusModeAriaLabel(value as FocusMode)}
          >
            {value === 'quick' ? (
              <LightningIcon size={15} strokeWidth={2.1} />
            ) : null}
            {value === 'minimum' ? (
              <span className={styles.mobileEnergyIcon} aria-hidden="true">
                <LightningIcon size={15} strokeWidth={2.2} />
              </span>
            ) : value === 'regular' ? (
              <span className={styles.mobileEnergyIcon} aria-hidden="true">
                <LightningIcon size={15} strokeWidth={2.2} />
                <LightningIcon size={15} strokeWidth={2.2} />
              </span>
            ) : value === 'deep' ? (
              <span className={styles.mobileEnergyIcon} aria-hidden="true">
                <LightningIcon size={15} strokeWidth={2.2} />
                <LightningIcon size={15} strokeWidth={2.2} />
                <LightningIcon size={15} strokeWidth={2.2} />
              </span>
            ) : null}
            <span className={styles.modeLabel}>{label}</span>
          </button>
        ))}
      </div>

      {zones.length === 0 && !planQuery.isLoading ? (
        <section className={styles.emptyPanel}>
          <h3>Зоны ещё не настроены</h3>
          <p>Базовый набор создаст 7 зон и стартовые задачи с частотами.</p>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={isBusy}
            onClick={() => {
              void handleSeedTemplates()
            }}
          >
            <PlusIcon size={18} strokeWidth={2.15} />
            <span>{isSeeding ? 'Добавляем...' : 'Добавить базовый набор'}</span>
          </button>
        </section>
      ) : null}

      {today?.urgentItems.length ? (
        <TaskSection
          title="Рекомендуется сегодня"
          items={today.urgentItems}
          isBusy={isBusy}
          postponeTargets={postponeTargets}
          onComplete={(taskId) => {
            void completeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onPostpone={(taskId) => {
            void postponeTaskMutation.mutateAsync({
              input: {
                date: todayKey,
                mode: postponeTargets[taskId] ? 'specific_date' : 'next_cycle',
                note: '',
                targetDate: postponeTargets[taskId] || null,
              },
              taskId,
            })
          }}
          onSkip={(taskId) => {
            void skipTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onTargetChange={updatePostponeTarget}
        />
      ) : null}

      {today?.quickItems.length && focusMode === 'quick' ? (
        <TaskSection
          title="Быстрый режим"
          items={today.quickItems}
          isBusy={isBusy}
          postponeTargets={postponeTargets}
          onComplete={(taskId) => {
            void completeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onPostpone={(taskId) => {
            void postponeTaskMutation.mutateAsync({
              input: {
                date: todayKey,
                mode: postponeTargets[taskId] ? 'specific_date' : 'next_cycle',
                note: '',
                targetDate: postponeTargets[taskId] || null,
              },
              taskId,
            })
          }}
          onSkip={(taskId) => {
            void skipTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onTargetChange={updatePostponeTarget}
        />
      ) : null}

      {today?.zones.length ? (
        <TaskSection
          title="Все задачи зоны"
          emptyMessage={
            today.summary.completedTodayCount > 0 &&
            today.summary.dueCount === 0
              ? 'На сегодня всё отмечено.'
              : 'Для выбранного режима задач нет.'
          }
          items={visibleTodayItems}
          isBusy={isBusy}
          postponeTargets={postponeTargets}
          onComplete={(taskId) => {
            void completeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onPostpone={(taskId) => {
            void postponeTaskMutation.mutateAsync({
              input: {
                date: todayKey,
                mode: postponeTargets[taskId] ? 'specific_date' : 'next_cycle',
                note: '',
                targetDate: postponeTargets[taskId] || null,
              },
              taskId,
            })
          }}
          onSkip={(taskId) => {
            void skipTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onTargetChange={updatePostponeTarget}
        />
      ) : null}

      <section className={styles.sideGrid}>
        <CompactList
          title="Накопилось"
          emptyMessage="Давно отложенных задач сейчас нет."
          items={today?.accumulatedItems ?? []}
        />
        <CompactList
          title="Сезонные"
          emptyMessage="На этот месяц сезонных задач нет."
          items={today?.seasonalItems ?? []}
        />
      </section>

      {zones.length > 0 ? (
        <div className={styles.settingsShortcutRow}>
          <Link className={styles.settingsShortcut} to="/cleaning/settings">
            <SettingsIcon size={16} strokeWidth={2.1} />
            <span>Настройки зон и задач</span>
          </Link>
        </div>
      ) : null}
    </section>
  )
}

export function CleaningSettingsPage() {
  const params = useParams()
  const navigate = useNavigate()
  const planQuery = useCleaningPlan()
  const createZoneMutation = useCreateCleaningZone()
  const updateZoneMutation = useUpdateCleaningZone()
  const removeZoneMutation = useRemoveCleaningZone()
  const createTaskMutation = useCreateCleaningTask()
  const updateTaskMutation = useUpdateCleaningTask()
  const removeTaskMutation = useRemoveCleaningTask()
  const [zoneTitle, setZoneTitle] = useState('')
  const [zoneDescription, setZoneDescription] = useState('')
  const [zoneDayOfWeek, setZoneDayOfWeek] = useState(() =>
    getIsoWeekdayFromDate(),
  )
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT)
  const [formError, setFormError] = useState<string | null>(null)
  const [isZoneCreateOpen, setIsZoneCreateOpen] = useState(false)
  const [isZoneEditOpen, setIsZoneEditOpen] = useState(false)
  const [isTaskCreateOpen, setIsTaskCreateOpen] = useState(false)
  const [isSeeding, setIsSeeding] = useState(false)
  const plan = planQuery.data
  const zones = useMemo(() => plan?.zones ?? [], [plan?.zones])
  const tasks = useMemo(() => plan?.tasks ?? [], [plan?.tasks])
  const freeWeekdays = useMemo(() => {
    const occupiedDays = new Set(zones.map((zone) => zone.dayOfWeek))

    return WEEKDAYS.filter((day) => !occupiedDays.has(day.value))
  }, [zones])
  const statesByTaskId = useMemo(
    () => new Map((plan?.states ?? []).map((state) => [state.taskId, state])),
    [plan?.states],
  )
  const todayWeekday = getIsoWeekdayFromDate()
  const todayZone =
    zones.find((zone) => zone.dayOfWeek === todayWeekday) ?? zones[0] ?? null
  const selectedZone =
    zones.find((zone) => zone.id === params.zoneId) ?? todayZone
  const selectedZoneTasks = selectedZone
    ? tasks.filter((task) => task.zoneId === selectedZone.id)
    : []
  const zoneSettingsWeekdays = useMemo(() => {
    if (!selectedZone) {
      return freeWeekdays
    }

    const occupiedDays = new Set(
      zones
        .filter((zone) => zone.id !== selectedZone.id)
        .map((zone) => zone.dayOfWeek),
    )

    return WEEKDAYS.filter((day) => !occupiedDays.has(day.value))
  }, [freeWeekdays, selectedZone, zones])
  const isBusy =
    createZoneMutation.isPending ||
    updateZoneMutation.isPending ||
    removeZoneMutation.isPending ||
    createTaskMutation.isPending ||
    updateTaskMutation.isPending ||
    removeTaskMutation.isPending ||
    isSeeding
  const errorMessage =
    formError ||
    getFirstErrorMessage([
      planQuery.error,
      createZoneMutation.error,
      updateZoneMutation.error,
      removeZoneMutation.error,
      createTaskMutation.error,
      updateTaskMutation.error,
      removeTaskMutation.error,
    ])

  useEffect(() => {
    if (freeWeekdays.length === 0) {
      setIsZoneCreateOpen(false)
      return
    }

    const selectedDayIsFree = freeWeekdays.some(
      (day) => day.value === zoneDayOfWeek,
    )

    if (!selectedDayIsFree) {
      setZoneDayOfWeek(freeWeekdays[0]?.value ?? zoneDayOfWeek)
    }
  }, [freeWeekdays, zoneDayOfWeek])

  useEffect(() => {
    setIsZoneEditOpen(false)
    setIsTaskCreateOpen(false)
    setFormError(null)
  }, [selectedZone?.id])

  async function handleCreateZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const title = zoneTitle.trim()
    const selectedFreeWeekday = freeWeekdays.find(
      (day) => day.value === zoneDayOfWeek,
    )

    if (!title) {
      setFormError('Введите название зоны.')
      return
    }

    if (!selectedFreeWeekday) {
      setFormError('Свободных дней для новой зоны нет.')
      return
    }

    setFormError(null)

    try {
      await createZoneMutation.mutateAsync({
        dayOfWeek: selectedFreeWeekday.value,
        description: zoneDescription.trim(),
        isActive: true,
        title,
      })
      setZoneTitle('')
      setZoneDescription('')
      setIsZoneCreateOpen(false)
    } catch {
      // mutation state renders the error
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedZone) {
      setFormError('Сначала добавьте зону.')
      return
    }

    const title = taskDraft.title.trim()

    if (!title) {
      setFormError('Введите задачу.')
      return
    }

    setFormError(null)

    try {
      await createTaskMutation.mutateAsync({
        assignee: taskDraft.assignee,
        customIntervalDays:
          taskDraft.frequencyType === 'custom'
            ? Number(taskDraft.customIntervalDays) || 1
            : null,
        depth: taskDraft.depth,
        description: taskDraft.description.trim(),
        energy: taskDraft.energy,
        estimatedMinutes: Number(taskDraft.estimatedMinutes) || null,
        frequencyInterval: Math.max(
          1,
          Number(taskDraft.frequencyInterval) || 1,
        ),
        frequencyType: taskDraft.frequencyType,
        impactScore: clamp(Number(taskDraft.impactScore) || 3, 1, 5),
        isActive: true,
        isSeasonal: taskDraft.isSeasonal,
        priority: taskDraft.priority,
        seasonMonths: taskDraft.isSeasonal ? taskDraft.seasonMonths : [],
        tags: parseTags(taskDraft.tags),
        title,
        zoneId: selectedZone.id,
      })
      setTaskDraft(EMPTY_TASK_DRAFT)
      setIsTaskCreateOpen(false)
    } catch {
      // mutation state renders the error
    }
  }

  function handleUpdateZone(
    input: CleaningZoneUpdateInput,
    options: { closeEditorOnSuccess?: boolean } = {},
  ) {
    if (!selectedZone) {
      return
    }

    setFormError(null)

    void updateZoneMutation
      .mutateAsync({
        input,
        zoneId: selectedZone.id,
      })
      .then(() => {
        if (options.closeEditorOnSuccess) {
          setIsZoneEditOpen(false)
        }
      })
      .catch(() => {
        // mutation state renders the error
      })
  }

  async function handleSeedTemplates() {
    setIsSeeding(true)
    setFormError(null)

    try {
      for (const [
        zoneIndex,
        template,
      ] of DEFAULT_CLEANING_TEMPLATES.entries()) {
        const zone = await createZoneMutation.mutateAsync({
          dayOfWeek: template.dayOfWeek,
          description: template.description,
          isActive: true,
          sortOrder: zoneIndex,
          title: template.title,
        })

        for (const [taskIndex, task] of template.tasks.entries()) {
          await createTaskMutation.mutateAsync({
            ...task,
            sortOrder: taskIndex,
            zoneId: zone.id,
          })
        }
      }
    } catch (error) {
      setFormError(getCleaningErrorMessage(error))
    } finally {
      setIsSeeding(false)
    }
  }

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      <div className={styles.settingsHeaderShell}>
        <PageHeader
          kicker="Уборка"
          title="Настройки"
          description="Зоны, дни недели, частоты и список задач."
          actions={
            <div className={styles.headerActions}>
              {zones.length === 0 ? (
                <button
                  className={styles.softButton}
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    void handleSeedTemplates()
                  }}
                >
                  <PlusIcon size={17} strokeWidth={2.15} />
                  <span>{isSeeding ? 'Добавляем...' : 'Шаблоны'}</span>
                </button>
              ) : null}
              <Link className={styles.softLinkButton} to="/cleaning">
                К уборке
              </Link>
            </div>
          }
        />
      </div>

      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

      <section className={styles.managementGrid}>
        <section className={cx(styles.panel, styles.zonePickerPanel)}>
          <div className={styles.zonePanelHeader}>
            <div className={styles.zonePanelTitle}>
              <span>Зоны</span>
              <span aria-hidden="true">*</span>
              <span>Неделя</span>
            </div>
            {freeWeekdays.length > 0 ? (
              <button
                className={cx(
                  styles.zoneAddButton,
                  isZoneCreateOpen && styles.zoneAddButtonActive,
                )}
                type="button"
                disabled={isBusy}
                aria-label={
                  isZoneCreateOpen ? 'Скрыть добавление зоны' : 'Добавить зону'
                }
                aria-expanded={isZoneCreateOpen}
                onClick={() => {
                  setIsZoneCreateOpen((current) => !current)
                  setFormError(null)
                }}
              >
                <PlusIcon size={16} strokeWidth={2.2} />
              </button>
            ) : null}
          </div>

          {zones.length > 0 ? (
            <ZonePicker
              disabled={isBusy}
              selectedZone={selectedZone}
              zones={zones}
              onSelect={(zoneId) => {
                void navigate(`/cleaning/settings/zones/${zoneId}`)
              }}
            />
          ) : (
            <p className={styles.emptyCopy}>Зоны ещё не добавлены.</p>
          )}

          {freeWeekdays.length > 0 && isZoneCreateOpen ? (
            <form
              className={cx(styles.inlineForm, styles.zoneCreateForm)}
              onSubmit={(event) => {
                void handleCreateZone(event)
              }}
            >
              <input
                type="text"
                value={zoneTitle}
                maxLength={80}
                placeholder="Новая зона"
                disabled={isBusy}
                onChange={(event) => {
                  setZoneTitle(event.target.value)
                  setFormError(null)
                }}
              />
              <SelectPicker
                ariaLabel="День новой зоны"
                value={String(
                  freeWeekdays.some((day) => day.value === zoneDayOfWeek)
                    ? zoneDayOfWeek
                    : (freeWeekdays[0]?.value ?? zoneDayOfWeek),
                )}
                disabled={isBusy}
                options={freeWeekdays.map((day) => ({
                  label: day.label,
                  value: String(day.value),
                }))}
                onChange={(nextValue) => {
                  setZoneDayOfWeek(Number(nextValue))
                }}
              />
              <input
                type="text"
                value={zoneDescription}
                maxLength={600}
                placeholder="Короткое описание"
                disabled={isBusy}
                onChange={(event) => {
                  setZoneDescription(event.target.value)
                }}
              />
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={isBusy}
              >
                <PlusIcon size={17} strokeWidth={2.15} />
                <span>Добавить</span>
              </button>
            </form>
          ) : null}
        </section>

        <section className={styles.panel}>
          {selectedZone ? (
            <>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.kicker}>Зона</p>
                  <h3>{selectedZone.title}</h3>
                </div>
                <div className={styles.zoneHeaderActions}>
                  <span className={styles.badge}>
                    {getWeekdayLabel(selectedZone.dayOfWeek)}
                  </span>
                  <button
                    className={cx(
                      styles.iconButton,
                      isZoneEditOpen && styles.iconButtonActive,
                    )}
                    type="button"
                    disabled={isBusy}
                    aria-label={
                      isZoneEditOpen
                        ? 'Скрыть редактирование зоны'
                        : 'Редактировать зону'
                    }
                    aria-expanded={isZoneEditOpen}
                    onClick={() => {
                      setIsZoneEditOpen((current) => !current)
                      setFormError(null)
                    }}
                  >
                    <EditIcon size={16} strokeWidth={2.1} />
                  </button>
                  <button
                    className={cx(
                      styles.iconButton,
                      isTaskCreateOpen && styles.iconButtonActive,
                      isTaskCreateOpen && styles.iconButtonAddActive,
                    )}
                    type="button"
                    disabled={isBusy}
                    aria-label={
                      isTaskCreateOpen
                        ? 'Скрыть добавление задачи'
                        : 'Добавить задачу'
                    }
                    aria-expanded={isTaskCreateOpen}
                    onClick={() => {
                      setIsTaskCreateOpen((current) => !current)
                      setFormError(null)
                    }}
                  >
                    <PlusIcon size={16} strokeWidth={2.2} />
                  </button>
                </div>
              </div>

              <ZoneStats
                history={plan?.history ?? []}
                statesByTaskId={statesByTaskId}
                tasks={selectedZoneTasks}
                zone={selectedZone}
              />

              {isZoneEditOpen ? (
                <ZoneSettings
                  key={selectedZone.id}
                  availableWeekdays={zoneSettingsWeekdays}
                  disabled={isBusy}
                  zone={selectedZone}
                  onRemove={() => {
                    if (
                      window.confirm(
                        `Удалить зону «${selectedZone.title}» вместе с задачами?`,
                      )
                    ) {
                      void removeZoneMutation.mutateAsync(selectedZone.id)
                    }
                  }}
                  onSave={(input) => {
                    handleUpdateZone(input, { closeEditorOnSuccess: true })
                  }}
                  onUpdate={(input) => {
                    handleUpdateZone(input)
                  }}
                />
              ) : null}

              {isTaskCreateOpen ? (
                <form
                  className={styles.taskForm}
                  onSubmit={(event) => {
                    void handleCreateTask(event)
                  }}
                >
                  <label
                    className={cx(styles.taskFormField, styles.taskTitleField)}
                  >
                    <span className={styles.fieldLabel}>Название</span>
                    <input
                      type="text"
                      value={taskDraft.title}
                      maxLength={140}
                      placeholder="Например: помыть холодильник"
                      disabled={isBusy}
                      onChange={(event) => {
                        setTaskDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                        setFormError(null)
                      }}
                    />
                  </label>
                  <label className={styles.taskFormField}>
                    <span className={styles.fieldLabel}>Мин</span>
                    <input
                      type="number"
                      min={1}
                      value={taskDraft.estimatedMinutes}
                      disabled={isBusy}
                      onChange={(event) => {
                        setTaskDraft((current) => ({
                          ...current,
                          estimatedMinutes: event.target.value,
                        }))
                      }}
                    />
                  </label>
                  <div className={styles.taskFormField}>
                    <span className={styles.fieldLabel}>Приоритет</span>
                    <SelectPicker
                      value={taskDraft.priority}
                      disabled={isBusy}
                      ariaLabel="Приоритет"
                      options={Object.entries(PRIORITY_LABELS).map(
                        ([value, label]) => ({
                          label,
                          value,
                        }),
                      )}
                      onChange={(nextValue) => {
                        setTaskDraft((current) => ({
                          ...current,
                          priority: nextValue as CleaningPriority,
                        }))
                      }}
                    />
                  </div>
                  <div className={styles.taskFormField}>
                    <span className={styles.fieldLabel}>Частота</span>
                    <SelectPicker
                      value={taskDraft.frequencyType}
                      disabled={isBusy}
                      ariaLabel="Частота"
                      options={Object.entries(FREQUENCY_LABELS).map(
                        ([value, label]) => ({
                          label,
                          value,
                        }),
                      )}
                      onChange={(nextValue) => {
                        setTaskDraft((current) => ({
                          ...current,
                          frequencyType: nextValue as CleaningFrequencyType,
                        }))
                      }}
                    />
                  </div>
                  <label className={styles.taskFormField}>
                    <span className={styles.fieldLabel}>Интервал</span>
                    <input
                      type="number"
                      min={1}
                      value={
                        taskDraft.frequencyType === 'custom'
                          ? taskDraft.customIntervalDays
                          : taskDraft.frequencyInterval
                      }
                      disabled={isBusy}
                      onChange={(event) => {
                        const value = event.target.value
                        setTaskDraft((current) => ({
                          ...current,
                          ...(current.frequencyType === 'custom'
                            ? { customIntervalDays: value }
                            : { frequencyInterval: value }),
                        }))
                      }}
                    />
                  </label>
                  <div className={styles.taskFormField}>
                    <span className={styles.fieldLabel}>Объём</span>
                    <SelectPicker
                      value={taskDraft.depth}
                      disabled={isBusy}
                      ariaLabel="Объём уборки"
                      options={Object.entries(DEPTH_LABELS).map(
                        ([value, label]) => ({
                          label,
                          value,
                        }),
                      )}
                      onChange={(nextValue) => {
                        setTaskDraft((current) => ({
                          ...current,
                          depth: nextValue as CleaningDepth,
                        }))
                      }}
                    />
                  </div>
                  <div className={styles.taskFormField}>
                    <span className={styles.fieldLabel}>Энергия</span>
                    <SelectPicker
                      value={taskDraft.energy}
                      disabled={isBusy}
                      ariaLabel="Энергия"
                      options={Object.entries(ENERGY_LABELS).map(
                        ([value, label]) => ({
                          label,
                          value,
                        }),
                      )}
                      onChange={(nextValue) => {
                        setTaskDraft((current) => ({
                          ...current,
                          energy: nextValue as CleaningEnergy,
                        }))
                      }}
                    />
                  </div>
                  <div className={styles.taskFormField}>
                    <span className={styles.fieldLabel}>Кто</span>
                    <SelectPicker
                      value={taskDraft.assignee}
                      disabled={isBusy}
                      ariaLabel="Исполнитель"
                      options={Object.entries(ASSIGNEE_LABELS).map(
                        ([value, label]) => ({
                          label,
                          value,
                        }),
                      )}
                      onChange={(nextValue) => {
                        setTaskDraft((current) => ({
                          ...current,
                          assignee: nextValue as CleaningAssignee,
                        }))
                      }}
                    />
                  </div>
                  <button
                    className={cx(
                      styles.primaryButton,
                      styles.taskSubmitButton,
                    )}
                    type="submit"
                    disabled={isBusy}
                  >
                    <CheckIcon size={17} strokeWidth={2.15} />
                    <span>Создать</span>
                  </button>

                  <label className={styles.seasonToggle}>
                    <input
                      className={styles.seasonCheckboxInput}
                      type="checkbox"
                      checked={taskDraft.isSeasonal}
                      disabled={isBusy}
                      onChange={(event) => {
                        setTaskDraft((current) => ({
                          ...current,
                          isSeasonal: event.target.checked,
                        }))
                      }}
                    />
                    <span
                      className={styles.seasonCheckboxBox}
                      aria-hidden="true"
                    >
                      <CheckIcon size={13} strokeWidth={2.3} />
                    </span>
                    <span>Сезонная</span>
                  </label>

                  {taskDraft.isSeasonal ? (
                    <div className={styles.monthGrid}>
                      {MONTHS.map((month) => (
                        <label
                          key={month.value}
                          className={styles.monthCheckbox}
                        >
                          <input
                            className={styles.seasonCheckboxInput}
                            type="checkbox"
                            checked={taskDraft.seasonMonths.includes(
                              month.value,
                            )}
                            disabled={isBusy}
                            onChange={() => {
                              setTaskDraft((current) => ({
                                ...current,
                                seasonMonths: toggleNumber(
                                  current.seasonMonths,
                                  month.value,
                                ),
                              }))
                            }}
                          />
                          <span
                            className={styles.seasonCheckboxBox}
                            aria-hidden="true"
                          >
                            <CheckIcon size={12} strokeWidth={2.3} />
                          </span>
                          <span>{month.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </form>
              ) : null}

              <div className={styles.zoneTaskList}>
                {selectedZoneTasks.length === 0 ? (
                  <p className={styles.emptyCopy}>
                    В этой зоне пока нет задач.
                  </p>
                ) : (
                  selectedZoneTasks.map((task) => (
                    <ZoneTaskRow
                      key={task.id}
                      disabled={isBusy}
                      state={statesByTaskId.get(task.id)}
                      task={task}
                      onRemove={() => {
                        void removeTaskMutation.mutateAsync(task.id)
                      }}
                      onUpdate={(input) => {
                        void updateTaskMutation.mutateAsync({
                          input,
                          taskId: task.id,
                        })
                      }}
                    />
                  ))
                )}
              </div>

              <HistoryList
                history={(plan?.history ?? []).filter(
                  (item) => item.zoneId === selectedZone.id,
                )}
                tasks={tasks}
              />
            </>
          ) : (
            <p className={styles.emptyCopy}>Выберите или создайте зону.</p>
          )}
        </section>
      </section>
    </section>
  )
}
