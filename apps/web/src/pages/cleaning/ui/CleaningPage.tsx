import {
  type CleaningPriority,
  type CleaningZoneUpdateInput,
  generateUuidV7,
} from '@planner/contracts'
import { type FormEvent, useMemo, useState } from 'react'
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'

import {
  getCleaningErrorMessage,
  getCleaningFocusModeFromSearchParams,
  isCleaningConnectionError,
  useCleaningPlan,
  useCleaningToday,
  useCompleteCleaningTask,
  useCreateCleaningTask,
  useCreateCleaningZone,
  usePostponeCleaningTask,
  useRemoveCleaningTask,
  useRemoveCleaningZone,
  useSeedCleaningTemplates,
  useSkipCleaningTask,
  useUpdateCleaningTask,
  useUpdateCleaningZone,
} from '@/features/cleaning'
import { usePlannerTimeZone } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { useBrowserOffline } from '@/shared/lib/offline-sync'
import { getTodayDate } from '@/shared/time/time.service'
import { CheckIcon, EditIcon, PlusIcon } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PageStateView, PageStatusBanner } from '@/shared/ui/PageState'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  clamp,
  createActionInput,
  DEFAULT_CLEANING_TEMPLATES,
  EMPTY_TASK_DRAFT,
  filterItemsByFocusMode,
  getFirstErrorMessage,
  getFrequencyUnitOptions,
  getHeroHint,
  getHiddenOverdueCleaningItems,
  getIsoWeekdayFromDate,
  getPostponedCleaningItems,
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
  CollapsibleTaskSection,
  HistoryList,
  StatPill,
  TaskSection,
  ZonePicker,
  ZoneSettings,
  ZoneStats,
  ZoneTaskRow,
} from './CleaningPage.sections'

const CLEANING_GENERAL_SETTINGS_PATH = '/cleaning/settings/general'

