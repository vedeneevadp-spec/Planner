import {
  generateUuidV7,
  type HabitEntryRecord,
  type HabitRecord,
  type SelfCareAnalyticsResponse,
  type SelfCareAppointmentDetails,
  type SelfCareAppointmentDetailsInput,
  type SelfCareCategory,
  type SelfCareCompletion,
  type SelfCareCompletionInput,
  type SelfCareCompletionStatus,
  type SelfCareCourseDetails,
  type SelfCareCourseDetailsInput,
  type SelfCareDailyState,
  type SelfCareDailyStateInput,
  type SelfCareDashboardResponse,
  type SelfCareFlexibleGoalProgress,
  type SelfCareHistoryResponse,
  type SelfCareItem,
  type SelfCareItemAlternative,
  type SelfCareItemInput,
  type SelfCareListResponse,
  type SelfCareMeasurementDetails,
  type SelfCareMeasurementDetailsInput,
  type SelfCareMeasurementTrend,
  type SelfCareMedicalDetails,
  type SelfCareMedicalDetailsInput,
  type SelfCareMinimumItem,
  type SelfCareMinimumItemInput,
  type SelfCareOccurrence,
  type SelfCarePlanResponse,
  type SelfCareProcedureDetails,
  type SelfCareProcedureDetailsInput,
  type SelfCareRitualCompletionInput,
  type SelfCareRitualStep,
  type SelfCareRitualStepCompletion,
  type SelfCareRitualStepInput,
  type SelfCareScheduleRule,
  type SelfCareScheduleRuleInput,
  type SelfCareSettings,
  type SelfCareTemplate,
  type SelfCareTimeOfDay,
  type SelfCareTodayItem,
} from '@planner/contracts'

import {
  addDays,
  addInterval,
  buildDueAt,
  generateSelfCareOccurrenceDates,
  getDateKey,
  getFlexibleGoalPeriod,
  getFlexibleGoalProgress,
  isCompletionProgressStatus,
  normalizeDaysOfWeek,
} from './self-care.recurrence.js'

export {
  addDays,
  addInterval,
  buildDueAt,
  generateSelfCareOccurrenceDates,
  getDateKey,
  getFlexibleGoalPeriod,
  getFlexibleGoalProgress,
  getIsoWeekday,
  isCompletionProgressStatus,
  normalizeDaysOfWeek,
} from './self-care.recurrence.js'

type SelfCareItemInputOverrides = {
  [K in keyof SelfCareItemInput]?: SelfCareItemInput[K] | undefined
}

const DEFAULT_MINIMUM_TITLES = [
  'вода',
  'еда',
  'умыться',
  'выйти на воздух',
  'лечь спать',
]
const AFTER_COMPLETION_PLANNING_ITEM_TYPES: ReadonlySet<SelfCareItem['type']> =
  new Set(['appointment', 'medical', 'procedure'])

export interface SelfCareStateSnapshot {
  alternatives: SelfCareItemAlternative[]
  appointmentDetails: SelfCareAppointmentDetails[]
  completions: SelfCareCompletion[]
  courseDetails: SelfCareCourseDetails[]
  dailyStates: SelfCareDailyState[]
  items: SelfCareItem[]
  medicalDetails: SelfCareMedicalDetails[]
  measurementDetails?: SelfCareMeasurementDetails[] | undefined
  minimumItems: SelfCareMinimumItem[]
  occurrences: SelfCareOccurrence[]
  procedureDetails: SelfCareProcedureDetails[]
  scheduleRules: SelfCareScheduleRule[]
  settings: SelfCareSettings
  stepCompletions: SelfCareRitualStepCompletion[]
  steps: SelfCareRitualStep[]
  templates: SelfCareTemplate[]
}

export interface CreateSelfCareRecordsResult {
  alternatives: SelfCareItemAlternative[]
  appointmentDetails: SelfCareAppointmentDetails | null
  courseDetails: SelfCareCourseDetails | null
  item: SelfCareItem
  medicalDetails: SelfCareMedicalDetails | null
  measurementDetails: SelfCareMeasurementDetails | null
  procedureDetails: SelfCareProcedureDetails | null
  scheduleRule: SelfCareScheduleRule | null
  steps: SelfCareRitualStep[]
}

export function createSelfCareRecords(
  input: SelfCareItemInput,
  context: {
    actorUserId: string
    createdFromTemplateId?: string | null | undefined
    workspaceId: string
  },
): CreateSelfCareRecordsResult {
  const now = new Date().toISOString()
  const itemId = input.id ?? generateUuidV7()
  const minimum = input.minimumVersion
  const item: SelfCareItem = {
    category: input.category,
    color: input.color,
    createdAt: now,
    createdFromTemplateId: context.createdFromTemplateId ?? null,
    customCategoryId: input.customCategoryId,
    defaultDurationMinutes: input.defaultDurationMinutes,
    deletedAt: null,
    description: input.description,
    icon: input.icon,
    id: itemId,
    importance: input.importance,
    isActive: input.isActive,
    isArchived: input.isArchived,
    isPrivate: input.isPrivate,
    migratedFromHabitId: input.migratedFromHabitId,
    minimumVersionDescription: minimum?.description || null,
    minimumVersionDurationMinutes: minimum?.durationMinutes ?? null,
    minimumVersionTitle: minimum?.title ?? null,
    preferredTimeOfDay: input.preferredTimeOfDay,
    title: input.title,
    type: input.type,
    updatedAt: now,
    userId: context.actorUserId,
    version: 1,
    workspaceId: context.workspaceId,
  }

  return {
    alternatives: input.alternatives.map((alternative) => ({
      countsAsCompletion: alternative.countsAsCompletion,
      description: alternative.description,
      id: alternative.id ?? generateUuidV7(),
      itemId,
      title: alternative.title,
    })),
    appointmentDetails: input.appointmentDetails
      ? createAppointmentDetailsRecord(itemId, input.appointmentDetails, now)
      : null,
    courseDetails: input.courseDetails
      ? createCourseDetailsRecord(itemId, input.courseDetails, now)
      : null,
    item,
    medicalDetails: input.medicalDetails
      ? createMedicalDetailsRecord(itemId, input.medicalDetails, now)
      : null,
    measurementDetails: input.measurementDetails
      ? createMeasurementDetailsRecord(itemId, input.measurementDetails, now)
      : null,
    procedureDetails: input.procedureDetails
      ? createProcedureDetailsRecord(itemId, input.procedureDetails, now)
      : null,
    scheduleRule: input.scheduleRule
      ? createScheduleRuleRecord(itemId, input.scheduleRule, now)
      : inferDefaultScheduleRule(item, now),
    steps: input.steps.map((step, index) =>
      createRitualStepRecord(itemId, step, index, now),
    ),
  }
}

