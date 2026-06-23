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

import { getSelfCareErrorMessage } from '@/features/self-care'
import type { SelectPickerOption } from '@/shared/ui/SelectPicker'

import {
  isCompletionDoneToday,
  isProgressCompletionStatus,
} from './SelfCarePage.schedule'

export type SelfCareTab =
  | 'today'
  | 'plan'
  | 'rituals'
  | 'history'
  | 'analytics'
  | 'settings'

export type SelfCareCreateDialogMode = 'choice' | 'custom' | 'template'
export type SelfCareCreateRepeatKind = SelfCareRepeatKind
export type SelfCareStandardRepeatKind = Exclude<
  SelfCareCreateRepeatKind,
  'course' | 'flexible_goal'
>
export type SelfCareEditRepeatMode = SelfCareStandardRepeatKind | 'keep'
export type SelfCareCourseScheduleMode = 'daily' | 'weekly' | 'interval'
export type SelfCareCourseEditScheduleMode = SelfCareCourseScheduleMode | 'keep'
export type SelfCareCourseRepeatMode = 'cycle' | 'once'
export type SelfCareTimePreference = SelfCareTimeOfDay | 'exact'
export type SelfCareCreateScheduleRuleInput = NonNullable<
  SelfCareItemInput['scheduleRule']
>
export type SelfCareCourseType = 'days' | 'sessions'
export type SelfCareCustomCreatePayload = {
  input: SelfCareItemInput
  scheduleInput?: SelfCareItemScheduleInput | undefined
}
export type SelfCareEditSubmitPayload = {
  input: SelfCareItemUpdateInput
  scheduleInput?: SelfCareItemScheduleInput | undefined
}
export type SelfCareCourseRestartPayload = {
  input: SelfCareItemUpdateInput
  restartDate: string
}
export type SelfCareSettingsPatch = SelfCareSettingsUpdateInput
export type AddCareTemplateFilter = 'beauty' | 'health' | 'movement' | 'rest'
export type RitualStepDrafts = Record<string, readonly string[]>
export type RitualStepDraftOverrides = Record<string, readonly string[] | null>
export type VisibleSelfCareCategory = Extract<
  SelfCareCategory,
  'beauty' | 'body' | 'custom' | 'health' | 'movement' | 'relax'
>
export type SelfCareTodayCardActionKind =
  | 'archive'
  | 'complete'
  | 'edit'
  | 'restart'
  | 'schedule'
  | 'skip'
export type SelfCareSkipActionSection = 'overdue' | 'today'

export const TYPES_WITH_EXACT_SCHEDULE: ReadonlySet<SelfCareItemType> = new Set(
  [
    'appointment',
    'medical',
    'measurement',
    'mood_check',
    'procedure',
    'rest_action',
    'task',
  ],
)

export const SELF_CARE_PLAN_LOOKAHEAD_DAYS = 45

export const SELF_CARE_TABS: Array<{ id: SelfCareTab; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: 'plan', label: 'План' },
  { id: 'rituals', label: 'Все заботы' },
  { id: 'history', label: 'История' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'settings', label: 'Настройки' },
]

export function shouldShowSelfCareSkipAction(
  entry: SelfCareTodayItem,
  section: SelfCareSkipActionSection,
): boolean {
  return section === 'overdue' && entry.occurrence !== null
}

export function getSelfCareTodayCardActionOrder(input: {
  hasRestartAction: boolean
  hasScheduleAction: boolean
  hasSkipAction: boolean
}): SelfCareTodayCardActionKind[] {
  return [
    ...(input.hasRestartAction ? [] : (['complete'] as const)),
    'edit',
    'archive',
    ...(input.hasRestartAction ? (['restart'] as const) : []),
    ...(input.hasSkipAction ? (['skip'] as const) : []),
    ...(input.hasScheduleAction ? (['schedule'] as const) : []),
  ]
}

export const CATEGORY_LABELS: Record<SelfCareCategory, string> = {
  beauty: 'Уход',
  body: 'Красота',
  custom: 'Прочее',
  daily_base: 'Прочее',
  emotional: 'Прочее',
  health: 'Здоровье',
  medical: 'Здоровье',
  movement: 'Спорт',
  nutrition: 'Здоровье',
  relax: 'Восстановление',
  sleep: 'Восстановление',
}

