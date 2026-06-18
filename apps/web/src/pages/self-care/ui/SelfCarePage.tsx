import type {
  SelfCareCategory,
  SelfCareCompletion,
  SelfCareCompletionInput,
  SelfCareCourseDetails,
  SelfCareFlexiblePeriod,
  SelfCareIntervalUnit,
  SelfCareItem,
  SelfCareItemInput,
  SelfCareItemScheduleInput,
  SelfCareItemType,
  SelfCareItemUpdateInput,
  SelfCareListResponse,
  SelfCareRepeatKind,
  SelfCareRitualStepDraftInput,
  SelfCareRitualStepDraftListResponse,
  SelfCareScheduleRule,
  SelfCareSettingsUpdateInput,
  SelfCareTemplate,
  SelfCareTimeOfDay,
  SelfCareTodayItem,
} from '@planner/contracts'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'

import { useUploadedIconAssets } from '@/features/emoji-library'
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
  useSelfCareRitualStepDrafts,
  useSelfCareSettings,
  useSelfCareTemplates,
  useUpdateSelfCareItem,
  useUpdateSelfCareSettings,
  useUpsertSelfCareRitualStepDraft,
} from '@/features/self-care'
import { cx } from '@/shared/lib/classnames'
import { addDays, getDateKey } from '@/shared/lib/date'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  GearIcon,
  getIconLabel,
  IconChoicePicker,
  IconMark,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { SelectPicker, type SelectPickerOption } from '@/shared/ui/SelectPicker'

import styles from './SelfCarePage.module.css'

type SelfCareTab =
  | 'today'
  | 'plan'
  | 'rituals'
  | 'history'
  | 'analytics'
  | 'settings'

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
type SelfCareEditSubmitPayload = {
  input: SelfCareItemUpdateInput
  scheduleInput?: SelfCareItemScheduleInput | undefined
}
type SelfCareSettingsPatch = SelfCareSettingsUpdateInput
type AddCareTemplateFilter = 'beauty' | 'health' | 'movement' | 'rest'
type RitualStepDrafts = Record<string, readonly string[]>
type RitualStepDraftOverrides = Record<string, readonly string[] | null>

const TYPES_WITH_EXACT_SCHEDULE: ReadonlySet<SelfCareItemType> = new Set([
  'appointment',
  'medical',
  'measurement',
  'mood_check',
  'procedure',
  'rest_action',
  'task',
])

const HIDDEN_TODAY_OCCURRENCE_STATUSES: ReadonlySet<
  NonNullable<SelfCareTodayItem['occurrence']>['status']
> = new Set(['cancelled', 'done', 'missed', 'moved', 'partial', 'skipped'])
const DAY_MS = 86_400_000
const SELF_CARE_PLAN_LOOKAHEAD_DAYS = 45

const SELF_CARE_TABS: Array<{ id: SelfCareTab; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: 'plan', label: 'План' },
  { id: 'rituals', label: 'Все заботы' },
  { id: 'history', label: 'История' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'settings', label: 'Настройки' },
]

const CATEGORY_LABELS: Record<SelfCareCategory, string> = {
  beauty: 'Уход',
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

const CATEGORY_SELECT_OPTIONS: Array<SelectPickerOption<SelfCareCategory>> = (
  Object.entries(CATEGORY_LABELS) as Array<[SelfCareCategory, string]>
).map(([value, label]) => ({ label, value }))

const TIME_GROUP_LABELS: Record<SelfCareTimeOfDay, string> = {
  afternoon: 'День',
  anytime: 'В любое время',
  evening: 'Вечер',
  morning: 'Утро',
  night: 'Ночь',
}

const TIME_GROUP_SELECT_OPTIONS: Array<SelectPickerOption<SelfCareTimeOfDay>> =
  (Object.entries(TIME_GROUP_LABELS) as Array<[SelfCareTimeOfDay, string]>).map(
    ([value, label]) => ({ label, value }),
  )

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
  alternative_done: 'частично выполнено',
  cancelled: 'отменено',
  done: 'выполнено',
  moved: 'перенесено',
  partial: 'частично',
  skipped: 'мягко пропущено',
}

const STATE_RATING_VALUES = [1, 2, 3, 4, 5] as const
const MOOD_RATING_LABELS: Record<(typeof STATE_RATING_VALUES)[number], string> =
  {
    1: 'Очень тяжело',
    2: 'Тяжело',
    3: 'Нейтрально',
    4: 'Хорошо',
    5: 'Отлично',
  }
const ENERGY_RATING_LABELS: Record<
  (typeof STATE_RATING_VALUES)[number],
  string
> = {
  1: 'Нет сил',
  2: 'Мало',
  3: 'Нормально',
  4: 'Много',
  5: 'Очень много',
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
    description: 'Стрижка, массаж, уход или другая регулярная запись.',
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
    description: 'Числовой показатель: вес, пульс, температура, объем.',
    label: 'Измерение',
    value: 'measurement',
  },
]

const CREATE_TYPE_SELECT_OPTIONS: Array<SelectPickerOption<SelfCareItemType>> =
  CREATE_TYPE_OPTIONS.map(({ label, value }) => ({ label, value }))

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

const CREATE_REPEAT_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareCreateRepeatKind>
> = CREATE_REPEAT_OPTIONS.map(({ label, value }) => ({ label, value }))

const INTERVAL_UNIT_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareIntervalUnit
}> = [
  { label: 'дней', value: 'day' },
  { label: 'недель', value: 'week' },
  { label: 'месяцев', value: 'month' },
  { label: 'лет', value: 'year' },
]

const INTERVAL_UNIT_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareIntervalUnit>
> = INTERVAL_UNIT_OPTIONS.map(({ label, value }) => ({ label, value }))

const FLEXIBLE_PERIOD_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareFlexiblePeriod
}> = [
  { label: 'день', value: 'day' },
  { label: 'неделю', value: 'week' },
  { label: 'месяц', value: 'month' },
]

const FLEXIBLE_PERIOD_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareFlexiblePeriod>
> = FLEXIBLE_PERIOD_OPTIONS.map(({ label, value }) => ({ label, value }))

const COURSE_TYPE_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareCourseType
}> = [
  { label: 'дней', value: 'days' },
  { label: 'сессий', value: 'sessions' },
]

const COURSE_TYPE_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareCourseType>
> = COURSE_TYPE_OPTIONS.map(({ label, value }) => ({ label, value }))

const WEEKDAY_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Пн', value: 1 },
  { label: 'Вт', value: 2 },
  { label: 'Ср', value: 3 },
  { label: 'Чт', value: 4 },
  { label: 'Пт', value: 5 },
  { label: 'Сб', value: 6 },
  { label: 'Вс', value: 7 },
]

const EVERY_WEEKDAY_VALUES = WEEKDAY_OPTIONS.map(({ value }) => value)
const WORKDAY_VALUES = [1, 2, 3, 4, 5] as const

const ADD_CARE_TEMPLATE_FILTERS: ReadonlyArray<{
  categories: SelfCareCategory[]
  label: string
  tileClassName: string | undefined
  value: AddCareTemplateFilter
}> = [
  {
    categories: ['beauty'],
    label: 'Уход',
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
const SELF_CARE_ICON_PICKER_OPEN_DATA_KEY = 'selfCareIconPickerOpen'

function isSelfCareIconPickerOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY] === 'true'
  )
}

