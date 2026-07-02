import type {
  SelfCareCompletion,
  SelfCareDashboardResponse,
  SelfCareHistoryResponse,
  SelfCareIntervalUnit,
  SelfCareItem,
  SelfCareItemScheduleInput,
  SelfCareListResponse,
  SelfCareOccurrenceMoveInput,
  SelfCarePlanResponse,
  SelfCareScheduleRule,
  SelfCareTimeOfDay,
  SelfCareTodayItem,
} from '@planner/contracts'

import {
  addDateDays,
  addDateMonthsClamped,
  getDateDistance,
  getIsoWeekday as getIsoWeekdayForDateOnly,
} from '@/shared/time/time.service'

type SelfCareQueryScope =
  'analytics' | 'dashboard' | 'history' | 'items' | 'plan'

type ScheduleMutationVariables = {
  input: SelfCareItemScheduleInput
  itemId: string
  skipInvalidation?: boolean | undefined
}

type MoveOccurrenceMutationVariables = {
  input: SelfCareOccurrenceMoveInput
  invalidationScopes?: readonly SelfCareQueryScope[] | undefined
  occurrenceId: string
}

type SelfCareScheduleEntry = {
  item: Pick<SelfCareTodayItem['item'], 'id'>
  occurrence: Pick<
    NonNullable<SelfCareTodayItem['occurrence']>,
    'id' | 'scheduledFor'
  > | null
}

interface ScheduleSelfCareEntryOccurrenceOptions {
  entry: SelfCareScheduleEntry
  input: SelfCareItemScheduleInput
  moveNote: string
  moveOccurrence: (
    variables: MoveOccurrenceMutationVariables,
  ) => Promise<unknown>
  scheduleItem: (variables: ScheduleMutationVariables) => Promise<unknown>
}

const SELF_CARE_RESCHEDULE_SCOPES: readonly SelfCareQueryScope[] = [
  'dashboard',
  'items',
  'plan',
  'history',
  'analytics',
]
const HIDDEN_TODAY_OCCURRENCE_STATUSES: ReadonlySet<
  NonNullable<SelfCareTodayItem['occurrence']>['status']
> = new Set(['cancelled', 'done', 'missed', 'moved', 'partial', 'skipped'])

export function shouldMoveExistingSelfCareOccurrence(
  entry: SelfCareScheduleEntry,
  input: SelfCareItemScheduleInput,
): boolean {
  return Boolean(
    entry.occurrence && input.scheduledFor !== entry.occurrence.scheduledFor,
  )
}

export async function scheduleSelfCareEntryOccurrence({
  entry,
  input,
  moveNote,
  moveOccurrence,
  scheduleItem,
}: ScheduleSelfCareEntryOccurrenceOptions): Promise<void> {
  const shouldMoveExistingOccurrence = shouldMoveExistingSelfCareOccurrence(
    entry,
    input,
  )

  await scheduleItem({
    input,
    itemId: entry.item.id,
    skipInvalidation: shouldMoveExistingOccurrence,
  })

  if (!entry.occurrence || !shouldMoveExistingOccurrence) {
    return
  }

  await moveOccurrence({
    invalidationScopes: SELF_CARE_RESCHEDULE_SCOPES,
    input: {
      newDate: input.scheduledFor,
      note: moveNote,
    },
    occurrenceId: entry.occurrence.id,
  })
}