export function createScheduleRuleRecord(
  itemId: string,
  input: SelfCareScheduleRuleInput,
  now = new Date().toISOString(),
): SelfCareScheduleRule {
  return {
    allowMultiplePerDay: input.allowMultiplePerDay,
    createdAt: now,
    dayOfMonth: input.dayOfMonth,
    daysOfWeek: normalizeDaysOfWeek(input.daysOfWeek),
    endDate: input.endDate,
    flexiblePeriod: input.flexiblePeriod,
    flexibleTargetCount: input.flexibleTargetCount,
    generateInCalendar: input.generateInCalendar,
    generateInTaskList: input.generateInTaskList,
    id: input.id ?? generateUuidV7(),
    intervalUnit: input.intervalUnit,
    intervalValue: input.intervalValue,
    itemId,
    monthOfYear: input.monthOfYear,
    preferredTime: input.preferredTime,
    reminderOffsetsMinutes: normalizeNumbers(input.reminderOffsetsMinutes),
    repeatKind: input.repeatKind,
    startDate: input.startDate,
    timezone: input.timezone,
    updatedAt: now,
    weekOfMonth: input.weekOfMonth,
  }
}

export function createRitualStepRecord(
  itemId: string,
  input: SelfCareRitualStepInput,
  index: number,
  now = new Date().toISOString(),
): SelfCareRitualStep {
  return {
    createdAt: now,
    defaultChecked: input.defaultChecked,
    id: input.id ?? generateUuidV7(),
    isOptional: input.isOptional,
    itemId,
    order: input.order ?? index,
    title: input.title,
    updatedAt: now,
  }
}

export function createProcedureDetailsRecord(
  itemId: string,
  input: SelfCareProcedureDetailsInput,
  now = new Date().toISOString(),
): SelfCareProcedureDetails {
  return {
    contact: input.contact,
    createdAt: now,
    currency: input.currency,
    defaultPrice: input.defaultPrice,
    id: generateUuidV7(),
    itemId,
    place: input.place,
    specialistName: input.specialistName,
    updatedAt: now,
  }
}

export function createAppointmentDetailsRecord(
  itemId: string,
  input: SelfCareAppointmentDetailsInput,
  now = new Date().toISOString(),
): SelfCareAppointmentDetails {
  return {
    createdAt: now,
    currency: input.currency,
    endsAt: input.endsAt,
    id: generateUuidV7(),
    itemId,
    occurrenceId: null,
    place: input.place,
    preparationNote: input.preparationNote,
    price: input.price,
    resultNote: input.resultNote,
    specialistContact: input.specialistContact,
    specialistName: input.specialistName,
    startsAt: input.startsAt,
    updatedAt: now,
  }
}

export function createMedicalDetailsRecord(
  itemId: string,
  input: SelfCareMedicalDetailsInput,
  now = new Date().toISOString(),
): SelfCareMedicalDetails {
  return {
    analysisList: input.analysisList,
    clinicAddress: input.clinicAddress,
    clinicName: input.clinicName,
    createdAt: now,
    documentUrls: input.documentUrls,
    doctorName: input.doctorName,
    id: generateUuidV7(),
    itemId,
    nextControlDate: input.nextControlDate,
    phone: input.phone,
    reminderStrategy: input.reminderStrategy,
    resultNote: input.resultNote,
    updatedAt: now,
    website: input.website,
  }
}

export function createCourseDetailsRecord(
  itemId: string,
  input: SelfCareCourseDetailsInput,
  now = new Date().toISOString(),
): SelfCareCourseDetails {
  return {
    breakDays: input.breakDays,
    completedCount: input.completedCount,
    courseType: input.courseType,
    createdAt: now,
    endDate: input.endDate,
    id: generateUuidV7(),
    isCompleted: input.isCompleted || input.completedCount >= input.totalCount,
    isPaused: input.isPaused,
    itemId,
    repeatAfterCompletion: input.repeatAfterCompletion,
    startDate: input.startDate,
    totalCount: input.totalCount,
    updatedAt: now,
  }
}

export function createMeasurementDetailsRecord(
  itemId: string,
  input: SelfCareMeasurementDetailsInput,
  now = new Date().toISOString(),
): SelfCareMeasurementDetails {
  return {
    createdAt: now,
    id: generateUuidV7(),
    itemId,
    targetMax: input.targetMax,
    targetMin: input.targetMin,
    unit: input.unit,
    updatedAt: now,
    valueLabel: input.valueLabel,
  }
}

export function createDefaultSelfCareSettings(input: {
  date?: string | undefined
  userId: string
}): SelfCareSettings {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    currency: 'RUB',
    defaultReminderTone: 'soft',
    gentleModeDate: null,
    gentleModeEnabledToday: false,
    id: generateUuidV7(),
    quietHoursEnd: '08:00',
    quietHoursStart: '22:00',
    showAppointmentsInCalendar: true,
    showSelfCareInMainTasks: true,
    updatedAt: now,
    userId: input.userId,
  }
}

export function createDefaultMinimumItems(
  userId: string,
): SelfCareMinimumItem[] {
  const now = new Date().toISOString()

  return DEFAULT_MINIMUM_TITLES.map((title, index) => ({
    createdAt: now,
    id: generateUuidV7(),
    isActive: true,
    linkedItemId: null,
    order: index,
    title,
    updatedAt: now,
    userId,
  }))
}

export function createMinimumItemRecord(
  input: SelfCareMinimumItemInput,
  context: { index: number; userId: string },
): SelfCareMinimumItem {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    id: input.id ?? generateUuidV7(),
    isActive: input.isActive,
    linkedItemId: input.linkedItemId,
    order: input.order ?? context.index,
    title: input.title,
    updatedAt: now,
    userId: context.userId,
  }
}

export function createDailyStateRecord(
  date: string,
  input: SelfCareDailyStateInput,
  context: { userId: string },
): SelfCareDailyState {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    date,
    energy: input.energy,
    id: generateUuidV7(),
    mood: input.mood,
    note: input.note,
    pain: input.pain,
    sleepQuality: input.sleepQuality,
    stress: input.stress,
    updatedAt: now,
    userId: context.userId,
  }
}

export function createCompletionRecord(
  input: SelfCareCompletionInput,
  context: {
    itemId: string
    occurrence?: SelfCareOccurrence | null | undefined
    scheduledFor?: string | null | undefined
    userId: string
  },
): SelfCareCompletion {
  const completedAt = input.completedAt ?? new Date().toISOString()

  return {
    alternativeTitle: input.alternativeTitle,
    completedAt,
    completedVariant: input.completedVariant,
    createdAt: completedAt,
    durationMinutes: input.durationMinutes,
    energyAfter: input.energyAfter,
    energyBefore: input.energyBefore,
    id: generateUuidV7(),
    itemId: context.itemId,
    measurementUnit: input.measurementUnit ?? null,
    measurementValue: input.measurementValue ?? null,
    moodAfter: input.moodAfter,
    moodBefore: input.moodBefore,
    note: input.note,
    occurrenceId: context.occurrence?.id ?? null,
    scheduledFor:
      context.scheduledFor ?? context.occurrence?.scheduledFor ?? null,
    status: input.status,
    userId: context.userId,
  }
}

export function createRitualStepCompletions(
  completionId: string,
  input: SelfCareRitualCompletionInput,
): SelfCareRitualStepCompletion[] {
  return input.steps.map((step) => ({
    completionId,
    id: generateUuidV7(),
    isDone: step.isDone,
    stepId: step.stepId,
  }))
}