export const VISIBLE_CATEGORY_LABELS: Record<VisibleSelfCareCategory, string> =
  {
    beauty: 'Уход',
    body: 'Красота',
    custom: 'Прочее',
    health: 'Здоровье',
    movement: 'Спорт',
    relax: 'Восстановление',
  }

export const VISIBLE_CATEGORY_ORDER: readonly VisibleSelfCareCategory[] = [
  'beauty',
  'body',
  'health',
  'movement',
  'relax',
  'custom',
]

export const CATEGORY_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareCategory>
> = VISIBLE_CATEGORY_ORDER.map((value) => ({
  label: VISIBLE_CATEGORY_LABELS[value],
  value,
}))

export const TIME_GROUP_LABELS: Record<SelfCareTimeOfDay, string> = {
  afternoon: 'День',
  anytime: 'В любое время',
  evening: 'Вечер',
  morning: 'Утро',
  night: 'Ночь',
}

export const TIME_GROUP_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareTimeOfDay>
> = (
  Object.entries(TIME_GROUP_LABELS) as Array<[SelfCareTimeOfDay, string]>
).map(([value, label]) => ({ label, value }))

export const TIME_PREFERENCE_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareTimePreference>
> = [
  ...TIME_GROUP_SELECT_OPTIONS,
  {
    label: 'Точное время',
    value: 'exact',
  },
]

export const REPEAT_LABELS: Record<SelfCareRepeatKind, string> = {
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

export const STATUS_LABELS: Record<SelfCareCompletion['status'], string> = {
  alternative_done: 'частично выполнено',
  cancelled: 'отменено',
  done: 'выполнено',
  moved: 'перенесено',
  partial: 'частично',
  skipped: 'мягко пропущено',
}

export const STANDARD_REPEAT_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareStandardRepeatKind
}> = [
  { label: 'Без повтора', value: 'none' },
  { label: 'Каждый день', value: 'daily' },
  { label: 'Еженедельно', value: 'weekly' },
  { label: 'Ежемесячно', value: 'monthly' },
  { label: 'Ежегодно', value: 'yearly' },
  { label: 'По интервалу', value: 'interval' },
  { label: 'После выполнения', value: 'after_completion' },
]

export const STANDARD_REPEAT_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareStandardRepeatKind>
> = STANDARD_REPEAT_OPTIONS.map(({ label, value }) => ({ label, value }))

export const COURSE_SCHEDULE_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareCourseScheduleMode
}> = [
  { label: 'Каждый день', value: 'daily' },
  { label: 'По дням недели', value: 'weekly' },
  { label: 'По интервалу', value: 'interval' },
]

export const COURSE_SCHEDULE_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareCourseScheduleMode>
> = COURSE_SCHEDULE_OPTIONS.map(({ label, value }) => ({ label, value }))

export const FLEXIBLE_GOAL_REPEAT_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareStandardRepeatKind
}> = [
  { label: 'Без повтора', value: 'none' },
  { label: 'Каждый день', value: 'daily' },
  { label: 'Еженедельно', value: 'weekly' },
  { label: 'Ежемесячно', value: 'monthly' },
  { label: 'Ежегодно', value: 'yearly' },
  { label: 'По интервалу', value: 'interval' },
]

export const FLEXIBLE_GOAL_REPEAT_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareStandardRepeatKind>
> = FLEXIBLE_GOAL_REPEAT_OPTIONS.map(({ label, value }) => ({ label, value }))

export const COURSE_REPEAT_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareCourseRepeatMode
}> = [
  { label: 'Один раз', value: 'once' },
  { label: 'Циклом', value: 'cycle' },
]

export const COURSE_REPEAT_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareCourseRepeatMode>
> = COURSE_REPEAT_OPTIONS.map(({ label, value }) => ({ label, value }))

