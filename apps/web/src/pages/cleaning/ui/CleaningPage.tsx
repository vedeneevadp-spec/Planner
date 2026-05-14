import {
  type CleaningAssignee,
  type CleaningDepth,
  type CleaningEnergy,
  type CleaningFrequencyType,
  type CleaningPriority,
  type CleaningTaskRecord,
  type CleaningTaskStateRecord,
  type CleaningTaskWithState,
  type CleaningZoneRecord,
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
import { formatShortDate, getDateKey } from '@/shared/lib/date'
import {
  CheckIcon,
  CloseIcon,
  EditIcon,
  LightningIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
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
  formatFrequency,
  formatPostponeCount,
  FREQUENCY_LABELS,
  getFirstErrorMessage,
  getFocusModeAriaLabel,
  getHeroHint,
  getHistoryActionLabel,
  getIsoWeekdayFromDate,
  getWeekdayLabel,
  getWeekdayShortLabel,
  MONTHS,
  parseTags,
  PRIORITY_LABELS,
  type TaskDraft,
  toggleNumber,
  type WeekdayOption,
  WEEKDAYS,
} from './CleaningPage.model'
import styles from './CleaningPage.module.css'

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

function TaskSection(props: {
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

function CompactList(props: {
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

function ZonePicker(props: {
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

function ZoneSettings(props: {
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

function ZoneTaskRow(props: {
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

function ZoneStats(props: {
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

function HistoryList(props: {
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

function StatPill(props: { label: string; value: string }) {
  return (
    <div className={styles.statPill}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}