export function inferRitualCompletionStatus(input: {
  requestedStatus: SelfCareCompletionStatus
  stepCompletions: SelfCareRitualStepCompletion[]
  steps: SelfCareRitualStep[]
}): SelfCareCompletionStatus {
  if (input.requestedStatus !== 'done') {
    return input.requestedStatus
  }

  if (input.steps.length === 0 || input.stepCompletions.length === 0) {
    return input.requestedStatus
  }

  const doneStepIds = new Set(
    input.stepCompletions
      .filter((completion) => completion.isDone)
      .map((completion) => completion.stepId),
  )
  const requiredSteps = input.steps.filter((step) => !step.isOptional)

  return requiredSteps.every((step) => doneStepIds.has(step.id))
    ? 'done'
    : 'partial'
}

export function createOccurrenceRecord(input: {
  dueAt: string | null
  item: SelfCareItem
  scheduledFor: string
  scheduleRule: SelfCareScheduleRule | null
}): SelfCareOccurrence {
  const now = new Date().toISOString()

  return {
    completedAt: null,
    createdAt: now,
    dueAt: input.dueAt,
    generatedAt: now,
    id: generateUuidV7(),
    itemId: input.item.id,
    movedTo: null,
    reminderOffsetsMinutes: [],
    reminderTimeZone: null,
    scheduledFor: input.scheduledFor,
    scheduleRuleId: input.scheduleRule?.id ?? null,
    status: 'scheduled',
    updatedAt: now,
    userId: input.item.userId,
  }
}

export function updateOccurrenceStatus(
  occurrence: SelfCareOccurrence,
  status: SelfCareOccurrence['status'],
  extra: Partial<Pick<SelfCareOccurrence, 'completedAt' | 'movedTo'>> = {},
): SelfCareOccurrence {
  return {
    ...occurrence,
    ...extra,
    status,
    updatedAt: new Date().toISOString(),
  }
}

export function generateSelfCareOccurrencesForRange(input: {
  completions: SelfCareCompletion[]
  courseDetails?: SelfCareCourseDetails | null | undefined
  existingOccurrences: SelfCareOccurrence[]
  from: string
  item: SelfCareItem
  scheduleRule: SelfCareScheduleRule | null
  to: string
}): SelfCareOccurrence[] {
  const { item, scheduleRule } = input

  if (
    !item.isActive ||
    item.isArchived ||
    item.deletedAt !== null ||
    !scheduleRule ||
    item.type === 'flexible_goal' ||
    scheduleRule.repeatKind === 'none' ||
    scheduleRule.repeatKind === 'flexible_goal'
  ) {
    return []
  }

  if (
    scheduleRule.repeatKind === 'course' &&
    input.courseDetails?.isCompleted
  ) {
    return []
  }

  if (scheduleRule.repeatKind === 'course' && input.courseDetails?.isPaused) {
    return []
  }

  if (isAfterCompletionPlanningItem(item, scheduleRule)) {
    return []
  }

  const existingDates = new Set(
    input.existingOccurrences
      .filter(
        (occurrence) =>
          occurrence.itemId === item.id &&
          (occurrence.scheduleRuleId === scheduleRule.id ||
            (!scheduleRule.allowMultiplePerDay &&
              occurrence.scheduleRuleId === null)),
      )
      .map((occurrence) => occurrence.scheduledFor),
  )
  const dates = generateSelfCareOccurrenceDates({
    completions: input.completions.filter(
      (completion) => completion.itemId === item.id,
    ),
    from: input.from,
    item,
    rule: scheduleRule,
    to: input.to,
  })

  return dates.flatMap((scheduledFor) => {
    if (existingDates.has(scheduledFor)) {
      return []
    }

    return [
      createOccurrenceRecord({
        dueAt: buildDueAt(scheduledFor, scheduleRule.preferredTime),
        item,
        scheduledFor,
        scheduleRule,
      }),
    ]
  })
}

export function buildDashboardResponse(input: {
  date: string
  state: SelfCareStateSnapshot
}): SelfCareDashboardResponse {
  const { date, state } = input
  const itemById = new Map(state.items.map((item) => [item.id, item]))
  const todayOccurrences = state.occurrences.filter(
    (occurrence) => occurrence.scheduledFor === date,
  )
  const flexibleGoalBlockedItemIds = new Set(
    todayOccurrences
      .filter(isFlexibleGoalBlockedByTodayOccurrence)
      .map((occurrence) => occurrence.itemId),
  )
  const todayItems = todayOccurrences
    .flatMap((occurrence) => {
      const item = itemById.get(occurrence.itemId)
      return item && isVisibleSelfCareItem(item)
        ? [buildTodayItem({ date, item, occurrence, state })]
        : []
    })
    .filter((entry) => shouldShowInDashboard(entry, state.settings, date))
    .sort(sortTodayItems)
  const flexibleGoals = state.scheduleRules
    .filter(
      (rule) =>
        isFlexibleGoalRuleActiveOnDate({
          date,
          item: itemById.get(rule.itemId) ?? null,
          rule,
        }) && !flexibleGoalBlockedItemIds.has(rule.itemId),
    )
    .flatMap((rule) => {
      const item = itemById.get(rule.itemId)
      return item && item.isActive && !item.isArchived
        ? [buildTodayItem({ date, item, occurrence: null, state })]
        : []
    })
    .filter((entry) => shouldShowInDashboard(entry, state.settings, date))
  const overdueItems = buildOverdueItems(date, state, itemById).filter(
    (entry) => shouldShowInDashboard(entry, state.settings, date),
  )
  const planningHints = buildPlanningHints(date, state)
  const upcomingImportant = buildUpcomingImportant(date, state)

  return {
    dailyState:
      state.dailyStates.find((dailyState) => dailyState.date === date) ?? null,
    date,
    flexibleGoals,
    gentleMode: isGentleModeEnabled(state.settings, date),
    minimumItems: state.minimumItems.filter((item) => item.isActive),
    overdueItems,
    planningHints,
    settings: state.settings,
    todayItems,
    upcomingImportant,
  }
}

function isFlexibleGoalBlockedByTodayOccurrence(
  occurrence: SelfCareOccurrence,
): boolean {
  return occurrence.status !== 'cancelled'
}

export function buildPlanResponse(input: {
  from: string
  state: SelfCareStateSnapshot
  to: string
}): SelfCarePlanResponse {
  const { from, state, to } = input
  const itemById = new Map(state.items.map((item) => [item.id, item]))
  const occurrences = state.occurrences
    .filter(
      (occurrence) =>
        occurrence.scheduledFor >= from && occurrence.scheduledFor <= to,
    )
    .flatMap((occurrence) => {
      const item = itemById.get(occurrence.itemId)
      return item &&
        isVisibleSelfCareItem(item) &&
        !isPlanningOnlyAfterCompletionOccurrence({
          item,
          occurrence,
          state,
        })
        ? [
            buildTodayItem({
              date: occurrence.scheduledFor,
              item,
              occurrence,
              state,
            }),
          ]
        : []
    })
    .sort(sortPlanItems)
  const courses = state.courseDetails.flatMap((course) => {
    const item = itemById.get(course.itemId)
    return item && isVisibleSelfCareItem(item) && !course.isCompleted
      ? [buildTodayItem({ date: from, item, occurrence: null, state })]
      : []
  })
  const medical = occurrences.filter((entry) => entry.item.type === 'medical')

  return {
    courses,
    from,
    medical,
    occurrences,
    planningHints: buildPlanningHints(from, state),
    to,
  }
}