export function CleaningPage() {
  const [searchParams] = useSearchParams()
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const planQuery = useCleaningPlan()
  const todayQuery = useCleaningToday(todayKey)
  const seedMutation = useSeedCleaningTemplates()
  const completeTaskMutation = useCompleteCleaningTask()
  const postponeTaskMutation = usePostponeCleaningTask()
  const skipTaskMutation = useSkipCleaningTask()
  const focusMode = getCleaningFocusModeFromSearchParams(searchParams)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSeeding, setIsSeeding] = useState(false)
  const isBrowserOffline = useBrowserOffline()
  const plan = planQuery.data
  const today = todayQuery.data
  const hasLoadedPlan = plan !== undefined
  const hasLoadedToday = today !== undefined
  const hasCriticalData = hasLoadedPlan && hasLoadedToday
  const zones = plan?.zones ?? []
  const todayItems = today?.items ?? []
  const generalItems = today?.generalItems ?? []
  const overdueItems = getHiddenOverdueCleaningItems(today)
  const overdueTaskIds = new Set(overdueItems.map((item) => item.task.id))
  const postponedItems = getPostponedCleaningItems(
    plan,
    today,
    todayKey,
  ).filter((item) => !overdueTaskIds.has(item.task.id))
  const visibleTodayItems = filterItemsByFocusMode(todayItems, focusMode)
  const visibleGeneralItems = filterItemsByFocusMode(generalItems, focusMode)
  const visibleOverdueItems = filterItemsByFocusMode(overdueItems, focusMode)
  const shouldShowGeneralSection = generalItems.length > 0
  const readiness = hasLoadedPlan
    ? planQuery.readiness
    : hasLoadedToday
      ? todayQuery.readiness
      : planQuery.readiness
  const loadError =
    planQuery.error ??
    todayQuery.error ??
    planQuery.sessionError ??
    todayQuery.sessionError
  const isOffline = isBrowserOffline || isOfflineCleaningState(loadError)
  const lastSuccessfulSyncAt = getOldestTimestamp([
    hasLoadedPlan ? planQuery.lastSuccessfulSyncAt : null,
    hasLoadedToday ? todayQuery.lastSuccessfulSyncAt : null,
  ])
  const canWrite =
    planQuery.offlineQueue.canWriteFromSession &&
    (isOffline
      ? planQuery.offlineQueue.canQueueWrites
      : Boolean(readiness?.canWriteProtectedData) ||
        planQuery.offlineQueue.canQueueWrites)
  const isInitialLoading =
    !hasCriticalData &&
    (planQuery.isCacheHydrating ||
      todayQuery.isCacheHydrating ||
      (!isOffline &&
        !loadError &&
        (planQuery.isLoading ||
          todayQuery.isLoading ||
          readiness?.reason === 'auth_restoring' ||
          readiness?.reason === 'planner_pending')))
  const isMutationBusy =
    seedMutation.isPending ||
    completeTaskMutation.isPending ||
    postponeTaskMutation.isPending ||
    skipTaskMutation.isPending ||
    isSeeding
  const isBusy = isMutationBusy || !canWrite
  const mutationErrorMessage =
    formError ||
    getFirstErrorMessage([
      seedMutation.error,
      completeTaskMutation.error,
      postponeTaskMutation.error,
      skipTaskMutation.error,
    ])

  async function handleRetryLoad() {
    if (readiness && !readiness.canUseProtectedApi) {
      await planQuery.retrySession()
      return
    }

    await Promise.allSettled([planQuery.refetch(), todayQuery.refetch()])
  }

  async function handleSeedTemplates() {
    setIsSeeding(true)
    setFormError(null)

    try {
      await seedMutation.mutateAsync({
        zones: DEFAULT_CLEANING_TEMPLATES.map((template, zoneIndex) => {
          const zoneId = generateUuidV7()

          return {
            tasks: template.tasks.map((task, taskIndex) => ({
              ...task,
              id: generateUuidV7(),
              sortOrder: taskIndex,
              zoneId,
            })),
            zone: {
              dayOfWeek: template.dayOfWeek,
              description: template.description,
              id: zoneId,
              isActive: true,
              sortOrder: zoneIndex,
              title: template.title,
            },
          }
        }),
      })
    } catch (error) {
      setFormError(getCleaningErrorMessage(error))
    } finally {
      setIsSeeding(false)
    }
  }

  if (!hasCriticalData) {
    return (
      <section className={`${pageStyles.page} ${styles.page}`}>
        <h1 className={pageStyles.visuallyHidden}>Уборка</h1>
        {isInitialLoading ? (
          <PageStateView
            kind="loading"
            title="Загружаем план уборки"
            skeletonVariant="cards"
          />
        ) : (
          <PageStateView
            kind={isOffline ? 'offline' : 'error'}
            title={
              isOffline
                ? 'Уборка доступна после подключения'
                : isCleaningAccessUnavailable(readiness?.reason)
                  ? 'Нужно восстановить доступ к уборке'
                  : 'Не удалось загрузить уборку'
            }
            description={getCleaningLoadDescription(
              loadError,
              readiness?.reason,
            )}
            lastSyncedAt={lastSuccessfulSyncAt}
            showUnknownLastSync={isOffline}
            action={{
              label: 'Повторить',
              onClick: () => {
                void handleRetryLoad()
              },
            }}
          />
        )}
      </section>
    )
  }

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      <h1 className={pageStyles.visuallyHidden}>Уборка</h1>
      {loadError || isOffline || !canWrite ? (
        <PageStatusBanner
          kind={
            isOffline
              ? 'offline'
              : isCleaningAccessRestoring(readiness?.reason)
                ? 'info'
                : 'error'
          }
          title={
            isOffline
              ? 'Работаем с сохранёнными данными'
              : isCleaningAccessRestoring(readiness?.reason)
                ? 'Восстанавливаем доступ'
                : undefined
          }
          description={getCleaningCachedDescription(
            loadError,
            readiness?.reason,
            canWrite,
          )}
          lastSyncedAt={lastSuccessfulSyncAt}
          showUnknownLastSync
          action={{
            label: 'Повторить',
            onClick: () => {
              void handleRetryLoad()
            },
          }}
        />
      ) : null}

      {mutationErrorMessage ? (
        <PageStatusBanner
          kind="error"
          title="Изменение не сохранено"
          description={mutationErrorMessage}
        />
      ) : null}

      <CleaningQueueStatus
        isOffline={isOffline}
        queue={planQuery.offlineQueue}
      />

      <section className={styles.todayHero}>
        <div>
          <p className={styles.kicker}>Сегодня</p>
          <h2>
            {getWeekdayLabel(
              today?.dayOfWeek ?? getIsoWeekdayFromDate(todayKey),
            )}
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
          <StatPill
            label="задач"
            value={String(today?.summary.dueCount ?? 0)}
          />
          <StatPill
            label="важные"
            value={String(today?.summary.urgentCount ?? 0)}
          />
          <StatPill
            label="быстрые"
            value={String(today?.summary.quickCount ?? 0)}
          />
          <StatPill label="отложено" value={String(postponedItems.length)} />
          <StatPill
            label="прочие"
            value={String(today?.summary.generalCount ?? 0)}
          />
        </div>
      </section>

      {hasLoadedPlan && zones.length === 0 ? (
        <PageStateView
          kind="empty"
          title="Зоны ещё не настроены"
          description="Базовый набор создаст 7 зон и стартовые задачи с частотами. Всё можно изменить позже."
          action={
            canWrite
              ? {
                  label: isSeeding ? 'Добавляем...' : 'Добавить базовый набор',
                  disabled: isMutationBusy,
                  onClick: () => {
                    if (!isMutationBusy) {
                      void handleSeedTemplates()
                    }
                  },
                }
              : undefined
          }
        />
      ) : null}

      {overdueItems.length > 0 ? (
        <TaskSection
          title="Просрочено"
          emptyMessage="Для выбранного режима просрочек нет."
          items={visibleOverdueItems}
          isBusy={isBusy}
          showZone
          onComplete={(taskId) => {
            void completeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onPostpone={(taskId) => {
            void postponeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onSkip={(taskId) => {
            void skipTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
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
          onComplete={(taskId) => {
            void completeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onPostpone={(taskId) => {
            void postponeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onSkip={(taskId) => {
            void skipTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
        />
      ) : null}

      {shouldShowGeneralSection ? (
        <TaskSection
          title="Прочая уборка"
          emptyMessage="Для выбранного режима задач нет."
          items={visibleGeneralItems}
          isBusy={isBusy}
          onComplete={(taskId) => {
            void completeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onPostpone={(taskId) => {
            void postponeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
          onSkip={(taskId) => {
            void skipTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
        />
      ) : null}

      {postponedItems.length > 0 ? (
        <CollapsibleTaskSection
          title="Отложено"
          items={postponedItems}
          isBusy={isBusy}
          onComplete={(taskId) => {
            void completeTaskMutation.mutateAsync({
              input: createActionInput(todayKey),
              taskId,
            })
          }}
        />
      ) : null}
    </section>
  )
}

export function CleaningSettingsPage() {
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const planQuery = useCleaningPlan()
  const seedMutation = useSeedCleaningTemplates()
  const createZoneMutation = useCreateCleaningZone()
  const updateZoneMutation = useUpdateCleaningZone()
  const removeZoneMutation = useRemoveCleaningZone()
  const createTaskMutation = useCreateCleaningTask()
  const updateTaskMutation = useUpdateCleaningTask()
  const removeTaskMutation = useRemoveCleaningTask()
  const [zoneTitle, setZoneTitle] = useState('')
  const [zoneDescription, setZoneDescription] = useState('')
  const [zoneDayOfWeek, setZoneDayOfWeek] = useState(() =>
    getIsoWeekdayFromDate(todayKey),
  )
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT)
  const [formError, setFormError] = useState<string | null>(null)
  const [isZoneCreateOpen, setIsZoneCreateOpen] = useState(false)
  const [isZoneEditOpen, setIsZoneEditOpen] = useState(false)
  const [isTaskCreateOpen, setIsTaskCreateOpen] = useState(false)
  const [isSeeding, setIsSeeding] = useState(false)
  const isBrowserOffline = useBrowserOffline()
  const plan = planQuery.data
  const hasLoadedPlan = plan !== undefined
  const readiness = planQuery.readiness
  const loadError = planQuery.error ?? planQuery.sessionError
  const isOffline = isBrowserOffline || isOfflineCleaningState(loadError)
  const canWrite =
    planQuery.offlineQueue.canWriteFromSession &&
    (isOffline
      ? planQuery.offlineQueue.canQueueWrites
      : Boolean(readiness?.canWriteProtectedData) ||
        planQuery.offlineQueue.canQueueWrites)
  const isInitialLoading =
    !hasLoadedPlan &&
    (planQuery.isCacheHydrating ||
      (!isOffline &&
        !loadError &&
        (planQuery.isLoading ||
          readiness?.reason === 'auth_restoring' ||
          readiness?.reason === 'planner_pending')))
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
  const todayWeekday = getIsoWeekdayFromDate(todayKey)
  const isGeneralSelected = location.pathname === CLEANING_GENERAL_SETTINGS_PATH
  const todayZone =
    zones.find((zone) => zone.dayOfWeek === todayWeekday) ?? zones[0] ?? null
  const selectedZone = isGeneralSelected
    ? null
    : (zones.find((zone) => zone.id === params.zoneId) ?? todayZone)
  const selectedTasks = isGeneralSelected
    ? tasks.filter((task) => task.scope === 'general')
    : selectedZone
      ? tasks.filter(
          (task) => task.scope === 'zone' && task.zoneId === selectedZone.id,
        )
      : []
  const taskDraftRepeatInterval =
    taskDraft.frequencyType === 'custom'
      ? taskDraft.customIntervalDays
      : taskDraft.frequencyInterval
  const taskDraftFrequencyUnitOptions = getFrequencyUnitOptions(
    taskDraftRepeatInterval,
  )
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
  const isMutationBusy =
    createZoneMutation.isPending ||
    updateZoneMutation.isPending ||
    removeZoneMutation.isPending ||
    createTaskMutation.isPending ||
    updateTaskMutation.isPending ||
    removeTaskMutation.isPending ||
    seedMutation.isPending ||
    isSeeding
  const isBusy = isMutationBusy || !canWrite
  const mutationErrorMessage =
    formError ||
    getFirstErrorMessage([
      createZoneMutation.error,
      updateZoneMutation.error,
      removeZoneMutation.error,
      createTaskMutation.error,
      updateTaskMutation.error,
      removeTaskMutation.error,
      seedMutation.error,
    ])

  const selectedZoneDayOfWeek = freeWeekdays.some(
    (day) => day.value === zoneDayOfWeek,
  )
    ? zoneDayOfWeek
    : (freeWeekdays[0]?.value ?? zoneDayOfWeek)

  async function handleCreateZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const title = zoneTitle.trim()
    const selectedFreeWeekday = freeWeekdays.find(
      (day) => day.value === selectedZoneDayOfWeek,
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

    if (!selectedZone && !isGeneralSelected) {
      setFormError('Сначала добавьте зону.')
      return
    }

    const title = taskDraft.title.trim()

    if (!title) {
      setFormError('Введите задачу.')
      return
    }

    const repeatInterval =
      taskDraft.frequencyType === 'custom'
        ? taskDraft.customIntervalDays
        : taskDraft.frequencyInterval
    const normalizedRepeatInterval = Math.max(1, Number(repeatInterval) || 1)

    setFormError(null)

    try {
      await createTaskMutation.mutateAsync({
        assignee: 'anyone',
        customIntervalDays:
          taskDraft.frequencyType === 'custom'
            ? normalizedRepeatInterval
            : null,
        depth: 'regular',
        description: taskDraft.description.trim(),
        energy: 'normal',
        estimatedMinutes: Number(taskDraft.estimatedMinutes) || null,
        frequencyInterval: normalizedRepeatInterval,
        frequencyType: taskDraft.frequencyType,
        impactScore: clamp(Number(taskDraft.impactScore) || 3, 1, 5),
        isActive: true,
        isSeasonal: taskDraft.isSeasonal,
        priority: taskDraft.priority,
        seasonMonths: taskDraft.isSeasonal ? taskDraft.seasonMonths : [],
        scope: isGeneralSelected ? 'general' : 'zone',
        tags: parseTags(taskDraft.tags),
        title,
        zoneId: isGeneralSelected ? null : selectedZone!.id,
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
      await seedMutation.mutateAsync({
        zones: DEFAULT_CLEANING_TEMPLATES.map((template, zoneIndex) => {
          const zoneId = generateUuidV7()

          return {
            tasks: template.tasks.map((task, taskIndex) => ({
              ...task,
              id: generateUuidV7(),
              sortOrder: taskIndex,
              zoneId,
            })),
            zone: {
              dayOfWeek: template.dayOfWeek,
              description: template.description,
              id: zoneId,
              isActive: true,
              sortOrder: zoneIndex,
              title: template.title,
            },
          }
        }),
      })
    } catch (error) {
      setFormError(getCleaningErrorMessage(error))
    } finally {
      setIsSeeding(false)
    }
  }

  async function handleRetryLoad() {
    if (readiness && !readiness.canUseProtectedApi) {
      await planQuery.retrySession()
      return
    }

    await planQuery.refetch()
  }

  if (!hasLoadedPlan) {
    return (
      <section className={`${pageStyles.page} ${styles.page}`}>
        <h1 className={pageStyles.visuallyHidden}>Настройки уборки</h1>
        {isInitialLoading ? (
          <PageStateView
            kind="loading"
            title="Загружаем настройки уборки"
            skeletonVariant="settings"
          />
        ) : (
          <PageStateView
            kind={isOffline ? 'offline' : 'error'}
            title={
              isOffline
                ? 'Настройки доступны после подключения'
                : isCleaningAccessUnavailable(readiness?.reason)
                  ? 'Нужно восстановить доступ к настройкам'
                  : 'Не удалось загрузить настройки уборки'
            }
            description={getCleaningLoadDescription(
              loadError,
              readiness?.reason,
            )}
            lastSyncedAt={planQuery.lastSuccessfulSyncAt}
            showUnknownLastSync={isOffline}
            action={{
              label: 'Повторить',
              onClick: () => {
                void handleRetryLoad()
              },
            }}
          />
        )}
      </section>
    )
  }

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      <h1 className={pageStyles.visuallyHidden}>Настройки уборки</h1>
      <div className={styles.settingsHeaderShell}>
        <PageHeader
          kicker="Уборка"
          title="Настройки"
          description="Зоны, дни недели, частоты и список задач."
          actions={
            hasLoadedPlan && zones.length === 0 ? (
              <div className={styles.headerActions}>
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
              </div>
            ) : null
          }
        />
      </div>

      {loadError || isOffline || !canWrite ? (
        <PageStatusBanner
          kind={
            isOffline
              ? 'offline'
              : isCleaningAccessRestoring(readiness?.reason)
                ? 'info'
                : 'error'
          }
          title={
            isOffline
              ? 'Настройки открыты из сохранённых данных'
              : isCleaningAccessRestoring(readiness?.reason)
                ? 'Восстанавливаем доступ'
                : undefined
          }
          description={getCleaningCachedDescription(
            loadError,
            readiness?.reason,
            canWrite,
          )}
          lastSyncedAt={planQuery.lastSuccessfulSyncAt}
          showUnknownLastSync
          action={{
            label: 'Повторить',
            onClick: () => {
              void handleRetryLoad()
            },
          }}
        />
      ) : null}

      {mutationErrorMessage ? (
        <PageStatusBanner
          kind="error"
          title="Изменение не сохранено"
          description={mutationErrorMessage}
        />
      ) : null}

      <CleaningQueueStatus
        isOffline={isOffline}
        queue={planQuery.offlineQueue}
      />

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

          <ZonePicker
            disabled={isBusy}
            isGeneralSelected={isGeneralSelected}
            selectedZone={selectedZone}
            zones={zones}
            onSelect={(zoneId) => {
              setIsZoneEditOpen(false)
              setIsTaskCreateOpen(false)
              setFormError(null)
              void navigate(`/cleaning/settings/zones/${zoneId}`)
            }}
            onSelectGeneral={() => {
              setIsZoneEditOpen(false)
              setIsTaskCreateOpen(false)
              setFormError(null)
              void navigate(CLEANING_GENERAL_SETTINGS_PATH)
            }}
          />

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
                value={String(selectedZoneDayOfWeek)}
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
          {selectedZone || isGeneralSelected ? (
            <>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.kicker}>
                    {isGeneralSelected ? 'Раздел' : 'Зона'}
                  </p>
                  <h3>
                    {isGeneralSelected ? 'Прочая уборка' : selectedZone!.title}
                  </h3>
                </div>
                <div className={styles.zoneHeaderActions}>
                  {selectedZone ? (
                    <>
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
                    </>
                  ) : null}
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

              {selectedZone ? (
                <ZoneStats
                  history={plan?.history ?? []}
                  isMobileHidden={
                    isZoneCreateOpen || isZoneEditOpen || isTaskCreateOpen
                  }
                  statesByTaskId={statesByTaskId}
                  tasks={selectedTasks}
                  zone={selectedZone}
                />
              ) : (
                <p className={styles.emptyCopy}>
                  Сюда можно добавлять задачи по уборке, которые не относятся к
                  конкретной зоне или дню. Например: помыть окна, постирать
                  шторы, разобрать кладовку.
                </p>
              )}

              {selectedZone && isZoneEditOpen ? (
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
                  <fieldset
                    className={cx(styles.taskFormField, styles.repeatField)}
                  >
                    <legend className={styles.fieldLabel}>Повторять</legend>
                    <div className={styles.repeatControl}>
                      <span className={styles.repeatPrefix}>раз в</span>
                      <input
                        type="number"
                        min={1}
                        value={taskDraftRepeatInterval}
                        disabled={isBusy}
                        aria-label="Интервал повторения уборки"
                        onChange={(event) => {
                          const { value } = event.target
                          setTaskDraft((current) => ({
                            ...current,
                            customIntervalDays: value,
                            frequencyInterval: value,
                          }))
                        }}
                      />
                      <SelectPicker
                        className={styles.repeatUnitPicker}
                        value={taskDraft.frequencyType}
                        disabled={isBusy}
                        ariaLabel="Единица повторения уборки"
                        options={taskDraftFrequencyUnitOptions}
                        onChange={(nextValue) => {
                          setTaskDraft((current) => {
                            const currentInterval =
                              current.frequencyType === 'custom'
                                ? current.customIntervalDays
                                : current.frequencyInterval

                            return {
                              ...current,
                              customIntervalDays: currentInterval,
                              frequencyInterval: currentInterval,
                              frequencyType: nextValue,
                            }
                          })
                        }}
                      />
                    </div>
                  </fieldset>
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
                {selectedTasks.length === 0 ? (
                  <div className={styles.emptyTaskState}>
                    <p className={styles.emptyCopy}>
                      {isGeneralSelected
                        ? 'Сюда можно добавлять задачи по уборке, которые не относятся к конкретной зоне или дню.'
                        : 'В этой зоне пока нет задач.'}
                    </p>
                    {isGeneralSelected ? (
                      <button
                        className={styles.softButton}
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setIsTaskCreateOpen(true)
                          setFormError(null)
                        }}
                      >
                        <PlusIcon size={17} strokeWidth={2.15} />
                        <span>Добавить</span>
                      </button>
                    ) : null}
                  </div>
                ) : (
                  selectedTasks.map((task) => (
                    <ZoneTaskRow
                      key={task.id}
                      disabled={isBusy}
                      state={statesByTaskId.get(task.id)}
                      task={task}
                      zones={zones}
                      onRemove={() => {
                        void removeTaskMutation.mutateAsync(task.id)
                      }}
                      onUpdate={(input) => {
                        return updateTaskMutation.mutateAsync({
                          input,
                          taskId: task.id,
                        })
                      }}
                    />
                  ))
                )}
              </div>

              <HistoryList
                history={(plan?.history ?? []).filter((item) =>
                  isGeneralSelected
                    ? item.zoneId === null
                    : item.zoneId === selectedZone!.id,
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

function CleaningQueueStatus({
  isOffline,
  queue,
}: {
  isOffline: boolean
  queue: ReturnType<typeof useCleaningPlan>['offlineQueue']
}) {
  if (queue.conflicted > 0) {
    return (
      <>
        <PageStatusBanner
          kind="error"
          title="Некоторые изменения требуют проверки"
          description={`${queue.conflicted} ${queue.conflicted === 1 ? 'изменение не совпало' : 'изменения не совпали'} с актуальными данными. Мы не заменили их без вашего решения.`}
          action={{
            label: 'Обновить и повторить',
            onClick: () => {
              void queue.refreshAndRetryConflicts()
            },
          }}
        />
        <PageStatusBanner
          kind="info"
          title="Можно оставить данные сервера"
          description="Конфликтующие изменения и зависящие от них локальные шаги будут отменены."
          action={{
            label: 'Отменить локальные изменения',
            onClick: () => {
              void queue.discardConflicts()
            },
          }}
        />
      </>
    )
  }

  if (queue.isDraining) {
    return (
      <PageStatusBanner
        kind="info"
        title="Синхронизируем изменения"
        description="Сохранённые на устройстве изменения отправляются по порядку."
      />
    )
  }

  if (queue.failed > 0 && !isOffline) {
    return (
      <PageStatusBanner
        kind="error"
        title="Не все изменения синхронизированы"
        description="Изменения остаются на устройстве. Можно повторить отправку."
        action={{
          label: 'Повторить',
          onClick: () => {
            void queue.retry()
          },
        }}
      />
    )
  }

  if (isOffline && (queue.pending > 0 || queue.failed > 0)) {
    const count = queue.pending + queue.failed

    return (
      <PageStatusBanner
        kind="offline"
        title="Изменения сохранены на устройстве"
        description={formatQueuedChangeCount(count)}
      />
    )
  }

  return null
}

function formatQueuedChangeCount(count: number): string {
  const remainder100 = count % 100
  const remainder10 = count % 10
  const noun =
    remainder10 === 1 && remainder100 !== 11
      ? 'изменение будет отправлено'
      : remainder10 >= 2 &&
          remainder10 <= 4 &&
          (remainder100 < 12 || remainder100 > 14)
        ? 'изменения будут отправлены'
        : 'изменений будут отправлены'

  return `${count} ${noun} после восстановления связи.`
}

function isOfflineCleaningState(error: unknown): boolean {
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    isCleaningConnectionError(error)
  )
}

function getCleaningLoadDescription(
  error: unknown,
  readinessReason?: string,
): string {
  if (isOfflineCleaningState(error)) {
    return 'Нет подключения, а на устройстве нет полного сохранённого набора данных для этого экрана. Проверьте сеть и повторите.'
  }

  if (readinessReason === 'unauthorized' || readinessReason === 'no_session') {
    return 'Сессия завершилась. Повторите попытку, чтобы восстановить доступ к данным.'
  }

  if (readinessReason === 'auth_deferred') {
    return 'Не удалось восстановить вход. Повторите попытку, когда авторизация будет доступна.'
  }

  return error
    ? getCleaningErrorMessage(error)
    : 'Сервис пока не ответил. Повторите попытку.'
}

function getCleaningCachedDescription(
  error: unknown,
  readinessReason: string | undefined,
  canWrite: boolean,
): string {
  if (isOfflineCleaningState(error)) {
    return canWrite
      ? 'Показываем сохранённые данные. Изменения сохранятся на этом устройстве и синхронизируются после подключения.'
      : 'Показываем сохранённые данные. Для изменений нужно восстановить доступ.'
  }

  if (
    readinessReason === 'unauthorized' ||
    readinessReason === 'auth_deferred' ||
    readinessReason === 'no_session'
  ) {
    return 'Сохранённые данные доступны для просмотра. Чтобы вносить изменения, восстановите вход.'
  }

  if (!canWrite) {
    if (
      readinessReason === 'auth_restoring' ||
      readinessReason === 'planner_pending'
    ) {
      return 'Восстанавливаем доступ. Сохранённые данные пока доступны только для просмотра.'
    }

    return 'Сохранённые данные доступны для просмотра. Изменения станут доступны после восстановления соединения.'
  }

  return error
    ? `Сохранённые данные остаются доступны. ${getCleaningErrorMessage(error)}`
    : 'Сохранённые данные остаются доступны.'
}

function isCleaningAccessUnavailable(
  readinessReason: string | undefined,
): boolean {
  return (
    readinessReason === 'unauthorized' ||
    readinessReason === 'auth_deferred' ||
    readinessReason === 'no_session'
  )
}

function isCleaningAccessRestoring(
  readinessReason: string | undefined,
): boolean {
  return (
    readinessReason === 'auth_restoring' ||
    readinessReason === 'planner_pending'
  )
}

function getOldestTimestamp(
  values: Array<string | null | undefined>,
): string | null {
  const timestamps = values.filter((value): value is string => Boolean(value))

  if (values.length === 0 || timestamps.length !== values.length) {
    return null
  }

  return timestamps.reduce((oldest, value) => (value < oldest ? value : oldest))
}
