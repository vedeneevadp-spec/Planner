import type {
  SelfCareCategory,
  SelfCareCompletion,
  SelfCareCompletionInput,
  SelfCareCourseDetails,
  SelfCareFlexiblePeriod,
  SelfCareImportance,
  SelfCareIntervalUnit,
  SelfCareItem,
  SelfCareItemInput,
  SelfCareItemScheduleInput,
  SelfCareItemType,
  SelfCareItemUpdateInput,
  SelfCareListResponse,
  SelfCareReminderTone,
  SelfCareRepeatKind,
  SelfCareScheduleRule,
  SelfCareSettingsUpdateInput,
  SelfCareTemplate,
  SelfCareTimeOfDay,
  SelfCareTodayItem,
} from '@planner/contracts'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'

import {
  getSelfCareErrorMessage,
  useArchiveSelfCareItem,
  useCancelSelfCareOccurrence,
  useCompleteSelfCareCourseSession,
  useCompleteSelfCareFlexibleGoal,
  useCompleteSelfCareItemNow,
  useCompleteSelfCareOccurrence,
  useCreateSelfCareItem,
  useCreateSelfCareItemFromTemplate,
  useMoveSelfCareOccurrence,
  useScheduleSelfCareItem,
  useSelfCareAnalytics,
  useSelfCareDashboard,
  useSelfCareHistory,
  useSelfCareItems,
  useSelfCarePlan,
  useSelfCareSettings,
  useSelfCareTemplates,
  useSkipSelfCareOccurrence,
  useUpdateSelfCareItem,
  useUpdateSelfCareSettings,
} from '@/features/self-care'
import { cx } from '@/shared/lib/classnames'
import { addDays, getDateKey } from '@/shared/lib/date'
import {
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import styles from './SelfCarePage.module.css'

type SelfCareTab =
  | 'today'
  | 'plan'
  | 'rituals'
  | 'history'
  | 'analytics'
  | 'settings'

type CardAction = 'full' | 'minimum' | 'skip'
type SelfCareCreateDialogMode = 'choice' | 'custom' | 'template'
type SelfCareCreateRepeatKind = SelfCareRepeatKind
type SelfCareEditRepeatMode = SelfCareCreateRepeatKind | 'keep'
type SelfCareCreateScheduleRuleInput = NonNullable<
  SelfCareItemInput['scheduleRule']
>
type SelfCareCourseType = 'days' | 'sessions'
type SelfCareCustomCreatePayload = {
  input: SelfCareItemInput
  scheduleInput?: SelfCareItemScheduleInput | undefined
}
type SelfCareSettingsPatch = Partial<SelfCareSettingsUpdateInput>
type AddCareTemplateFilter = 'beauty' | 'health' | 'movement' | 'rest'
type RitualStepDrafts = Record<string, readonly string[]>

const HIDDEN_TODAY_OCCURRENCE_STATUSES: ReadonlySet<
  NonNullable<SelfCareTodayItem['occurrence']>['status']
> = new Set(['cancelled', 'done', 'missed', 'moved', 'partial', 'skipped'])
const DAY_MS = 86_400_000

const SELF_CARE_TABS: Array<{ id: SelfCareTab; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: 'plan', label: 'План' },
  { id: 'rituals', label: 'Ритуалы' },
  { id: 'history', label: 'История' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'settings', label: 'Настройки' },
]

const CATEGORY_LABELS: Record<SelfCareCategory, string> = {
  beauty: 'Красота',
  body: 'Тело',
  custom: 'Другое',
  daily_base: 'База',
  emotional: 'Эмоции',
  health: 'Здоровье',
  medical: 'Медицинское',
  movement: 'Движение',
  nutrition: 'Питание',
  relax: 'Восстановление',
  sleep: 'Сон',
}

const IMPORTANCE_LABELS: Record<SelfCareImportance, string> = {
  gentle: 'Бережное',
  recommended: 'Желательное',
  required: 'Обязательное',
}

const TIME_GROUP_LABELS: Record<SelfCareTimeOfDay, string> = {
  afternoon: 'День',
  anytime: 'В любое время',
  evening: 'Вечер',
  morning: 'Утро',
  night: 'Ночь',
}

const REPEAT_LABELS: Record<SelfCareRepeatKind, string> = {
  after_completion: 'после выполнения',
  course: 'курс',
  daily: 'каждый день',
  flexible_goal: 'цель на период',
  interval: 'по интервалу',
  monthly: 'ежемесячно',
  none: 'без повтора',
  weekly: 'еженедельно',
  yearly: 'ежегодно',
}

const STATUS_LABELS: Record<SelfCareCompletion['status'], string> = {
  alternative_done: 'минимальная версия',
  cancelled: 'отменено',
  done: 'выполнено',
  moved: 'перенесено',
  partial: 'частично',
  skipped: 'мягко пропущено',
}

const CREATE_TYPE_OPTIONS: ReadonlyArray<{
  description: string
  label: string
  value: SelfCareItemType
}> = [
  {
    description: 'Разовое действие: купить, выбрать, уточнить, записаться.',
    label: 'Задача',
    value: 'task',
  },
  {
    description: 'Повторяющееся действие: вода, зарядка, прогулка, сон.',
    label: 'Регулярная забота',
    value: 'habit',
  },
  {
    description: 'Уход или подготовка с несколькими шагами.',
    label: 'Ритуал',
    value: 'ritual',
  },
  {
    description: 'Маникюр, стрижка, массаж, косметолог и похожие записи.',
    label: 'Процедура',
    value: 'procedure',
  },
  {
    description: 'Конкретная запись с датой, временем, местом и специалистом.',
    label: 'Запись',
    value: 'appointment',
  },
  {
    description: 'Чекапы, стоматолог, анализы и личные напоминания.',
    label: 'Медицинское',
    value: 'medical',
  },
  {
    description: 'Набрать несколько выполнений за день, неделю или месяц.',
    label: 'Цель на период',
    value: 'flexible_goal',
  },
  {
    description: 'Курс по дням или сессиям: витамины, процедуры, упражнения.',
    label: 'Курс',
    value: 'course',
  },
  {
    description: 'Мягкая отметка настроения, энергии или общего состояния.',
    label: 'Дневник состояния',
    value: 'mood_check',
  },
  {
    description: 'Отдых, релакс, тишина, восстановление.',
    label: 'Восстановление',
    value: 'rest_action',
  },
  {
    description: 'Сон, энергия, давление или другое наблюдение.',
    label: 'Измерение',
    value: 'measurement',
  },
]

const CREATE_REPEAT_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareCreateRepeatKind
}> = [
  { label: 'Без повтора', value: 'none' },
  { label: 'Каждый день', value: 'daily' },
  { label: 'Еженедельно', value: 'weekly' },
  { label: 'Ежемесячно', value: 'monthly' },
  { label: 'Ежегодно', value: 'yearly' },
  { label: 'По интервалу', value: 'interval' },
  { label: 'После выполнения', value: 'after_completion' },
  { label: 'Цель на период', value: 'flexible_goal' },
  { label: 'Курс', value: 'course' },
]

const INTERVAL_UNIT_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareIntervalUnit
}> = [
  { label: 'дней', value: 'day' },
  { label: 'недель', value: 'week' },
  { label: 'месяцев', value: 'month' },
  { label: 'лет', value: 'year' },
]

const FLEXIBLE_PERIOD_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareFlexiblePeriod
}> = [
  { label: 'день', value: 'day' },
  { label: 'неделю', value: 'week' },
  { label: 'месяц', value: 'month' },
]

const COURSE_TYPE_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareCourseType
}> = [
  { label: 'дней', value: 'days' },
  { label: 'сессий', value: 'sessions' },
]

const WEEKDAY_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Пн', value: 1 },
  { label: 'Вт', value: 2 },
  { label: 'Ср', value: 3 },
  { label: 'Чт', value: 4 },
  { label: 'Пт', value: 5 },
  { label: 'Сб', value: 6 },
  { label: 'Вс', value: 7 },
]

const ADD_CARE_TEMPLATE_FILTERS: ReadonlyArray<{
  categories: SelfCareCategory[]
  label: string
  tileClassName: string | undefined
  value: AddCareTemplateFilter
}> = [
  {
    categories: ['beauty'],
    label: 'Красота',
    tileClassName: styles.addCareCategoryBeauty,
    value: 'beauty',
  },
  {
    categories: ['health', 'medical'],
    label: 'Здоровье',
    tileClassName: styles.addCareCategoryHealth,
    value: 'health',
  },
  {
    categories: ['movement', 'body'],
    label: 'Движение',
    tileClassName: styles.addCareCategoryMovement,
    value: 'movement',
  },
  {
    categories: ['relax', 'emotional', 'sleep'],
    label: 'Отдых',
    tileClassName: styles.addCareCategoryRest,
    value: 'rest',
  },
]

const SELF_CARE_ACTION_SEARCH_PARAM = 'selfCareAction'
const SELF_CARE_ACTION_REQUEST_SEARCH_PARAM = 'selfCareActionRequest'