export function buildHistoryResponse(input: {
  from: string
  state: SelfCareStateSnapshot
  to: string
}): SelfCareHistoryResponse {
  const completions = input.state.completions
    .filter(
      (completion) =>
        completion.completedAt.slice(0, 10) >= input.from &&
        completion.completedAt.slice(0, 10) <= input.to,
    )
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
  const completionIds = new Set(completions.map((completion) => completion.id))

  return {
    completions,
    items: input.state.items,
    stepCompletions: input.state.stepCompletions.filter((step) =>
      completionIds.has(step.completionId),
    ),
  }
}

export function buildAnalyticsResponse(input: {
  from: string
  state: SelfCareStateSnapshot
  to: string
}): SelfCareAnalyticsResponse {
  const history = buildHistoryResponse(input)
  const itemById = new Map(input.state.items.map((item) => [item.id, item]))
  const measurementDetailsByItemId = new Map(
    (input.state.measurementDetails ?? []).map((details) => [
      details.itemId,
      details,
    ]),
  )
  const appointmentDetailsByItemId = new Map(
    input.state.appointmentDetails.map((details) => [details.itemId, details]),
  )
  const procedureDetailsByItemId = new Map(
    input.state.procedureDetails.map((details) => [details.itemId, details]),
  )
  const balanceByCategory = createEmptyCategoryCounts()
  const completionsByDay: Record<string, number> = {}
  const flexibleGoalItemIds = new Set<string>()
  const measurementTrendByItemId = new Map<string, SelfCareMeasurementTrend>()
  let procedureCosts = 0
  const procedureCostsByMonth: Record<string, number> = {}

  for (const completion of history.completions) {
    if (!isCompletionProgressStatus(completion.status)) {
      continue
    }

    const item = itemById.get(completion.itemId)

    if (item) {
      balanceByCategory[item.category] += 1
    }

    const dateKey = completion.completedAt.slice(0, 10)
    completionsByDay[dateKey] = (completionsByDay[dateKey] ?? 0) + 1

    if (item?.type === 'appointment' || item?.type === 'procedure') {
      const price =
        item.type === 'appointment'
          ? (appointmentDetailsByItemId.get(item.id)?.price ?? 0)
          : (procedureDetailsByItemId.get(item.id)?.defaultPrice ?? 0)

      if (price > 0) {
        const monthKey = dateKey.slice(0, 7)
        procedureCosts += price
        procedureCostsByMonth[monthKey] =
          (procedureCostsByMonth[monthKey] ?? 0) + price
      }
    }

    if (item?.type === 'measurement' && completion.measurementValue !== null) {
      const details = measurementDetailsByItemId.get(item.id)
      const trend = measurementTrendByItemId.get(item.id) ?? {
        itemId: item.id,
        points: [],
        title: item.title,
        unit: completion.measurementUnit ?? details?.unit ?? null,
        valueLabel: details?.valueLabel ?? 'Значение',
      }

      trend.points.push({
        completedAt: completion.completedAt,
        date: dateKey,
        value: completion.measurementValue,
      })
      measurementTrendByItemId.set(item.id, trend)
    }
  }

  const measurementTrends = [...measurementTrendByItemId.values()]
    .map((trend) => ({
      ...trend,
      points: [...trend.points].sort((left, right) =>
        left.completedAt.localeCompare(right.completedAt),
      ),
    }))
    .sort((left, right) => {
      const leftLatest = left.points[left.points.length - 1]?.completedAt ?? ''
      const rightLatest =
        right.points[right.points.length - 1]?.completedAt ?? ''

      return rightLatest.localeCompare(leftLatest)
    })

  return {
    balanceByCategory,
    completionsByDay,
    courses: input.state.courseDetails.flatMap((course) => {
      const item = itemById.get(course.itemId)
      return item
        ? [
            buildTodayItem({
              date: input.to,
              item,
              occurrence: null,
              state: input.state,
            }),
          ]
        : []
    }),
    flexibleGoals: input.state.scheduleRules
      .filter((rule) => rule.flexibleTargetCount && rule.flexiblePeriod)
      .flatMap((rule) => {
        const item = itemById.get(rule.itemId)
        if (
          !item ||
          item.type !== 'flexible_goal' ||
          !isVisibleSelfCareItem(item) ||
          flexibleGoalItemIds.has(item.id)
        ) {
          return []
        }

        flexibleGoalItemIds.add(item.id)
        return [
          buildTodayItem({
            date: input.to,
            item,
            occurrence: null,
            state: input.state,
          }),
        ]
      }),
    medicalUpcoming: buildUpcomingImportant(input.to, input.state).filter(
      (entry) => entry.item.type === 'medical',
    ),
    measurementTrends,
    minimumCompletionCount: history.completions.filter((completion) =>
      completion.note.toLowerCase().includes('миним'),
    ).length,
    moodEnergyTrend: input.state.dailyStates.filter(
      (dailyState) =>
        dailyState.date >= input.from && dailyState.date <= input.to,
    ),
    procedureCosts,
    procedureCostsByMonth,
    selectedSelfCareCount: history.completions.filter((completion) =>
      isCompletionProgressStatus(completion.status),
    ).length,
  }
}

export function buildTodayItem(input: {
  date: string
  item: SelfCareItem
  occurrence: SelfCareOccurrence | null
  state: SelfCareStateSnapshot
}): SelfCareTodayItem {
  const scheduleRule =
    input.state.scheduleRules.find((rule) => rule.itemId === input.item.id) ??
    null
  const flexibleProgress =
    (input.item.type === 'flexible_goal' ||
      scheduleRule?.repeatKind === 'flexible_goal') &&
    scheduleRule?.flexibleTargetCount &&
    scheduleRule.flexiblePeriod
      ? buildFlexibleProgressForRule(
          input.date,
          scheduleRule,
          input.state.completions,
        )
      : null

  return {
    appointment:
      input.state.appointmentDetails.find(
        (details) => details.occurrenceId === input.occurrence?.id,
      ) ??
      input.state.appointmentDetails.find(
        (details) =>
          details.itemId === input.item.id && details.occurrenceId === null,
      ) ??
      input.state.appointmentDetails.find(
        (details) => details.itemId === input.item.id,
      ) ??
      null,
    completion:
      input.occurrence && input.occurrence.status !== 'scheduled'
        ? (input.state.completions.find(
            (completion) => completion.occurrenceId === input.occurrence?.id,
          ) ?? null)
        : null,
    courseDetails:
      input.state.courseDetails.find(
        (details) => details.itemId === input.item.id,
      ) ?? null,
    flexibleProgress,
    item: input.item,
    lastMeasurement: findLastMeasurementCompletion(
      input.state.completions,
      input.item.id,
    ),
    measurement:
      input.state.measurementDetails?.find(
        (details) => details.itemId === input.item.id,
      ) ?? null,
    occurrence: input.occurrence,
    procedure:
      input.state.procedureDetails.find(
        (details) => details.itemId === input.item.id,
      ) ?? null,
    scheduleRule,
    steps: input.state.steps
      .filter((step) => step.itemId === input.item.id)
      .sort((left, right) => left.order - right.order),
    timeGroup: resolveTimeGroup(input.item, input.occurrence, scheduleRule),
  }
}