export const INTERVAL_UNIT_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareIntervalUnit
}> = [
  { label: 'дней', value: 'day' },
  { label: 'недель', value: 'week' },
  { label: 'месяцев', value: 'month' },
  { label: 'лет', value: 'year' },
]

export const INTERVAL_UNIT_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareIntervalUnit>
> = INTERVAL_UNIT_OPTIONS.map(({ label, value }) => ({ label, value }))

export const FLEXIBLE_PERIOD_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareFlexiblePeriod
}> = [
  { label: 'день', value: 'day' },
  { label: 'неделю', value: 'week' },
  { label: 'месяц', value: 'month' },
]

export const FLEXIBLE_PERIOD_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareFlexiblePeriod>
> = FLEXIBLE_PERIOD_OPTIONS.map(({ label, value }) => ({ label, value }))

export const COURSE_TYPE_OPTIONS: ReadonlyArray<{
  label: string
  value: SelfCareCourseType
}> = [
  { label: 'дней', value: 'days' },
  { label: 'сессий', value: 'sessions' },
]

export const COURSE_TYPE_SELECT_OPTIONS: Array<
  SelectPickerOption<SelfCareCourseType>
> = COURSE_TYPE_OPTIONS.map(({ label, value }) => ({ label, value }))

export const WEEKDAY_OPTIONS: ReadonlyArray<{ label: string; value: number }> =
  [
    { label: 'Пн', value: 1 },
    { label: 'Вт', value: 2 },
    { label: 'Ср', value: 3 },
    { label: 'Чт', value: 4 },
    { label: 'Пт', value: 5 },
    { label: 'Сб', value: 6 },
    { label: 'Вс', value: 7 },
  ]

export const EVERY_WEEKDAY_VALUES = WEEKDAY_OPTIONS.map(({ value }) => value)
export const WORKDAY_VALUES = [1, 2, 3, 4, 5] as const

export const ADD_CARE_TEMPLATE_FILTERS: ReadonlyArray<{
  categories: SelfCareCategory[]
  label: string
  value: AddCareTemplateFilter
}> = [
  {
    categories: ['beauty', 'body'],
    label: 'Уход',
    value: 'beauty',
  },
  {
    categories: ['health', 'medical', 'nutrition'],
    label: 'Здоровье',
    value: 'health',
  },
  {
    categories: ['movement'],
    label: 'Движение',
    value: 'movement',
  },
  {
    categories: ['relax', 'sleep'],
    label: 'Отдых',
    value: 'rest',
  },
]

export const SELF_CARE_ACTION_SEARCH_PARAM = 'selfCareAction'
export const SELF_CARE_ACTION_REQUEST_SEARCH_PARAM = 'selfCareActionRequest'