export function SelfCarePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const todayKey = getDateKey(new Date())
  const rangeFrom = getDateKey(addDays(new Date(), -30))
  const planTo = getDateKey(addDays(new Date(), 180))
  const activeTab = getSelfCareTab(searchParams)
  const dashboardQuery = useSelfCareDashboard(todayKey)
  const itemsQuery = useSelfCareItems()
  const planQuery = useSelfCarePlan(todayKey, planTo)
  const historyQuery = useSelfCareHistory(rangeFrom, todayKey)
  const analyticsQuery = useSelfCareAnalytics(rangeFrom, todayKey)
  const settingsQuery = useSelfCareSettings()
  const templatesQuery = useSelfCareTemplates()
  const completeOccurrenceMutation = useCompleteSelfCareOccurrence()
  const completeItemNowMutation = useCompleteSelfCareItemNow()
  const completeFlexibleGoalMutation = useCompleteSelfCareFlexibleGoal()
  const completeCourseMutation = useCompleteSelfCareCourseSession()
  const skipOccurrenceMutation = useSkipSelfCareOccurrence()
  const cancelOccurrenceMutation = useCancelSelfCareOccurrence()
  const archiveItemMutation = useArchiveSelfCareItem()
  const scheduleItemMutation = useScheduleSelfCareItem()
  const moveOccurrenceMutation = useMoveSelfCareOccurrence()
  const createItemMutation = useCreateSelfCareItem()
  const createFromTemplateMutation = useCreateSelfCareItemFromTemplate()
  const updateItemMutation = useUpdateSelfCareItem()
  const updateSettingsMutation = useUpdateSelfCareSettings()
  const [formError, setFormError] = useState<string | null>(null)
  const [scheduleDialogEntry, setScheduleDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [editDialogEntry, setEditDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [scheduleDate, setScheduleDate] = useState(todayKey)
  const [hiddenScheduledItemIds, setHiddenScheduledItemIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [creatingTemplateIds, setCreatingTemplateIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [ritualStepDrafts, setRitualStepDrafts] = useState<RitualStepDrafts>({})
  const dashboard = dashboardQuery.data
  const list = itemsQuery.data
  const plan = planQuery.data
  const history = historyQuery.data
  const analytics = analyticsQuery.data
  const createDialogMode = getSelfCareCreateDialogMode(searchParams)
  const settingsResponse =
    settingsQuery.data ??
    (dashboard ? { minimumItems: [], settings: dashboard.settings } : undefined)
  const templates = templatesQuery.data ?? []
  const createdTemplateIds = useMemo(() => getCreatedTemplateIds(list), [list])
  const disabledTemplateIds = useMemo(
    () => new Set([...createdTemplateIds, ...creatingTemplateIds]),
    [createdTemplateIds, creatingTemplateIds],
  )
  const isActionBusy =
    completeOccurrenceMutation.isPending ||
    completeItemNowMutation.isPending ||
    completeFlexibleGoalMutation.isPending ||
    completeCourseMutation.isPending ||
    skipOccurrenceMutation.isPending ||
    cancelOccurrenceMutation.isPending ||
    archiveItemMutation.isPending ||
    scheduleItemMutation.isPending ||
    moveOccurrenceMutation.isPending ||
    createItemMutation.isPending ||
    createFromTemplateMutation.isPending ||
    updateItemMutation.isPending ||
    updateSettingsMutation.isPending
  const errorMessage =
    formError ||
    firstErrorMessage([
      dashboardQuery.error,
      itemsQuery.error,
      planQuery.error,
      historyQuery.error,
      analyticsQuery.error,
      settingsQuery.error,
      templatesQuery.error,
      completeOccurrenceMutation.error,
      completeItemNowMutation.error,
      completeFlexibleGoalMutation.error,
      completeCourseMutation.error,
      skipOccurrenceMutation.error,
      cancelOccurrenceMutation.error,
      archiveItemMutation.error,
      scheduleItemMutation.error,
      moveOccurrenceMutation.error,
      createItemMutation.error,
      createFromTemplateMutation.error,
      updateItemMutation.error,
      updateSettingsMutation.error,
    ])

  function setActiveTab(tab: SelfCareTab) {
    const next = new URLSearchParams(searchParams)
    if (tab === 'today') {
      next.delete('tab')
    } else {
      next.set('tab', tab)
    }
    setSearchParams(next, { replace: true })
  }

  function closeCreateDialog(): void {
    const next = new URLSearchParams(searchParams)
    next.delete(SELF_CARE_ACTION_SEARCH_PARAM)
    next.delete(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM)
    setSearchParams(next, { replace: true })
  }

  function closeCreateDialogAndShowTab(tab: SelfCareTab): void {
    const next = new URLSearchParams(searchParams)
    next.delete(SELF_CARE_ACTION_SEARCH_PARAM)
    next.delete(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM)

    if (tab === 'today') {
      next.delete('tab')
    } else {
      next.set('tab', tab)
    }

    setSearchParams(next, { replace: true })
  }

  function openCreateDialog(): void {
    const next = new URLSearchParams(searchParams)
    next.set(SELF_CARE_ACTION_SEARCH_PARAM, 'care')
    next.set(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM, 'choice')
    setSearchParams(next)
  }

  function setCreateDialogMode(mode: SelfCareCreateDialogMode): void {
    const next = new URLSearchParams(searchParams)
    next.set(SELF_CARE_ACTION_SEARCH_PARAM, 'care')
    next.set(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM, mode)
    setSearchParams(next)
  }

  function handleCreateCustomCare(payload: SelfCareCustomCreatePayload): void {
    setFormError(null)

    void createItemMutation
      .mutateAsync(payload.input)
      .then(async (item) => {
        if (payload.scheduleInput) {
          await scheduleItemMutation.mutateAsync({
            input: payload.scheduleInput,
            itemId: item.id,
          })
        }
      })
      .then(() => {
        closeCreateDialogAndShowTab(payload.scheduleInput ? 'plan' : 'rituals')
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleCreateFromTemplate(
    templateId: string,
    options: { closeAfterCreate?: boolean } = {},
  ): void {
    setFormError(null)

    if (!list) {
      setFormError(
        'Данные еще загружаются. Попробуй еще раз через пару секунд.',
      )
      return
    }

    if (
      createdTemplateIds.has(templateId) ||
      creatingTemplateIds.has(templateId)
    ) {
      setFormError('Такая забота уже добавлена.')
      return
    }

    setCreatingTemplateIds((current) => new Set(current).add(templateId))

    void createFromTemplateMutation
      .mutateAsync({ templateId })
      .then(() => {
        if (options.closeAfterCreate) {
          closeCreateDialog()
        }
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
      .finally(() => {
        setCreatingTemplateIds((current) => {
          const next = new Set(current)
          next.delete(templateId)
          return next
        })
      })
  }

  function handleUpdateSettings(input: SelfCareSettingsPatch): void {
    setFormError(null)

    const current = settingsResponse?.settings
    if (!current) {
      setFormError(
        'Настройки еще загружаются. Попробуй еще раз через пару секунд.',
      )
      return
    }

    const payload: SelfCareSettingsUpdateInput = {
      currency: current.currency,
      defaultReminderTone: current.defaultReminderTone,
      quietHoursEnd: current.quietHoursEnd,
      quietHoursStart: current.quietHoursStart,
      showAppointmentsInCalendar: current.showAppointmentsInCalendar,
      showDailyRitualsInCalendar: current.showDailyRitualsInCalendar,
      showSelfCareInMainTasks: current.showSelfCareInMainTasks,
      ...input,
    }

    void updateSettingsMutation.mutateAsync(payload).catch((error: unknown) => {
      setFormError(getSelfCareErrorMessage(error))
    })
  }

  function handleArchiveItem(entry: SelfCareTodayItem): void {
    setFormError(null)

    const shouldArchive = window.confirm(
      `Удалить «${entry.item.title}» из заботы о себе? История останется в разделе.`,
    )

    if (!shouldArchive) {
      return
    }

    void archiveItemMutation
      .mutateAsync(entry.item.id)
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleEditItem(entry: SelfCareTodayItem): void {
    setFormError(null)
    setEditDialogEntry(entry)
  }

  function closeEditDialog(): void {
    setFormError(null)
    setEditDialogEntry(null)
  }

  function handleUpdateItem(input: SelfCareItemUpdateInput): void {
    if (!editDialogEntry) {
      return
    }

    setFormError(null)
    void updateItemMutation
      .mutateAsync({
        input,
        itemId: editDialogEntry.item.id,
      })
      .then(() => {
        closeEditDialog()
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleScheduleItem(entry: SelfCareTodayItem): void {
    setFormError(null)
    setScheduleDate(getInitialScheduleDate(entry, todayKey))
    setScheduleDialogEntry(entry)
  }

  function closeScheduleDialog(): void {
    setFormError(null)
    setScheduleDialogEntry(null)
    setScheduleDate(todayKey)
  }

  function handleScheduleSubmit(input: SelfCareItemScheduleInput): void {
    if (!scheduleDialogEntry) {
      return
    }

    const entry = scheduleDialogEntry
    setFormError(null)
    void scheduleItemMutation
      .mutateAsync({
        input,
        itemId: entry.item.id,
      })
      .then(async () => {
        if (
          entry.occurrence &&
          entry.occurrence.scheduledFor < todayKey &&
          input.scheduledFor !== entry.occurrence.scheduledFor
        ) {
          await moveOccurrenceMutation.mutateAsync({
            input: {
              newDate: input.scheduledFor,
              note: 'Перенесено из просроченного плана.',
            },
            occurrenceId: entry.occurrence.id,
          })
        }
      })
      .then(() => {
        setHiddenScheduledItemIds((current) =>
          new Set(current).add(entry.item.id),
        )
        closeScheduleDialog()
        setActiveTab('plan')
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleCancelPlannedOccurrence(entry: SelfCareTodayItem): void {
    if (!entry.occurrence) {
      return
    }

    setFormError(null)
    const shouldCancel = window.confirm(
      `Убрать «${entry.item.title}» из плана на ${formatDate(entry.occurrence.scheduledFor)}? Сама забота останется.`,
    )

    if (!shouldCancel) {
      return
    }

    void cancelOccurrenceMutation
      .mutateAsync(entry.occurrence.id)
      .then(() => {
        setHiddenScheduledItemIds((current) => {
          const next = new Set(current)
          next.delete(entry.item.id)
          return next
        })
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleToggleRitualStep(
    entry: SelfCareTodayItem,
    stepId: string,
  ): void {
    if (!entry.steps.some((step) => step.id === stepId)) {
      return
    }

    if (isEntryDoneToday(entry, todayKey)) {
      return
    }

    const draftKey = getRitualStepDraftKey(entry, todayKey)

    setRitualStepDrafts((current) => {
      const selectedStepIds = new Set(
        current[draftKey] ?? getInitialRitualStepDraft(entry),
      )

      if (selectedStepIds.has(stepId)) {
        selectedStepIds.delete(stepId)
      } else {
        selectedStepIds.add(stepId)
      }

      return { ...current, [draftKey]: [...selectedStepIds] }
    })
  }

  function clearRitualStepDraft(entry: SelfCareTodayItem): void {
    const draftKey = getRitualStepDraftKey(entry, todayKey)

    setRitualStepDrafts((current) => {
      if (!current[draftKey]) {
        return current
      }

      const next = { ...current }
      delete next[draftKey]
      return next
    })
  }

  function handleCardAction(
    entry: SelfCareTodayItem,
    action: CardAction,
  ): void {
    setFormError(null)

    void (async () => {
      if (action === 'skip' && entry.occurrence) {
        await skipOccurrenceMutation.mutateAsync({
          input: { reason: 'Сегодня не получилось, можно вернуться позже.' },
          occurrenceId: entry.occurrence.id,
        })
        return
      }

      const input = buildCompletionInput(entry, action)
      const ritualSteps = buildRitualStepCompletionInput(
        entry,
        action,
        getRitualStepDraft(ritualStepDrafts, entry, todayKey),
      )

      if (entry.occurrence) {
        await completeOccurrenceMutation.mutateAsync({
          input: {
            ...input,
            steps: ritualSteps,
          },
          occurrenceId: entry.occurrence.id,
        })
        clearRitualStepDraft(entry)
        return
      }

      if (entry.item.type === 'flexible_goal') {
        await completeFlexibleGoalMutation.mutateAsync({
          input,
          itemId: entry.item.id,
        })
        return
      }

      if (entry.item.type === 'course') {
        await completeCourseMutation.mutateAsync({
          input,
          itemId: entry.item.id,
        })
        return
      }

      await completeItemNowMutation.mutateAsync({
        input: { ...input, steps: ritualSteps },
        itemId: entry.item.id,
      })
      clearRitualStepDraft(entry)
    })().catch((error: unknown) => {
      setFormError(getSelfCareErrorMessage(error))
    })
  }

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

      <nav className={styles.tabs} aria-label="Разделы заботы о себе">
        {SELF_CARE_TABS.map((tab) => (
          <button
            key={tab.id}
            className={cx(
              styles.tabButton,
              activeTab === tab.id && styles.tabButtonActive,
            )}
            type="button"
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {dashboardQuery.isLoading && !dashboard ? (
        <section className={styles.emptyPanel}>
          Загружаем заботу о себе.
        </section>
      ) : null}

      {activeTab === 'today' ? (
        <SelfCareTodayTab
          dashboard={dashboard}
          history={history}
          hiddenScheduledItemIds={hiddenScheduledItemIds}
          isBusy={isActionBusy}
          list={list}
          plan={plan}
          ritualStepDrafts={ritualStepDrafts}
          todayKey={todayKey}
          onAddCare={openCreateDialog}
          onCardAction={handleCardAction}
          onArchiveItem={handleArchiveItem}
          onEditItem={handleEditItem}
          onScheduleItem={handleScheduleItem}
          onShowHistory={() => setActiveTab('history')}
          onShowPlan={() => setActiveTab('plan')}
          onToggleRitualStep={handleToggleRitualStep}
        />
      ) : null}

      {activeTab === 'plan' ? (
        <SelfCarePlanTab
          hiddenScheduledItemIds={hiddenScheduledItemIds}
          history={history}
          isBusy={isActionBusy}
          plan={plan}
          todayKey={todayKey}
          onCardAction={handleCardAction}
          onArchiveItem={handleArchiveItem}
          onCancelOccurrence={handleCancelPlannedOccurrence}
          onEditItem={handleEditItem}
          onScheduleItem={handleScheduleItem}
        />
      ) : null}

      {activeTab === 'rituals' ? (
        <SelfCareRitualsTab
          list={list}
          history={history}
          plan={plan}
          dashboardItems={[
            ...(dashboard?.todayItems ?? []),
            ...(dashboard?.flexibleGoals ?? []),
          ]}
          isBusy={isActionBusy}
          ritualStepDrafts={ritualStepDrafts}
          todayKey={todayKey}
          onCardAction={handleCardAction}
          onArchiveItem={handleArchiveItem}
          onEditItem={handleEditItem}
          onToggleRitualStep={handleToggleRitualStep}
        />
      ) : null}

      {activeTab === 'history' ? (
        <SelfCareHistoryTab history={history} />
      ) : null}

      {activeTab === 'analytics' ? (
        <SelfCareAnalyticsTab analytics={analytics} />
      ) : null}

      {activeTab === 'settings' ? (
        <SelfCareSettingsTab
          isBusy={isActionBusy}
          disabledTemplateIds={disabledTemplateIds}
          settings={settingsResponse}
          templates={templates}
          onCreateFromTemplate={handleCreateFromTemplate}
          onUpdateSettings={handleUpdateSettings}
        />
      ) : null}

      {createDialogMode ? (
        <SelfCareCreateDialog
          mode={createDialogMode}
          errorMessage={errorMessage}
          disabledTemplateIds={disabledTemplateIds}
          isBusy={isActionBusy || !list}
          todayKey={todayKey}
          templates={templates}
          onBack={() => setCreateDialogMode('choice')}
          onClose={closeCreateDialog}
          onCreateCustom={handleCreateCustomCare}
          onCreateFromTemplate={(templateId) =>
            handleCreateFromTemplate(templateId, { closeAfterCreate: true })
          }
          onSelectCustom={() => setCreateDialogMode('custom')}
          onSelectTemplate={() => setCreateDialogMode('template')}
        />
      ) : null}

      {scheduleDialogEntry ? (
        <SelfCareScheduleDialog
          date={scheduleDate}
          entry={scheduleDialogEntry}
          errorMessage={formError}
          isBusy={
            scheduleItemMutation.isPending || moveOccurrenceMutation.isPending
          }
          todayKey={todayKey}
          onChangeDate={setScheduleDate}
          onClose={closeScheduleDialog}
          onSubmit={handleScheduleSubmit}
        />
      ) : null}

      {editDialogEntry ? (
        <SelfCareEditDialog
          entry={editDialogEntry}
          errorMessage={formError}
          isBusy={updateItemMutation.isPending}
          todayKey={todayKey}
          onClose={closeEditDialog}
          onSubmit={handleUpdateItem}
        />
      ) : null}
    </section>
  )
}

function SelfCareTodayTab({
  dashboard,
  history,
  hiddenScheduledItemIds,
  isBusy,
  list,
  onAddCare,
  onCardAction,
  onArchiveItem,
  onEditItem,
  onScheduleItem,
  onShowHistory,
  onShowPlan,
  plan,
  ritualStepDrafts,
  todayKey,
  onToggleRitualStep,
}: {
  dashboard: ReturnType<typeof useSelfCareDashboard>['data'] | undefined
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  hiddenScheduledItemIds: ReadonlySet<string>
  isBusy: boolean
  list: SelfCareListResponse | undefined
  onAddCare: () => void
  onCardAction: (entry: SelfCareTodayItem, action: CardAction) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
  onScheduleItem: (entry: SelfCareTodayItem) => void
  onShowHistory: () => void
  onShowPlan: () => void
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  ritualStepDrafts: RitualStepDrafts
  todayKey: string
  onToggleRitualStep: (entry: SelfCareTodayItem, stepId: string) => void
}) {
  if (!dashboard) {
    return <div className={styles.tabPanel} />
  }

  const dashboardTodayItems = dashboard.todayItems
  const dashboardFlexibleGoals = dashboard.flexibleGoals
  const overdueItems = dashboard.overdueItems.filter(shouldShowTodayEntry)
  const todayItems = dashboardTodayItems.filter(shouldShowTodayEntry)
  const flexibleGoals = dashboardFlexibleGoals.filter(shouldShowTodayEntry)
  const availableTodayEntries = buildAvailableTodayEntries({
    dashboard,
    history,
    list,
    plan,
    todayKey,
  })
  const planningHints = dashboard.planningHints.filter(
    (entry) => !hiddenScheduledItemIds.has(entry.item.id),
  )
  const groupedItems = groupTodayItems(todayItems)
  const hasVisibleTodayContent =
    overdueItems.length > 0 ||
    todayItems.length > 0 ||
    availableTodayEntries.length > 0 ||
    flexibleGoals.length > 0 ||
    planningHints.length > 0
  const hasClosedTodayWork = [
    ...dashboardTodayItems,
    ...dashboardFlexibleGoals,
  ].some(isClosedTodayEntry)
  const tomorrowCount = getPlannedEntriesCountForDate(
    plan,
    shiftDateKey(todayKey, 1),
  )
  const isAvailableTodayLoading = !list || !history

  if (!hasVisibleTodayContent && isAvailableTodayLoading) {
    return (
      <div className={styles.tabPanel}>
        <section className={styles.emptyPanel}>
          Загружаем доступные на сегодня действия.
        </section>
      </div>
    )
  }

  if (!hasVisibleTodayContent) {
    return (
      <SelfCareTodayClearState
        hasClosedTodayWork={hasClosedTodayWork}
        tomorrowCount={tomorrowCount}
        onAddCare={onAddCare}
        onShowHistory={onShowHistory}
        onShowPlan={onShowPlan}
      />
    )
  }

  return (
    <div className={styles.tabPanel}>
      {overdueItems.length ? (
        <SelfCareSection title="Не закрыто за прошлые дни">
          {overdueItems.map((entry) => (
            <SelfCareItemCard
              key={`overdue-${entry.occurrence?.id ?? entry.item.id}`}
              entry={entry}
              isBusy={isBusy}
              scheduleActionLabel="Перенести"
              stepDraft={getRitualStepDraft(ritualStepDrafts, entry, todayKey)}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onSchedule={onScheduleItem}
              onToggleStep={onToggleRitualStep}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {(['morning', 'afternoon', 'evening', 'night', 'anytime'] as const).map(
        (group) =>
          groupedItems[group].length ? (
            <SelfCareSection key={group} title={TIME_GROUP_LABELS[group]}>
              {groupedItems[group].map((entry) => (
                <SelfCareItemCard
                  key={entry.occurrence?.id ?? entry.item.id}
                  entry={entry}
                  isBusy={isBusy}
                  stepDraft={getRitualStepDraft(
                    ritualStepDrafts,
                    entry,
                    todayKey,
                  )}
                  onAction={onCardAction}
                  onArchive={onArchiveItem}
                  onEdit={onEditItem}
                  onToggleStep={onToggleRitualStep}
                />
              ))}
            </SelfCareSection>
          ) : null,
      )}

      {availableTodayEntries.length ? (
        <SelfCareSection title="Доступно сегодня">
          {availableTodayEntries.map((entry) => (
            <SelfCareItemCard
              key={`available-${entry.item.id}`}
              entry={entry}
              isBusy={isBusy}
              stepDraft={getRitualStepDraft(ritualStepDrafts, entry, todayKey)}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onToggleStep={onToggleRitualStep}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {flexibleGoals.length ? (
        <SelfCareSection title="Гибкие цели недели">
          {flexibleGoals.map((entry) => (
            <SelfCareItemCard
              key={`goal-${entry.item.id}`}
              entry={entry}
              isBusy={isBusy}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {planningHints.length ? (
        <SelfCareSection title="Ближайшее важное">
          {planningHints.map((entry) => (
            <PlanningHintCard
              key={`hint-${entry.item.id}-${entry.occurrence?.id ?? 'item'}`}
              entry={entry}
              isBusy={isBusy}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onSchedule={onScheduleItem}
            />
          ))}
        </SelfCareSection>
      ) : null}
    </div>
  )
}

function SelfCareTodayClearState({
  hasClosedTodayWork,
  onAddCare,
  onShowHistory,
  onShowPlan,
  tomorrowCount,
}: {
  hasClosedTodayWork: boolean
  onAddCare: () => void
  onShowHistory: () => void
  onShowPlan: () => void
  tomorrowCount: number | null
}) {
  return (
    <div className={styles.tabPanel}>
      <section className={styles.clearStatePanel}>
        <div className={styles.clearStateContent}>
          <div className={styles.clearStateHero}>
            <div>
              <h2>
                {hasClosedTodayWork
                  ? 'Сегодня можно выдохнуть'
                  : 'Сегодня спокойно'}
              </h2>
              <p>
                {hasClosedTodayWork
                  ? 'Ты уже сделала всё, что было запланировано. Можно ничего не добавлять — отдых тоже часть заботы.'
                  : 'На сегодня ничего не запланировано. Можно оставить день свободным или добавить что-то маленькое для себя.'}
              </p>
            </div>
          </div>

          <div className={styles.clearStateActions}>
            <button
              className={styles.softButton}
              type="button"
              onClick={onShowHistory}
            >
              Посмотреть выполненное
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={onAddCare}
            >
              Добавить заботу
            </button>
          </div>

          <div className={styles.tomorrowPreview}>
            <div>
              <span>Завтра</span>
              <strong>{formatTomorrowPlanSummary(tomorrowCount)}</strong>
            </div>
            {tomorrowCount && tomorrowCount > 0 ? (
              <button
                className={styles.softButton}
                type="button"
                onClick={onShowPlan}
              >
                Посмотреть
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.clearStateArtwork} aria-hidden="true">
          <img
            className={cx(styles.clearStateImage, styles.clearStateImageLight)}
            src="/self-care/today-clear-light.png"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <img
            className={cx(styles.clearStateImage, styles.clearStateImageDark)}
            src="/self-care/today-clear-dark.png"
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>
      </section>
    </div>
  )
}

function SelfCarePlanTab({
  hiddenScheduledItemIds,
  history,
  isBusy,
  onCardAction,
  onArchiveItem,
  onCancelOccurrence,
  onEditItem,
  onScheduleItem,
  plan,
  todayKey,
}: {
  hiddenScheduledItemIds: ReadonlySet<string>
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  isBusy: boolean
  onCardAction: (entry: SelfCareTodayItem, action: CardAction) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onCancelOccurrence: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
  onScheduleItem: (entry: SelfCareTodayItem) => void
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  todayKey: string
}) {
  const latestCompletionByItemId = useMemo(
    () => getLatestProgressCompletionByItemId(history),
    [history],
  )
  const nextPlannedDateByItemId = useMemo(
    () => getNextPlannedDateByItemId(plan, todayKey),
    [plan, todayKey],
  )
  const occurrences = (plan?.occurrences ?? []).filter(shouldShowPlannedEntry)
  const courseEntries = (plan?.courses ?? []).map((entry) =>
    mergeLatestProgressCompletion(
      entry,
      latestCompletionByItemId.get(entry.item.id) ?? null,
    ),
  )
  const planningHints = (plan?.planningHints ?? []).filter(
    (entry) => !hiddenScheduledItemIds.has(entry.item.id),
  )

  return (
    <div className={styles.tabPanel}>
      <section className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>План заботы</p>
          <h3>Ближайшие записи, процедуры и напоминания</h3>
        </div>
        <CalendarIcon size={26} />
      </section>

      {occurrences.length ? (
        <SelfCareSection title="Записи и задачи">
          {occurrences.slice(0, 18).map((entry) => (
            <SelfCareItemCard
              actions="plan"
              key={entry.occurrence?.id ?? entry.item.id}
              entry={entry}
              isBusy={isBusy}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onCancelOccurrence={onCancelOccurrence}
              onEdit={onEditItem}
            />
          ))}
        </SelfCareSection>
      ) : (
        <section className={styles.emptyPanel}>
          На ближайшие даты пока ничего не запланировано.
        </section>
      )}

      {planningHints.length ? (
        <SelfCareSection title="Пора запланировать">
          {planningHints.map((entry) => (
            <PlanningHintCard
              key={`plan-hint-${entry.item.id}`}
              entry={entry}
              isBusy={isBusy}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onSchedule={onScheduleItem}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {plan?.medical.length ? (
        <SelfCareSection title="Медицинское">
          {plan.medical.map((entry) => (
            <PlanningHintCard
              key={`medical-${entry.item.id}-${entry.occurrence?.id ?? 'item'}`}
              entry={entry}
              isBusy={isBusy}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {courseEntries.length ? (
        <SelfCareSection title="Курсы">
          {courseEntries.map((entry) => (
            <SelfCareItemCard
              key={`course-${entry.item.id}`}
              entry={entry}
              isBusy={isBusy}
              nextOccurrenceDate={nextPlannedDateByItemId.get(entry.item.id)}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
            />
          ))}
        </SelfCareSection>
      ) : null}
    </div>
  )
}

function SelfCareRitualsTab({
  dashboardItems,
  history,
  isBusy,
  list,
  plan,
  ritualStepDrafts,
  todayKey,
  onCardAction,
  onArchiveItem,
  onEditItem,
  onToggleRitualStep,
}: {
  dashboardItems: SelfCareTodayItem[]
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  isBusy: boolean
  list: SelfCareListResponse | undefined
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  ritualStepDrafts: RitualStepDrafts
  todayKey: string
  onCardAction: (entry: SelfCareTodayItem, action: CardAction) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
  onToggleRitualStep: (entry: SelfCareTodayItem, stepId: string) => void
}) {
  const grouped = useMemo(() => groupItemsByCategory(list), [list])
  const latestCompletionByItemId = useMemo(
    () => getLatestProgressCompletionByItemId(history),
    [history],
  )
  const nextPlannedDateByItemId = useMemo(
    () => getNextPlannedDateByItemId(plan, todayKey),
    [plan, todayKey],
  )
  const todayByItemId = new Map(
    dashboardItems.map((entry) => [entry.item.id, entry]),
  )

  if (!list) {
    return <div className={styles.tabPanel} />
  }

  return (
    <div className={styles.tabPanel}>
      {Object.entries(grouped).map(([category, items]) =>
        items.length ? (
          <SelfCareSection
            key={category}
            title={CATEGORY_LABELS[category as SelfCareCategory]}
          >
            {items.map((item) => {
              const baseEntry =
                todayByItemId.get(item.id) ?? buildItemEntry(item, list)
              const latestCompletion =
                latestCompletionByItemId.get(item.id) ?? null
              const entry = mergeLatestProgressCompletion(
                baseEntry,
                latestCompletion,
              )
              const nextOccurrenceDate =
                nextPlannedDateByItemId.get(item.id) ??
                inferNextCompletionDate({
                  completion: entry.completion,
                  scheduleRule: entry.scheduleRule,
                  todayKey,
                })

              return (
                <SelfCareItemCard
                  key={item.id}
                  entry={entry}
                  isBusy={isBusy}
                  nextOccurrenceDate={nextOccurrenceDate}
                  stepDraft={getRitualStepDraft(
                    ritualStepDrafts,
                    entry,
                    todayKey,
                  )}
                  onAction={onCardAction}
                  onArchive={onArchiveItem}
                  onEdit={onEditItem}
                  onToggleStep={onToggleRitualStep}
                  compact
                />
              )
            })}
          </SelfCareSection>
        ) : null,
      )}
    </div>
  )
}

function SelfCareHistoryTab({
  history,
}: {
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
}) {
  const itemById = new Map(
    (history?.items ?? []).map((item) => [item.id, item]),
  )

  if (!history?.completions.length) {
    return (
      <section className={styles.emptyPanel}>
        История появится после первых выполнений.
      </section>
    )
  }

  return (
    <div className={styles.timeline}>
      {history.completions.map((completion) => {
        const item = itemById.get(completion.itemId)
        return (
          <article key={completion.id} className={styles.historyCard}>
            <time>{formatDate(completion.completedAt.slice(0, 10))}</time>
            <div>
              <h3>{item?.title ?? 'Забота о себе'}</h3>
              <p>{STATUS_LABELS[completion.status]}</p>
              {completion.note ? (
                <p className={styles.noteText}>{completion.note}</p>
              ) : null}
              {completion.energyAfter ? (
                <p>Энергия после: {completion.energyAfter}/5</p>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function SelfCareAnalyticsTab({
  analytics,
}: {
  analytics: ReturnType<typeof useSelfCareAnalytics>['data'] | undefined
}) {
  const topCategories = Object.entries(analytics?.balanceByCategory ?? {})
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)

  return (
    <div className={styles.tabPanel}>
      <section className={styles.analyticsHero}>
        <p>
          На этом отрезке ты {analytics?.selectedSelfCareCount ?? 0} раз выбрала
          заботу о себе.
        </p>
        <strong>{analytics?.selectedSelfCareCount ?? 0}</strong>
        <span>действий заботы отмечено за период</span>
      </section>

      <div className={styles.gridTwo}>
        <section className={styles.panel}>
          <h3>Баланс категорий</h3>
          {topCategories.length ? (
            <div className={styles.metricList}>
              {topCategories.map(([category, count]) => (
                <MetricRow
                  key={category}
                  label={CATEGORY_LABELS[category as SelfCareCategory]}
                  value={`${count} раз`}
                />
              ))}
            </div>
          ) : (
            <p className={styles.mutedText}>
              Данные появятся после выполнений.
            </p>
          )}
        </section>

        <section className={styles.panel}>
          <h3>Процедуры и здоровье</h3>
          <div className={styles.metricList}>
            <MetricRow
              label="Расходы на процедуры"
              value={formatMoney(analytics?.procedureCosts ?? 0)}
            />
            <MetricRow
              label="Медицинское скоро"
              value={String(analytics?.medicalUpcoming.length ?? 0)}
            />
          </div>
        </section>
      </div>

      {analytics?.flexibleGoals.length ? (
        <SelfCareSection title="Гибкие цели">
          {analytics.flexibleGoals.map((entry) => (
            <PlanningHintCard
              key={`analytics-goal-${entry.item.id}`}
              entry={entry}
            />
          ))}
        </SelfCareSection>
      ) : null}
    </div>
  )
}

function SelfCareSettingsTab({
  disabledTemplateIds,
  isBusy,
  onCreateFromTemplate,
  onUpdateSettings,
  settings,
  templates,
}: {
  disabledTemplateIds: ReadonlySet<string>
  isBusy: boolean
  onCreateFromTemplate: (templateId: string) => void
  onUpdateSettings: (input: SelfCareSettingsPatch) => void
  settings: ReturnType<typeof useSelfCareSettings>['data'] | undefined
  templates: SelfCareTemplate[]
}) {
  const currentSettings = settings?.settings

  return (
    <div className={styles.tabPanel}>
      <section className={styles.panel}>
        <h3>Настройки раздела</h3>
        {currentSettings ? (
          <SelfCareSettingsForm
            key={currentSettings.updatedAt}
            isBusy={isBusy}
            settings={currentSettings}
            onUpdateSettings={onUpdateSettings}
          />
        ) : (
          <p className={styles.mutedText}>
            Настройки загружаются. Форма станет доступна после ответа API.
          </p>
        )}
      </section>

      <TemplatesPicker
        templates={templates}
        isBusy={isBusy}
        disabledTemplateIds={disabledTemplateIds}
        onCreateFromTemplate={onCreateFromTemplate}
      />
    </div>
  )
}

function SelfCareSettingsForm({
  isBusy,
  onUpdateSettings,
  settings,
}: {
  isBusy: boolean
  onUpdateSettings: (input: SelfCareSettingsPatch) => void
  settings: NonNullable<
    ReturnType<typeof useSelfCareSettings>['data']
  >['settings']
}) {
  const [showSelfCareInMainTasks, setShowSelfCareInMainTasks] = useState(
    settings.showSelfCareInMainTasks,
  )
  const [showAppointmentsInCalendar, setShowAppointmentsInCalendar] = useState(
    settings.showAppointmentsInCalendar,
  )
  const [showDailyRitualsInCalendar, setShowDailyRitualsInCalendar] = useState(
    settings.showDailyRitualsInCalendar,
  )
  const [quietHoursStart, setQuietHoursStart] = useState(
    settings.quietHoursStart ?? '',
  )
  const [quietHoursEnd, setQuietHoursEnd] = useState(
    settings.quietHoursEnd ?? '',
  )
  const [defaultReminderTone, setDefaultReminderTone] =
    useState<SelfCareReminderTone>(settings.defaultReminderTone)
  const [currency, setCurrency] = useState(settings.currency ?? '')

  return (
    <form
      className={styles.settingsForm}
      onSubmit={(event) => {
        event.preventDefault()
        onUpdateSettings({
          currency: normalizeOptionalText(currency),
          defaultReminderTone,
          quietHoursEnd: normalizeOptionalText(quietHoursEnd),
          quietHoursStart: normalizeOptionalText(quietHoursStart),
          showAppointmentsInCalendar,
          showDailyRitualsInCalendar,
          showSelfCareInMainTasks,
        })
      }}
    >
      <div className={styles.settingsToggleList}>
        <label className={styles.toggleField}>
          <input
            type="checkbox"
            checked={showSelfCareInMainTasks}
            disabled={isBusy}
            onChange={(event) =>
              setShowSelfCareInMainTasks(event.target.checked)
            }
          />
          <span>Показывать заботу в общем списке задач</span>
        </label>

        <label className={styles.toggleField}>
          <input
            type="checkbox"
            checked={showAppointmentsInCalendar}
            disabled={isBusy}
            onChange={(event) =>
              setShowAppointmentsInCalendar(event.target.checked)
            }
          />
          <span>Показывать записи в календаре</span>
        </label>

        <label className={styles.toggleField}>
          <input
            type="checkbox"
            checked={showDailyRitualsInCalendar}
            disabled={isBusy}
            onChange={(event) =>
              setShowDailyRitualsInCalendar(event.target.checked)
            }
          />
          <span>Показывать ежедневные ритуалы в календаре</span>
        </label>
      </div>

      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Тихие часы с</span>
          <input
            type="time"
            value={quietHoursStart}
            disabled={isBusy}
            onChange={(event) => setQuietHoursStart(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>Тихие часы до</span>
          <input
            type="time"
            value={quietHoursEnd}
            disabled={isBusy}
            onChange={(event) => setQuietHoursEnd(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>Тон уведомлений</span>
          <select
            value={defaultReminderTone}
            disabled={isBusy}
            onChange={(event) =>
              setDefaultReminderTone(event.target.value as SelfCareReminderTone)
            }
          >
            <option value="soft">Мягкий</option>
            <option value="normal">Обычный</option>
          </select>
        </label>

        <label className={styles.dateField}>
          <span>Валюта процедур</span>
          <input
            type="text"
            autoComplete="off"
            maxLength={8}
            placeholder="RUB"
            value={currency}
            disabled={isBusy}
            onChange={(event) => setCurrency(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.modalActions}>
        <button className={styles.doneButton} type="submit" disabled={isBusy}>
          Сохранить настройки
        </button>
      </div>
    </form>
  )
}

function SelfCareItemCard({
  actions = 'today',
  compact = false,
  entry,
  isBusy,
  nextOccurrenceDate,
  onAction,
  onArchive,
  onCancelOccurrence,
  onEdit,
  onSchedule,
  onToggleStep,
  scheduleActionLabel = 'Перенести',
  stepDraft,
}: {
  actions?: 'plan' | 'today'
  compact?: boolean
  entry: SelfCareTodayItem
  isBusy: boolean
  nextOccurrenceDate?: string | null | undefined
  onAction: (entry: SelfCareTodayItem, action: CardAction) => void
  onArchive: (entry: SelfCareTodayItem) => void
  onCancelOccurrence?: (entry: SelfCareTodayItem) => void
  onEdit: (entry: SelfCareTodayItem) => void
  onSchedule?: (entry: SelfCareTodayItem) => void
  onToggleStep?: (entry: SelfCareTodayItem, stepId: string) => void
  scheduleActionLabel?: string
  stepDraft?: readonly string[] | undefined
}) {
  const todayKey = getDateKey(new Date())
  const isDone = isEntryDoneToday(entry, todayKey)
  const primaryActionLabel = getPrimaryActionLabel(entry, isDone)
  const flexibleProgressLabel = entry.flexibleProgress
    ? `${entry.flexibleProgress.completedCount} из ${entry.flexibleProgress.targetCount}`
    : null
  const courseProgress = getCourseProgress(entry.courseDetails)
  const scheduleLabel = formatSchedule(entry.scheduleRule)
  const detailsLabel = formatEntryDetails(entry)
  const completionLabel =
    entry.item.type === 'course'
      ? formatCourseCompletionState(entry, todayKey)
      : formatCompletionState(entry.completion, todayKey)
  const nextLabel = nextOccurrenceDate
    ? `Следующее выполнение: ${formatDate(nextOccurrenceDate)}`
    : null
  const hasMinimum = Boolean(entry.item.minimumVersionTitle)

  return (
    <article
      className={cx(
        styles.card,
        compact && styles.cardCompact,
        isDone && styles.cardDone,
      )}
    >
      <div className={styles.cardMain}>
        <div className={styles.cardIcon} aria-hidden="true">
          {entry.item.icon ?? '♡'}
        </div>
        <div>
          <div className={styles.cardTitleRow}>
            <h3>{entry.item.title}</h3>
            <span className={styles.badge}>
              {IMPORTANCE_LABELS[entry.item.importance]}
            </span>
          </div>
          <p className={styles.cardMeta}>
            {CATEGORY_LABELS[entry.item.category]} · {getTypeLabel(entry.item)}{' '}
            · {scheduleLabel}
          </p>
          {entry.occurrence ? (
            <p className={styles.cardMeta}>
              {formatDate(entry.occurrence.scheduledFor)}
              {entry.occurrence.dueAt
                ? ` · ${formatTime(entry.occurrence.dueAt)}`
                : ''}
            </p>
          ) : null}
          {detailsLabel ? (
            <p className={styles.cardMeta}>{detailsLabel}</p>
          ) : null}
          {completionLabel ? (
            <p className={styles.progressText}>{completionLabel}</p>
          ) : null}
          {nextLabel ? <p className={styles.cardMeta}>{nextLabel}</p> : null}
          {courseProgress ? (
            <div
              className={styles.courseProgress}
              aria-label={courseProgress.ariaLabel}
            >
              <p className={styles.progressText}>{courseProgress.label}</p>
              <div className={styles.courseProgressTrack} aria-hidden="true">
                <span style={{ inlineSize: `${courseProgress.percent}%` }} />
              </div>
              <p className={styles.cardMeta}>{courseProgress.meta}</p>
            </div>
          ) : null}
          {flexibleProgressLabel ? (
            <p className={styles.progressText}>
              Прогресс: {flexibleProgressLabel}
            </p>
          ) : null}
          {entry.steps.length ? (
            <ChecklistPreview
              entry={entry}
              isBusy={isBusy}
              isDone={isDone}
              selectedStepIds={getEffectiveRitualStepIds(entry, stepDraft)}
              onToggleStep={onToggleStep}
            />
          ) : null}
          {hasMinimum ? (
            <p className={styles.minimumText}>
              Минимальная версия: {entry.item.minimumVersionTitle}
            </p>
          ) : null}
        </div>
      </div>
      <div className={styles.cardActions}>
        {actions === 'plan' ? (
          <>
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={() => onEdit(entry)}
            >
              Настроить
            </button>
            <button
              className={styles.dangerButton}
              type="button"
              disabled={isBusy || !entry.occurrence}
              onClick={() => onCancelOccurrence?.(entry)}
            >
              Убрать из плана
            </button>
          </>
        ) : (
          <>
            <button
              className={styles.doneButton}
              type="button"
              disabled={isBusy || isDone}
              aria-label={`Отметить заботу «${entry.item.title}»`}
              onClick={() => onAction(entry, 'full')}
            >
              <CheckIcon size={16} />
              <span>{primaryActionLabel}</span>
            </button>
            {hasMinimum ? (
              <button
                className={styles.softButton}
                type="button"
                disabled={isBusy || isDone}
                onClick={() => onAction(entry, 'minimum')}
              >
                Минимум
              </button>
            ) : null}
            {onSchedule && entry.occurrence ? (
              <button
                className={styles.softButton}
                type="button"
                disabled={isBusy || isDone}
                onClick={() => onSchedule(entry)}
              >
                {scheduleActionLabel}
              </button>
            ) : null}
            {entry.occurrence ? (
              <button
                className={styles.softButton}
                type="button"
                disabled={isBusy || isDone}
                aria-label={`Убрать заботу «${entry.item.title}» из сегодняшнего списка`}
                onClick={() => onAction(entry, 'skip')}
              >
                Не сегодня
              </button>
            ) : null}
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={() => onEdit(entry)}
            >
              Настроить
            </button>
          </>
        )}
        {actions === 'today' ? (
          <button
            className={styles.dangerButton}
            type="button"
            disabled={isBusy}
            aria-label={`Удалить заботу «${entry.item.title}»`}
            onClick={() => onArchive(entry)}
          >
            Удалить
          </button>
        ) : null}
      </div>
    </article>
  )
}

function PlanningHintCard({
  entry,
  isBusy,
  onArchive,
  onEdit,
  onSchedule,
}: {
  entry: SelfCareTodayItem
  isBusy?: boolean
  onArchive?: (entry: SelfCareTodayItem) => void
  onEdit?: (entry: SelfCareTodayItem) => void
  onSchedule?: (entry: SelfCareTodayItem) => void
}) {
  return (
    <article className={styles.hintCard}>
      <strong>{entry.item.title}</strong>
      <span>
        {CATEGORY_LABELS[entry.item.category]} · {getTypeLabel(entry.item)}
      </span>
      <p>{formatPlanningText(entry)}</p>
      <div className={styles.hintActions}>
        {onSchedule && !entry.occurrence ? (
          <button
            className={styles.softButton}
            type="button"
            disabled={isBusy}
            onClick={() => onSchedule(entry)}
          >
            Запланировать
          </button>
        ) : null}
        {onEdit ? (
          <button
            className={styles.softButton}
            type="button"
            disabled={isBusy}
            onClick={() => onEdit(entry)}
          >
            Настроить
          </button>
        ) : null}
        {onArchive ? (
          <button
            className={styles.dangerLinkButton}
            type="button"
            disabled={isBusy}
            onClick={() => onArchive(entry)}
          >
            Удалить
          </button>
        ) : null}
      </div>
    </article>
  )
}

function TemplatesPicker({
  disabledTemplateIds,
  isBusy,
  onCreateFromTemplate,
  templates,
}: {
  disabledTemplateIds: ReadonlySet<string>
  isBusy: boolean
  onCreateFromTemplate: (templateId: string) => void
  templates: SelfCareTemplate[]
}) {
  if (!templates.length) {
    return null
  }

  return (
    <SelfCareSection title="Шаблоны">
      <div className={styles.templateGrid}>
        {templates.slice(0, 12).map((template) => {
          const isTemplateDisabled = disabledTemplateIds.has(template.id)

          return (
            <button
              key={template.id}
              className={styles.templateCard}
              type="button"
              disabled={isBusy || isTemplateDisabled}
              onClick={() => onCreateFromTemplate(template.id)}
            >
              <strong>{template.title}</strong>
              <span>
                {CATEGORY_LABELS[template.category]} ·{' '}
                {getTemplateTypeLabel(template)}
                {isTemplateDisabled ? ' · уже добавлено' : ''}
              </span>
              <p>
                {template.description || 'Можно добавить и настроить под себя.'}
              </p>
            </button>
          )
        })}
      </div>
    </SelfCareSection>
  )
}

function SelfCareCreateDialog({
  disabledTemplateIds,
  errorMessage,
  isBusy,
  mode,
  onBack,
  onClose,
  onCreateCustom,
  onCreateFromTemplate,
  onSelectCustom,
  onSelectTemplate,
  templates,
  todayKey,
}: {
  disabledTemplateIds: ReadonlySet<string>
  errorMessage: string | null
  isBusy: boolean
  mode: SelfCareCreateDialogMode
  onBack: () => void
  onClose: () => void
  onCreateCustom: (payload: SelfCareCustomCreatePayload) => void
  onCreateFromTemplate: (templateId: string) => void
  onSelectCustom: () => void
  onSelectTemplate: () => void
  templates: SelfCareTemplate[]
  todayKey: string
}) {
  const [templateFilter, setTemplateFilter] =
    useState<AddCareTemplateFilter | null>(null)

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

  const heading =
    mode === 'template'
      ? templateFilter
        ? `Шаблоны: ${getAddCareFilterLabel(templateFilter)}`
        : 'Выбрать из шаблона'
      : mode === 'custom'
        ? 'Создать свою заботу'
        : 'Добавить заботу'
  const description =
    mode === 'template'
      ? 'Выбери готовую идею. После добавления ее можно настроить во вкладке «Ритуалы».'
      : mode === 'custom'
        ? 'Добавь понятную основу. Детали, историю и планирование можно дополнять дальше.'
        : 'Можно создать заботу с нуля или начать с готового шаблона.'
  const filteredTemplates = templateFilter
    ? templates.filter((template) =>
        getAddCareFilterCategories(templateFilter).includes(template.category),
      )
    : templates

  function openTemplatePicker(filter: AddCareTemplateFilter | null): void {
    setTemplateFilter(filter)
    onSelectTemplate()
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-describedby="add-care-description"
      aria-labelledby="add-care-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть добавление заботы"
        onClick={onClose}
      />

      <section
        className={cx(
          styles.modalPanel,
          mode === 'choice' && styles.addCareChoicePanel,
        )}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="add-care-title">{heading}</h2>
            <p id="add-care-description">{description}</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть добавление заботы"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        {mode !== 'choice' ? (
          <button
            className={styles.backLinkButton}
            type="button"
            disabled={isBusy}
            onClick={onBack}
          >
            Назад к выбору
          </button>
        ) : null}

        {errorMessage ? (
          <p className={styles.errorText}>{errorMessage}</p>
        ) : null}

        {mode === 'choice' ? (
          <div className={styles.addCareChoiceContent}>
            <div className={styles.createChoiceGrid}>
              <button
                className={cx(
                  styles.createChoiceCard,
                  styles.addCareCreateCard,
                )}
                type="button"
                disabled={isBusy}
                onClick={onSelectCustom}
              >
                <strong>Создать свою</strong>
                <span className={styles.addCareChoiceText}>
                  Для ухода, процедуры, медицинского напоминания или регулярной
                  заботы.
                </span>
              </button>
              <section
                className={cx(
                  styles.createChoiceCard,
                  styles.addCareTemplateCard,
                )}
                aria-labelledby="add-care-template-title"
              >
                <strong id="add-care-template-title">Выбрать из шаблона</strong>
                <span className={styles.addCareChoiceText}>
                  Готовые идеи для красоты, здоровья отдыха.
                </span>
                <button
                  className={styles.addCareArrowButton}
                  type="button"
                  disabled={isBusy}
                  aria-label="Открыть все шаблоны заботы"
                  onClick={() => openTemplatePicker(null)}
                >
                  <ChevronRightIcon size={18} strokeWidth={2.15} />
                </button>
                <div
                  className={styles.addCareCategoryGrid}
                  aria-label="Категории шаблонов"
                >
                  {ADD_CARE_TEMPLATE_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      className={cx(
                        styles.addCareCategoryButton,
                        filter.tileClassName,
                      )}
                      type="button"
                      disabled={isBusy}
                      onClick={() => openTemplatePicker(filter.value)}
                    >
                      <span>{filter.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {mode === 'custom' ? (
          <SelfCareCustomCreateForm
            isBusy={isBusy}
            todayKey={todayKey}
            onCreate={onCreateCustom}
          />
        ) : null}

        {mode === 'template' ? (
          filteredTemplates.length ? (
            <div className={styles.templateGrid}>
              {filteredTemplates.slice(0, 12).map((template) => {
                const isTemplateDisabled = disabledTemplateIds.has(template.id)

                return (
                  <button
                    key={template.id}
                    className={styles.templateCard}
                    type="button"
                    disabled={isBusy || isTemplateDisabled}
                    onClick={() => onCreateFromTemplate(template.id)}
                  >
                    <strong>{template.title}</strong>
                    <span>
                      {CATEGORY_LABELS[template.category]} ·{' '}
                      {getTemplateTypeLabel(template)}
                      {isTemplateDisabled ? ' · уже добавлено' : ''}
                    </span>
                    <p>
                      {template.description ||
                        'Можно добавить и настроить под себя.'}
                    </p>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className={styles.mutedText}>Шаблоны загружаются.</p>
          )
        ) : null}
      </section>
    </div>,
    document.body,
  )
}

function SelfCareCustomCreateForm({
  isBusy,
  onCreate,
  todayKey,
}: {
  isBusy: boolean
  onCreate: (payload: SelfCareCustomCreatePayload) => void
  todayKey: string
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<SelfCareItemType>('task')
  const [category, setCategory] = useState<SelfCareCategory>('daily_base')
  const [importance, setImportance] =
    useState<SelfCareImportance>('recommended')
  const [preferredTimeOfDay, setPreferredTimeOfDay] =
    useState<SelfCareTimeOfDay>('anytime')
  const [repeatKind, setRepeatKind] = useState<SelfCareCreateRepeatKind>('none')
  const [intervalValue, setIntervalValue] = useState('4')
  const [intervalUnit, setIntervalUnit] = useState<SelfCareIntervalUnit>('week')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(() => [
    getIsoWeekdayFromDateKey(todayKey),
  ])
  const [dayOfMonth, setDayOfMonth] = useState(() =>
    String(Number(todayKey.slice(8, 10))),
  )
  const [monthOfYear, setMonthOfYear] = useState(() =>
    String(Number(todayKey.slice(5, 7))),
  )
  const [flexibleTargetCount, setFlexibleTargetCount] = useState('3')
  const [flexiblePeriod, setFlexiblePeriod] =
    useState<SelfCareFlexiblePeriod>('week')
  const [courseType, setCourseType] = useState<SelfCareCourseType>('days')
  const [courseTotalCount, setCourseTotalCount] = useState('30')
  const [appointmentDate, setAppointmentDate] = useState(todayKey)
  const [appointmentTime, setAppointmentTime] = useState('09:00')
  const [detailsPlace, setDetailsPlace] = useState('')
  const [detailsSpecialist, setDetailsSpecialist] = useState('')
  const [detailsContact, setDetailsContact] = useState('')
  const [detailsPrice, setDetailsPrice] = useState('')
  const [detailsCurrency, setDetailsCurrency] = useState('RUB')
  const [detailsNote, setDetailsNote] = useState('')
  const [minimumVersionTitle, setMinimumVersionTitle] = useState('')
  const [stepsText, setStepsText] = useState('')
  const selectedType = CREATE_TYPE_OPTIONS.find(
    (option) => option.value === type,
  )
  const intervalNumber = parsePositiveInteger(intervalValue)
  const flexibleTargetNumber = parsePositiveInteger(flexibleTargetCount)
  const courseTotalNumber = parsePositiveInteger(courseTotalCount)
  const dayOfMonthNumber = parseBoundedInteger(dayOfMonth, 1, 31)
  const monthOfYearNumber = parseBoundedInteger(monthOfYear, 1, 12)
  const needsInterval = repeatKindRequiresInterval(repeatKind)
  const canSubmit =
    title.trim().length > 0 &&
    (!needsInterval || Boolean(intervalNumber)) &&
    (repeatKind !== 'weekly' || daysOfWeek.length > 0) &&
    (repeatKind !== 'monthly' || Boolean(dayOfMonthNumber)) &&
    (repeatKind !== 'yearly' ||
      (Boolean(dayOfMonthNumber) && Boolean(monthOfYearNumber))) &&
    (repeatKind !== 'flexible_goal' || Boolean(flexibleTargetNumber)) &&
    (type !== 'course' || Boolean(courseTotalNumber)) &&
    (type !== 'appointment' || appointmentDate.length > 0)

  function handleTypeChange(nextType: SelfCareItemType): void {
    setType(nextType)

    if (nextType === 'habit' || nextType === 'ritual') {
      setRepeatKind('daily')
    }

    if (nextType === 'procedure') {
      setCategory('beauty')
      setRepeatKind('after_completion')
      setIntervalValue('4')
      setIntervalUnit('week')
    }

    if (nextType === 'appointment') {
      setCategory('health')
      setRepeatKind('none')
    }

    if (nextType === 'medical') {
      setCategory('medical')
      setImportance('required')
      setRepeatKind('none')
    }

    if (nextType === 'flexible_goal') {
      setCategory('movement')
      setRepeatKind('flexible_goal')
      setFlexibleTargetCount('3')
      setFlexiblePeriod('week')
    }

    if (nextType === 'course') {
      setCategory('health')
      setRepeatKind('course')
      setCourseTotalCount('30')
    }

    if (nextType === 'mood_check') {
      setCategory('emotional')
      setImportance('gentle')
      setRepeatKind('daily')
    }

    if (nextType === 'rest_action') {
      setCategory('relax')
      setImportance('gentle')
    }

    if (nextType === 'measurement') {
      setCategory('health')
    }
  }

  function handleRepeatKindChange(
    nextRepeatKind: SelfCareCreateRepeatKind,
  ): void {
    setRepeatKind(nextRepeatKind)

    if (nextRepeatKind === 'flexible_goal') {
      setType('flexible_goal')
      setCategory('movement')
      setFlexibleTargetCount((value) => value || '3')
    }

    if (nextRepeatKind === 'course') {
      setType('course')
      setCategory('health')
      setCourseTotalCount((value) => value || '30')
    }
  }

  return (
    <form
      className={styles.createForm}
      onSubmit={(event) => {
        event.preventDefault()

        if (!canSubmit) {
          return
        }

        const minimumTitle = normalizeOptionalText(minimumVersionTitle)
        const detailsPriceValue = parseOptionalPrice(detailsPrice)
        const normalizedDetailsCurrency = normalizeOptionalText(detailsCurrency)
        const normalizedAppointmentTime = normalizeOptionalText(appointmentTime)
        const scheduleRule =
          type === 'task' && repeatKind === 'none'
            ? undefined
            : buildCreateScheduleRule({
                dayOfMonth: dayOfMonthNumber ?? getDatePart(todayKey, 'day'),
                daysOfWeek,
                flexiblePeriod,
                flexibleTargetCount: flexibleTargetNumber ?? 1,
                intervalUnit,
                intervalValue: intervalNumber ?? 1,
                monthOfYear:
                  monthOfYearNumber ?? getDatePart(todayKey, 'month'),
                repeatKind,
                startDate: todayKey,
              })
        const appointmentStartsAt = buildDateTimeInput(
          appointmentDate,
          normalizedAppointmentTime,
        )

        onCreate({
          input: {
            alternatives: [],
            appointmentDetails:
              type === 'appointment'
                ? {
                    currency: normalizedDetailsCurrency,
                    endsAt: null,
                    place: normalizeOptionalText(detailsPlace),
                    preparationNote: normalizeOptionalText(detailsNote),
                    price: detailsPriceValue,
                    resultNote: null,
                    specialistContact: normalizeOptionalText(detailsContact),
                    specialistName: normalizeOptionalText(detailsSpecialist),
                    startsAt: appointmentStartsAt,
                  }
                : undefined,
            category,
            color: null,
            courseDetails:
              type === 'course'
                ? {
                    completedCount: 0,
                    courseType,
                    endDate: null,
                    isCompleted: false,
                    isPaused: false,
                    startDate: todayKey,
                    totalCount: courseTotalNumber ?? 1,
                  }
                : undefined,
            customCategoryId: null,
            defaultDurationMinutes: null,
            description: description.trim(),
            icon: null,
            importance,
            isActive: true,
            isArchived: false,
            isPrivate: true,
            medicalDetails:
              type === 'medical'
                ? {
                    analysisList: [],
                    clinicAddress: null,
                    clinicName: null,
                    documentUrls: [],
                    doctorName: null,
                    nextControlDate: null,
                    phone: null,
                    reminderStrategy: 'soft',
                    resultNote: null,
                    website: null,
                  }
                : undefined,
            migratedFromHabitId: null,
            minimumVersion: minimumTitle
              ? {
                  description: '',
                  durationMinutes: null,
                  title: minimumTitle,
                }
              : undefined,
            preferredTimeOfDay,
            procedureDetails:
              type === 'procedure'
                ? {
                    contact: normalizeOptionalText(detailsContact),
                    currency: normalizedDetailsCurrency,
                    defaultPrice: detailsPriceValue,
                    place: normalizeOptionalText(detailsPlace),
                    specialistName: normalizeOptionalText(detailsSpecialist),
                  }
                : undefined,
            scheduleRule,
            steps:
              type === 'ritual'
                ? parseMultilineTitles(stepsText).map((stepTitle, index) => ({
                    defaultChecked: false,
                    isOptional: false,
                    order: index,
                    title: stepTitle,
                  }))
                : [],
            title: title.trim(),
            type,
          },
          scheduleInput:
            type === 'appointment'
              ? {
                  currency:
                    detailsPriceValue === null
                      ? null
                      : normalizedDetailsCurrency,
                  note: detailsNote,
                  place: normalizeOptionalText(detailsPlace),
                  price: detailsPriceValue,
                  scheduledFor: appointmentDate,
                  scheduledTime: normalizedAppointmentTime,
                  specialistContact: normalizeOptionalText(detailsContact),
                  specialistName: normalizeOptionalText(detailsSpecialist),
                }
              : undefined,
        })
      }}
    >
      <label className={styles.dateField}>
        <span>Название</span>
        <input
          type="text"
          autoComplete="off"
          maxLength={160}
          required
          placeholder="Например: растяжка, стоматолог, стрижка"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <label className={styles.dateField}>
        <span>Тип</span>
        <select
          value={type}
          onChange={(event) =>
            handleTypeChange(event.target.value as SelfCareItemType)
          }
        >
          {CREATE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedType ? (
          <small className={styles.fieldHint}>{selectedType.description}</small>
        ) : null}
      </label>

      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Категория</span>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as SelfCareCategory)
            }
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.dateField}>
          <span>Важность</span>
          <select
            value={importance}
            onChange={(event) =>
              setImportance(event.target.value as SelfCareImportance)
            }
          >
            {Object.entries(IMPORTANCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Когда удобнее</span>
          <select
            value={preferredTimeOfDay}
            onChange={(event) =>
              setPreferredTimeOfDay(event.target.value as SelfCareTimeOfDay)
            }
          >
            {Object.entries(TIME_GROUP_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.dateField}>
          <span>Регулярность</span>
          <select
            value={repeatKind}
            onChange={(event) =>
              handleRepeatKindChange(
                event.target.value as SelfCareCreateRepeatKind,
              )
            }
          >
            {CREATE_REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <SelfCareRepeatFields
        dayOfMonth={dayOfMonth}
        daysOfWeek={daysOfWeek}
        flexiblePeriod={flexiblePeriod}
        flexibleTargetCount={flexibleTargetCount}
        intervalUnit={intervalUnit}
        intervalValue={intervalValue}
        monthOfYear={monthOfYear}
        repeatKind={repeatKind}
        onChangeDayOfMonth={setDayOfMonth}
        onChangeFlexiblePeriod={setFlexiblePeriod}
        onChangeFlexibleTargetCount={setFlexibleTargetCount}
        onChangeIntervalUnit={setIntervalUnit}
        onChangeIntervalValue={setIntervalValue}
        onChangeMonthOfYear={setMonthOfYear}
        onToggleWeekday={(weekday) =>
          setDaysOfWeek((current) => toggleWeekday(current, weekday))
        }
      />

      {type === 'appointment' ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>Дата записи</span>
            <input
              type="date"
              min={todayKey}
              required
              value={appointmentDate}
              onChange={(event) => setAppointmentDate(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Время записи</span>
            <input
              type="time"
              value={appointmentTime}
              onChange={(event) => setAppointmentTime(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {type === 'course' ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>Длина курса</span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              required
              value={courseTotalCount}
              onChange={(event) => setCourseTotalCount(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Единица курса</span>
            <select
              value={courseType}
              onChange={(event) =>
                setCourseType(event.target.value as SelfCareCourseType)
              }
            >
              {COURSE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {type === 'appointment' || type === 'procedure' ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>Место</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="Салон, клиника, адрес"
              value={detailsPlace}
              onChange={(event) => setDetailsPlace(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Мастер / специалист</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="Имя мастера или врача"
              value={detailsSpecialist}
              onChange={(event) => setDetailsSpecialist(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Контакт</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="Телефон, ссылка, мессенджер"
              value={detailsContact}
              onChange={(event) => setDetailsContact(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Стоимость</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={detailsPrice}
              onChange={(event) => setDetailsPrice(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Валюта</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={8}
              value={detailsCurrency}
              onChange={(event) => setDetailsCurrency(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Комментарий</span>
            <textarea
              rows={3}
              maxLength={600}
              placeholder="Что важно помнить"
              value={detailsNote}
              onChange={(event) => setDetailsNote(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {type === 'ritual' ? (
        <label className={styles.dateField}>
          <span>Шаги ритуала</span>
          <textarea
            rows={4}
            maxLength={800}
            placeholder={'Умыться\nКрем\nSPF'}
            value={stepsText}
            onChange={(event) => setStepsText(event.target.value)}
          />
        </label>
      ) : null}

      <label className={styles.dateField}>
        <span>Минимальная версия</span>
        <input
          type="text"
          autoComplete="off"
          maxLength={160}
          placeholder="Например: растяжка 3 минуты"
          value={minimumVersionTitle}
          onChange={(event) => setMinimumVersionTitle(event.target.value)}
        />
      </label>

      <label className={styles.dateField}>
        <span>Описание</span>
        <textarea
          rows={3}
          maxLength={1200}
          placeholder="Можно оставить пустым"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className={styles.modalActions}>
        <button
          className={styles.doneButton}
          type="submit"
          disabled={isBusy || !canSubmit}
        >
          Создать заботу
        </button>
      </div>
    </form>
  )
}

function SelfCareRepeatFields({
  dayOfMonth,
  daysOfWeek,
  flexiblePeriod,
  flexibleTargetCount,
  intervalUnit,
  intervalValue,
  monthOfYear,
  onChangeDayOfMonth,
  onChangeFlexiblePeriod,
  onChangeFlexibleTargetCount,
  onChangeIntervalUnit,
  onChangeIntervalValue,
  onChangeMonthOfYear,
  onToggleWeekday,
  repeatKind,
}: {
  dayOfMonth: string
  daysOfWeek: number[]
  flexiblePeriod: SelfCareFlexiblePeriod
  flexibleTargetCount: string
  intervalUnit: SelfCareIntervalUnit
  intervalValue: string
  monthOfYear: string
  onChangeDayOfMonth: (value: string) => void
  onChangeFlexiblePeriod: (value: SelfCareFlexiblePeriod) => void
  onChangeFlexibleTargetCount: (value: string) => void
  onChangeIntervalUnit: (value: SelfCareIntervalUnit) => void
  onChangeIntervalValue: (value: string) => void
  onChangeMonthOfYear: (value: string) => void
  onToggleWeekday: (weekday: number) => void
  repeatKind: SelfCareCreateRepeatKind
}) {
  if (repeatKindRequiresInterval(repeatKind)) {
    return (
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Повторять через</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            required
            value={intervalValue}
            onChange={(event) => onChangeIntervalValue(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>Период</span>
          <select
            value={intervalUnit}
            onChange={(event) =>
              onChangeIntervalUnit(event.target.value as SelfCareIntervalUnit)
            }
          >
            {INTERVAL_UNIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    )
  }

  if (repeatKind === 'weekly') {
    return (
      <div
        className={styles.quickDateGrid}
        role="group"
        aria-label="Дни недели для повтора"
      >
        {WEEKDAY_OPTIONS.map((weekday) => {
          const isSelected = daysOfWeek.includes(weekday.value)

          return (
            <button
              key={weekday.value}
              className={cx(
                styles.quickDateButton,
                isSelected && styles.quickDateButtonActive,
              )}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggleWeekday(weekday.value)}
            >
              {weekday.label}
            </button>
          )
        })}
      </div>
    )
  }

  if (repeatKind === 'monthly') {
    return (
      <label className={styles.dateField}>
        <span>День месяца</span>
        <input
          type="number"
          min="1"
          max="31"
          step="1"
          inputMode="numeric"
          required
          value={dayOfMonth}
          onChange={(event) => onChangeDayOfMonth(event.target.value)}
        />
      </label>
    )
  }

  if (repeatKind === 'yearly') {
    return (
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Месяц</span>
          <input
            type="number"
            min="1"
            max="12"
            step="1"
            inputMode="numeric"
            required
            value={monthOfYear}
            onChange={(event) => onChangeMonthOfYear(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>День месяца</span>
          <input
            type="number"
            min="1"
            max="31"
            step="1"
            inputMode="numeric"
            required
            value={dayOfMonth}
            onChange={(event) => onChangeDayOfMonth(event.target.value)}
          />
        </label>
      </div>
    )
  }

  if (repeatKind === 'flexible_goal') {
    return (
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Цель</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            required
            value={flexibleTargetCount}
            onChange={(event) =>
              onChangeFlexibleTargetCount(event.target.value)
            }
          />
        </label>

        <label className={styles.dateField}>
          <span>Период цели</span>
          <select
            value={flexiblePeriod}
            onChange={(event) =>
              onChangeFlexiblePeriod(
                event.target.value as SelfCareFlexiblePeriod,
              )
            }
          >
            {FLEXIBLE_PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    )
  }

  return null
}

function SelfCareEditDialog({
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
  onSubmit: (input: SelfCareItemUpdateInput) => void
  todayKey: string
}) {
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
      aria-labelledby="self-care-edit-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть настройки заботы"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-edit-title">Настроить заботу</h2>
            <p>Измени название, регулярность, шаги и детали.</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть настройки заботы"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        {errorMessage ? (
          <p className={styles.errorText}>{errorMessage}</p>
        ) : null}

        <SelfCareEditForm
          entry={entry}
          isBusy={isBusy}
          todayKey={todayKey}
          onCancel={onClose}
          onSubmit={onSubmit}
        />
      </section>
    </div>,
    document.body,
  )
}

function SelfCareEditForm({
  entry,
  isBusy,
  onCancel,
  onSubmit,
  todayKey,
}: {
  entry: SelfCareTodayItem
  isBusy: boolean
  onCancel: () => void
  onSubmit: (input: SelfCareItemUpdateInput) => void
  todayKey: string
}) {
  const [title, setTitle] = useState(entry.item.title)
  const [description, setDescription] = useState(entry.item.description)
  const [category, setCategory] = useState<SelfCareCategory>(
    entry.item.category,
  )
  const [importance, setImportance] = useState<SelfCareImportance>(
    entry.item.importance,
  )
  const [preferredTimeOfDay, setPreferredTimeOfDay] =
    useState<SelfCareTimeOfDay>(entry.item.preferredTimeOfDay ?? 'anytime')
  const [isActive, setIsActive] = useState(entry.item.isActive)
  const [repeatMode, setRepeatMode] = useState<SelfCareEditRepeatMode>(
    getInitialEditRepeatMode(entry.scheduleRule),
  )
  const [intervalValue, setIntervalValue] = useState(
    formatOptionalNumber(entry.scheduleRule?.intervalValue ?? 4),
  )
  const [intervalUnit, setIntervalUnit] = useState<SelfCareIntervalUnit>(
    entry.scheduleRule?.intervalUnit ?? 'week',
  )
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    entry.scheduleRule?.daysOfWeek.length
      ? entry.scheduleRule.daysOfWeek
      : [getIsoWeekdayFromDateKey(todayKey)],
  )
  const [dayOfMonth, setDayOfMonth] = useState(
    formatOptionalNumber(
      entry.scheduleRule?.dayOfMonth ?? getDatePart(todayKey, 'day'),
    ),
  )
  const [monthOfYear, setMonthOfYear] = useState(
    formatOptionalNumber(
      entry.scheduleRule?.monthOfYear ?? getDatePart(todayKey, 'month'),
    ),
  )
  const [flexibleTargetCount, setFlexibleTargetCount] = useState(
    formatOptionalNumber(entry.scheduleRule?.flexibleTargetCount ?? 3),
  )
  const [flexiblePeriod, setFlexiblePeriod] = useState<SelfCareFlexiblePeriod>(
    entry.scheduleRule?.flexiblePeriod ?? 'week',
  )
  const [minimumVersionTitle, setMinimumVersionTitle] = useState(
    entry.item.minimumVersionTitle ?? '',
  )
  const [stepsText, setStepsText] = useState(
    entry.steps.map((step) => step.title).join('\n'),
  )
  const [procedurePlace, setProcedurePlace] = useState(
    entry.procedure?.place ?? '',
  )
  const [procedureSpecialist, setProcedureSpecialist] = useState(
    entry.procedure?.specialistName ?? '',
  )
  const [procedureContact, setProcedureContact] = useState(
    entry.procedure?.contact ?? '',
  )
  const [procedurePrice, setProcedurePrice] = useState(
    formatOptionalNumber(entry.procedure?.defaultPrice),
  )
  const [procedureCurrency, setProcedureCurrency] = useState(
    entry.procedure?.currency ?? 'RUB',
  )
  const intervalNumber = parsePositiveInteger(intervalValue)
  const flexibleTargetNumber = parsePositiveInteger(flexibleTargetCount)
  const dayOfMonthNumber = parseBoundedInteger(dayOfMonth, 1, 31)
  const monthOfYearNumber = parseBoundedInteger(monthOfYear, 1, 12)
  const selectedRepeatKind = repeatMode === 'keep' ? null : repeatMode
  const canSubmit =
    title.trim().length > 0 &&
    (!selectedRepeatKind ||
      ((!repeatKindRequiresInterval(selectedRepeatKind) ||
        Boolean(intervalNumber)) &&
        (selectedRepeatKind !== 'weekly' || daysOfWeek.length > 0) &&
        (selectedRepeatKind !== 'monthly' || Boolean(dayOfMonthNumber)) &&
        (selectedRepeatKind !== 'yearly' ||
          (Boolean(dayOfMonthNumber) && Boolean(monthOfYearNumber))) &&
        (selectedRepeatKind !== 'flexible_goal' ||
          Boolean(flexibleTargetNumber))))

  return (
    <form
      className={styles.createForm}
      onSubmit={(event) => {
        event.preventDefault()

        if (!canSubmit) {
          return
        }

        const minimumTitle = normalizeOptionalText(minimumVersionTitle)
        const input: SelfCareItemUpdateInput = {
          category,
          description: description.trim(),
          expectedVersion: entry.item.version,
          importance,
          isActive,
          minimumVersion: minimumTitle
            ? {
                description: entry.item.minimumVersionDescription ?? '',
                durationMinutes: entry.item.minimumVersionDurationMinutes,
                title: minimumTitle,
              }
            : null,
          preferredTimeOfDay,
          title: title.trim(),
        }

        if (repeatMode !== 'keep') {
          input.scheduleRule = buildCreateScheduleRule({
            dayOfMonth: dayOfMonthNumber ?? getDatePart(todayKey, 'day'),
            daysOfWeek,
            flexiblePeriod,
            flexibleTargetCount: flexibleTargetNumber ?? 1,
            intervalUnit,
            intervalValue: intervalNumber ?? 1,
            monthOfYear: monthOfYearNumber ?? getDatePart(todayKey, 'month'),
            repeatKind: repeatMode,
            startDate: entry.scheduleRule?.startDate ?? todayKey,
          })
        }

        if (entry.item.type === 'ritual') {
          input.steps = parseMultilineTitles(stepsText).map(
            (stepTitle, index) => ({
              defaultChecked: false,
              isOptional: false,
              order: index,
              title: stepTitle,
            }),
          )
        }

        if (entry.item.type === 'procedure') {
          input.procedureDetails = {
            contact: normalizeOptionalText(procedureContact),
            currency: normalizeOptionalText(procedureCurrency),
            defaultPrice: parseOptionalPrice(procedurePrice),
            place: normalizeOptionalText(procedurePlace),
            specialistName: normalizeOptionalText(procedureSpecialist),
          }
        }

        onSubmit(input)
      }}
    >
      <div className={styles.scheduleTarget}>
        <strong>{entry.item.title}</strong>
        <span>
          {CATEGORY_LABELS[entry.item.category]} · {getTypeLabel(entry.item)}
        </span>
      </div>

      <label className={styles.dateField}>
        <span>Название</span>
        <input
          type="text"
          autoComplete="off"
          maxLength={160}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Категория</span>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as SelfCareCategory)
            }
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.dateField}>
          <span>Важность</span>
          <select
            value={importance}
            onChange={(event) =>
              setImportance(event.target.value as SelfCareImportance)
            }
          >
            {Object.entries(IMPORTANCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Когда удобнее</span>
          <select
            value={preferredTimeOfDay}
            onChange={(event) =>
              setPreferredTimeOfDay(event.target.value as SelfCareTimeOfDay)
            }
          >
            {Object.entries(TIME_GROUP_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.dateField}>
          <span>Регулярность</span>
          <select
            value={repeatMode}
            onChange={(event) =>
              setRepeatMode(event.target.value as SelfCareEditRepeatMode)
            }
          >
            <option value="keep">
              Не менять: {formatSchedule(entry.scheduleRule)}
            </option>
            {CREATE_REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {repeatMode !== 'keep' ? (
        <SelfCareRepeatFields
          dayOfMonth={dayOfMonth}
          daysOfWeek={daysOfWeek}
          flexiblePeriod={flexiblePeriod}
          flexibleTargetCount={flexibleTargetCount}
          intervalUnit={intervalUnit}
          intervalValue={intervalValue}
          monthOfYear={monthOfYear}
          repeatKind={repeatMode}
          onChangeDayOfMonth={setDayOfMonth}
          onChangeFlexiblePeriod={setFlexiblePeriod}
          onChangeFlexibleTargetCount={setFlexibleTargetCount}
          onChangeIntervalUnit={setIntervalUnit}
          onChangeIntervalValue={setIntervalValue}
          onChangeMonthOfYear={setMonthOfYear}
          onToggleWeekday={(weekday) =>
            setDaysOfWeek((current) => toggleWeekday(current, weekday))
          }
        />
      ) : null}

      {entry.item.type === 'ritual' ? (
        <label className={styles.dateField}>
          <span>Шаги ритуала</span>
          <textarea
            rows={4}
            maxLength={800}
            placeholder={'Умыться\nКрем\nSPF'}
            value={stepsText}
            onChange={(event) => setStepsText(event.target.value)}
          />
        </label>
      ) : null}

      {entry.item.type === 'procedure' ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>Место</span>
            <input
              type="text"
              autoComplete="off"
              value={procedurePlace}
              onChange={(event) => setProcedurePlace(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Мастер / специалист</span>
            <input
              type="text"
              autoComplete="off"
              value={procedureSpecialist}
              onChange={(event) => setProcedureSpecialist(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Контакт</span>
            <input
              type="text"
              autoComplete="off"
              value={procedureContact}
              onChange={(event) => setProcedureContact(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Стоимость</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={procedurePrice}
              onChange={(event) => setProcedurePrice(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Валюта</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={8}
              value={procedureCurrency}
              onChange={(event) => setProcedureCurrency(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      <label className={styles.dateField}>
        <span>Минимальная версия</span>
        <input
          type="text"
          autoComplete="off"
          maxLength={160}
          placeholder="Например: растяжка 3 минуты"
          value={minimumVersionTitle}
          onChange={(event) => setMinimumVersionTitle(event.target.value)}
        />
      </label>

      <label className={styles.dateField}>
        <span>Описание</span>
        <textarea
          rows={3}
          maxLength={1200}
          placeholder="Можно оставить пустым"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <label className={styles.toggleField}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        <span>Показывать эту заботу в разделе</span>
      </label>

      <div className={styles.modalActions}>
        <button
          className={styles.softButton}
          type="button"
          disabled={isBusy}
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          className={styles.doneButton}
          type="submit"
          disabled={isBusy || !canSubmit}
        >
          Сохранить
        </button>
      </div>
    </form>
  )
}

function SelfCareScheduleDialog({
  date,
  entry,
  errorMessage,
  isBusy,
  onChangeDate,
  onClose,
  onSubmit,
  todayKey,
}: {
  date: string
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onChangeDate: (date: string) => void
  onClose: () => void
  onSubmit: (input: SelfCareItemScheduleInput) => void
  todayKey: string
}) {
  const [scheduledTime, setScheduledTime] = useState(
    getInitialScheduleTime(entry),
  )
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
                    'RUB'),
              note,
              place: normalizeOptionalText(place),
              price: priceValue,
              scheduledFor: date,
              scheduledTime: normalizeOptionalText(scheduledTime),
              specialistContact: normalizeOptionalText(specialistContact),
              specialistName: normalizeOptionalText(specialistName),
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
              disabled={isBusy || !date}
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

function SelfCareSection({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section className={styles.sectionBlock}>
      <h2>{title}</h2>
      <div className={styles.cardList}>{children}</div>
    </section>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metricRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ChecklistPreview({
  entry,
  isBusy,
  isDone,
  onToggleStep,
  selectedStepIds,
}: {
  entry: SelfCareTodayItem
  isBusy: boolean
  isDone: boolean
  onToggleStep?:
    | ((entry: SelfCareTodayItem, stepId: string) => void)
    | undefined
  selectedStepIds: readonly string[]
}) {
  const selectedStepIdSet = new Set(selectedStepIds)
  const doneCount = entry.steps.filter((step) =>
    selectedStepIdSet.has(step.id),
  ).length
  const isInteractive = Boolean(onToggleStep) && !isDone

  return (
    <div className={styles.stepPreview} aria-label="Этапы ритуала">
      <span className={styles.stepPreviewCounter}>
        Этапы: {doneCount}/{entry.steps.length}
      </span>
      {entry.steps.map((step) => {
        const isStepDone = isDone || selectedStepIdSet.has(step.id)

        return (
          <button
            key={step.id}
            className={cx(styles.stepChip, isStepDone && styles.stepChipDone)}
            type="button"
            disabled={isBusy}
            aria-pressed={isStepDone}
            aria-disabled={!isInteractive}
            onClick={() => {
              if (!isInteractive) {
                return
              }

              onToggleStep?.(entry, step.id)
            }}
          >
            <CheckIcon size={13} />
            <span>{step.title}</span>
          </button>
        )
      })}
    </div>
  )
}

function buildCompletionInput(
  entry: SelfCareTodayItem,
  action: CardAction,
): SelfCareCompletionInput {
  if (action === 'minimum') {
    return {
      alternativeTitle: entry.item.minimumVersionTitle,
      completedVariant: 'minimum' as const,
      durationMinutes: entry.item.minimumVersionDurationMinutes,
      energyAfter: null,
      energyBefore: null,
      moodAfter: null,
      moodBefore: null,
      note: entry.item.minimumVersionTitle
        ? `Минимальная версия: ${entry.item.minimumVersionTitle}`
        : 'Минимальная версия тоже считается заботой.',
      status: 'alternative_done' as const,
    }
  }

  return {
    alternativeTitle: null,
    completedVariant: 'full' as const,
    durationMinutes: entry.item.defaultDurationMinutes,
    energyAfter: null,
    energyBefore: null,
    moodAfter: null,
    moodBefore: null,
    note: '',
    status: 'done' as const,
  }
}

function buildRitualStepCompletionInput(
  entry: SelfCareTodayItem,
  action: CardAction,
  stepDraft: readonly string[] | undefined,
): Array<{ isDone: boolean; stepId: string }> {
  if (entry.steps.length === 0) {
    return []
  }

  if (action === 'minimum') {
    return entry.steps.map((step) => ({
      isDone: !step.isOptional,
      stepId: step.id,
    }))
  }

  const selectedStepIds = new Set(stepDraft ?? [])

  if (stepDraft) {
    return entry.steps.map((step) => ({
      isDone: selectedStepIds.has(step.id),
      stepId: step.id,
    }))
  }

  return entry.steps.map((step) => ({
    isDone: true,
    stepId: step.id,
  }))
}

function getRitualStepDraftKey(
  entry: SelfCareTodayItem,
  todayKey: string,
): string {
  return `${todayKey}:${entry.occurrence?.id ?? entry.item.id}`
}

function getRitualStepDraft(
  drafts: RitualStepDrafts,
  entry: SelfCareTodayItem,
  todayKey: string,
): readonly string[] | undefined {
  return drafts[getRitualStepDraftKey(entry, todayKey)]
}

function getInitialRitualStepDraft(
  entry: SelfCareTodayItem,
): readonly string[] {
  return entry.steps
    .filter((step) => step.defaultChecked)
    .map((step) => step.id)
}

function getEffectiveRitualStepIds(
  entry: SelfCareTodayItem,
  stepDraft: readonly string[] | undefined,
): readonly string[] {
  return stepDraft ?? getInitialRitualStepDraft(entry)
}

function groupTodayItems(
  items: SelfCareTodayItem[],
): Record<SelfCareTimeOfDay, SelfCareTodayItem[]> {
  return items.reduce<Record<SelfCareTimeOfDay, SelfCareTodayItem[]>>(
    (groups, item) => {
      groups[item.timeGroup].push(item)
      return groups
    },
    {
      afternoon: [],
      anytime: [],
      evening: [],
      morning: [],
      night: [],
    },
  )
}

function groupItemsByCategory(
  list: SelfCareListResponse | undefined,
): Record<SelfCareCategory, SelfCareItem[]> {
  const groups = Object.keys(CATEGORY_LABELS).reduce(
    (current, category) => ({ ...current, [category]: [] }),
    {} as Record<SelfCareCategory, SelfCareItem[]>,
  )

  for (const item of list?.items ?? []) {
    if (!item.isArchived) {
      groups[item.category].push(item)
    }
  }

  return groups
}

function buildItemEntry(
  item: SelfCareItem,
  list: SelfCareListResponse,
): SelfCareTodayItem {
  const scheduleRule =
    list.scheduleRules.find((rule) => rule.itemId === item.id) ?? null

  return {
    appointment:
      list.appointmentDetails.find((details) => details.itemId === item.id) ??
      null,
    completion: null,
    courseDetails:
      list.courseDetails.find((details) => details.itemId === item.id) ?? null,
    flexibleProgress: null,
    item,
    occurrence: null,
    procedure:
      list.procedureDetails.find((details) => details.itemId === item.id) ??
      null,
    scheduleRule,
    steps: list.steps
      .filter((step) => step.itemId === item.id)
      .sort((left, right) => left.order - right.order),
    timeGroup: item.preferredTimeOfDay ?? 'anytime',
  }
}

function buildAvailableTodayEntries(input: {
  dashboard: ReturnType<typeof useSelfCareDashboard>['data'] | undefined
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  list: SelfCareListResponse | undefined
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  todayKey: string
}): SelfCareTodayItem[] {
  if (!input.list || !input.history) {
    return []
  }

  const list = input.list
  const history = input.history
  const occupiedItemIds = getOccupiedTodayItemIds(
    input.dashboard,
    input.plan,
    input.todayKey,
  )
  const latestCompletionByItemId = getLatestProgressCompletionByItemId(history)

  return list.items
    .filter((item) => !occupiedItemIds.has(item.id))
    .map((item) =>
      mergeLatestProgressCompletion(
        buildItemEntry(item, list),
        latestCompletionByItemId.get(item.id) ?? null,
      ),
    )
    .filter((entry) => shouldShowAvailableTodayEntry(entry, input.todayKey))
    .sort(compareTodayEntries)
}

function getOccupiedTodayItemIds(
  dashboard: ReturnType<typeof useSelfCareDashboard>['data'] | undefined,
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined,
  todayKey: string,
): ReadonlySet<string> {
  const itemIds = new Set<string>()

  for (const entry of [
    ...(dashboard?.overdueItems ?? []),
    ...(dashboard?.todayItems ?? []),
    ...(dashboard?.flexibleGoals ?? []),
  ]) {
    itemIds.add(entry.item.id)
  }

  for (const entry of plan?.occurrences ?? []) {
    if (entry.occurrence?.scheduledFor === todayKey) {
      itemIds.add(entry.item.id)
    }
  }

  return itemIds
}

function compareTodayEntries(
  left: SelfCareTodayItem,
  right: SelfCareTodayItem,
): number {
  const timeDiff =
    getTimeGroupWeight(left.timeGroup) - getTimeGroupWeight(right.timeGroup)

  if (timeDiff !== 0) {
    return timeDiff
  }

  const importanceDiff =
    getImportanceWeight(left.item.importance) -
    getImportanceWeight(right.item.importance)

  if (importanceDiff !== 0) {
    return importanceDiff
  }

  return left.item.title.localeCompare(right.item.title, 'ru')
}

function getTimeGroupWeight(timeGroup: SelfCareTimeOfDay): number {
  if (timeGroup === 'morning') return 0
  if (timeGroup === 'afternoon') return 1
  if (timeGroup === 'evening') return 2
  if (timeGroup === 'night') return 3
  return 4
}

function getImportanceWeight(importance: SelfCareImportance): number {
  if (importance === 'required') return 0
  if (importance === 'recommended') return 1
  return 2
}

function shouldShowAvailableTodayEntry(
  entry: SelfCareTodayItem,
  todayKey: string,
): boolean {
  if (!entry.item.isActive || entry.item.isArchived || entry.item.deletedAt) {
    return false
  }

  if (entry.item.type === 'flexible_goal') {
    return false
  }

  if (entry.item.type === 'appointment') {
    return isAppointmentAvailableToday(entry, todayKey)
  }

  if (entry.item.type === 'course') {
    return isCourseAvailableToday(entry, todayKey)
  }

  if (isEntryDoneToday(entry, todayKey)) {
    return false
  }

  return isScheduleRuleAvailableToday(
    entry.scheduleRule,
    entry.completion,
    todayKey,
  )
}

function isAppointmentAvailableToday(
  entry: SelfCareTodayItem,
  todayKey: string,
): boolean {
  return (
    !isEntryDoneToday(entry, todayKey) &&
    entry.appointment?.startsAt.slice(0, 10) === todayKey
  )
}

function isCourseAvailableToday(
  entry: SelfCareTodayItem,
  todayKey: string,
): boolean {
  const course = entry.courseDetails

  if (!course || course.isCompleted || course.isPaused) {
    return false
  }

  if (
    course.courseType !== 'sessions' &&
    !entry.scheduleRule?.allowMultiplePerDay &&
    isEntryDoneToday(entry, todayKey)
  ) {
    return false
  }

  return entry.scheduleRule
    ? isScheduleRuleAvailableToday(
        entry.scheduleRule,
        entry.completion,
        todayKey,
      )
    : true
}

function isScheduleRuleAvailableToday(
  rule: SelfCareScheduleRule | null,
  completion: SelfCareCompletion | null,
  todayKey: string,
): boolean {
  if (!rule) {
    return completion ? false : true
  }

  const startDate = rule.startDate ?? todayKey

  if (todayKey < startDate || (rule.endDate && todayKey > rule.endDate)) {
    return false
  }

  if (rule.repeatKind === 'none') {
    return completion ? false : true
  }

  if (rule.repeatKind === 'flexible_goal') {
    return false
  }

  if (rule.repeatKind === 'daily') {
    return isEveryNDays(startDate, todayKey, rule.intervalValue ?? 1)
  }

  if (rule.repeatKind === 'weekly') {
    return (
      rule.daysOfWeek.includes(getIsoWeekdayFromDateKey(todayKey)) &&
      isEveryNWeeks(startDate, todayKey, rule.intervalValue ?? 1)
    )
  }

  if (rule.repeatKind === 'monthly') {
    return isMonthlyRuleAvailableToday(rule, startDate, todayKey)
  }

  if (rule.repeatKind === 'yearly') {
    return isYearlyRuleAvailableToday(rule, startDate, todayKey)
  }

  if (rule.repeatKind === 'interval') {
    return isIntervalRuleAvailableToday(rule, startDate, todayKey)
  }

  if (rule.repeatKind === 'after_completion') {
    return isAfterCompletionRuleAvailableToday(rule, completion, todayKey)
  }

  return isCourseRuleAvailableToday(rule, startDate, todayKey)
}

function isAfterCompletionRuleAvailableToday(
  rule: SelfCareScheduleRule,
  completion: SelfCareCompletion | null,
  todayKey: string,
): boolean {
  const startDate = rule.startDate ?? todayKey

  if (!completion) {
    return startDate <= todayKey
  }

  const nextDate = addIntervalDateKey(
    completion.completedAt.slice(0, 10),
    rule.intervalValue ?? 1,
    rule.intervalUnit ?? 'month',
  )

  return nextDate <= todayKey
}

function isCourseRuleAvailableToday(
  rule: SelfCareScheduleRule,
  startDate: string,
  todayKey: string,
): boolean {
  if (rule.daysOfWeek.length > 0) {
    return rule.daysOfWeek.includes(getIsoWeekdayFromDateKey(todayKey))
  }

  if (rule.intervalValue && rule.intervalUnit) {
    return isIntervalRuleAvailableToday(rule, startDate, todayKey)
  }

  return todayKey >= startDate
}

function isMonthlyRuleAvailableToday(
  rule: SelfCareScheduleRule,
  startDate: string,
  todayKey: string,
): boolean {
  if (!isEveryNMonths(startDate, todayKey, rule.intervalValue ?? 1)) {
    return false
  }

  return getMonthlyCandidateDateKey(rule, todayKey) === todayKey
}

function isYearlyRuleAvailableToday(
  rule: SelfCareScheduleRule,
  startDate: string,
  todayKey: string,
): boolean {
  const startYear = Number(startDate.slice(0, 4))
  const currentYear = Number(todayKey.slice(0, 4))
  const every = rule.intervalValue ?? 1

  if ((currentYear - startYear) % every !== 0) {
    return false
  }

  const month = rule.monthOfYear ?? Number(startDate.slice(5, 7))
  const day = Math.min(
    rule.dayOfMonth ?? Number(startDate.slice(8, 10)),
    getDaysInMonth(currentYear, month),
  )

  return buildDateKeyFromParts(currentYear, month, day) === todayKey
}

function isIntervalRuleAvailableToday(
  rule: SelfCareScheduleRule,
  startDate: string,
  todayKey: string,
): boolean {
  let cursor = startDate
  let guard = 0

  while (cursor < todayKey && guard < 5000) {
    cursor = addIntervalDateKey(
      cursor,
      rule.intervalValue ?? 1,
      rule.intervalUnit ?? 'day',
    )
    guard += 1
  }

  return cursor === todayKey
}

function isEveryNDays(
  startDate: string,
  todayKey: string,
  every: number,
): boolean {
  const distance = getDateDistanceInDays(startDate, todayKey)
  return distance >= 0 && distance % every === 0
}

function isEveryNWeeks(
  startDate: string,
  todayKey: string,
  every: number,
): boolean {
  const distance = getDateDistanceInDays(startDate, todayKey)
  return distance >= 0 && Math.floor(distance / 7) % every === 0
}

function isEveryNMonths(
  startDate: string,
  todayKey: string,
  every: number,
): boolean {
  const distance =
    (Number(todayKey.slice(0, 4)) - Number(startDate.slice(0, 4))) * 12 +
    Number(todayKey.slice(5, 7)) -
    Number(startDate.slice(5, 7))

  return distance >= 0 && distance % every === 0
}

function getMonthlyCandidateDateKey(
  rule: SelfCareScheduleRule,
  todayKey: string,
): string {
  const year = Number(todayKey.slice(0, 4))
  const month = Number(todayKey.slice(5, 7))

  if (rule.weekOfMonth) {
    return getNthWeekdayOfMonthDateKey(
      year,
      month,
      rule.daysOfWeek[0] ?? getIsoWeekdayFromDateKey(todayKey),
      rule.weekOfMonth,
    )
  }

  return buildDateKeyFromParts(
    year,
    month,
    Math.min(
      rule.dayOfMonth ?? Number(todayKey.slice(8, 10)),
      getDaysInMonth(year, month),
    ),
  )
}

function getNthWeekdayOfMonthDateKey(
  year: number,
  month: number,
  weekday: number,
  weekOfMonth: number,
): string {
  if (weekOfMonth === -1) {
    let day = getDaysInMonth(year, month)

    while (
      getIsoWeekdayFromDateKey(buildDateKeyFromParts(year, month, day)) !==
      weekday
    ) {
      day -= 1
    }

    return buildDateKeyFromParts(year, month, day)
  }

  let day = 1

  while (
    getIsoWeekdayFromDateKey(buildDateKeyFromParts(year, month, day)) !==
    weekday
  ) {
    day += 1
  }

  return buildDateKeyFromParts(
    year,
    month,
    day + (Math.max(1, weekOfMonth) - 1) * 7,
  )
}

function getDateDistanceInDays(startDate: string, endDate: string): number {
  return Math.round(
    (dateKeyToUtcMs(endDate) - dateKeyToUtcMs(startDate)) / DAY_MS,
  )
}

function dateKeyToUtcMs(dateKey: string): number {
  return Date.UTC(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(5, 7)) - 1,
    Number(dateKey.slice(8, 10)),
  )
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function buildDateKeyFromParts(
  year: number,
  month: number,
  day: number,
): string {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-')
}

function getLatestProgressCompletionByItemId(
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined,
): ReadonlyMap<string, SelfCareCompletion> {
  const latestByItemId = new Map<string, SelfCareCompletion>()

  for (const completion of history?.completions ?? []) {
    if (!isProgressCompletionStatus(completion.status)) {
      continue
    }

    const existing = latestByItemId.get(completion.itemId)
    if (!existing || completion.completedAt > existing.completedAt) {
      latestByItemId.set(completion.itemId, completion)
    }
  }

  return latestByItemId
}

function mergeLatestProgressCompletion(
  entry: SelfCareTodayItem,
  latestCompletion: SelfCareCompletion | null,
): SelfCareTodayItem {
  return entry.completion || !latestCompletion
    ? entry
    : { ...entry, completion: latestCompletion }
}

function getNextPlannedDateByItemId(
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined,
  todayKey: string,
): ReadonlyMap<string, string> {
  const nextByItemId = new Map<string, string>()
  const entries = [...(plan?.occurrences ?? [])]
    .filter(
      (entry) =>
        shouldShowPlannedEntry(entry) &&
        entry.occurrence &&
        entry.occurrence.scheduledFor >= todayKey,
    )
    .sort((left, right) =>
      (left.occurrence?.scheduledFor ?? '').localeCompare(
        right.occurrence?.scheduledFor ?? '',
      ),
    )

  for (const entry of entries) {
    const scheduledFor = entry.occurrence?.scheduledFor
    if (scheduledFor && !nextByItemId.has(entry.item.id)) {
      nextByItemId.set(entry.item.id, scheduledFor)
    }
  }

  return nextByItemId
}

function inferNextCompletionDate(input: {
  completion: SelfCareCompletion | null
  scheduleRule: SelfCareScheduleRule | null
  todayKey: string
}): string | null {
  if (
    !input.completion ||
    !isProgressCompletionStatus(input.completion.status) ||
    !input.scheduleRule
  ) {
    return null
  }

  const completedDate = input.completion.completedAt.slice(0, 10)
  const nextDate = addRepeatInterval(completedDate, input.scheduleRule)

  return nextDate && nextDate >= input.todayKey ? nextDate : null
}

function getSelfCareTab(searchParams: URLSearchParams): SelfCareTab {
  const value = searchParams.get('tab')
  return SELF_CARE_TABS.some((tab) => tab.id === value)
    ? (value as SelfCareTab)
    : 'today'
}

function getAddCareFilterCategories(
  value: AddCareTemplateFilter,
): SelfCareCategory[] {
  return (
    ADD_CARE_TEMPLATE_FILTERS.find((filter) => filter.value === value)
      ?.categories ?? []
  )
}

function getAddCareFilterLabel(value: AddCareTemplateFilter): string {
  return (
    ADD_CARE_TEMPLATE_FILTERS.find((filter) => filter.value === value)?.label ??
    'Шаблоны'
  )
}

function getSelfCareCreateDialogMode(
  searchParams: URLSearchParams,
): SelfCareCreateDialogMode | null {
  if (searchParams.get(SELF_CARE_ACTION_SEARCH_PARAM) !== 'care') {
    return null
  }

  const value = searchParams.get(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM)
  if (value === 'custom' || value === 'template') {
    return value
  }

  return 'choice'
}

function firstErrorMessage(errors: unknown[]): string | null {
  const error = errors.find(Boolean)
  return error ? getSelfCareErrorMessage(error) : null
}

function shiftDateKey(dateKey: string, days: number): string {
  return getDateKey(addDays(new Date(`${dateKey}T12:00:00`), days))
}

function getInitialScheduleDate(
  entry: SelfCareTodayItem,
  fallbackDate: string,
): string {
  if (
    entry.occurrence?.scheduledFor &&
    entry.occurrence.scheduledFor >= fallbackDate
  ) {
    return entry.occurrence.scheduledFor
  }

  return entry.appointment?.startsAt.slice(0, 10) ?? fallbackDate
}

function getInitialScheduleTime(entry: SelfCareTodayItem): string {
  if (entry.occurrence?.dueAt) {
    return entry.occurrence.dueAt.slice(11, 16)
  }

  const appointmentTime = entry.appointment?.startsAt.slice(11, 16)
  if (appointmentTime && appointmentTime !== '00:00') {
    return appointmentTime
  }

  return entry.scheduleRule?.preferredTime ?? ''
}

function getInitialEditRepeatMode(
  rule: SelfCareScheduleRule | null,
): SelfCareEditRepeatMode {
  if (rule) {
    return rule.repeatKind
  }

  return 'keep'
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseOptionalPrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseBoundedInteger(
  value: string,
  min: number,
  max: number,
): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

function parseMultilineTitles(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function buildCreateScheduleRule(input: {
  dayOfMonth: number
  daysOfWeek: number[]
  flexiblePeriod: SelfCareFlexiblePeriod
  flexibleTargetCount: number
  intervalUnit: SelfCareIntervalUnit
  intervalValue: number
  monthOfYear: number
  repeatKind: SelfCareCreateRepeatKind
  startDate: string
}): SelfCareCreateScheduleRuleInput {
  const needsInterval = repeatKindRequiresInterval(input.repeatKind)
  const usesDayOfMonth =
    input.repeatKind === 'monthly' || input.repeatKind === 'yearly'

  return {
    allowMultiplePerDay: false,
    dayOfMonth: usesDayOfMonth ? input.dayOfMonth : null,
    daysOfWeek:
      input.repeatKind === 'weekly' || input.repeatKind === 'course'
        ? input.daysOfWeek
        : [],
    endDate: null,
    flexiblePeriod:
      input.repeatKind === 'flexible_goal' ? input.flexiblePeriod : null,
    flexibleTargetCount:
      input.repeatKind === 'flexible_goal' ? input.flexibleTargetCount : null,
    generateInCalendar: false,
    generateInTaskList: true,
    intervalUnit: needsInterval ? input.intervalUnit : null,
    intervalValue: needsInterval ? input.intervalValue : null,
    monthOfYear: input.repeatKind === 'yearly' ? input.monthOfYear : null,
    preferredTime: null,
    reminderOffsetsMinutes: [],
    repeatKind: input.repeatKind,
    startDate: input.startDate,
    timezone: null,
    weekOfMonth: null,
  }
}

function repeatKindRequiresInterval(
  repeatKind: SelfCareCreateRepeatKind,
): boolean {
  return repeatKind === 'after_completion' || repeatKind === 'interval'
}

function toggleWeekday(current: number[], weekday: number): number[] {
  const next = current.includes(weekday)
    ? current.filter((value) => value !== weekday)
    : [...current, weekday]

  return next.sort((left, right) => left - right)
}

function getIsoWeekdayFromDateKey(dateKey: string): number {
  const weekday = new Date(`${dateKey}T12:00:00`).getDay()
  return weekday === 0 ? 7 : weekday
}

function getDatePart(dateKey: string, part: 'day' | 'month'): number {
  return Number(part === 'day' ? dateKey.slice(8, 10) : dateKey.slice(5, 7))
}

function buildDateTimeInput(dateKey: string, time: string | null): string {
  return `${dateKey}T${time ?? '00:00'}:00.000Z`
}

function getCreatedTemplateIds(
  list: SelfCareListResponse | undefined,
): ReadonlySet<string> {
  return new Set(
    (list?.items ?? [])
      .filter((item) => !item.isArchived && item.createdFromTemplateId)
      .map((item) => item.createdFromTemplateId as string),
  )
}

function shouldShowTodayEntry(entry: SelfCareTodayItem): boolean {
  if (entry.item.isArchived || !entry.item.isActive) {
    return false
  }

  if (entry.completion) {
    return false
  }

  if (
    entry.occurrence &&
    HIDDEN_TODAY_OCCURRENCE_STATUSES.has(entry.occurrence.status)
  ) {
    return false
  }

  if (
    entry.flexibleProgress &&
    entry.flexibleProgress.completedCount >= entry.flexibleProgress.targetCount
  ) {
    return false
  }

  return true
}

function shouldShowPlannedEntry(entry: SelfCareTodayItem): boolean {
  if (entry.item.isArchived || !entry.item.isActive) {
    return false
  }

  if (entry.completion) {
    return false
  }

  return entry.occurrence
    ? !HIDDEN_TODAY_OCCURRENCE_STATUSES.has(entry.occurrence.status)
    : true
}

function isClosedTodayEntry(entry: SelfCareTodayItem): boolean {
  if (entry.completion) {
    return true
  }

  if (
    entry.occurrence &&
    HIDDEN_TODAY_OCCURRENCE_STATUSES.has(entry.occurrence.status)
  ) {
    return true
  }

  return Boolean(
    entry.flexibleProgress &&
    entry.flexibleProgress.completedCount >= entry.flexibleProgress.targetCount,
  )
}

function getPlannedEntriesCountForDate(
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined,
  dateKey: string,
): number | null {
  if (!plan) {
    return null
  }

  return plan.occurrences.filter(
    (entry) =>
      shouldShowPlannedEntry(entry) &&
      entry.occurrence?.scheduledFor === dateKey,
  ).length
}

function formatSchedule(rule: SelfCareScheduleRule | null): string {
  if (!rule) {
    return 'по необходимости'
  }

  if (
    rule.repeatKind === 'flexible_goal' &&
    rule.flexibleTargetCount &&
    rule.flexiblePeriod
  ) {
    const period =
      rule.flexiblePeriod === 'week'
        ? 'неделю'
        : rule.flexiblePeriod === 'month'
          ? 'месяц'
          : 'день'
    return `${rule.flexibleTargetCount} раза за ${period}`
  }

  if (
    (rule.repeatKind === 'interval' ||
      rule.repeatKind === 'after_completion') &&
    rule.intervalValue &&
    rule.intervalUnit
  ) {
    return `каждые ${rule.intervalValue} ${formatIntervalUnit(rule.intervalUnit)}`
  }

  return REPEAT_LABELS[rule.repeatKind]
}

function formatIntervalUnit(
  unit: NonNullable<SelfCareScheduleRule['intervalUnit']>,
): string {
  if (unit === 'day') return 'дн.'
  if (unit === 'week') return 'нед.'
  if (unit === 'month') return 'мес.'
  return 'г.'
}

function getTypeLabel(item: SelfCareItem): string {
  if (item.type === 'habit') return 'регулярная забота'
  if (item.type === 'flexible_goal') return 'цель на период'
  if (item.type === 'mood_check') return 'состояние'
  if (item.type === 'rest_action') return 'восстановление'
  if (item.type === 'medical') return 'медицинское'
  if (item.type === 'appointment') return 'запись'
  if (item.type === 'procedure') return 'процедура'
  if (item.type === 'course') return 'курс'
  if (item.type === 'ritual') return 'ритуал'
  if (item.type === 'measurement') return 'измерение'
  return 'задача'
}

function getTemplateTypeLabel(template: SelfCareTemplate): string {
  if (template.type === 'habit') return 'регулярная забота'
  if (template.type === 'flexible_goal') return 'цель'
  return getTypeLabel(template as unknown as SelfCareItem)
}

function formatDate(dateKey: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(new Date(`${dateKey}T12:00:00`))
}

function formatTime(value: string): string {
  return value.slice(11, 16)
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    currency: 'RUB',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(value)
}

function formatEntryDetails(entry: SelfCareTodayItem): string | null {
  const parts = [
    entry.appointment?.place ?? entry.procedure?.place,
    entry.appointment?.specialistName ?? entry.procedure?.specialistName,
    entry.appointment?.price !== null && entry.appointment?.price !== undefined
      ? formatMoney(entry.appointment.price)
      : entry.procedure?.defaultPrice !== null &&
          entry.procedure?.defaultPrice !== undefined
        ? formatMoney(entry.procedure.defaultPrice)
        : null,
  ].filter(Boolean)

  return parts.length ? parts.join(' · ') : null
}

function formatCompletionState(
  completion: SelfCareCompletion | null,
  todayKey: string,
): string | null {
  if (!completion || !isProgressCompletionStatus(completion.status)) {
    return null
  }

  const completionDate = completion.completedAt.slice(0, 10)
  const label =
    completion.status === 'alternative_done'
      ? 'Минимальная версия'
      : completion.status === 'partial'
        ? 'Частично выполнено'
        : 'Выполнено'

  return completionDate === todayKey
    ? `${label} сегодня`
    : `${label}: ${formatDate(completionDate)}`
}

function formatCourseCompletionState(
  entry: SelfCareTodayItem,
  todayKey: string,
): string | null {
  const course = entry.courseDetails

  if (!course) {
    return formatCompletionState(entry.completion, todayKey)
  }

  if (course.isCompleted) {
    return 'Курс завершён'
  }

  if (!isCompletionDoneToday(entry.completion, todayKey)) {
    return null
  }

  return course.courseType === 'sessions'
    ? 'Сессия засчитана сегодня'
    : 'Сегодня засчитано'
}

function isEntryDoneToday(entry: SelfCareTodayItem, todayKey: string): boolean {
  if (entry.item.type === 'course') {
    if (entry.courseDetails?.isCompleted) {
      return true
    }

    if (
      entry.courseDetails?.courseType === 'sessions' ||
      entry.scheduleRule?.allowMultiplePerDay
    ) {
      return false
    }

    return (
      isCompletionDoneToday(entry.completion, todayKey) ||
      isOccurrenceDoneToday(entry.occurrence, todayKey)
    )
  }

  if (isCompletionDoneToday(entry.completion, todayKey)) {
    return true
  }

  return isOccurrenceDoneToday(entry.occurrence, todayKey)
}

function isCompletionDoneToday(
  completion: SelfCareCompletion | null,
  todayKey: string,
): boolean {
  return Boolean(
    completion &&
    isProgressCompletionStatus(completion.status) &&
    completion.completedAt.slice(0, 10) === todayKey,
  )
}

function isOccurrenceDoneToday(
  occurrence: SelfCareTodayItem['occurrence'],
  todayKey: string,
): boolean {
  if (!occurrence) {
    return false
  }

  return (
    (occurrence.status === 'done' || occurrence.status === 'partial') &&
    (occurrence.completedAt?.slice(0, 10) ?? occurrence.scheduledFor) ===
      todayKey
  )
}

function getPrimaryActionLabel(
  entry: SelfCareTodayItem,
  isDone: boolean,
): string {
  if (entry.item.type !== 'course') {
    return isDone ? 'Готово' : 'Выполнить'
  }

  if (entry.courseDetails?.isCompleted) {
    return 'Курс завершён'
  }

  if (isDone && entry.courseDetails?.courseType !== 'sessions') {
    return 'Сегодня засчитано'
  }

  return entry.courseDetails?.courseType === 'sessions'
    ? 'Засчитать сессию'
    : 'Засчитать день'
}

function getCourseProgress(course: SelfCareCourseDetails | null): {
  ariaLabel: string
  label: string
  meta: string
  percent: number
} | null {
  if (!course) {
    return null
  }

  const totalCount = Math.max(1, course.totalCount)
  const completedCount = Math.min(course.completedCount, totalCount)
  const remainingCount = Math.max(0, totalCount - completedCount)
  const totalUnit = getCourseUnitLabel(course.courseType, totalCount)
  const remainingUnit = getCourseUnitLabel(course.courseType, remainingCount)
  const percent = Math.round((completedCount / totalCount) * 100)
  const label = `Курс: ${completedCount} из ${totalCount} ${totalUnit}`
  const meta = course.isCompleted
    ? 'Все итерации курса засчитаны'
    : `Осталось ${remainingCount} ${remainingUnit}`

  return {
    ariaLabel: `${label}. ${meta}`,
    label,
    meta,
    percent,
  }
}

function getCourseUnitLabel(
  courseType: SelfCareCourseDetails['courseType'],
  count: number,
): string {
  return courseType === 'sessions'
    ? pluralRu(count, 'сессия', 'сессии', 'сессий')
    : pluralRu(count, 'день', 'дня', 'дней')
}

function pluralRu(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const abs = Math.abs(count)
  const lastTwo = abs % 100
  const last = abs % 10

  if (lastTwo >= 11 && lastTwo <= 14) {
    return many
  }

  if (last === 1) {
    return one
  }

  if (last >= 2 && last <= 4) {
    return few
  }

  return many
}

function isProgressCompletionStatus(
  status: SelfCareCompletion['status'],
): boolean {
  return (
    status === 'done' || status === 'partial' || status === 'alternative_done'
  )
}

function addRepeatInterval(
  dateKey: string,
  rule: SelfCareScheduleRule,
): string | null {
  if (rule.repeatKind === 'none' || rule.repeatKind === 'flexible_goal') {
    return null
  }

  if (rule.repeatKind === 'daily') {
    return shiftDateKey(dateKey, rule.intervalValue ?? 1)
  }

  if (rule.repeatKind === 'weekly') {
    return shiftDateKey(dateKey, (rule.intervalValue ?? 1) * 7)
  }

  if (rule.repeatKind === 'monthly') {
    return shiftMonthKey(dateKey, rule.intervalValue ?? 1)
  }

  if (rule.repeatKind === 'yearly') {
    return shiftMonthKey(dateKey, (rule.intervalValue ?? 1) * 12)
  }

  if (rule.repeatKind === 'course') {
    return rule.intervalUnit
      ? addIntervalDateKey(dateKey, rule.intervalValue ?? 1, rule.intervalUnit)
      : shiftDateKey(dateKey, 1)
  }

  return addIntervalDateKey(
    dateKey,
    rule.intervalValue ?? 1,
    rule.intervalUnit ?? 'month',
  )
}

function addIntervalDateKey(
  dateKey: string,
  value: number,
  unit: SelfCareIntervalUnit,
): string {
  if (unit === 'day') return shiftDateKey(dateKey, value)
  if (unit === 'week') return shiftDateKey(dateKey, value * 7)
  if (unit === 'month') return shiftMonthKey(dateKey, value)
  return shiftMonthKey(dateKey, value * 12)
}

function shiftMonthKey(dateKey: string, months: number): string {
  const year = Number(dateKey.slice(0, 4))
  const month = Number(dateKey.slice(5, 7))
  const day = Number(dateKey.slice(8, 10))
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const targetYear = target.getUTCFullYear()
  const targetMonth = target.getUTCMonth() + 1
  const lastTargetDay = new Date(
    Date.UTC(targetYear, targetMonth, 0),
  ).getUTCDate()

  return [
    String(targetYear).padStart(4, '0'),
    String(targetMonth).padStart(2, '0'),
    String(Math.min(day, lastTargetDay)).padStart(2, '0'),
  ].join('-')
}

function formatPlanningText(entry: SelfCareTodayItem): string {
  if (entry.flexibleProgress) {
    return `Осталось ${entry.flexibleProgress.remainingCount} до цели периода. Можно добавить короткую версию.`
  }

  if (entry.occurrence) {
    return `${formatDate(entry.occurrence.scheduledFor)}${entry.occurrence.dueAt ? ` · ${formatTime(entry.occurrence.dueAt)}` : ''}`
  }

  if (entry.scheduleRule?.repeatKind === 'after_completion') {
    return 'Давно не обновлялось. Можно выбрать дату и детали нового визита.'
  }

  return 'Можно выбрать дату, время и детали записи.'
}

function formatTomorrowPlanSummary(count: number | null): string {
  if (count === null) {
    return 'План загружается'
  }

  if (count === 0) {
    return 'Пока ничего не запланировано'
  }

  return `${count} ${pluralizeRu(count, 'ритуал', 'ритуала', 'ритуалов')} запланировано`
}

function pluralizeRu(
  value: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = value % 10
  const mod100 = value % 100

  if (mod10 === 1 && mod100 !== 11) {
    return one
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few
  }

  return many
}