export function buildSelfCareListResponse(
  state: SelfCareStateSnapshot,
  filters: {
    category?: SelfCareCategory | undefined
    includeArchived?: boolean | undefined
    type?: SelfCareItem['type'] | undefined
  } = {},
): SelfCareListResponse {
  const items = state.items.filter((item) => {
    if (item.type === 'mood_check') {
      return false
    }

    if (!filters.includeArchived && item.isArchived) {
      return false
    }

    if (filters.category && item.category !== filters.category) {
      return false
    }

    if (filters.type && item.type !== filters.type) {
      return false
    }

    return item.deletedAt === null
  })

  return {
    alternatives: state.alternatives,
    appointmentDetails: state.appointmentDetails,
    courseDetails: state.courseDetails,
    items: sortSelfCareItems(items),
    medicalDetails: state.medicalDetails,
    measurementDetails: state.measurementDetails ?? [],
    procedureDetails: state.procedureDetails,
    scheduleRules: state.scheduleRules,
    steps: state.steps.sort((left, right) => left.order - right.order),
  }
}

export function buildSystemSelfCareTemplates(): SelfCareTemplate[] {
  const now = '2026-06-06T00:00:00.000Z'
  const templates: Array<
    Omit<SelfCareTemplate, 'createdAt' | 'id' | 'isSystem' | 'updatedAt'>
  > = [
    template(
      'Медицинский чекап',
      'Раз в год: сохранить дату и результаты без медицинских интерпретаций.',
      'appointment',
      'medical',
      'required',
      { repeatKind: 'yearly', reminderOffsetsMinutes: [43_200, 10_080, 1_440] },
    ),
    template(
      'Стоматолог',
      'Мягкое напоминание раз в 6 месяцев.',
      'appointment',
      'medical',
      'required',
      {
        intervalUnit: 'month',
        intervalValue: 6,
        repeatKind: 'after_completion',
        reminderOffsetsMinutes: [43_200, 10_080, 1_440],
      },
    ),
    template(
      'Стрижка',
      'Каждые 6 недель после выполнения.',
      'appointment',
      'beauty',
      'recommended',
      {
        intervalUnit: 'week',
        intervalValue: 6,
        repeatKind: 'after_completion',
      },
    ),
    template(
      'Массаж',
      'Каждые 4 недели после выполнения.',
      'appointment',
      'relax',
      'recommended',
      {
        intervalUnit: 'week',
        intervalValue: 4,
        repeatKind: 'after_completion',
      },
    ),
    template('SPF', 'Каждое утро.', 'habit', 'daily_base', 'recommended', {
      preferredTime: '09:00',
      repeatKind: 'daily',
    }),
    template(
      'Утренний минимум',
      'Короткий чеклист для старта дня.',
      'ritual',
      'daily_base',
      'recommended',
      { preferredTime: '08:30', repeatKind: 'daily' },
      ['умыться', 'вода', 'лекарства или витамины', 'SPF', 'план дня'],
    ),
    template(
      'Вечернее восстановление',
      'Можно сделать полную или минимальную версию.',
      'ritual',
      'sleep',
      'gentle',
      { preferredTime: '21:30', repeatKind: 'daily' },
      [
        'душ или умывание',
        'подготовить вещи',
        'отложить экран',
        'короткая пауза',
        'лечь вовремя',
      ],
    ),
    template(
      'Йога',
      '3 раза в неделю.',
      'flexible_goal',
      'movement',
      'recommended',
      {
        flexiblePeriod: 'week',
        flexibleTargetCount: 3,
        repeatKind: 'flexible_goal',
      },
    ),
    template(
      'Прогулка',
      '5 раз в неделю.',
      'flexible_goal',
      'movement',
      'gentle',
      {
        flexiblePeriod: 'week',
        flexibleTargetCount: 5,
        repeatKind: 'flexible_goal',
      },
    ),
    template(
      'Пауза 20 минут',
      '3 раза в неделю.',
      'flexible_goal',
      'relax',
      'gentle',
      {
        flexiblePeriod: 'week',
        flexibleTargetCount: 3,
        repeatKind: 'flexible_goal',
      },
    ),
    template(
      'Витамины',
      'Курс на 30 дней.',
      'course',
      'health',
      'recommended',
      { repeatKind: 'course' },
    ),
  ]

  return templates.map((item, index) => ({
    ...item,
    createdAt: now,
    id: `system-self-care-template-${index + 1}`,
    isSystem: true,
    updatedAt: now,
  }))
}

function template(
  title: string,
  description: string,
  type: SelfCareTemplate['type'],
  category: SelfCareTemplate['category'],
  importance: SelfCareTemplate['importance'],
  defaultSchedule: unknown,
  defaultSteps: string[] = [],
): Omit<SelfCareTemplate, 'createdAt' | 'id' | 'isSystem' | 'updatedAt'> {
  return {
    category,
    color: null,
    defaultSchedule,
    defaultSteps,
    description,
    icon: null,
    importance,
    title,
    type,
  }
}