export function buildCompletionInput(
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

export function buildRitualStepCompletionInput(
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

export function getRitualStepDraftKey(
  entry: SelfCareTodayItem,
  todayKey: string,
): string {
  return getRitualStepDraftKeyFromParts(
    todayKey,
    entry.item.id,
    entry.occurrence?.id ?? null,
  )
}

export function getRitualStepDraft(
  drafts: RitualStepDrafts,
  entry: SelfCareTodayItem,
  todayKey: string,
): readonly string[] | undefined {
  return drafts[getRitualStepDraftKey(entry, todayKey)]
}

export function getInitialRitualStepDraft(
  entry: SelfCareTodayItem,
): readonly string[] {
  return entry.steps
    .filter((step) => step.defaultChecked)
    .map((step) => step.id)
}

export function getEffectiveRitualStepIds(
  entry: SelfCareTodayItem,
  stepDraft: readonly string[] | undefined,
): readonly string[] {
  return stepDraft ?? getInitialRitualStepDraft(entry)
}

export function buildRitualStepDraftInput(
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

export function buildRitualStepDraftMap(
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

export function applyRitualStepDraftOverrides(
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

export function getRitualStepDraftKeyFromParts(
  date: string,
  itemId: string,
  occurrenceId: string | null,
): string {
  return `${date}:${itemId}:${occurrenceId ?? ''}`
}

export function groupTodayItems(
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

export function groupItemsByCategory(
  list: SelfCareListResponse | undefined,
): Record<VisibleSelfCareCategory, SelfCareItem[]> {
  const groups = VISIBLE_CATEGORY_ORDER.reduce(
    (current, category) => ({ ...current, [category]: [] }),
    {} as Record<VisibleSelfCareCategory, SelfCareItem[]>,
  )

  for (const item of list?.items ?? []) {
    if (!item.isArchived) {
      groups[getVisibleSelfCareCategory(item.category)].push(item)
    }
  }

  return groups
}

export function getVisibleSelfCareCategory(
  category: SelfCareCategory,
): VisibleSelfCareCategory {
  if (category === 'body') {
    return 'body'
  }

  if (category === 'beauty') {
    return 'beauty'
  }

  if (category === 'movement') {
    return 'movement'
  }

  if (category === 'relax' || category === 'sleep') {
    return 'relax'
  }

  if (
    category === 'health' ||
    category === 'medical' ||
    category === 'nutrition'
  ) {
    return 'health'
  }

  return 'custom'
}

export function buildVisibleCategoryDistribution(
  countsByCategory: Partial<Record<SelfCareCategory, number>>,
): Array<[VisibleSelfCareCategory, number]> {
  const totals = VISIBLE_CATEGORY_ORDER.reduce(
    (current, category) => ({ ...current, [category]: 0 }),
    {} as Record<VisibleSelfCareCategory, number>,
  )

  for (const [category, value] of Object.entries(countsByCategory) as Array<
    [SelfCareCategory, number]
  >) {
    if (value > 0) {
      totals[getVisibleSelfCareCategory(category)] += value
    }
  }

  return VISIBLE_CATEGORY_ORDER.map(
    (category) =>
      [category, totals[category]] as [VisibleSelfCareCategory, number],
  )
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
}

export function getSelfCareTab(searchParams: URLSearchParams): SelfCareTab {
  const value = searchParams.get('tab')
  return SELF_CARE_TABS.some((tab) => tab.id === value)
    ? (value as SelfCareTab)
    : 'today'
}

export function getAddCareFilterCategories(
  value: AddCareTemplateFilter,
): SelfCareCategory[] {
  return (
    ADD_CARE_TEMPLATE_FILTERS.find((filter) => filter.value === value)
      ?.categories ?? []
  )
}

export function getAddCareFilterLabel(value: AddCareTemplateFilter): string {
  return (
    ADD_CARE_TEMPLATE_FILTERS.find((filter) => filter.value === value)?.label ??
    'Шаблоны'
  )
}

export function getSelfCareCreateDialogMode(
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

export function firstErrorMessage(errors: unknown[]): string | null {
  const error = errors.find(Boolean)
  return error ? getSelfCareErrorMessage(error) : null
}

export function getInitialScheduleDate(
  entry: SelfCareTodayItem,
  fallbackDate: string,
): string {
  if (
    entry.occurrence?.scheduledFor &&
    entry.occurrence.scheduledFor >= fallbackDate
  ) {
    return entry.occurrence.scheduledFor
  }

  return entry.appointment
    ? formatLocalDateKey(entry.appointment.startsAt)
    : fallbackDate
}

export function getInitialScheduleTime(entry: SelfCareTodayItem): string {
  if (entry.occurrence?.dueAt) {
    return formatTime(entry.occurrence.dueAt)
  }

  const appointmentTime = entry.appointment
    ? formatTime(entry.appointment.startsAt)
    : null
  if (appointmentTime && appointmentTime !== '00:00') {
    return appointmentTime
  }

  return entry.scheduleRule?.preferredTime ?? ''
}

export function shouldUseExactSchedule(type: SelfCareItemType): boolean {
  return TYPES_WITH_EXACT_SCHEDULE.has(type)
}

export function shouldShowVisitDetails(type: SelfCareItemType): boolean {
  return type === 'appointment' || type === 'medical' || type === 'procedure'
}

export function getExactScheduleDateLabel(type: SelfCareItemType): string {
  if (type === 'appointment' || type === 'procedure' || type === 'medical') {
    return 'Дата записи'
  }

  if (type === 'measurement') {
    return 'Дата измерения'
  }

  if (type === 'mood_check') {
    return 'Дата отметки'
  }

  return 'Дата в плане'
}

export function getExactScheduleTimeLabel(type: SelfCareItemType): string {
  if (type === 'appointment' || type === 'procedure' || type === 'medical') {
    return 'Время записи'
  }

  if (type === 'measurement') {
    return 'Время измерения'
  }

  if (type === 'mood_check') {
    return 'Время отметки'
  }

  return 'Время'
}

export function getInitialMeasurementValue(entry: SelfCareTodayItem): string {
  return formatOptionalNumber(
    entry.lastMeasurement?.measurementValue ??
      entry.completion?.measurementValue,
  )
}

export function getInitialEditRepeatMode(
  rule: SelfCareScheduleRule | null,
): SelfCareEditRepeatMode {
  if (
    rule &&
    rule.repeatKind !== 'course' &&
    rule.repeatKind !== 'flexible_goal'
  ) {
    return rule.repeatKind
  }

  return 'keep'
}

export function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function parseOptionalPrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function parseOptionalMeasurementNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseRequiredMeasurementNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function isValidMeasurementTargetRange(
  targetMin: number | null,
  targetMax: number | null,
): boolean {
  return targetMin === null || targetMax === null || targetMin <= targetMax
}

export function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseNonnegativeInteger(value: string): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function parseBoundedInteger(
  value: string,
  min: number,
  max: number,
): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null
}

export function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

export function parseMultilineTitles(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function buildCreateScheduleRule(input: {
  courseScheduleMode?: SelfCareCourseScheduleMode | undefined
  dayOfMonth: number
  daysOfWeek: number[]
  flexiblePeriod: SelfCareFlexiblePeriod
  flexibleTargetCount: number
  hasFlexibleGoal?: boolean | undefined
  intervalUnit: SelfCareIntervalUnit
  intervalValue: number
  monthOfYear: number
  preferredTime?: string | null | undefined
  reminderOffsetsMinutes?: number[] | undefined
  repeatKind: SelfCareCreateRepeatKind
  startDate: string
  timezone?: string | null | undefined
}): SelfCareCreateScheduleRuleInput {
  const needsInterval =
    repeatKindRequiresInterval(input.repeatKind) ||
    (input.repeatKind === 'course' && input.courseScheduleMode === 'interval')
  const hasFlexibleGoal =
    input.hasFlexibleGoal || input.repeatKind === 'flexible_goal'
  const usesDayOfMonth =
    !hasFlexibleGoal &&
    (input.repeatKind === 'monthly' || input.repeatKind === 'yearly')
  const usesDaysOfWeek =
    !hasFlexibleGoal &&
    (input.repeatKind === 'weekly' ||
      (input.repeatKind === 'course' && input.courseScheduleMode === 'weekly'))

  return {
    allowMultiplePerDay: false,
    dayOfMonth: usesDayOfMonth ? input.dayOfMonth : null,
    daysOfWeek: usesDaysOfWeek ? input.daysOfWeek : [],
    endDate: null,
    flexiblePeriod: hasFlexibleGoal ? input.flexiblePeriod : null,
    flexibleTargetCount: hasFlexibleGoal ? input.flexibleTargetCount : null,
    generateInCalendar: false,
    generateInTaskList: true,
    intervalUnit: needsInterval ? input.intervalUnit : null,
    intervalValue: needsInterval ? input.intervalValue : null,
    monthOfYear:
      !hasFlexibleGoal && input.repeatKind === 'yearly'
        ? input.monthOfYear
        : null,
    preferredTime: input.preferredTime ?? null,
    reminderOffsetsMinutes: input.reminderOffsetsMinutes ?? [],
    repeatKind: input.repeatKind,
    startDate: input.startDate,
    timezone: input.timezone ?? null,
    weekOfMonth: null,
  }
}

export function repeatKindRequiresInterval(
  repeatKind: SelfCareCreateRepeatKind,
): boolean {
  return repeatKind === 'after_completion' || repeatKind === 'interval'
}

export function getCreateScheduleRepeatKind(
  type: SelfCareItemType,
  repeatKind: SelfCareStandardRepeatKind,
): SelfCareCreateRepeatKind {
  if (type === 'course') {
    return 'course'
  }

  if (type === 'flexible_goal') {
    return repeatKind
  }

  return repeatKind
}

export function getVisibleRepeatKind(
  type: SelfCareItemType,
  repeatKind: SelfCareStandardRepeatKind,
  options: {
    courseScheduleMode: SelfCareCourseScheduleMode
  },
): SelfCareCreateRepeatKind {
  if (type === 'course') {
    return getCourseVisibleRepeatKind(options.courseScheduleMode)
  }

  return getCreateScheduleRepeatKind(type, repeatKind)
}

export function getCourseVisibleRepeatKind(
  courseScheduleMode: SelfCareCourseScheduleMode,
): SelfCareCreateRepeatKind {
  if (courseScheduleMode === 'weekly') {
    return 'weekly'
  }

  if (courseScheduleMode === 'interval') {
    return 'interval'
  }

  return 'daily'
}

export function toggleWeekday(current: number[], weekday: number): number[] {
  const next = current.includes(weekday)
    ? current.filter((value) => value !== weekday)
    : [...current, weekday]

  return next.sort((left, right) => left - right)
}

export function buildDateTimeInput(
  dateKey: string,
  time: string | null,
): string {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number)
  const [hours = 0, minutes = 0] = (time ?? '00:00').split(':').map(Number)
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0)

  return date.toISOString()
}

export function getCreatedTemplateIds(
  list: SelfCareListResponse | undefined,
): ReadonlySet<string> {
  return new Set(
    (list?.items ?? [])
      .filter((item) => !item.isArchived && item.createdFromTemplateId)
      .map((item) => item.createdFromTemplateId as string),
  )
}

export function isVisibleSelfCareTemplate(template: SelfCareTemplate): boolean {
  return template.type !== 'mood_check' && template.category !== 'emotional'
}

export function canRestartCourse(entry: SelfCareTodayItem): boolean {
  return Boolean(
    entry.item.type === 'course' &&
    entry.item.isActive &&
    !entry.item.isArchived &&
    !entry.item.deletedAt &&
    entry.courseDetails?.isCompleted,
  )
}

export function getDefaultFlexibleGoalRepeatKind(
  period: SelfCareFlexiblePeriod,
): SelfCareStandardRepeatKind {
  if (period === 'day') return 'daily'
  if (period === 'month') return 'monthly'
  return 'weekly'
}

export function getDefaultFlexibleGoalIntervalUnit(
  period: SelfCareFlexiblePeriod,
): SelfCareIntervalUnit {
  if (period === 'day') return 'day'
  if (period === 'month') return 'month'
  return 'week'
}

export function getInitialFlexibleGoalRepeatMode(
  rule: SelfCareScheduleRule | null,
): SelfCareStandardRepeatKind {
  if (!rule) {
    return 'weekly'
  }

  if (rule.repeatKind === 'flexible_goal') {
    return getDefaultFlexibleGoalRepeatKind(rule.flexiblePeriod ?? 'week')
  }

  if (rule.repeatKind === 'course' || rule.repeatKind === 'after_completion') {
    return getDefaultFlexibleGoalRepeatKind(rule.flexiblePeriod ?? 'week')
  }

  return rule.repeatKind
}

export function buildRestartCourseScheduleRule(
  entry: SelfCareTodayItem,
  restartDate: string,
): SelfCareCreateScheduleRuleInput {
  const rule = entry.scheduleRule

  return {
    allowMultiplePerDay: rule?.allowMultiplePerDay ?? false,
    dayOfMonth: null,
    daysOfWeek: rule?.repeatKind === 'course' ? rule.daysOfWeek : [],
    endDate: null,
    flexiblePeriod: null,
    flexibleTargetCount: null,
    generateInCalendar: rule?.generateInCalendar ?? false,
    generateInTaskList: rule?.generateInTaskList ?? true,
    intervalUnit: rule?.repeatKind === 'course' ? rule.intervalUnit : null,
    intervalValue: rule?.repeatKind === 'course' ? rule.intervalValue : null,
    monthOfYear: null,
    preferredTime: rule?.preferredTime ?? null,
    reminderOffsetsMinutes: rule?.reminderOffsetsMinutes ?? [],
    repeatKind: 'course',
    startDate: restartDate,
    timezone: rule?.timezone ?? null,
    weekOfMonth: null,
  }
}

export function formatSchedule(rule: SelfCareScheduleRule | null): string {
  if (!rule) {
    return 'по необходимости'
  }

  if (rule.flexibleTargetCount && rule.flexiblePeriod) {
    const targetLabel = `${rule.flexibleTargetCount} ${pluralRu(
      rule.flexibleTargetCount,
      'раз',
      'раза',
      'раз',
    )} за ${formatFlexiblePeriod(rule.flexiblePeriod)}`
    const repeatLabel = formatFlexibleGoalRepeat(rule)
    return repeatLabel ? `${targetLabel} · ${repeatLabel}` : targetLabel
  }

  if (
    (rule.repeatKind === 'interval' ||
      rule.repeatKind === 'after_completion') &&
    rule.intervalValue &&
    rule.intervalUnit
  ) {
    return `каждые ${rule.intervalValue} ${formatIntervalUnit(rule.intervalUnit)}`
  }

  if (rule.repeatKind === 'course') {
    if (rule.daysOfWeek.length > 0) {
      return `курс: ${formatWeeklySchedule(rule)}`
    }

    if (rule.intervalValue && rule.intervalUnit) {
      return `курс: каждые ${rule.intervalValue} ${formatIntervalUnit(rule.intervalUnit)}`
    }

    return 'курс: каждый день'
  }

  if (rule.repeatKind === 'weekly') {
    return formatWeeklySchedule(rule)
  }

  return REPEAT_LABELS[rule.repeatKind]
}

export function formatWeeklySchedule(rule: SelfCareScheduleRule): string {
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

function formatFlexiblePeriod(period: SelfCareFlexiblePeriod): string {
  if (period === 'day') return 'день'
  if (period === 'month') return 'месяц'
  return 'неделю'
}

function formatFlexibleGoalRepeat(rule: SelfCareScheduleRule): string | null {
  if (rule.repeatKind === 'none') {
    return 'без повтора'
  }

  if (rule.repeatKind === 'flexible_goal') {
    const defaultRepeat = getDefaultFlexibleGoalRepeatKind(
      rule.flexiblePeriod ?? 'week',
    )
    return REPEAT_LABELS[defaultRepeat]
  }

  if (
    (rule.repeatKind === 'interval' ||
      rule.repeatKind === 'after_completion') &&
    rule.intervalValue &&
    rule.intervalUnit
  ) {
    return `каждые ${rule.intervalValue} ${formatIntervalUnit(rule.intervalUnit)}`
  }

  if (rule.repeatKind === 'course') {
    return null
  }

  return REPEAT_LABELS[rule.repeatKind]
}

export function areSameWeekdays(
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export function getTodayScheduleLabel(entry: SelfCareTodayItem): string | null {
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

export function formatIntervalUnit(
  unit: NonNullable<SelfCareScheduleRule['intervalUnit']>,
): string {
  if (unit === 'day') return 'дн.'
  if (unit === 'week') return 'нед.'
  if (unit === 'month') return 'мес.'
  return 'г.'
}

export function getTypeLabel(item: SelfCareItem): string {
  if (item.type === 'habit') return 'регулярная забота'
  if (item.type === 'flexible_goal') return 'цель на период'
  if (item.type === 'mood_check') return 'состояние'
  if (item.type === 'rest_action') return 'задача'
  if (
    item.type === 'medical' ||
    item.type === 'appointment' ||
    item.type === 'procedure'
  ) {
    return 'запись'
  }
  if (item.type === 'course') return 'курс'
  if (item.type === 'ritual') return 'ритуал'
  if (item.type === 'measurement') return 'измерение'
  return 'задача'
}

export function getTemplateTypeLabel(template: SelfCareTemplate): string {
  if (template.type === 'habit') return 'регулярная забота'
  if (template.type === 'flexible_goal') return 'цель'
  if (template.type === 'mood_check') return 'состояние'
  if (template.type === 'rest_action') return 'задача'
  if (
    template.type === 'medical' ||
    template.type === 'appointment' ||
    template.type === 'procedure'
  ) {
    return 'запись'
  }
  if (template.type === 'course') return 'курс'
  if (template.type === 'ritual') return 'ритуал'
  if (template.type === 'measurement') return 'измерение'
  return 'задача'
}

export function formatDate(dateKey: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(new Date(`${dateKey}T12:00:00`))
}

export function formatShortDate(dateKey: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dateKey}T12:00:00`))
}

export function formatMonthKey(monthKey: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${monthKey}-01T12:00:00`))
}

export function formatTime(value: string): string {
  const plainTime = /^(\d{2}:\d{2})/.exec(value)?.[1]

  if (plainTime) {
    return plainTime
  }

  const date = new Date(value)

  if (!Number.isNaN(date.getTime())) {
    return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
  }

  return /T(\d{2}:\d{2})/.exec(value)?.[1] ?? value.slice(0, 5)
}

function formatLocalDateKey(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10)
  }

  return [
    date.getFullYear(),
    padTimePart(date.getMonth() + 1),
    padTimePart(date.getDate()),
  ].join('-')
}

function padTimePart(value: number): string {
  return String(value).padStart(2, '0')
}

export function getPercent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

export function formatMoney(value: number, currency = 'RUB'): string {
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

export function formatMeasurementValue(
  value: number,
  unit: string | null | undefined,
): string {
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(value)

  return unit ? `${formatted} ${unit}` : formatted
}

export function formatMeasurementDelta(
  value: number,
  unit: string | null | undefined,
): string {
  if (value === 0) {
    return 'без изменений'
  }

  const formatted = formatMeasurementValue(value, unit)
  return value > 0 ? `+${formatted}` : formatted
}

export function formatMeasurementSummary(
  entry: SelfCareTodayItem,
): string | null {
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

export function formatMeasurementTarget(
  entry: SelfCareTodayItem,
): string | null {
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

export function formatStateSummary(entry: SelfCareTodayItem): string | null {
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

export function formatStateCompletionSummary(
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

export function hasStateCompletionValues(
  completion: SelfCareCompletion | null,
): boolean {
  return Boolean(
    completion &&
    (completion.moodAfter !== null || completion.energyAfter !== null),
  )
}

export function formatEntryDetails(entry: SelfCareTodayItem): string | null {
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

export function formatCompletionState(
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

export function formatCourseCompletionState(
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

export function getPrimaryActionLabel(
  entry: SelfCareTodayItem,
  isDone: boolean,
): string {
  if (entry.item.type === 'measurement') {
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

export function getCourseProgress(course: SelfCareCourseDetails | null): {
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
    : course.repeatAfterCompletion
      ? course.breakDays > 0
        ? `Осталось ${remainingCount} ${remainingUnit}; затем перерыв ${course.breakDays} ${pluralRu(
            course.breakDays,
            'день',
            'дня',
            'дней',
          )}`
        : `Осталось ${remainingCount} ${remainingUnit}; затем следующий цикл`
      : `Осталось ${remainingCount} ${remainingUnit}`

  return {
    ariaLabel: `${label}. ${meta}`,
    label,
    meta,
    percent,
  }
}

export function getCourseUnitLabel(
  courseType: SelfCareCourseDetails['courseType'],
  count: number,
): string {
  return courseType === 'sessions'
    ? pluralRu(count, 'сессия', 'сессии', 'сессий')
    : pluralRu(count, 'день', 'дня', 'дней')
}

export function pluralRu(
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

export function formatPlanningText(entry: SelfCareTodayItem): string {
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

export function formatTomorrowPlanSummary(count: number | null): string {
  if (count === null) {
    return 'План загружается'
  }

  if (count === 0) {
    return 'Пока ничего не запланировано'
  }

  return `${count} ${pluralizeRu(count, 'ритуал', 'ритуала', 'ритуалов')} запланировано`
}

export function pluralizeRu(
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