export function buildItemEntry(
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
    exercise:
      list.exerciseDetails.find((details) => details.itemId === item.id) ??
      null,
    flexibleProgress: null,
    item,
    lastExercise: null,
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

export function buildTodayCourseEntries(input: {
  dashboardTodayItems: SelfCareTodayItem[]
  latestCompletionByItemId: ReadonlyMap<string, SelfCareCompletion>
  nextPlannedDateByItemId: ReadonlyMap<string, string>
  planCourses: SelfCareTodayItem[]
  todayKey: string
}): SelfCareTodayItem[] {
  const byItemId = new Map<string, SelfCareTodayItem>()

  for (const entry of input.dashboardTodayItems) {
    if (entry.item.type === 'course') {
      byItemId.set(entry.item.id, entry)
    }
  }

  for (const entry of input.planCourses) {
    if (!byItemId.has(entry.item.id)) {
      byItemId.set(entry.item.id, entry)
    }
  }

  return [...byItemId.values()]
    .map((entry) =>
      mergeLatestProgressCompletion(
        entry,
        input.latestCompletionByItemId.get(entry.item.id) ?? null,
      ),
    )
    .filter((entry) =>
      shouldShowCourseInToday(
        entry,
        input.todayKey,
        input.nextPlannedDateByItemId.get(entry.item.id),
      ),
    )
    .sort(compareTodayEntries)
}

export function buildAvailableTodayEntries(input: {
  dashboard: SelfCareDashboardResponse | undefined
  history: SelfCareHistoryResponse | undefined
  list: SelfCareListResponse | undefined
  plan: SelfCarePlanResponse | undefined
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

export function buildRitualDashboardItems(
  dashboard: SelfCareDashboardResponse | undefined,
): SelfCareTodayItem[] {
  if (!dashboard) {
    return []
  }

  const byItemId = new Map<string, SelfCareTodayItem>()

  for (const entry of [
    ...dashboard.todayItems,
    ...dashboard.flexibleGoals,
    ...dashboard.overdueItems,
  ]) {
    byItemId.set(entry.item.id, entry)
  }

  return [...byItemId.values()]
}

export function compareTodayEntries(
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

export function shouldShowAvailableTodayEntry(
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

  if (isExercisePartialToday(entry, todayKey)) {
    return true
  }

  return isScheduleRuleAvailableToday(
    entry.scheduleRule,
    entry.completion,
    todayKey,
  )
}

export function isScheduleRuleAvailableToday(
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

export function getLatestProgressCompletionByItemId(
  history: SelfCareHistoryResponse | undefined,
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

export function mergeLatestProgressCompletion(
  entry: SelfCareTodayItem,
  latestCompletion: SelfCareCompletion | null,
): SelfCareTodayItem {
  if (!latestCompletion) {
    return entry
  }

  return {
    ...entry,
    completion: entry.completion ?? latestCompletion,
    lastExercise:
      latestCompletion.measurementValue === null ||
      entry.item.type !== 'exercise'
        ? entry.lastExercise
        : latestCompletion,
    lastMeasurement:
      latestCompletion.measurementValue === null ||
      entry.item.type !== 'measurement'
        ? entry.lastMeasurement
        : latestCompletion,
  }
}

export function mergeRitualProgressCompletion(
  entry: SelfCareTodayItem,
  latestCompletion: SelfCareCompletion | null,
): SelfCareTodayItem {
  const merged = mergeLatestProgressCompletion(entry, latestCompletion)

  if (
    entry.occurrence &&
    entry.occurrence.status === 'scheduled' &&
    !entry.completion
  ) {
    return {
      ...merged,
      completion: null,
    }
  }

  return merged
}

export function getNextPlannedDateByItemId(
  plan: SelfCarePlanResponse | undefined,
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

export function getPlanOccurrenceEntries(
  plan: SelfCarePlanResponse | undefined,
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

export function inferNextCompletionDate(input: {
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

export function shouldShowTodayEntry(entry: SelfCareTodayItem): boolean {
  if (entry.item.isArchived || !entry.item.isActive) {
    return false
  }

  if (entry.item.type === 'course') {
    return false
  }

  if (entry.completion && !isExercisePartialToday(entry)) {
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

export function shouldShowOverdueEntry(entry: SelfCareTodayItem): boolean {
  if (entry.item.isArchived || !entry.item.isActive) {
    return false
  }

  if (
    entry.item.type === 'course' &&
    (entry.courseDetails?.isCompleted || entry.courseDetails?.isPaused)
  ) {
    return false
  }

  if (isStaleCourseOccurrence(entry)) {
    return false
  }

  if (entry.completion && !isExercisePartialToday(entry)) {
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

export function shouldShowPlannedEntry(entry: SelfCareTodayItem): boolean {
  if (entry.item.isArchived || !entry.item.isActive) {
    return false
  }

  if (
    entry.item.type === 'course' &&
    (entry.courseDetails?.isCompleted || entry.courseDetails?.isPaused)
  ) {
    return false
  }

  if (isStaleCourseOccurrence(entry)) {
    return false
  }

  if (entry.completion) {
    return false
  }

  return entry.occurrence
    ? !HIDDEN_TODAY_OCCURRENCE_STATUSES.has(entry.occurrence.status)
    : true
}

export function isClosedTodayEntry(entry: SelfCareTodayItem): boolean {
  if (entry.item.type === 'course' && entry.courseDetails?.isCompleted) {
    return true
  }

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

export function getPlannedEntriesCountForDate(
  plan: SelfCarePlanResponse | undefined,
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

export function isEntryDoneToday(
  entry: SelfCareTodayItem,
  todayKey: string,
): boolean {
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

  if (entry.item.type === 'exercise') {
    if (
      entry.completion?.status !== 'partial' &&
      isCompletionDoneToday(entry.completion, todayKey)
    ) {
      return true
    }

    return Boolean(
      entry.occurrence?.status === 'done' &&
      (entry.occurrence.completedAt?.slice(0, 10) ??
        entry.occurrence.scheduledFor) === todayKey,
    )
  }

  if (isCompletionDoneToday(entry.completion, todayKey)) {
    return true
  }

  return isOccurrenceDoneToday(entry.occurrence, todayKey)
}

function isExercisePartialToday(
  entry: SelfCareTodayItem,
  todayKey = entry.completion?.completedAt.slice(0, 10),
): boolean {
  return Boolean(
    entry.item.type === 'exercise' &&
    entry.completion?.status === 'partial' &&
    entry.completion.completedAt.slice(0, 10) === todayKey,
  )
}

export function isCompletionDoneToday(
  completion: SelfCareCompletion | null,
  todayKey: string,
): boolean {
  return Boolean(
    completion &&
    isProgressCompletionStatus(completion.status) &&
    completion.completedAt.slice(0, 10) === todayKey,
  )
}

export function isProgressCompletionStatus(
  status: SelfCareCompletion['status'],
): boolean {
  return (
    status === 'done' || status === 'partial' || status === 'alternative_done'
  )
}

export function addRepeatInterval(
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

export function addIntervalDateKey(
  dateKey: string,
  value: number,
  unit: SelfCareIntervalUnit,
): string {
  if (unit === 'day') return shiftDateKey(dateKey, value)
  if (unit === 'week') return shiftDateKey(dateKey, value * 7)
  if (unit === 'month') return shiftMonthKey(dateKey, value)
  return shiftMonthKey(dateKey, value * 12)
}

export function shiftDateKey(dateKey: string, days: number): string {
  return addDateDays(dateKey, days)
}

function shiftMonthKey(dateKey: string, months: number): string {
  return addDateMonthsClamped(dateKey, months)
}

export function getIsoWeekdayFromDateKey(dateKey: string): number {
  return getIsoWeekdayForDateOnly(dateKey)
}

export function getDatePart(dateKey: string, part: 'day' | 'month'): number {
  return Number(part === 'day' ? dateKey.slice(8, 10) : dateKey.slice(5, 7))
}

function getOccupiedTodayItemIds(
  dashboard: SelfCareDashboardResponse | undefined,
  plan: SelfCarePlanResponse | undefined,
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

function getTimeGroupWeight(timeGroup: SelfCareTimeOfDay): number {
  if (timeGroup === 'morning') return 0
  if (timeGroup === 'afternoon') return 1
  if (timeGroup === 'evening') return 2
  if (timeGroup === 'night') return 3
  return 4
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

  if (isStaleCourseOccurrence(entry)) {
    return false
  }

  if (
    entry.scheduleRule?.startDate &&
    entry.scheduleRule.startDate > todayKey
  ) {
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
  return getDateDistance(startDate, endDate)
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
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

function comparePlanOccurrenceEntries(
  left: SelfCareTodayItem,
  right: SelfCareTodayItem,
): number {
  const dateDiff = (left.occurrence?.scheduledFor ?? '').localeCompare(
    right.occurrence?.scheduledFor ?? '',
  )

  return dateDiff === 0 ? compareTodayEntries(left, right) : dateDiff
}

function isStaleCourseOccurrence(entry: SelfCareTodayItem): boolean {
  return Boolean(
    entry.item.type === 'course' &&
    entry.occurrence &&
    entry.scheduleRule?.repeatKind === 'course' &&
    entry.scheduleRule.startDate &&
    entry.occurrence.scheduledFor < entry.scheduleRule.startDate,
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