export function buildItemInputFromTemplate(
  templateRecord: SelfCareTemplate,
  overrides: SelfCareItemInputOverrides = {},
): SelfCareItemInput {
  const schedule = isRecord(templateRecord.defaultSchedule)
    ? templateRecord.defaultSchedule
    : {}
  const templateType =
    templateRecord.type === 'procedure' || templateRecord.type === 'medical'
      ? 'appointment'
      : templateRecord.type
  const scheduleDate =
    typeof schedule.startDate === 'string'
      ? schedule.startDate
      : getDateKey(new Date())
  const scheduleTime =
    typeof schedule.preferredTime === 'string'
      ? schedule.preferredTime
      : '09:00'
  const base: SelfCareItemInput = {
    alternatives: [],
    category: templateRecord.category,
    color: templateRecord.color,
    customCategoryId: null,
    defaultDurationMinutes: null,
    description: templateRecord.description,
    icon: templateRecord.icon,
    importance: templateRecord.importance,
    isActive: true,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: null,
    preferredTimeOfDay: inferPreferredTimeOfDay(schedule.preferredTime),
    scheduleRule: {
      allowMultiplePerDay: false,
      dayOfMonth: null,
      daysOfWeek: [],
      endDate: null,
      flexiblePeriod: null,
      flexibleTargetCount: null,
      generateInCalendar: false,
      generateInTaskList: true,
      intervalUnit: null,
      intervalValue: null,
      monthOfYear: null,
      preferredTime: null,
      reminderOffsetsMinutes: [],
      repeatKind: 'none',
      startDate: getDateKey(new Date()),
      timezone: null,
      weekOfMonth: null,
      ...schedule,
    } as SelfCareScheduleRuleInput,
    steps: templateRecord.defaultSteps.map((title, index) => ({
      defaultChecked: false,
      isOptional: false,
      order: index,
      title,
    })),
    title: templateRecord.title,
    type: templateType,
    ...(templateType === 'appointment'
      ? {
          appointmentDetails: {
            currency: null,
            endsAt: null,
            place: null,
            preparationNote: '',
            price: null,
            resultNote: null,
            specialistContact: null,
            specialistName: null,
            startsAt: `${scheduleDate}T${scheduleTime}:00.000Z`,
          },
        }
      : {}),
    ...(templateType === 'course'
      ? {
          courseDetails: {
            breakDays: 0,
            completedCount: 0,
            courseType: 'days',
            endDate: null,
            isCompleted: false,
            isPaused: false,
            repeatAfterCompletion: false,
            startDate: getDateKey(new Date()),
            totalCount: 30,
          },
        }
      : {}),
  }

  const definedOverrides = compactOverrides(overrides)
  const merged = {
    ...base,
    ...definedOverrides,
  } as SelfCareItemInput

  return {
    ...merged,
    alternatives: definedOverrides.alternatives ?? base.alternatives,
    scheduleRule: definedOverrides.scheduleRule ?? base.scheduleRule,
    steps: definedOverrides.steps ?? base.steps,
  }
}

export function mapHabitToSelfCareInput(habit: HabitRecord): SelfCareItemInput {
  const shouldUseFlexibleProgress =
    habit.targetType !== 'duration' && habit.targetValue > 1

  return {
    alternatives: [],
    category: 'daily_base',
    color: habit.color,
    customCategoryId: null,
    defaultDurationMinutes:
      habit.targetType === 'duration' ? habit.targetValue : null,
    description: habit.description,
    icon: habit.icon,
    importance: 'recommended',
    isActive: habit.isActive,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: habit.id,
    preferredTimeOfDay: inferPreferredTimeOfDay(habit.reminderTime),
    scheduleRule: {
      allowMultiplePerDay: false,
      dayOfMonth: null,
      daysOfWeek: habit.daysOfWeek,
      endDate: habit.endDate,
      flexiblePeriod: shouldUseFlexibleProgress ? 'day' : null,
      flexibleTargetCount: shouldUseFlexibleProgress ? habit.targetValue : null,
      generateInCalendar: false,
      generateInTaskList: true,
      intervalUnit: null,
      intervalValue: null,
      monthOfYear: null,
      preferredTime: habit.reminderTime,
      reminderOffsetsMinutes: [],
      repeatKind: shouldUseFlexibleProgress
        ? 'flexible_goal'
        : habit.frequency === 'daily'
          ? 'daily'
          : 'weekly',
      startDate: habit.startDate,
      timezone: null,
      weekOfMonth: null,
    },
    steps: [],
    title: habit.title,
    type: 'habit',
  }
}

export function mapHabitEntryToSelfCareCompletion(input: {
  entry: HabitEntryRecord
  item: SelfCareItem
}): SelfCareCompletion {
  return {
    alternativeTitle: null,
    completedAt: `${input.entry.date}T12:00:00.000Z`,
    completedVariant: 'full',
    createdAt: input.entry.createdAt,
    durationMinutes: null,
    energyAfter: null,
    energyBefore: null,
    id: generateUuidV7(),
    itemId: input.item.id,
    measurementUnit: null,
    measurementValue: null,
    moodAfter: null,
    moodBefore: null,
    note: input.entry.note,
    occurrenceId: null,
    scheduledFor: input.entry.date,
    status: input.entry.status === 'skipped' ? 'skipped' : 'done',
    userId: input.entry.userId,
  }
}

function inferDefaultScheduleRule(
  item: SelfCareItem,
  now: string,
): SelfCareScheduleRule | null {
  if (item.type === 'appointment' || item.type === 'task') {
    return null
  }

  if (item.type === 'flexible_goal') {
    return createScheduleRuleRecord(
      item.id,
      {
        allowMultiplePerDay: false,
        dayOfMonth: null,
        daysOfWeek: [],
        endDate: null,
        flexiblePeriod: 'week',
        flexibleTargetCount: 3,
        generateInCalendar: false,
        generateInTaskList: true,
        intervalUnit: null,
        intervalValue: null,
        monthOfYear: null,
        preferredTime: null,
        reminderOffsetsMinutes: [],
        repeatKind: 'flexible_goal',
        startDate: getDateKey(new Date()),
        timezone: null,
        weekOfMonth: null,
      },
      now,
    )
  }

  return createScheduleRuleRecord(
    item.id,
    {
      allowMultiplePerDay: false,
      dayOfMonth: null,
      daysOfWeek: [],
      endDate: null,
      flexiblePeriod: null,
      flexibleTargetCount: null,
      generateInCalendar: false,
      generateInTaskList: true,
      intervalUnit: null,
      intervalValue: null,
      monthOfYear: null,
      preferredTime: null,
      reminderOffsetsMinutes: [],
      repeatKind: item.type === 'course' ? 'course' : 'daily',
      startDate: getDateKey(new Date()),
      timezone: null,
      weekOfMonth: null,
    },
    now,
  )
}

function buildFlexibleProgressForRule(
  date: string,
  rule: SelfCareScheduleRule,
  completions: SelfCareCompletion[],
): SelfCareFlexibleGoalProgress | null {
  if (!rule.flexibleTargetCount || !rule.flexiblePeriod) {
    return null
  }

  const period = getFlexibleGoalPeriod(date, rule.flexiblePeriod)

  return getFlexibleGoalProgress({
    completions,
    itemId: rule.itemId,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    targetCount: rule.flexibleTargetCount,
  })
}

function isFlexibleGoalRuleActiveOnDate(input: {
  date: string
  item: SelfCareItem | null
  rule: SelfCareScheduleRule
}): boolean {
  const { date, item, rule } = input

  if (
    !item ||
    (item.type !== 'flexible_goal' && rule.repeatKind !== 'flexible_goal') ||
    !isVisibleSelfCareItem(item) ||
    !rule.flexibleTargetCount ||
    !rule.flexiblePeriod
  ) {
    return false
  }

  const startDate = rule.startDate ?? item.createdAt.slice(0, 10)

  if (date < startDate || (rule.endDate && date > rule.endDate)) {
    return false
  }

  if (rule.repeatKind === 'none') {
    const firstPeriod = getFlexibleGoalPeriod(startDate, rule.flexiblePeriod)
    return date >= firstPeriod.periodStart && date <= firstPeriod.periodEnd
  }

  if (rule.repeatKind === 'flexible_goal') {
    return true
  }

  if (rule.repeatKind === 'course' || rule.repeatKind === 'after_completion') {
    return false
  }

  const currentPeriod = getFlexibleGoalPeriod(date, rule.flexiblePeriod)
  const repeatInterval = getFlexibleGoalRepeatInterval(rule)

  return isRepeatingFlexiblePeriodActive({
    periodEnd: currentPeriod.periodEnd,
    periodStart: currentPeriod.periodStart,
    repeatInterval,
    startDate,
  })
}