export function SelfCarePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const todayKey = getDateKey(new Date())
  const rangeFrom = getDateKey(addDays(new Date(), -30))
  const planTo = getDateKey(addDays(new Date(), SELF_CARE_PLAN_LOOKAHEAD_DAYS))
  const activeTab = getSelfCareTab(searchParams)
  const createDialogMode = getSelfCareCreateDialogMode(searchParams)
  const tabsRef = useRef<HTMLElement | null>(null)
  const { uploadedIcons } = useUploadedIconAssets()
  const shouldLoadDashboard = activeTab === 'today' || activeTab === 'rituals'
  const shouldLoadItems =
    activeTab === 'today' ||
    activeTab === 'rituals' ||
    activeTab === 'settings' ||
    Boolean(createDialogMode)
  const shouldLoadPlan =
    activeTab === 'today' || activeTab === 'plan' || activeTab === 'rituals'
  const shouldLoadHistory =
    activeTab === 'today' ||
    activeTab === 'plan' ||
    activeTab === 'rituals' ||
    activeTab === 'history'
  const shouldLoadRitualStepDrafts =
    activeTab === 'today' || activeTab === 'rituals'
  const shouldLoadSettings =
    activeTab === 'settings' || Boolean(createDialogMode)
  const shouldLoadTemplates =
    activeTab === 'settings' || Boolean(createDialogMode)
  const dashboardQuery = useSelfCareDashboard(todayKey, {
    enabled: shouldLoadDashboard,
  })
  const itemsQuery = useSelfCareItems({ enabled: shouldLoadItems })
  const planQuery = useSelfCarePlan(todayKey, planTo, {
    enabled: shouldLoadPlan,
  })
  const stepDraftsQuery = useSelfCareRitualStepDrafts(todayKey, {
    enabled: shouldLoadRitualStepDrafts,
  })
  const historyQuery = useSelfCareHistory(rangeFrom, todayKey, {
    enabled: shouldLoadHistory,
  })
  const analyticsQuery = useSelfCareAnalytics(rangeFrom, todayKey, {
    enabled: activeTab === 'analytics',
  })
  const settingsQuery = useSelfCareSettings({ enabled: shouldLoadSettings })
  const templatesQuery = useSelfCareTemplates({ enabled: shouldLoadTemplates })
  const completeOccurrenceMutation = useCompleteSelfCareOccurrence()
  const completeItemNowMutation = useCompleteSelfCareItemNow()
  const completeFlexibleGoalMutation = useCompleteSelfCareFlexibleGoal()
  const completeCourseMutation = useCompleteSelfCareCourseSession()
  const cancelOccurrenceMutation = useCancelSelfCareOccurrence()
  const archiveItemMutation = useArchiveSelfCareItem()
  const scheduleItemMutation = useScheduleSelfCareItem()
  const moveOccurrenceMutation = useMoveSelfCareOccurrence()
  const createItemMutation = useCreateSelfCareItem()
  const createFromTemplateMutation = useCreateSelfCareItemFromTemplate()
  const updateItemMutation = useUpdateSelfCareItem()
  const updateSettingsMutation = useUpdateSelfCareSettings()
  const upsertRitualStepDraftMutation = useUpsertSelfCareRitualStepDraft()
  const [formError, setFormError] = useState<string | null>(null)
  const [scheduleDialogEntry, setScheduleDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [editDialogEntry, setEditDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [measurementDialogEntry, setMeasurementDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [moodDialogEntry, setMoodDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [scheduleDate, setScheduleDate] = useState(todayKey)
  const [hiddenScheduledItemIds, setHiddenScheduledItemIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [creatingTemplateIds, setCreatingTemplateIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [ritualStepDraftOverrides, setRitualStepDraftOverrides] =
    useState<RitualStepDraftOverrides>({})
  const dashboard = dashboardQuery.data
  const list = itemsQuery.data
  const plan = planQuery.data
  const history = historyQuery.data
  const analytics = analyticsQuery.data
  const settingsResponse =
    settingsQuery.data ??
    (dashboard ? { minimumItems: [], settings: dashboard.settings } : undefined)
  const defaultCurrency = settingsResponse?.settings.currency ?? 'RUB'
  const templates = templatesQuery.data ?? []
  const isActiveTabLoading =
    (activeTab === 'today' && dashboardQuery.isLoading && !dashboard) ||
    (activeTab === 'plan' && planQuery.isLoading && !plan) ||
    (activeTab === 'rituals' && itemsQuery.isLoading && !list) ||
    (activeTab === 'history' && historyQuery.isLoading && !history) ||
    (activeTab === 'analytics' && analyticsQuery.isLoading && !analytics) ||
    (activeTab === 'settings' && settingsQuery.isLoading && !settingsResponse)
  const serverRitualStepDrafts = useMemo(
    () =>
      stepDraftsQuery.data ? buildRitualStepDraftMap(stepDraftsQuery.data) : {},
    [stepDraftsQuery.data],
  )
  const ritualStepDrafts = useMemo(
    () =>
      applyRitualStepDraftOverrides(
        serverRitualStepDrafts,
        ritualStepDraftOverrides,
      ),
    [ritualStepDraftOverrides, serverRitualStepDrafts],
  )
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
      stepDraftsQuery.error,
      historyQuery.error,
      analyticsQuery.error,
      settingsQuery.error,
      templatesQuery.error,
      completeOccurrenceMutation.error,
      completeItemNowMutation.error,
      completeFlexibleGoalMutation.error,
      completeCourseMutation.error,
      cancelOccurrenceMutation.error,
      archiveItemMutation.error,
      scheduleItemMutation.error,
      moveOccurrenceMutation.error,
      createItemMutation.error,
      createFromTemplateMutation.error,
      updateItemMutation.error,
      updateSettingsMutation.error,
      upsertRitualStepDraftMutation.error,
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

    const shouldSchedule = Boolean(payload.scheduleInput)
    void createItemMutation
      .mutateAsync({
        input: payload.input,
        skipInvalidation: shouldSchedule,
      })
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

  async function handleUpdateSettings(
    input: SelfCareSettingsPatch,
  ): Promise<void> {
    setFormError(null)

    try {
      await updateSettingsMutation.mutateAsync(input)
    } catch (error: unknown) {
      setFormError(getSelfCareErrorMessage(error))
      throw error
    }
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

  function handleUpdateItem(payload: SelfCareEditSubmitPayload): void {
    if (!editDialogEntry) {
      return
    }

    const entry = editDialogEntry
    setFormError(null)
    void (async () => {
      await updateItemMutation.mutateAsync({
        input: payload.input,
        itemId: entry.item.id,
        skipInvalidation: Boolean(payload.scheduleInput),
      })

      if (payload.scheduleInput) {
        await scheduleItemMutation.mutateAsync({
          input: payload.scheduleInput,
          itemId: entry.item.id,
        })
      }
    })()
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

  function closeMeasurementDialog(): void {
    setFormError(null)
    setMeasurementDialogEntry(null)
  }

  function closeMoodDialog(): void {
    setFormError(null)
    setMoodDialogEntry(null)
  }

  function handleScheduleSubmit(input: SelfCareItemScheduleInput): void {
    if (!scheduleDialogEntry) {
      return
    }

    const entry = scheduleDialogEntry
    const occurrence = entry.occurrence
    const shouldMoveOverdue = occurrence
      ? occurrence.scheduledFor < todayKey &&
        input.scheduledFor !== occurrence.scheduledFor
      : false
    setFormError(null)
    void scheduleItemMutation
      .mutateAsync({
        input,
        itemId: entry.item.id,
        skipInvalidation: shouldMoveOverdue,
      })
      .then(async () => {
        if (occurrence && shouldMoveOverdue) {
          await moveOccurrenceMutation.mutateAsync({
            invalidationScopes: [
              'dashboard',
              'items',
              'plan',
              'history',
              'analytics',
            ],
            input: {
              newDate: input.scheduledFor,
              note: 'Перенесено из просроченного плана.',
            },
            occurrenceId: occurrence.id,
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

  function handleMeasurementSubmit(input: SelfCareCompletionInput): void {
    if (!measurementDialogEntry) {
      return
    }

    const entry = measurementDialogEntry
    setFormError(null)

    void (async () => {
      if (entry.occurrence) {
        await completeOccurrenceMutation.mutateAsync({
          input: { ...input, steps: [] },
          occurrenceId: entry.occurrence.id,
        })
        return
      }

      await completeItemNowMutation.mutateAsync({
        input: { ...input, steps: [] },
        itemId: entry.item.id,
      })
    })()
      .then(() => {
        closeMeasurementDialog()
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleMoodSubmit(input: SelfCareCompletionInput): void {
    if (!moodDialogEntry) {
      return
    }

    const entry = moodDialogEntry
    setFormError(null)

    void (async () => {
      if (entry.occurrence) {
        await completeOccurrenceMutation.mutateAsync({
          input: { ...input, steps: [] },
          occurrenceId: entry.occurrence.id,
        })
        return
      }

      await completeItemNowMutation.mutateAsync({
        input: { ...input, steps: [] },
        itemId: entry.item.id,
      })
    })()
      .then(() => {
        closeMoodDialog()
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
    const selectedStepIds = new Set(
      ritualStepDrafts[draftKey] ?? getInitialRitualStepDraft(entry),
    )

    if (selectedStepIds.has(stepId)) {
      selectedStepIds.delete(stepId)
    } else {
      selectedStepIds.add(stepId)
    }

    const stepIds = [...selectedStepIds]

    setRitualStepDraftOverrides((current) => {
      return { ...current, [draftKey]: stepIds }
    })
    void upsertRitualStepDraftMutation
      .mutateAsync(buildRitualStepDraftInput(entry, todayKey, stepIds))
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function clearRitualStepDraft(entry: SelfCareTodayItem): void {
    const draftKey = getRitualStepDraftKey(entry, todayKey)

    setRitualStepDraftOverrides((current) => {
      if (current[draftKey] === null) {
        return current
      }

      return { ...current, [draftKey]: null }
    })
  }

  function handleCardAction(entry: SelfCareTodayItem): void {
    setFormError(null)

    if (entry.item.type === 'measurement') {
      setMeasurementDialogEntry(entry)
      return
    }

    if (entry.item.type === 'mood_check') {
      setMoodDialogEntry(entry)
      return
    }

    void (async () => {
      const input = buildCompletionInput(entry)
      const ritualSteps = buildRitualStepCompletionInput(
        entry,
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

  useEffect(() => {
    const activeTabButton = tabsRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    )

    activeTabButton?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTab])

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

      <nav
        ref={tabsRef}
        className={styles.tabs}
        aria-label="Разделы заботы о себе"
      >
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

      {isActiveTabLoading ? (
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
          uploadedIcons={uploadedIcons}
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
          uploadedIcons={uploadedIcons}
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
          uploadedIcons={uploadedIcons}
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
        <SelfCareAnalyticsTab
          analytics={analytics}
          defaultCurrency={defaultCurrency}
        />
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
          defaultCurrency={defaultCurrency}
          errorMessage={errorMessage}
          disabledTemplateIds={disabledTemplateIds}
          isBusy={isActionBusy || !list}
          todayKey={todayKey}
          templates={templates}
          uploadedIcons={uploadedIcons}
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
          defaultCurrency={defaultCurrency}
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

      {measurementDialogEntry ? (
        <SelfCareMeasurementDialog
          entry={measurementDialogEntry}
          errorMessage={formError}
          isBusy={
            completeOccurrenceMutation.isPending ||
            completeItemNowMutation.isPending
          }
          onClose={closeMeasurementDialog}
          onSubmit={handleMeasurementSubmit}
        />
      ) : null}

      {moodDialogEntry ? (
        <SelfCareMoodDialog
          entry={moodDialogEntry}
          errorMessage={formError}
          isBusy={
            completeOccurrenceMutation.isPending ||
            completeItemNowMutation.isPending
          }
          onClose={closeMoodDialog}
          onSubmit={handleMoodSubmit}
        />
      ) : null}

      {editDialogEntry ? (
        <SelfCareEditDialog
          defaultCurrency={defaultCurrency}
          entry={editDialogEntry}
          errorMessage={formError}
          isBusy={updateItemMutation.isPending}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
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
  uploadedIcons,
  onToggleRitualStep,
}: {
  dashboard: ReturnType<typeof useSelfCareDashboard>['data'] | undefined
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  hiddenScheduledItemIds: ReadonlySet<string>
  isBusy: boolean
  list: SelfCareListResponse | undefined
  onAddCare: () => void
  onCardAction: (entry: SelfCareTodayItem) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
  onScheduleItem: (entry: SelfCareTodayItem) => void
  onShowHistory: () => void
  onShowPlan: () => void
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  ritualStepDrafts: RitualStepDrafts
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
  onToggleRitualStep: (entry: SelfCareTodayItem, stepId: string) => void
}) {
  const latestCompletionByItemId = useMemo(
    () => getLatestProgressCompletionByItemId(history),
    [history],
  )
  const nextPlannedDateByItemId = useMemo(
    () => getNextPlannedDateByItemId(plan, todayKey),
    [plan, todayKey],
  )

  if (!dashboard) {
    return <div className={styles.tabPanel} />
  }

  const dashboardTodayItems = dashboard.todayItems
  const dashboardFlexibleGoals = dashboard.flexibleGoals
  const overdueItems = dashboard.overdueItems.filter(shouldShowTodayEntry)
  const todayItems = dashboardTodayItems.filter(shouldShowTodayEntry)
  const flexibleGoals = dashboardFlexibleGoals.filter(shouldShowTodayEntry)
  const courseEntries = (plan?.courses ?? [])
    .map((entry) =>
      mergeLatestProgressCompletion(
        entry,
        latestCompletionByItemId.get(entry.item.id) ?? null,
      ),
    )
    .filter((entry) =>
      shouldShowCourseInToday(
        entry,
        todayKey,
        nextPlannedDateByItemId.get(entry.item.id),
      ),
    )
  const availableTodayEntries = buildAvailableTodayEntries({
    dashboard,
    history,
    list,
    plan,
    todayKey,
  }).filter((entry) => entry.item.type !== 'course')
  const planningHints = dashboard.planningHints.filter(
    (entry) => !hiddenScheduledItemIds.has(entry.item.id),
  )
  const groupedItems = groupTodayItems(todayItems)
  const hasVisibleTodayContent =
    overdueItems.length > 0 ||
    todayItems.length > 0 ||
    courseEntries.length > 0 ||
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
              isTodayView
              isBusy={isBusy}
              scheduleActionLabel="Перенести"
              stepDraft={getRitualStepDraft(ritualStepDrafts, entry, todayKey)}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onSchedule={onScheduleItem}
              onToggleStep={onToggleRitualStep}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {courseEntries.length ? (
        <SelfCareSection title="Курсы">
          {courseEntries.map((entry) => (
            <SelfCareItemCard
              key={`today-course-${entry.item.id}`}
              entry={entry}
              isTodayView
              isBusy={isBusy}
              nextOccurrenceDate={nextPlannedDateByItemId.get(entry.item.id)}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
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
                  isTodayView
                  isBusy={isBusy}
                  stepDraft={getRitualStepDraft(
                    ritualStepDrafts,
                    entry,
                    todayKey,
                  )}
                  uploadedIcons={uploadedIcons}
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
              isTodayView
              isBusy={isBusy}
              stepDraft={getRitualStepDraft(ritualStepDrafts, entry, todayKey)}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onToggleStep={onToggleRitualStep}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {flexibleGoals.length ? (
        <SelfCareSection title="Гибкие цели">
          {flexibleGoals.map((entry) => (
            <SelfCareItemCard
              key={`goal-${entry.item.id}`}
              entry={entry}
              isTodayView
              isBusy={isBusy}
              uploadedIcons={uploadedIcons}
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
              isTodayView
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
                  ? 'Всё запланированное на сегодня уже выполнено. Можно ничего не добавлять — отдых тоже часть заботы.'
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
  uploadedIcons,
}: {
  hiddenScheduledItemIds: ReadonlySet<string>
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  isBusy: boolean
  onCardAction: (entry: SelfCareTodayItem) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onCancelOccurrence: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
  onScheduleItem: (entry: SelfCareTodayItem) => void
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const latestCompletionByItemId = useMemo(
    () => getLatestProgressCompletionByItemId(history),
    [history],
  )
  const nextPlannedDateByItemId = useMemo(
    () => getNextPlannedDateByItemId(plan, todayKey),
    [plan, todayKey],
  )
  const occurrences = getPlanOccurrenceEntries(plan, todayKey)
  const courseEntries = (plan?.courses ?? []).map((entry) =>
    mergeLatestProgressCompletion(
      entry,
      latestCompletionByItemId.get(entry.item.id) ?? null,
    ),
  )
  const planningHints = (plan?.planningHints ?? []).filter(
    (entry) => !hiddenScheduledItemIds.has(entry.item.id),
  )
  const medicalEntries = plan?.medical ?? []
  const hasPlanContent =
    occurrences.length > 0 ||
    planningHints.length > 0 ||
    medicalEntries.length > 0 ||
    courseEntries.length > 0

  return (
    <div className={styles.tabPanel}>
      {occurrences.length ? (
        <SelfCareSection title="Записи и задачи">
          {occurrences.slice(0, 18).map((entry) => (
            <SelfCareItemCard
              actions="plan"
              key={entry.occurrence?.id ?? entry.item.id}
              entry={entry}
              isBusy={isBusy}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onCancelOccurrence={onCancelOccurrence}
              onEdit={onEditItem}
            />
          ))}
        </SelfCareSection>
      ) : !hasPlanContent ? (
        <section className={styles.emptyPanel}>
          На ближайшие даты пока ничего не запланировано.
        </section>
      ) : null}

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

      {medicalEntries.length ? (
        <SelfCareSection title="Медицинское">
          {medicalEntries.map((entry) => (
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
              uploadedIcons={uploadedIcons}
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
  uploadedIcons,
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
  uploadedIcons: UploadedIconAsset[]
  onCardAction: (entry: SelfCareTodayItem) => void
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
                  uploadedIcons={uploadedIcons}
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
              {completion.measurementValue !== null ? (
                <p className={styles.measurementHistoryValue}>
                  {formatMeasurementValue(
                    completion.measurementValue,
                    completion.measurementUnit,
                  )}
                </p>
              ) : null}
              {formatStateCompletionSummary(completion) ? (
                <p className={styles.stateHistoryValue}>
                  {formatStateCompletionSummary(completion)}
                </p>
              ) : null}
              {completion.note ? (
                <p className={styles.noteText}>{completion.note}</p>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

type SelfCareAnalyticsData = NonNullable<
  ReturnType<typeof useSelfCareAnalytics>['data']
>

function SelfCareAnalyticsTab({
  analytics,
  defaultCurrency,
}: {
  analytics: ReturnType<typeof useSelfCareAnalytics>['data'] | undefined
  defaultCurrency: string
}) {
  const categoryDistribution = Object.entries(
    analytics?.balanceByCategory ?? {},
  )
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
  const categoryTotal = categoryDistribution.reduce(
    (total, [, count]) => total + count,
    0,
  )
  const procedureCostsByMonth = Object.entries(
    analytics?.procedureCostsByMonth ?? {},
  )
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[0].localeCompare(left[0]))
    .slice(0, 6)
  const measurementTrends = analytics?.measurementTrends ?? []

  return (
    <div className={styles.tabPanel}>
      <section className={styles.analyticsHero}>
        <div>
          <p>За выбранный период</p>
          <span>Отметок заботы</span>
        </div>
        <strong>{analytics?.selectedSelfCareCount ?? 0}</strong>
      </section>

      <div className={cx(styles.gridTwo, styles.analyticsGrid)}>
        <section className={cx(styles.panel, styles.analyticsPanel)}>
          <h3>Баланс категорий</h3>
          {categoryDistribution.length ? (
            <div className={styles.categoryDistributionList}>
              {categoryDistribution.map(([category, count]) => (
                <CategoryDistributionRow
                  key={category}
                  count={count}
                  label={CATEGORY_LABELS[category as SelfCareCategory]}
                  percent={getPercent(count, categoryTotal)}
                />
              ))}
            </div>
          ) : (
            <p className={styles.mutedText}>
              Данные появятся после выполнений.
            </p>
          )}
        </section>

        <section className={cx(styles.panel, styles.analyticsPanel)}>
          <h3>Процедуры и здоровье</h3>
          <div className={styles.metricList}>
            <MetricRow
              label="Расходы на процедуры"
              value={formatMoney(
                analytics?.procedureCosts ?? 0,
                defaultCurrency,
              )}
            />
            <MetricRow
              label="Медицинское скоро"
              value={String(analytics?.medicalUpcoming.length ?? 0)}
            />
          </div>
          {procedureCostsByMonth.length ? (
            <>
              <span className={styles.analyticsSubheading}>По месяцам</span>
              <div className={styles.metricList}>
                {procedureCostsByMonth.map(([monthKey, value]) => (
                  <MetricRow
                    key={monthKey}
                    label={formatMonthKey(monthKey)}
                    value={formatMoney(value, defaultCurrency)}
                  />
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section
          className={cx(
            styles.panel,
            styles.analyticsPanel,
            styles.analyticsWidePanel,
          )}
        >
          <h3>Динамика измерений</h3>
          {measurementTrends.length ? (
            <div className={styles.measurementTrendList}>
              {measurementTrends.map((trend) => (
                <MeasurementTrendRow key={trend.itemId} trend={trend} />
              ))}
            </div>
          ) : (
            <p className={styles.mutedText}>
              Динамика появится после первых записей измерений.
            </p>
          )}
        </section>
      </div>
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
  onUpdateSettings: (input: SelfCareSettingsPatch) => Promise<void>
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
            key={currentSettings.id}
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
  onUpdateSettings: (input: SelfCareSettingsPatch) => Promise<void>
  settings: NonNullable<
    ReturnType<typeof useSelfCareSettings>['data']
  >['settings']
}) {
  const [currency, setCurrency] = useState(settings.currency ?? '')
  const [showSelfCareInMainTasks, setShowSelfCareInMainTasks] = useState(
    settings.showSelfCareInMainTasks,
  )
  const [showAppointmentsInCalendar, setShowAppointmentsInCalendar] = useState(
    settings.showAppointmentsInCalendar,
  )
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')

  return (
    <form
      className={styles.settingsForm}
      onSubmit={(event) => {
        event.preventDefault()
        setSaveStatus('idle')
        void onUpdateSettings({
          currency: normalizeOptionalText(currency),
          showAppointmentsInCalendar,
          showSelfCareInMainTasks,
        })
          .then(() => {
            setSaveStatus('saved')
          })
          .catch(() => undefined)
      }}
    >
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Валюта процедур</span>
          <input
            type="text"
            autoComplete="off"
            maxLength={8}
            placeholder="RUB"
            value={currency}
            disabled={isBusy}
            onChange={(event) => {
              setSaveStatus('idle')
              setCurrency(event.target.value)
            }}
          />
        </label>
      </div>
      <label className={styles.toggleField}>
        <input
          type="checkbox"
          checked={showSelfCareInMainTasks}
          disabled={isBusy}
          onChange={(event) => {
            setSaveStatus('idle')
            setShowSelfCareInMainTasks(event.target.checked)
          }}
        />
        <span>Показывать заботу в общем списке задач</span>
      </label>
      <label className={styles.toggleField}>
        <input
          type="checkbox"
          checked={showAppointmentsInCalendar}
          disabled={isBusy}
          onChange={(event) => {
            setSaveStatus('idle')
            setShowAppointmentsInCalendar(event.target.checked)
          }}
        />
        <span>Показывать записи в календаре</span>
      </label>

      <div className={styles.modalActions}>
        <span className={styles.settingsSaveStatus} role="status">
          {saveStatus === 'saved' ? 'Сохранено' : ''}
        </span>
        <button className={styles.doneButton} type="submit" disabled={isBusy}>
          Сохранить настройки
        </button>
      </div>
    </form>
  )
}

function SelfCareCardIcon({
  uploadedIcons,
  value,
}: {
  uploadedIcons: UploadedIconAsset[]
  value: string | null | undefined
}) {
  const iconValue = value?.trim()

  return (
    <div className={styles.cardIcon} aria-hidden="true">
      {iconValue ? (
        <IconMark
          className={styles.cardIconMark}
          uploadedIcons={uploadedIcons}
          value={iconValue}
        />
      ) : (
        <span className={styles.cardIconPlaceholder}>♡</span>
      )}
    </div>
  )
}

function SelfCareItemCard({
  actions = 'today',
  compact = false,
  entry,
  isBusy,
  isTodayView = false,
  nextOccurrenceDate,
  onAction,
  onArchive,
  onCancelOccurrence,
  onEdit,
  onSchedule,
  onToggleStep,
  scheduleActionLabel = 'Перенести',
  stepDraft,
  uploadedIcons,
}: {
  actions?: 'plan' | 'today'
  compact?: boolean
  entry: SelfCareTodayItem
  isBusy: boolean
  isTodayView?: boolean
  nextOccurrenceDate?: string | null | undefined
  onAction: (entry: SelfCareTodayItem) => void
  onArchive: (entry: SelfCareTodayItem) => void
  onCancelOccurrence?: (entry: SelfCareTodayItem) => void
  onEdit: (entry: SelfCareTodayItem) => void
  onSchedule?: (entry: SelfCareTodayItem) => void
  onToggleStep?: (entry: SelfCareTodayItem, stepId: string) => void
  scheduleActionLabel?: string
  stepDraft?: readonly string[] | undefined
  uploadedIcons: UploadedIconAsset[]
}) {
  const todayKey = getDateKey(new Date())
  const isDone = isEntryDoneToday(entry, todayKey)
  const primaryActionLabel = getPrimaryActionLabel(entry, isDone)
  const flexibleProgressLabel = entry.flexibleProgress
    ? `${entry.flexibleProgress.completedCount} из ${entry.flexibleProgress.targetCount}`
    : null
  const courseProgress = getCourseProgress(entry.courseDetails)
  const scheduleLabel = formatSchedule(entry.scheduleRule)
  const todayScheduleLabel = isTodayView ? getTodayScheduleLabel(entry) : null
  const detailsLabel = formatEntryDetails(entry)
  const measurementLabel = formatMeasurementSummary(entry)
  const measurementTargetLabel = formatMeasurementTarget(entry)
  const stateLabel = formatStateSummary(entry)
  const completionLabel =
    entry.item.type === 'course'
      ? formatCourseCompletionState(entry, todayKey)
      : entry.item.type === 'mood_check' &&
          !hasStateCompletionValues(entry.completion)
        ? null
        : formatCompletionState(entry.completion, todayKey)
  const nextLabel = nextOccurrenceDate
    ? `Следующее выполнение: ${formatDate(nextOccurrenceDate)}`
    : null

  return (
    <article
      className={cx(
        styles.card,
        compact && styles.cardCompact,
        isDone && styles.cardDone,
      )}
    >
      <div className={styles.cardMain}>
        <SelfCareCardIcon
          uploadedIcons={uploadedIcons}
          value={entry.item.icon}
        />
        <div>
          <div className={styles.cardTitleRow}>
            <h3>{entry.item.title}</h3>
          </div>
          {!isTodayView ? (
            <p className={styles.cardMeta}>
              {CATEGORY_LABELS[entry.item.category]} ·{' '}
              {getTypeLabel(entry.item)} · {scheduleLabel}
            </p>
          ) : null}
          {todayScheduleLabel ? (
            <p className={styles.cardMeta}>{todayScheduleLabel}</p>
          ) : null}
          {!isTodayView && entry.occurrence ? (
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
          {measurementLabel ? (
            <p className={styles.measurementValue}>{measurementLabel}</p>
          ) : null}
          {measurementTargetLabel ? (
            <p className={styles.cardMeta}>{measurementTargetLabel}</p>
          ) : null}
          {stateLabel ? (
            <p className={styles.stateValue}>{stateLabel}</p>
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
        </div>
      </div>
      <div className={styles.cardActions}>
        {actions === 'plan' ? (
          <>
            <button
              className={cx(
                styles.cardActionButton,
                styles.cardActionButtonSoft,
              )}
              type="button"
              disabled={isBusy}
              title="Настроить"
              aria-label={`Настроить заботу «${entry.item.title}»`}
              onClick={() => onEdit(entry)}
            >
              <GearIcon size={18} strokeWidth={2.1} />
            </button>
            <button
              className={cx(styles.cardTextButton, styles.cardTextButtonDanger)}
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
              className={cx(
                styles.cardActionButton,
                styles.cardActionButtonDone,
              )}
              type="button"
              disabled={isBusy || isDone}
              title={primaryActionLabel}
              aria-label={`${primaryActionLabel}: «${entry.item.title}»`}
              onClick={() => onAction(entry)}
            >
              <CheckIcon size={18} strokeWidth={2.3} />
            </button>
            {onSchedule && entry.occurrence ? (
              <button
                className={cx(styles.cardTextButton, styles.cardTextButtonSoft)}
                type="button"
                disabled={isBusy || isDone}
                onClick={() => onSchedule(entry)}
              >
                {scheduleActionLabel}
              </button>
            ) : null}
            <button
              className={cx(
                styles.cardActionButton,
                styles.cardActionButtonSoft,
              )}
              type="button"
              disabled={isBusy}
              title="Настроить"
              aria-label={`Настроить заботу «${entry.item.title}»`}
              onClick={() => onEdit(entry)}
            >
              <GearIcon size={18} strokeWidth={2.1} />
            </button>
          </>
        )}
        {actions === 'today' ? (
          <button
            className={cx(
              styles.cardActionButton,
              styles.cardActionButtonDanger,
            )}
            type="button"
            disabled={isBusy}
            title="Удалить"
            aria-label={`Удалить заботу «${entry.item.title}»`}
            onClick={() => onArchive(entry)}
          >
            <TrashIcon size={18} strokeWidth={2.1} />
          </button>
        ) : null}
      </div>
    </article>
  )
}

function PlanningHintCard({
  entry,
  isBusy,
  isTodayView = false,
  onArchive,
  onEdit,
  onSchedule,
}: {
  entry: SelfCareTodayItem
  isBusy?: boolean
  isTodayView?: boolean
  onArchive?: (entry: SelfCareTodayItem) => void
  onEdit?: (entry: SelfCareTodayItem) => void
  onSchedule?: (entry: SelfCareTodayItem) => void
}) {
  const planningText = formatPlanningText(entry)
  const shouldShowPlanningText = !isTodayView || !entry.occurrence

  return (
    <article className={styles.hintCard}>
      <strong>{entry.item.title}</strong>
      {!isTodayView ? (
        <span>
          {CATEGORY_LABELS[entry.item.category]} · {getTypeLabel(entry.item)}
        </span>
      ) : null}
      {shouldShowPlanningText ? <p>{planningText}</p> : null}
      <div className={styles.hintActions}>
        {onSchedule && !entry.occurrence ? (
          <button
            className={cx(styles.cardTextButton, styles.cardTextButtonSoft)}
            type="button"
            disabled={isBusy}
            onClick={() => onSchedule(entry)}
          >
            Запланировать
          </button>
        ) : null}
        {onEdit ? (
          <button
            className={cx(styles.cardActionButton, styles.cardActionButtonSoft)}
            type="button"
            disabled={isBusy}
            title="Настроить"
            aria-label={`Настроить заботу «${entry.item.title}»`}
            onClick={() => onEdit(entry)}
          >
            <GearIcon size={18} strokeWidth={2.1} />
          </button>
        ) : null}
        {onArchive ? (
          <button
            className={cx(
              styles.cardActionButton,
              styles.cardActionButtonDanger,
            )}
            type="button"
            disabled={isBusy}
            title="Удалить"
            aria-label={`Удалить заботу «${entry.item.title}»`}
            onClick={() => onArchive(entry)}
          >
            <TrashIcon size={18} strokeWidth={2.1} />
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
  defaultCurrency,
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
  uploadedIcons,
}: {
  defaultCurrency: string
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
  uploadedIcons: UploadedIconAsset[]
}) {
  const [templateFilter, setTemplateFilter] =
    useState<AddCareTemplateFilter | null>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (isSelfCareIconPickerOpen()) {
          return
        }

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
            <ChevronLeftIcon size={17} strokeWidth={2.2} />
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
                <button
                  className={styles.addCareTemplateMainButton}
                  type="button"
                  disabled={isBusy}
                  onClick={() => openTemplatePicker(null)}
                >
                  <span className={styles.addCareTemplateCopy}>
                    <strong id="add-care-template-title">
                      Выбрать из шаблона
                    </strong>
                    <span className={styles.addCareChoiceText}>
                      Готовые идеи для ухода, здоровья и восстановления.
                    </span>
                  </span>
                  <span
                    className={styles.addCareArrowButton}
                    aria-hidden="true"
                  >
                    <ChevronRightIcon size={18} strokeWidth={2.15} />
                  </span>
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
            defaultCurrency={defaultCurrency}
            isBusy={isBusy}
            todayKey={todayKey}
            uploadedIcons={uploadedIcons}
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

function SelfCareTitleIconField({
  icon,
  maxLength,
  placeholder,
  required = false,
  title,
  uploadedIcons,
  onOpenIconPicker,
  onTitleChange,
}: {
  icon: string
  maxLength: number
  placeholder?: string | undefined
  required?: boolean | undefined
  title: string
  uploadedIcons: UploadedIconAsset[]
  onOpenIconPicker: () => void
  onTitleChange: (title: string) => void
}) {
  const normalizedIcon = icon.trim()
  const iconLabel = getIconLabel(normalizedIcon, uploadedIcons)

  return (
    <div className={styles.titleIconFieldRow}>
      <label className={styles.dateField}>
        <span>Название</span>
        <input
          type="text"
          autoComplete="off"
          maxLength={maxLength}
          required={required}
          placeholder={placeholder}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>

      <button
        className={styles.iconSelectButton}
        type="button"
        aria-label={`Выбрать иконку. Сейчас: ${iconLabel}`}
        onClick={onOpenIconPicker}
      >
        <span className={styles.iconSelectButtonMark} aria-hidden="true">
          {normalizedIcon ? (
            <IconMark
              className={styles.iconSelectButtonIcon}
              uploadedIcons={uploadedIcons}
              value={normalizedIcon}
            />
          ) : (
            <span className={styles.iconSelectButtonPlaceholder}>♡</span>
          )}
        </span>
      </button>
    </div>
  )
}

function SelfCareIconPickerDialog({
  uploadedIcons,
  value,
  onChange,
  onClose,
}: {
  uploadedIcons: UploadedIconAsset[]
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const previousValue =
      document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY]
    document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY] = 'true'

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)

      if (previousValue === undefined) {
        delete document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY]
        return
      }

      document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY] = previousValue
    }
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={cx(styles.modalOverlay, styles.iconPickerDialogOverlay)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-icon-picker-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть выбор иконки"
        onClick={onClose}
      />

      <section className={cx(styles.modalPanel, styles.iconPickerDialogPanel)}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-icon-picker-title">Иконка</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть выбор иконки"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <IconChoicePicker
          className={styles.iconPickerDialogPicker}
          hideLabel
          label="Иконка"
          uploadedIcons={uploadedIcons}
          value={value}
          onChange={(nextValue) => {
            onChange(nextValue)
            onClose()
          }}
        />
      </section>
    </div>,
    document.body,
  )
}

function SelfCareCustomCreateForm({
  defaultCurrency,
  isBusy,
  onCreate,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  isBusy: boolean
  onCreate: (payload: SelfCareCustomCreatePayload) => void
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const [type, setType] = useState<SelfCareItemType>('task')
  const [category, setCategory] = useState<SelfCareCategory>('daily_base')
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
  const [scheduledDate, setScheduledDate] = useState(todayKey)
  const [scheduledTime, setScheduledTime] = useState('09:00')
  const [detailsPlace, setDetailsPlace] = useState('')
  const [detailsSpecialist, setDetailsSpecialist] = useState('')
  const [detailsContact, setDetailsContact] = useState('')
  const [detailsPrice, setDetailsPrice] = useState('')
  const [detailsCurrency, setDetailsCurrency] = useState(defaultCurrency)
  const [detailsNote, setDetailsNote] = useState('')
  const [measurementValueLabel, setMeasurementValueLabel] = useState('Значение')
  const [measurementUnit, setMeasurementUnit] = useState('')
  const [measurementTargetMin, setMeasurementTargetMin] = useState('')
  const [measurementTargetMax, setMeasurementTargetMax] = useState('')
  const [stepsText, setStepsText] = useState('')
  const selectedType = CREATE_TYPE_OPTIONS.find(
    (option) => option.value === type,
  )
  const intervalNumber = parsePositiveInteger(intervalValue)
  const flexibleTargetNumber = parsePositiveInteger(flexibleTargetCount)
  const courseTotalNumber = parsePositiveInteger(courseTotalCount)
  const measurementTargetMinNumber =
    parseOptionalMeasurementNumber(measurementTargetMin)
  const measurementTargetMaxNumber =
    parseOptionalMeasurementNumber(measurementTargetMax)
  const usesExactSchedule = shouldUseExactSchedule(type)
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
    (!usesExactSchedule || scheduledDate.length > 0) &&
    (type !== 'measurement' ||
      (measurementUnit.trim().length > 0 &&
        isValidMeasurementTargetRange(
          measurementTargetMinNumber,
          measurementTargetMaxNumber,
        )))

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
      setRepeatKind('daily')
    }

    if (nextType === 'rest_action') {
      setCategory('relax')
    }

    if (nextType === 'measurement') {
      setCategory('body')
      setRepeatKind('daily')
      setMeasurementValueLabel((value) => value || 'Значение')
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

        const detailsPriceValue = parseOptionalPrice(detailsPrice)
        const normalizedDetailsCurrency = normalizeOptionalText(detailsCurrency)
        const normalizedScheduledTime = normalizeOptionalText(scheduledTime)
        const canStoreVisitDetails = shouldShowVisitDetails(type)
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
                startDate: usesExactSchedule ? scheduledDate : todayKey,
              })
        const scheduledStartsAt = buildDateTimeInput(
          scheduledDate,
          normalizedScheduledTime,
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
                    startsAt: scheduledStartsAt,
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
            icon: normalizeOptionalText(icon),
            importance: 'recommended',
            isActive: true,
            isArchived: false,
            isPrivate: true,
            medicalDetails:
              type === 'medical'
                ? {
                    analysisList: [],
                    clinicAddress: normalizeOptionalText(detailsPlace),
                    clinicName: null,
                    documentUrls: [],
                    doctorName: normalizeOptionalText(detailsSpecialist),
                    nextControlDate: scheduledDate || null,
                    phone: normalizeOptionalText(detailsContact),
                    reminderStrategy: 'soft',
                    resultNote: normalizeOptionalText(detailsNote),
                    website: null,
                  }
                : undefined,
            measurementDetails:
              type === 'measurement'
                ? {
                    targetMax: measurementTargetMaxNumber,
                    targetMin: measurementTargetMinNumber,
                    unit: measurementUnit.trim(),
                    valueLabel: measurementValueLabel.trim() || 'Значение',
                  }
                : undefined,
            migratedFromHabitId: null,
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
          scheduleInput: usesExactSchedule
            ? {
                currency:
                  !canStoreVisitDetails || detailsPriceValue === null
                    ? null
                    : normalizedDetailsCurrency,
                note: canStoreVisitDetails ? detailsNote : '',
                place: canStoreVisitDetails
                  ? normalizeOptionalText(detailsPlace)
                  : null,
                price: canStoreVisitDetails ? detailsPriceValue : null,
                scheduledFor: scheduledDate,
                scheduledTime: normalizedScheduledTime,
                specialistContact: canStoreVisitDetails
                  ? normalizeOptionalText(detailsContact)
                  : null,
                specialistName: canStoreVisitDetails
                  ? normalizeOptionalText(detailsSpecialist)
                  : null,
              }
            : undefined,
        })
      }}
    >
      <SelfCareTitleIconField
        icon={icon}
        maxLength={160}
        placeholder="Например: растяжка, стоматолог, стрижка"
        required
        title={title}
        uploadedIcons={uploadedIcons}
        onOpenIconPicker={() => setIsIconPickerOpen(true)}
        onTitleChange={setTitle}
      />

      {isIconPickerOpen ? (
        <SelfCareIconPickerDialog
          uploadedIcons={uploadedIcons}
          value={icon}
          onChange={setIcon}
          onClose={() => setIsIconPickerOpen(false)}
        />
      ) : null}

      <div className={styles.selectWithHint}>
        <SelectPicker<SelfCareItemType>
          className={styles.selectField}
          label="Тип"
          value={type}
          options={CREATE_TYPE_SELECT_OPTIONS}
          onChange={handleTypeChange}
        />
        {selectedType ? (
          <small className={styles.fieldHint}>{selectedType.description}</small>
        ) : null}
      </div>

      <SelectPicker<SelfCareCategory>
        className={styles.selectField}
        label="Категория"
        value={category}
        options={CATEGORY_SELECT_OPTIONS}
        onChange={setCategory}
      />

      <div className={styles.createFormGrid}>
        <SelectPicker<SelfCareTimeOfDay>
          className={styles.selectField}
          label="Когда удобнее"
          value={preferredTimeOfDay}
          options={TIME_GROUP_SELECT_OPTIONS}
          onChange={setPreferredTimeOfDay}
        />

        <SelectPicker<SelfCareCreateRepeatKind>
          className={styles.selectField}
          label="Регулярность"
          value={repeatKind}
          options={CREATE_REPEAT_SELECT_OPTIONS}
          onChange={handleRepeatKindChange}
        />
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

      {usesExactSchedule ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>{getExactScheduleDateLabel(type)}</span>
            <input
              type="date"
              min={todayKey}
              required
              value={scheduledDate}
              onChange={(event) => setScheduledDate(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>{getExactScheduleTimeLabel(type)}</span>
            <input
              type="time"
              value={scheduledTime}
              onChange={(event) => setScheduledTime(event.target.value)}
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

          <SelectPicker<SelfCareCourseType>
            className={styles.selectField}
            label="Единица курса"
            value={courseType}
            options={COURSE_TYPE_SELECT_OPTIONS}
            onChange={setCourseType}
          />
        </div>
      ) : null}

      {type === 'measurement' ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>Что измеряем</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={80}
              required
              placeholder="Вес, пульс, температура"
              value={measurementValueLabel}
              onChange={(event) => setMeasurementValueLabel(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Единица</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={32}
              required
              placeholder="кг, см, °C"
              value={measurementUnit}
              onChange={(event) => setMeasurementUnit(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Нижняя граница</span>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              placeholder="Необязательно"
              value={measurementTargetMin}
              onChange={(event) => setMeasurementTargetMin(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Верхняя граница</span>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              placeholder="Необязательно"
              value={measurementTargetMax}
              onChange={(event) => setMeasurementTargetMax(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {shouldShowVisitDetails(type) ? (
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

        <SelectPicker<SelfCareIntervalUnit>
          className={styles.selectField}
          label="Период"
          value={intervalUnit}
          options={INTERVAL_UNIT_SELECT_OPTIONS}
          onChange={onChangeIntervalUnit}
        />
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

        <SelectPicker<SelfCareFlexiblePeriod>
          className={styles.selectField}
          label="Период цели"
          value={flexiblePeriod}
          options={FLEXIBLE_PERIOD_SELECT_OPTIONS}
          onChange={onChangeFlexiblePeriod}
        />
      </div>
    )
  }

  return null
}

function SelfCareEditDialog({
  defaultCurrency,
  entry,
  errorMessage,
  isBusy,
  onClose,
  onSubmit,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onClose: () => void
  onSubmit: (payload: SelfCareEditSubmitPayload) => void
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (isSelfCareIconPickerOpen()) {
          return
        }

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
          defaultCurrency={defaultCurrency}
          entry={entry}
          isBusy={isBusy}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onCancel={onClose}
          onSubmit={onSubmit}
        />
      </section>
    </div>,
    document.body,
  )
}

function SelfCareEditForm({
  defaultCurrency,
  entry,
  isBusy,
  onCancel,
  onSubmit,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  entry: SelfCareTodayItem
  isBusy: boolean
  onCancel: () => void
  onSubmit: (payload: SelfCareEditSubmitPayload) => void
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const [title, setTitle] = useState(entry.item.title)
  const [description, setDescription] = useState(entry.item.description)
  const [icon, setIcon] = useState(entry.item.icon ?? '')
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const [category, setCategory] = useState<SelfCareCategory>(
    entry.item.category,
  )
  const [preferredTimeOfDay, setPreferredTimeOfDay] =
    useState<SelfCareTimeOfDay>(entry.item.preferredTimeOfDay ?? 'anytime')
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
  const [stepsText, setStepsText] = useState(
    entry.steps.map((step) => step.title).join('\n'),
  )
  const [scheduledDate, setScheduledDate] = useState(
    getInitialScheduleDate(entry, todayKey),
  )
  const [scheduledTime, setScheduledTime] = useState(
    getInitialScheduleTime(entry),
  )
  const [procedurePlace, setProcedurePlace] = useState(
    entry.appointment?.place ?? entry.procedure?.place ?? '',
  )
  const [procedureSpecialist, setProcedureSpecialist] = useState(
    entry.appointment?.specialistName ?? entry.procedure?.specialistName ?? '',
  )
  const [procedureContact, setProcedureContact] = useState(
    entry.appointment?.specialistContact ?? entry.procedure?.contact ?? '',
  )
  const [procedurePrice, setProcedurePrice] = useState(
    formatOptionalNumber(
      entry.appointment?.price ?? entry.procedure?.defaultPrice,
    ),
  )
  const [procedureCurrency, setProcedureCurrency] = useState(
    entry.appointment?.currency ?? entry.procedure?.currency ?? defaultCurrency,
  )
  const [measurementValueLabel, setMeasurementValueLabel] = useState(
    entry.measurement?.valueLabel ?? 'Значение',
  )
  const [measurementUnit, setMeasurementUnit] = useState(
    entry.measurement?.unit ?? '',
  )
  const [measurementTargetMin, setMeasurementTargetMin] = useState(
    formatOptionalNumber(entry.measurement?.targetMin),
  )
  const [measurementTargetMax, setMeasurementTargetMax] = useState(
    formatOptionalNumber(entry.measurement?.targetMax),
  )
  const intervalNumber = parsePositiveInteger(intervalValue)
  const flexibleTargetNumber = parsePositiveInteger(flexibleTargetCount)
  const measurementTargetMinNumber =
    parseOptionalMeasurementNumber(measurementTargetMin)
  const measurementTargetMaxNumber =
    parseOptionalMeasurementNumber(measurementTargetMax)
  const dayOfMonthNumber = parseBoundedInteger(dayOfMonth, 1, 31)
  const monthOfYearNumber = parseBoundedInteger(monthOfYear, 1, 12)
  const selectedRepeatKind = repeatMode === 'keep' ? null : repeatMode
  const usesExactSchedule = shouldUseExactSchedule(entry.item.type)
  const canStoreVisitDetails = shouldShowVisitDetails(entry.item.type)
  const canSubmit =
    title.trim().length > 0 &&
    (!usesExactSchedule || scheduledDate.length > 0) &&
    (!selectedRepeatKind ||
      ((!repeatKindRequiresInterval(selectedRepeatKind) ||
        Boolean(intervalNumber)) &&
        (selectedRepeatKind !== 'weekly' || daysOfWeek.length > 0) &&
        (selectedRepeatKind !== 'monthly' || Boolean(dayOfMonthNumber)) &&
        (selectedRepeatKind !== 'yearly' ||
          (Boolean(dayOfMonthNumber) && Boolean(monthOfYearNumber))) &&
        (selectedRepeatKind !== 'flexible_goal' ||
          Boolean(flexibleTargetNumber)))) &&
    (entry.item.type !== 'measurement' ||
      (measurementUnit.trim().length > 0 &&
        isValidMeasurementTargetRange(
          measurementTargetMinNumber,
          measurementTargetMaxNumber,
        )))

  return (
    <form
      className={styles.createForm}
      onSubmit={(event) => {
        event.preventDefault()

        if (!canSubmit) {
          return
        }

        const detailsPriceValue = parseOptionalPrice(procedurePrice)
        const normalizedProcedureCurrency =
          normalizeOptionalText(procedureCurrency)
        const normalizedScheduledTime = normalizeOptionalText(scheduledTime)
        const input: SelfCareItemUpdateInput = {
          category,
          description: description.trim(),
          expectedVersion: entry.item.version,
          icon: normalizeOptionalText(icon),
          minimumVersion: null,
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
            startDate: usesExactSchedule
              ? scheduledDate
              : (entry.scheduleRule?.startDate ?? todayKey),
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
            currency: normalizedProcedureCurrency,
            defaultPrice: detailsPriceValue,
            place: normalizeOptionalText(procedurePlace),
            specialistName: normalizeOptionalText(procedureSpecialist),
          }
        }

        if (entry.item.type === 'measurement') {
          input.measurementDetails = {
            targetMax: measurementTargetMaxNumber,
            targetMin: measurementTargetMinNumber,
            unit: measurementUnit.trim(),
            valueLabel: measurementValueLabel.trim() || 'Значение',
          }
        }

        onSubmit({
          input,
          scheduleInput: usesExactSchedule
            ? {
                currency:
                  !canStoreVisitDetails || detailsPriceValue === null
                    ? null
                    : normalizedProcedureCurrency,
                note: canStoreVisitDetails
                  ? (entry.appointment?.preparationNote ?? '')
                  : '',
                place: canStoreVisitDetails
                  ? normalizeOptionalText(procedurePlace)
                  : null,
                price: canStoreVisitDetails ? detailsPriceValue : null,
                scheduledFor: scheduledDate,
                scheduledTime: normalizedScheduledTime,
                specialistContact: canStoreVisitDetails
                  ? normalizeOptionalText(procedureContact)
                  : null,
                specialistName: canStoreVisitDetails
                  ? normalizeOptionalText(procedureSpecialist)
                  : null,
              }
            : undefined,
        })
      }}
    >
      <div className={styles.scheduleTarget}>
        <strong>{entry.item.title}</strong>
        <span>
          {CATEGORY_LABELS[entry.item.category]} · {getTypeLabel(entry.item)}
        </span>
      </div>

      <SelfCareTitleIconField
        icon={icon}
        maxLength={160}
        required
        title={title}
        uploadedIcons={uploadedIcons}
        onOpenIconPicker={() => setIsIconPickerOpen(true)}
        onTitleChange={setTitle}
      />

      {isIconPickerOpen ? (
        <SelfCareIconPickerDialog
          uploadedIcons={uploadedIcons}
          value={icon}
          onChange={setIcon}
          onClose={() => setIsIconPickerOpen(false)}
        />
      ) : null}

      <SelectPicker<SelfCareCategory>
        className={styles.selectField}
        label="Категория"
        value={category}
        options={CATEGORY_SELECT_OPTIONS}
        onChange={setCategory}
      />

      <div className={styles.createFormGrid}>
        <SelectPicker<SelfCareTimeOfDay>
          className={styles.selectField}
          label="Когда удобнее"
          value={preferredTimeOfDay}
          options={TIME_GROUP_SELECT_OPTIONS}
          onChange={setPreferredTimeOfDay}
        />

        <SelectPicker<SelfCareEditRepeatMode>
          className={styles.selectField}
          label="Регулярность"
          value={repeatMode}
          options={[
            {
              label: `Не менять: ${formatSchedule(entry.scheduleRule)}`,
              value: 'keep',
            },
            ...CREATE_REPEAT_SELECT_OPTIONS,
          ]}
          onChange={setRepeatMode}
        />
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

      {usesExactSchedule ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>{getExactScheduleDateLabel(entry.item.type)}</span>
            <input
              type="date"
              min={todayKey}
              required
              value={scheduledDate}
              onChange={(event) => setScheduledDate(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>{getExactScheduleTimeLabel(entry.item.type)}</span>
            <input
              type="time"
              value={scheduledTime}
              onChange={(event) => setScheduledTime(event.target.value)}
            />
          </label>
        </div>
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

      {canStoreVisitDetails ? (
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

      {entry.item.type === 'measurement' ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>Что измеряем</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={80}
              required
              value={measurementValueLabel}
              onChange={(event) => setMeasurementValueLabel(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Единица</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={32}
              required
              value={measurementUnit}
              onChange={(event) => setMeasurementUnit(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Нижняя граница</span>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={measurementTargetMin}
              onChange={(event) => setMeasurementTargetMin(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Верхняя граница</span>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={measurementTargetMax}
              onChange={(event) => setMeasurementTargetMax(event.target.value)}
            />
          </label>
        </div>
      ) : null}

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
                    defaultCurrency),
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

function SelfCareMeasurementDialog({
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

function SelfCareMoodDialog({
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
  const [energy, setEnergy] = useState<number | null>(null)
  const [mood, setMood] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const canSubmit = mood !== null || energy !== null

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
      aria-labelledby="self-care-mood-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть ввод состояния"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-mood-title">Записать состояние</h2>
            <p>{entry.item.title}</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть ввод состояния"
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
              alternativeTitle: null,
              completedVariant: 'full',
              durationMinutes: null,
              energyAfter: energy,
              energyBefore: null,
              measurementUnit: null,
              measurementValue: null,
              moodAfter: mood,
              moodBefore: null,
              note,
              status: 'done',
            })
          }}
        >
          <div className={styles.scheduleTarget}>
            <strong>Как сейчас?</strong>
            <span>
              Выберите настроение или энергию, можно добавить заметку.
            </span>
          </div>

          <RatingPicker
            label="Настроение"
            labels={MOOD_RATING_LABELS}
            value={mood}
            onChange={setMood}
          />

          <RatingPicker
            label="Энергия"
            labels={ENERGY_RATING_LABELS}
            value={energy}
            onChange={setEnergy}
          />

          <label className={styles.dateField}>
            <span>Заметка</span>
            <textarea
              rows={3}
              maxLength={1200}
              placeholder="Что повлияло на состояние"
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
              disabled={isBusy || !canSubmit}
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

function RatingPicker({
  label,
  labels,
  onChange,
  value,
}: {
  label: string
  labels: Record<(typeof STATE_RATING_VALUES)[number], string>
  onChange: (value: number) => void
  value: number | null
}) {
  return (
    <fieldset className={styles.ratingField}>
      <legend>{label}</legend>
      <div className={styles.ratingGrid}>
        {STATE_RATING_VALUES.map((rating) => (
          <button
            key={rating}
            className={cx(
              styles.ratingButton,
              value === rating && styles.ratingButtonActive,
            )}
            type="button"
            aria-pressed={value === rating}
            onClick={() => onChange(rating)}
          >
            <strong>{rating}</strong>
            <span>{labels[rating]}</span>
          </button>
        ))}
      </div>
    </fieldset>
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

function CategoryDistributionRow({
  count,
  label,
  percent,
}: {
  count: number
  label: string
  percent: number
}) {
  return (
    <div className={styles.categoryDistributionRow}>
      <div className={styles.categoryDistributionHeader}>
        <span>{label}</span>
        <strong>
          {count} · {percent}%
        </strong>
      </div>
      <div className={styles.analyticsBar} aria-hidden="true">
        <span style={{ inlineSize: `${percent}%` }} />
      </div>
    </div>
  )
}

function MeasurementTrendRow({
  trend,
}: {
  trend: SelfCareAnalyticsData['measurementTrends'][number]
}) {
  const latest = trend.points[trend.points.length - 1]
  const previous = trend.points[trend.points.length - 2]
  const delta =
    latest && previous
      ? Number((latest.value - previous.value).toFixed(2))
      : null
  const recentPoints = trend.points.slice(-4)

  return (
    <article className={styles.measurementTrendItem}>
      <div className={styles.measurementTrendHeader}>
        <div>
          <strong>{trend.title}</strong>
          <span>{trend.valueLabel}</span>
        </div>
        {latest ? (
          <strong className={styles.measurementTrendValue}>
            {formatMeasurementValue(latest.value, trend.unit)}
          </strong>
        ) : null}
      </div>

      {delta !== null ? (
        <p className={styles.measurementTrendDelta}>
          {formatMeasurementDelta(delta, trend.unit)} с прошлого измерения
        </p>
      ) : null}

      <div className={styles.measurementTrendPoints}>
        {recentPoints.map((point) => (
          <span key={`${trend.itemId}-${point.completedAt}`}>
            <small>{formatShortDate(point.date)}</small>
            <strong>{formatMeasurementValue(point.value, trend.unit)}</strong>
          </span>
        ))}
      </div>
    </article>
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
  const isInteractive = Boolean(onToggleStep) && !isDone

  return (
    <div className={styles.stepPreview} aria-label="Этапы ритуала">
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
): SelfCareCompletionInput {
  return {
    alternativeTitle: null,
    completedVariant: 'full' as const,
    durationMinutes: entry.item.defaultDurationMinutes,
    energyAfter: null,
    energyBefore: null,
    measurementUnit: null,
    measurementValue: null,
    moodAfter: null,
    moodBefore: null,
    note: '',
    status: 'done' as const,
  }
}

function buildRitualStepCompletionInput(
  entry: SelfCareTodayItem,
  stepDraft: readonly string[] | undefined,
): Array<{ isDone: boolean; stepId: string }> {
  if (entry.steps.length === 0) {
    return []
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
  return getRitualStepDraftKeyFromParts(
    todayKey,
    entry.item.id,
    entry.occurrence?.id ?? null,
  )
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

function buildRitualStepDraftInput(
  entry: SelfCareTodayItem,
  todayKey: string,
  stepIds: readonly string[],
): SelfCareRitualStepDraftInput {
  return {
    date: todayKey,
    itemId: entry.item.id,
    occurrenceId: entry.occurrence?.id ?? null,
    stepIds: [...stepIds],
  }
}

function buildRitualStepDraftMap(
  response: SelfCareRitualStepDraftListResponse,
): RitualStepDrafts {
  return response.drafts.reduce<RitualStepDrafts>((drafts, draft) => {
    drafts[
      getRitualStepDraftKeyFromParts(
        draft.date,
        draft.itemId,
        draft.occurrenceId,
      )
    ] = draft.stepIds

    return drafts
  }, {})
}

function applyRitualStepDraftOverrides(
  drafts: RitualStepDrafts,
  overrides: RitualStepDraftOverrides,
): RitualStepDrafts {
  return Object.entries(overrides).reduce<RitualStepDrafts>(
    (nextDrafts, [draftKey, stepIds]) => {
      if (stepIds === null) {
        delete nextDrafts[draftKey]
        return nextDrafts
      }

      nextDrafts[draftKey] = stepIds
      return nextDrafts
    },
    { ...drafts },
  )
}

function getRitualStepDraftKeyFromParts(
  date: string,
  itemId: string,
  occurrenceId: string | null,
): string {
  return `${date}:${itemId}:${occurrenceId ?? ''}`
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
    lastMeasurement: null,
    measurement:
      list.measurementDetails.find((details) => details.itemId === item.id) ??
      null,
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

  return left.item.title.localeCompare(right.item.title, 'ru')
}

function getTimeGroupWeight(timeGroup: SelfCareTimeOfDay): number {
  if (timeGroup === 'morning') return 0
  if (timeGroup === 'afternoon') return 1
  if (timeGroup === 'evening') return 2
  if (timeGroup === 'night') return 3
  return 4
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

function shouldShowCourseInToday(
  entry: SelfCareTodayItem,
  todayKey: string,
  nextOccurrenceDate: string | null | undefined,
): boolean {
  const course = entry.courseDetails

  const isActiveCourse = Boolean(
    course &&
    entry.item.isActive &&
    !entry.item.isArchived &&
    !entry.item.deletedAt &&
    !course.isCompleted &&
    !course.isPaused,
  )

  if (!isActiveCourse) {
    return false
  }

  if (!isCompletionDoneToday(entry.completion, todayKey)) {
    return true
  }

  return nextOccurrenceDate === todayKey
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
  if (!latestCompletion) {
    return entry
  }

  return {
    ...entry,
    completion: entry.completion ?? latestCompletion,
    lastMeasurement:
      latestCompletion.measurementValue === null
        ? entry.lastMeasurement
        : latestCompletion,
  }
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

function getPlanOccurrenceEntries(
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined,
  todayKey: string,
): SelfCareTodayItem[] {
  const byItemId = new Map<string, SelfCareTodayItem>()
  const entries = [...(plan?.occurrences ?? [])]
    .filter(
      (entry) =>
        entry.item.type !== 'course' &&
        entry.item.type !== 'medical' &&
        shouldShowPlannedEntry(entry) &&
        entry.occurrence &&
        entry.occurrence.scheduledFor >= todayKey,
    )
    .sort(comparePlanOccurrenceEntries)

  for (const entry of entries) {
    if (!byItemId.has(entry.item.id)) {
      byItemId.set(entry.item.id, entry)
    }
  }

  return [...byItemId.values()]
}

function comparePlanOccurrenceEntries(
  left: SelfCareTodayItem,
  right: SelfCareTodayItem,
): number {
  const dateDiff = (left.occurrence?.scheduledFor ?? '').localeCompare(
    right.occurrence?.scheduledFor ?? '',
  )

  return dateDiff === 0 ? compareTodayEntries(left, right) : dateDiff
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

function shouldUseExactSchedule(type: SelfCareItemType): boolean {
  return TYPES_WITH_EXACT_SCHEDULE.has(type)
}

function shouldShowVisitDetails(type: SelfCareItemType): boolean {
  return type === 'appointment' || type === 'medical' || type === 'procedure'
}

function getExactScheduleDateLabel(type: SelfCareItemType): string {
  if (type === 'appointment') {
    return 'Дата записи'
  }

  if (type === 'procedure') {
    return 'Дата процедуры'
  }

  if (type === 'medical') {
    return 'Дата визита / контроля'
  }

  if (type === 'measurement') {
    return 'Дата измерения'
  }

  if (type === 'mood_check') {
    return 'Дата отметки'
  }

  return 'Дата в плане'
}

function getExactScheduleTimeLabel(type: SelfCareItemType): string {
  if (type === 'appointment') {
    return 'Время записи'
  }

  if (type === 'procedure') {
    return 'Время процедуры'
  }

  if (type === 'medical') {
    return 'Время визита'
  }

  if (type === 'measurement') {
    return 'Время измерения'
  }

  if (type === 'mood_check') {
    return 'Время отметки'
  }

  return 'Время'
}

function getInitialMeasurementValue(entry: SelfCareTodayItem): string {
  return formatOptionalNumber(
    entry.lastMeasurement?.measurementValue ??
      entry.completion?.measurementValue,
  )
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

function parseOptionalMeasurementNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseRequiredMeasurementNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function isValidMeasurementTargetRange(
  targetMin: number | null,
  targetMax: number | null,
): boolean {
  return targetMin === null || targetMax === null || targetMin <= targetMax
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

  if (rule.repeatKind === 'weekly') {
    return formatWeeklySchedule(rule)
  }

  return REPEAT_LABELS[rule.repeatKind]
}

function formatWeeklySchedule(rule: SelfCareScheduleRule): string {
  const days = [...new Set(rule.daysOfWeek)].sort((left, right) => left - right)

  if (areSameWeekdays(days, EVERY_WEEKDAY_VALUES)) {
    return 'каждый день'
  }

  if (areSameWeekdays(days, WORKDAY_VALUES)) {
    return 'по будням'
  }

  if (days.length > 0) {
    return days
      .map(
        (day) =>
          WEEKDAY_OPTIONS.find((option) => option.value === day)?.label ??
          String(day),
      )
      .join(', ')
  }

  return REPEAT_LABELS.weekly
}

function areSameWeekdays(
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function getTodayScheduleLabel(entry: SelfCareTodayItem): string | null {
  const rule = entry.scheduleRule

  if (
    entry.item.type !== 'habit' ||
    !rule ||
    rule.repeatKind === 'none' ||
    rule.repeatKind === 'flexible_goal'
  ) {
    return null
  }

  return formatSchedule(rule)
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

function formatShortDate(dateKey: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dateKey}T12:00:00`))
}

function formatMonthKey(monthKey: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${monthKey}-01T12:00:00`))
}

function formatTime(value: string): string {
  return value.slice(11, 16)
}

function getPercent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function formatMoney(value: number, currency = 'RUB'): string {
  try {
    return new Intl.NumberFormat('ru-RU', {
      currency,
      maximumFractionDigits: 0,
      style: 'currency',
    }).format(value)
  } catch {
    return `${new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: 0,
    }).format(value)} ${currency}`
  }
}

function formatMeasurementValue(
  value: number,
  unit: string | null | undefined,
): string {
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(value)

  return unit ? `${formatted} ${unit}` : formatted
}

function formatMeasurementDelta(
  value: number,
  unit: string | null | undefined,
): string {
  if (value === 0) {
    return 'без изменений'
  }

  const formatted = formatMeasurementValue(value, unit)
  return value > 0 ? `+${formatted}` : formatted
}

function formatMeasurementSummary(entry: SelfCareTodayItem): string | null {
  const completion = entry.lastMeasurement ?? entry.completion

  if (
    !completion ||
    completion.measurementValue === null ||
    !isProgressCompletionStatus(completion.status)
  ) {
    return entry.measurement
      ? `${entry.measurement.valueLabel}: еще нет показаний`
      : null
  }

  const date = completion.completedAt.slice(0, 10)
  return `${entry.measurement?.valueLabel ?? 'Последнее'}: ${formatMeasurementValue(
    completion.measurementValue,
    completion.measurementUnit ?? entry.measurement?.unit ?? null,
  )} · ${formatDate(date)}`
}

function formatMeasurementTarget(entry: SelfCareTodayItem): string | null {
  const details = entry.measurement
  if (!details) {
    return null
  }

  if (details.targetMin !== null && details.targetMax !== null) {
    return `Норма: ${formatMeasurementValue(details.targetMin, details.unit)} – ${formatMeasurementValue(details.targetMax, details.unit)}`
  }

  if (details.targetMin !== null) {
    return `Минимум: ${formatMeasurementValue(details.targetMin, details.unit)}`
  }

  if (details.targetMax !== null) {
    return `Максимум: ${formatMeasurementValue(details.targetMax, details.unit)}`
  }

  return null
}

function formatStateSummary(entry: SelfCareTodayItem): string | null {
  if (entry.item.type !== 'mood_check') {
    return null
  }

  const summary = formatStateCompletionSummary(entry.completion)
  if (!summary) {
    return 'Состояние: еще не записано'
  }

  const date = entry.completion?.completedAt.slice(0, 10)
  return date ? `${summary} · ${formatDate(date)}` : summary
}

function formatStateCompletionSummary(
  completion: SelfCareCompletion | null,
): string | null {
  if (
    !completion ||
    !isProgressCompletionStatus(completion.status) ||
    !hasStateCompletionValues(completion)
  ) {
    return null
  }

  const parts = [
    completion.moodAfter !== null
      ? `настроение ${completion.moodAfter}/5`
      : null,
    completion.energyAfter !== null
      ? `энергия ${completion.energyAfter}/5`
      : null,
  ].filter(Boolean)

  return parts.join(' · ')
}

function hasStateCompletionValues(
  completion: SelfCareCompletion | null,
): boolean {
  return Boolean(
    completion &&
    (completion.moodAfter !== null || completion.energyAfter !== null),
  )
}

function formatEntryDetails(entry: SelfCareTodayItem): string | null {
  const parts = [
    entry.appointment?.place ?? entry.procedure?.place,
    entry.appointment?.specialistName ?? entry.procedure?.specialistName,
    entry.appointment?.price !== null && entry.appointment?.price !== undefined
      ? formatMoney(
          entry.appointment.price,
          entry.appointment.currency ?? 'RUB',
        )
      : entry.procedure?.defaultPrice !== null &&
          entry.procedure?.defaultPrice !== undefined
        ? formatMoney(
            entry.procedure.defaultPrice,
            entry.procedure.currency ?? 'RUB',
          )
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
      ? 'Частично выполнено'
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
  if (entry.item.type === 'mood_check') {
    return isStateCompletionDoneToday(entry.completion, todayKey)
  }

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

function isStateCompletionDoneToday(
  completion: SelfCareCompletion | null,
  todayKey: string,
): boolean {
  return Boolean(
    completion &&
    hasStateCompletionValues(completion) &&
    isProgressCompletionStatus(completion.status) &&
    completion.completedAt.slice(0, 10) === todayKey,
  )
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
  if (entry.item.type === 'measurement') {
    return isDone ? 'Записано' : 'Записать'
  }

  if (entry.item.type === 'mood_check') {
    return isDone ? 'Записано' : 'Записать'
  }

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