function getFlexibleGoalRepeatInterval(rule: SelfCareScheduleRule): {
  unit: NonNullable<SelfCareScheduleRule['intervalUnit']>
  value: number
} {
  if (rule.repeatKind === 'daily') {
    return { unit: 'day', value: rule.intervalValue ?? 1 }
  }

  if (rule.repeatKind === 'weekly') {
    return { unit: 'week', value: rule.intervalValue ?? 1 }
  }

  if (rule.repeatKind === 'monthly') {
    return { unit: 'month', value: rule.intervalValue ?? 1 }
  }

  if (rule.repeatKind === 'yearly') {
    return { unit: 'year', value: rule.intervalValue ?? 1 }
  }

  return {
    unit: rule.intervalUnit ?? 'day',
    value: rule.intervalValue ?? 1,
  }
}

function isRepeatingFlexiblePeriodActive(input: {
  periodEnd: string
  periodStart: string
  repeatInterval: {
    unit: NonNullable<SelfCareScheduleRule['intervalUnit']>
    value: number
  }
  startDate: string
}): boolean {
  let cursor = input.startDate
  let guard = 0

  while (cursor < input.periodStart && guard < 5000) {
    cursor = addInterval(
      cursor,
      input.repeatInterval.value,
      input.repeatInterval.unit,
    )
    guard += 1
  }

  return cursor <= input.periodEnd
}

function buildPlanningHints(date: string, state: SelfCareStateSnapshot) {
  return state.items
    .filter(
      (item) =>
        item.isActive &&
        !item.isArchived &&
        item.deletedAt === null &&
        (item.type === 'appointment' ||
          item.type === 'procedure' ||
          item.type === 'medical'),
    )
    .flatMap((item) => {
      const rule = state.scheduleRules.find(
        (candidate) => candidate.itemId === item.id,
      )
      if (!rule || rule.repeatKind !== 'after_completion') {
        return []
      }

      if (hasOpenScheduledOccurrence(state, item, rule, date)) {
        return []
      }

      const lastCompletion = findLastCompletion(state.completions, item.id)
      if (!lastCompletion) {
        return [buildTodayItem({ date, item, occurrence: null, state })]
      }

      const nextDate = addInterval(
        lastCompletion.completedAt.slice(0, 10),
        rule.intervalValue ?? 1,
        rule.intervalUnit ?? 'month',
      )

      return nextDate <= addDays(date, 14)
        ? [buildTodayItem({ date: nextDate, item, occurrence: null, state })]
        : []
    })
}

function buildOverdueItems(
  date: string,
  state: SelfCareStateSnapshot,
  itemById: Map<string, SelfCareItem>,
) {
  return state.occurrences
    .filter(
      (occurrence) =>
        occurrence.status === 'scheduled' && occurrence.scheduledFor < date,
    )
    .flatMap((occurrence) => {
      const item = itemById.get(occurrence.itemId)

      if (!item || !shouldCarryOverOverdueItem(item, occurrence, state)) {
        return []
      }

      return [
        buildTodayItem({
          date: occurrence.scheduledFor,
          item,
          occurrence,
          state,
        }),
      ]
    })
    .sort(sortTodayItems)
}

function buildUpcomingImportant(date: string, state: SelfCareStateSnapshot) {
  const itemById = new Map(state.items.map((item) => [item.id, item]))

  return state.occurrences
    .filter(
      (occurrence) =>
        occurrence.scheduledFor >= date &&
        occurrence.scheduledFor <= addDays(date, 45) &&
        occurrence.status === 'scheduled',
    )
    .flatMap((occurrence) => {
      const item = itemById.get(occurrence.itemId)

      return item && isVisibleSelfCareItem(item) && item.type === 'medical'
        ? [
            buildTodayItem({
              date: occurrence.scheduledFor,
              item,
              occurrence,
              state,
            }),
          ]
        : []
    })
    .sort(sortTodayItems)
    .slice(0, 6)
}

function hasOpenScheduledOccurrence(
  state: SelfCareStateSnapshot,
  item: SelfCareItem,
  rule: SelfCareScheduleRule,
  date: string,
): boolean {
  return state.occurrences.some(
    (occurrence) =>
      occurrence.itemId === item.id &&
      occurrence.status === 'scheduled' &&
      (occurrence.scheduledFor < date ||
        !isPlanningOnlyAfterCompletionOccurrence({
          item,
          occurrence,
          rule,
          state,
        })),
  )
}

function isPlanningOnlyAfterCompletionOccurrence(input: {
  item: SelfCareItem
  occurrence: SelfCareOccurrence
  rule?: SelfCareScheduleRule | null | undefined
  state: SelfCareStateSnapshot
}): boolean {
  const rule =
    input.rule ??
    input.state.scheduleRules.find(
      (candidate) => candidate.id === input.occurrence.scheduleRuleId,
    ) ??
    input.state.scheduleRules.find(
      (candidate) => candidate.itemId === input.item.id,
    ) ??
    null

  return (
    input.occurrence.status === 'scheduled' &&
    isAfterCompletionPlanningItem(input.item, rule) &&
    !input.state.appointmentDetails.some(
      (details) => details.occurrenceId === input.occurrence.id,
    )
  )
}

function isAfterCompletionPlanningItem(
  item: SelfCareItem,
  rule: SelfCareScheduleRule | null,
): boolean {
  return (
    rule?.repeatKind === 'after_completion' &&
    AFTER_COMPLETION_PLANNING_ITEM_TYPES.has(item.type)
  )
}

function shouldCarryOverOverdueItem(
  item: SelfCareItem,
  occurrence: SelfCareOccurrence,
  state: SelfCareStateSnapshot,
): boolean {
  if (!isVisibleSelfCareItem(item)) {
    return false
  }

  if (
    item.type === 'appointment' ||
    item.type === 'medical' ||
    item.type === 'procedure' ||
    item.type === 'rest_action' ||
    item.type === 'task'
  ) {
    return true
  }

  const rule = state.scheduleRules.find(
    (candidate) => candidate.id === occurrence.scheduleRuleId,
  )

  return !rule || rule.repeatKind === 'after_completion'
}

export function shouldMarkSelfCareOccurrenceMissed(input: {
  date: string
  item: SelfCareItem
  occurrence: SelfCareOccurrence
  state: SelfCareStateSnapshot
}): boolean {
  return (
    isVisibleSelfCareItem(input.item) &&
    input.occurrence.status === 'scheduled' &&
    input.occurrence.scheduledFor < input.date &&
    !shouldCarryOverOverdueItem(input.item, input.occurrence, input.state)
  )
}

export function getMissedOccurrenceCutoffDate(
  requestedDate: string,
  now: Date = new Date(),
): string {
  const today = getDateKey(now)
  return requestedDate < today ? requestedDate : today
}

export function getSelfCareCompletionDateKey(
  input: Pick<SelfCareCompletionInput, 'completedAt'>,
): string {
  return (
    input.completedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  )
}

export function shouldDeduplicateSelfCareItemCompletion(input: {
  item: Pick<SelfCareItem, 'type'>
  scheduleRule: Pick<
    SelfCareScheduleRule,
    'allowMultiplePerDay' | 'repeatKind'
  > | null
}): boolean {
  return (
    input.item.type !== 'course' &&
    input.item.type !== 'flexible_goal' &&
    input.scheduleRule?.repeatKind !== 'flexible_goal' &&
    input.scheduleRule?.allowMultiplePerDay !== true
  )
}

export function shouldDeactivateCompletedFlexibleGoal(input: {
  completion: SelfCareCompletion
  completions: SelfCareCompletion[]
  item: SelfCareItem
  scheduleRule: SelfCareScheduleRule | null
}): boolean {
  const { completion, completions, item, scheduleRule } = input

  if (
    item.type !== 'flexible_goal' ||
    scheduleRule?.repeatKind !== 'none' ||
    !scheduleRule.flexiblePeriod ||
    !scheduleRule.flexibleTargetCount
  ) {
    return false
  }

  const startDate = scheduleRule.startDate ?? item.createdAt.slice(0, 10)
  const completionDate = completion.completedAt.slice(0, 10)
  const period = getFlexibleGoalPeriod(startDate, scheduleRule.flexiblePeriod)

  if (
    completionDate < period.periodStart ||
    completionDate > period.periodEnd
  ) {
    return false
  }

  const progress = getFlexibleGoalProgress({
    completions,
    itemId: item.id,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    targetCount: scheduleRule.flexibleTargetCount,
  })

  return progress.completedCount >= progress.targetCount
}

function isVisibleSelfCareItem(item: SelfCareItem): boolean {
  return (
    item.type !== 'mood_check' &&
    item.isActive &&
    !item.isArchived &&
    item.deletedAt === null
  )
}

function shouldShowInDashboard(
  entry: SelfCareTodayItem,
  settings: SelfCareSettings,
  date: string,
): boolean {
  if (shouldHideCourseDashboardEntry(entry)) {
    return false
  }

  if (!isGentleModeEnabled(settings, entry.occurrence?.scheduledFor ?? date)) {
    return true
  }

  return entry.item.category === 'daily_base' || entry.item.type === 'medical'
}

function shouldHideCourseDashboardEntry(entry: SelfCareTodayItem): boolean {
  if (entry.item.type !== 'course') {
    return false
  }

  if (entry.courseDetails?.isCompleted || entry.courseDetails?.isPaused) {
    return true
  }

  return Boolean(
    entry.occurrence &&
    entry.scheduleRule?.repeatKind === 'course' &&
    entry.scheduleRule.startDate &&
    entry.occurrence.scheduledFor < entry.scheduleRule.startDate,
  )
}

function resolveTimeGroup(
  item: SelfCareItem,
  occurrence: SelfCareOccurrence | null,
  rule: SelfCareScheduleRule | null,
): SelfCareTimeOfDay {
  const time = occurrence?.dueAt?.slice(11, 16) ?? rule?.preferredTime ?? null

  if (time) {
    const hour = Number(time.slice(0, 2))

    if (hour < 6) return 'night'
    if (hour < 12) return 'morning'
    if (hour < 18) return 'afternoon'
    if (hour < 23) return 'evening'
    return 'night'
  }

  return item.preferredTimeOfDay ?? 'anytime'
}

export function sortTodayItems(
  left: SelfCareTodayItem,
  right: SelfCareTodayItem,
): number {
  const leftTime = left.occurrence?.dueAt ?? left.appointment?.startsAt ?? ''
  const rightTime = right.occurrence?.dueAt ?? right.appointment?.startsAt ?? ''

  if (leftTime && rightTime && leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime)
  }

  return left.item.title.localeCompare(right.item.title, 'ru')
}

function sortPlanItems(
  left: SelfCareTodayItem,
  right: SelfCareTodayItem,
): number {
  const dateDiff = (left.occurrence?.scheduledFor ?? '').localeCompare(
    right.occurrence?.scheduledFor ?? '',
  )

  return dateDiff === 0 ? sortTodayItems(left, right) : dateDiff
}

export function sortSelfCareItems(items: SelfCareItem[]): SelfCareItem[] {
  return [...items].sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1
    }

    if (left.category !== right.category) {
      return left.category.localeCompare(right.category)
    }

    return left.title.localeCompare(right.title, 'ru')
  })
}

export function isGentleModeEnabled(
  settings: SelfCareSettings,
  date: string,
): boolean {
  return settings.gentleModeEnabledToday && settings.gentleModeDate === date
}

export function serializeTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function serializeNullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : serializeTimestamp(value)
}

export function serializeDate(value: unknown): string {
  if (value instanceof Date) return getDateKey(value)
  return String(value)
}

export function serializeNullableDate(value: unknown): string | null {
  return value === null || value === undefined ? null : serializeDate(value)
}

export function serializeNullableTime(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString().slice(11, 16)
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return String(value).slice(0, 5)
  }

  throw new Error('Unsupported time value.')
}

export function parseJsonArray<T>(value: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? (parsed as T[]) : fallback
    } catch {
      return fallback
    }
  }
  return fallback
}

function normalizeNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

function findLastCompletion(
  completions: SelfCareCompletion[],
  itemId: string,
): SelfCareCompletion | null {
  return (
    completions
      .filter(
        (completion) =>
          completion.itemId === itemId &&
          isCompletionProgressStatus(completion.status),
      )
      .sort((left, right) =>
        right.completedAt.localeCompare(left.completedAt),
      )[0] ?? null
  )
}

function findLastMeasurementCompletion(
  completions: SelfCareCompletion[],
  itemId: string,
): SelfCareCompletion | null {
  return (
    completions
      .filter(
        (completion) =>
          completion.itemId === itemId &&
          completion.measurementValue !== null &&
          isCompletionProgressStatus(completion.status),
      )
      .sort((left, right) =>
        right.completedAt.localeCompare(left.completedAt),
      )[0] ?? null
  )
}

function createEmptyCategoryCounts(): Record<SelfCareCategory, number> {
  return {
    beauty: 0,
    body: 0,
    custom: 0,
    daily_base: 0,
    emotional: 0,
    health: 0,
    medical: 0,
    movement: 0,
    nutrition: 0,
    relax: 0,
    sleep: 0,
  }
}

function inferPreferredTimeOfDay(time: unknown): SelfCareTimeOfDay {
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) {
    return 'anytime'
  }

  const hour = Number(time.slice(0, 2))
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  if (hour < 23) return 'evening'
  return 'night'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactOverrides(
  overrides: SelfCareItemInputOverrides,
): SelfCareItemInputOverrides {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      result[key] = value
    }
  }

  return result as SelfCareItemInputOverrides
}
